#include "texture_asset.hpp"
#include "animation_asset.hpp"
#include "ktex.hpp"
#include "resource_io.hpp"
#include "string_hash.hpp"
#include "sha256.hpp"
#include <map>
#include <emscripten.h>
extern "C" {
#include "lauxlib.h"
}
EM_JS(int,dst_texture_backend_ready,(),{return typeof Module['uploadNativeTexture']==='function'&&!!Module['nativeTextureBackendReady']?.()?1:0;});
EM_JS(int,dst_texture_exists,(uint32_t id),{return !!Module['hasNativeTexture']?.(id)?1:0;});
EM_JS(int,dst_texture_begin,(uint32_t id,uint32_t width,uint32_t height,uint32_t levels,char* error,int capacity),{
    try{Module['beginNativeTexture'](id,width,height,levels);return 0;}catch(failure){stringToUTF8(String(failure),error,capacity);return 1;}
});
EM_JS(int,dst_texture_upload,(uint32_t id,uint32_t level,uint32_t width,uint32_t height,const uint8_t* data,uint32_t size,char* error,int capacity),{
    try{Module['uploadNativeTexture'](id,level,width,height,HEAPU8.subarray(data,data+size));return 0;}catch(failure){stringToUTF8(String(failure),error,capacity);return 1;}
});
EM_JS(int,dst_texture_finish,(uint32_t id,char* error,int capacity),{
    try{Module['finishNativeTexture'](id);return 0;}catch(failure){stringToUTF8(String(failure),error,capacity);return 1;}
});
EM_JS(void,dst_texture_release,(uint32_t id),{Module['releaseNativeTexture']?.(id);});
namespace web_texture_asset {
namespace {
struct Record {std::vector<uint8_t> bytes;web_ktex::Texture texture;std::string hash;size_t retained_bytes=0;uint32_t references=0;bool uploaded=false;};
std::map<uint32_t,Record> cache;size_t retained=0;
constexpr size_t budget=128*1024*1024;
bool load_bytes(const std::string& path,std::vector<uint8_t>&& bytes,std::string& error){
    const auto id=web_strings::hash(path);if(cache.count(id))return true;
    Record record;if(!web_ktex::parse(bytes,record.texture,error)){error=path+": "+error;return false;}
    record.hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(bytes.data()),bytes.size()));record.bytes=std::move(bytes);
    record.retained_bytes=sizeof(Record)+128+record.bytes.capacity()+record.texture.mips.capacity()*sizeof(web_ktex::Mip)+record.hash.size();
    if(record.retained_bytes>budget-retained){error="KTEX encoded cache exceeds 128 MiB budget";return false;}
    retained+=record.retained_bytes;cache.emplace(id,std::move(record));return true;
}
bool load(const std::string& path,std::string& error){
    if(cache.count(web_strings::hash(path)))return true;
    std::vector<uint8_t> bytes;if(!web_resource_io::read(path,bytes,error))return false;return load_bytes(path,std::move(bytes),error);
}
bool upload(const std::string& path,std::string& error){
    auto id=web_strings::hash(path);auto& record=cache.at(id);if(record.uploaded&&dst_texture_exists(id))return true;
    if(!backend_ready()){error="UNIMPLEMENTED_NATIVE: client texture backend";return false;}
    char detail[2048]={0};const auto& first=record.texture.mips[0];
    if(dst_texture_begin(id,first.width,first.height,record.texture.mips.size(),detail,sizeof(detail))){error=detail;return false;}
    bool ok=true;std::vector<uint8_t> rgba;
    for(size_t i=0;i<record.texture.mips.size();++i){const auto& mip=record.texture.mips[i];
        if(!web_ktex::decode(record.bytes,record.texture,i,rgba,error)){ok=false;break;}
        if(dst_texture_upload(id,i,mip.width,mip.height,rgba.data(),rgba.size(),detail,sizeof(detail))){error=detail;ok=false;break;}
    }
    if(ok&&dst_texture_finish(id,detail,sizeof(detail))){error=detail;ok=false;}
    if(!ok){dst_texture_release(id);record.uploaded=false;return false;}record.uploaded=true;return true;
}
void integer(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
void text(lua_State* L,const char* name,const std::string& value){lua_pushlstring(L,value.data(),value.size());lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    bool all=lua_isnoneornil(L,1);lua_newtable(L);if(all){integer(L,"textures",cache.size());integer(L,"retainedBytes",retained);integer(L,"budget",budget);return 1;}
    auto id=web_strings::hash(luaL_checkstring(L,1));auto found=cache.find(id);if(found==cache.end()){lua_pop(L,1);lua_pushnil(L);return 1;}
    const auto& record=found->second;integer(L,"id",id);integer(L,"codec",record.texture.codec);integer(L,"references",record.references);integer(L,"retainedBytes",record.retained_bytes);text(L,"sourceSha256",record.hash);
    lua_pushboolean(L,record.uploaded&&dst_texture_exists(id));lua_setfield(L,-2,"textureReady");
    lua_newtable(L);int n=0;for(const auto& mip:record.texture.mips){lua_newtable(L);integer(L,"width",mip.width);integer(L,"height",mip.height);integer(L,"pitch",mip.pitch);integer(L,"bytes",mip.size);lua_rawseti(L,-2,++n);}lua_setfield(L,-2,"mips");return 1;
}
int decode_lua(lua_State* L){const char* path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=load(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);lua_settop(L,1);return inspect(L);
}
int mip_lua(lua_State* L){auto path=luaL_checkstring(L,1);int index=luaL_checkint(L,2);auto found=cache.find(web_strings::hash(path));
    if(found==cache.end())return luaL_error(L,"KTEX is not decoded");bool ok;
    {std::string error;std::vector<uint8_t> rgba;ok=web_ktex::decode(found->second.bytes,found->second.texture,static_cast<size_t>(index),rgba,error);
        if(ok){auto hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(rgba.data()),rgba.size()));lua_pushlstring(L,hash.data(),hash.size());}else lua_pushlstring(L,error.data(),error.size());}
    return ok?1:lua_error(L);
}
int upload_lua(lua_State* L){auto path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=load(path,error)&&upload(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);lua_settop(L,1);return inspect(L);
}
int animation_lua(lua_State* L){const char* path=luaL_checkstring(L,1);const char* atlas=luaL_checkstring(L,2);bool ok=false;
    {std::string error,key=std::string(path)+"#"+atlas;const auto* bundle=web_animation_asset::get(path);
        if(!bundle||!bundle->textures.count(atlas))error="Animation atlas is not decoded";
        else {auto bytes=bundle->textures.at(atlas).data;ok=load_bytes(key,std::move(bytes),error)&&upload(key,error);}
        if(ok){lua_settop(L,0);lua_pushlstring(L,key.data(),key.size());}else lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);return inspect(L);
}
int release_lua(lua_State* L){auto path=luaL_checkstring(L,1);auto found=cache.find(web_strings::hash(path));
    if(found!=cache.end()&&found->second.references)return luaL_error(L,"Texture is owned by loaded resources");release(path);return 0;
}
}
bool backend_ready(){return dst_texture_backend_ready()!=0;}
bool ready(const std::string& path){auto found=cache.find(web_strings::hash(path));return found!=cache.end()&&found->second.uploaded&&dst_texture_exists(found->first);}
bool dimensions(const std::string& path,uint16_t& width,uint16_t& height){
    auto found=cache.find(web_strings::hash(path));
    if(found==cache.end()||found->second.texture.mips.empty())return false;
    width=found->second.texture.mips[0].width;height=found->second.texture.mips[0].height;return true;
}
bool acquire(const std::string& path,std::string& error){
    if(!load(path,error))return false;auto& record=cache.at(web_strings::hash(path));
    if(!upload(path,error)){if(!record.references)release(path);return false;}++record.references;return true;
}
bool acquire_encoded(const std::string& key,const std::vector<uint8_t>& bytes,std::string& error){
    if(!cache.count(web_strings::hash(key))){auto copy=bytes;if(!load_bytes(key,std::move(copy),error))return false;}
    return acquire(key,error);
}
void release(const std::string& path){auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;
    if(found->second.references)--found->second.references;
    if(!found->second.references){if(found->second.uploaded)dst_texture_release(found->first);retained-=found->second.retained_bytes;cache.erase(found);}
}
void clear(){for(const auto& pair:cache)if(pair.second.uploaded)dst_texture_release(pair.first);cache.clear();retained=0;}
void install(lua_State* L){clear();lua_newtable(L);const luaL_Reg methods[]={{"Decode",decode_lua},{"Inspect",inspect},{"MipSha256",mip_lua},{"Upload",upload_lua},{"UploadAnimation",animation_lua},{"Release",release_lua},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setglobal(L,"WebTextures");}
}

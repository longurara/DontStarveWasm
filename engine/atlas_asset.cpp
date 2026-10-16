#include "atlas_asset.hpp"
#include "atlas_order.hpp"
#include "resource_io.hpp"
#include "string_hash.hpp"
#include "sha256.hpp"
#include "texture_asset.hpp"
#include <algorithm>
#include <csetjmp>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include "asset_xml.hpp"
extern "C" {
#include "lauxlib.h"
}
namespace web_atlas_asset {
namespace {
constexpr size_t budget=32*1024*1024;
struct Record {Atlas atlas;uint32_t references=0;bool initialized=false,deferred=false,texture_loaded=false,texture_owned=false;};
std::map<uint32_t,Record> cache;
size_t retained=0;bool client_role=false;
// RapidXML's parser frames contain trivial locals. Its documented no-exception
// handler/allocator can longjmp; DOM/context live on the heap before setjmp so
// cleanup remains defined and releases every pool block after malformed XML.
bool number(rapidxml::xml_node<>* node,const char* name,float& value){
    auto* attr=node->first_attribute(name);if(!attr||!attr->value_size())return false;
    char* end=nullptr;value=std::strtof(attr->value(),&end);
    while(end&&(*end==' '||*end=='\t'||*end=='\r'||*end=='\n'))++end;
    return end&&end!=attr->value()&&!*end&&std::isfinite(value);
}
bool parse(const std::string& path,std::vector<uint8_t>& bytes,Atlas& out,std::string& error){
    const auto document=std::make_unique<rapidxml::xml_document<>>();
    if(!web_asset_xml::parse(bytes,*document,16*1024*1024,error)){error="Invalid ATLAS "+error;return false;}
    auto* root=document->first_node("Atlas");
    if(!root){error="ATLAS requires Atlas root";return false;}
    auto* texture=root->first_node("Texture");auto* elements=root->first_node("Elements");
    auto* filename=texture?texture->first_attribute("filename"):nullptr;
    if(!filename||!filename->value_size()||!elements){error="ATLAS requires Texture filename and Elements";return false;}
    std::string file(filename->value(),filename->value_size());
    // Native concatenates the atlas directory and filename attribute. Loose
    // legacy terrain atlases can contain relative subdirectories; preserve
    // those spellings rather than silently repairing their texture references.
    if(file.size()>4096||file[0]=='/'||file.find_first_of("\\:\r\n\t")!=std::string::npos||file.find('\0')!=std::string::npos){
        error="Unsafe ATLAS texture filename";return false;
    }
    for(size_t start=0;start<=file.size();){auto end=file.find('/',start);if(end==std::string::npos)end=file.size();
        auto part=file.substr(start,end-start);if(part.empty()||part=="."||part==".."){error="Unsafe ATLAS texture filename";return false;}
        if(end==file.size())break;start=end+1;
    }
    auto slash=path.find_last_of('/');out.texture=(slash==std::string::npos?"":path.substr(0,slash+1))+file;
    for(auto* item=elements->first_node("Element");item;item=item->next_sibling("Element")){
        auto* name=item->first_attribute("name");
        if(!name||!name->value_size()||name->value_size()>4096||out.elements.size()>=100000){error="Invalid ATLAS element name/count";return false;}
        Element element;element.source_index=out.elements.size();element.name.assign(name->value(),name->value_size());element.id=web_strings::hash(element.name);
        const char* keys[]={"u1","v1","u2","v2"};
        for(int i=0;i<4;++i)if(!number(item,keys[i],element.uv[i])){error="Invalid ATLAS UV: "+element.name;return false;}
        out.elements.push_back(std::move(element));
    }
    ordering::sort(out.elements,0,out.elements.size(),out.elements.size());
    out.source_order.resize(out.elements.size());for(size_t i=0;i<out.elements.size();++i)out.source_order[out.elements[i].source_index]=i;
    out.retained_bytes=sizeof(Atlas)+out.texture.size()+out.elements.capacity()*sizeof(Element)+out.source_order.capacity()*sizeof(uint32_t)+128;
    for(const auto& element:out.elements)out.retained_bytes+=element.name.size();
    return true;
}
void integer(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
uint32_t string_id(lua_State* L,int index){
    if(lua_type(L,index)==LUA_TSTRING)return web_strings::hash(lua_tostring(L,index));
    double value=luaL_checknumber(L,index);
    // x64 CVTTSD2SI yields INT64_MIN for non-finite/out-of-range values;
    // the wrapper retains its low uint32 bits. Avoid undefined C++ casts.
    if(!std::isfinite(value)||value<-9223372036854775808.0||value>=9223372036854775808.0)return 0;
    return static_cast<uint32_t>(static_cast<int64_t>(value));
}
int contains(lua_State* L){
    uint32_t atlas=string_id(L,2),element=string_id(L,3);auto found=cache.find(atlas);bool present=false;
    if(found!=cache.end()&&found->second.initialized&&found->second.references){const auto& elements=found->second.atlas.elements;
        auto at=std::lower_bound(elements.begin(),elements.end(),element,[](const Element& item,uint32_t id){return item.id<id;});present=at!=elements.end()&&at->id==element;}
    lua_pushboolean(L,present);return 1;
}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);integer(L,"atlases",cache.size());integer(L,"retainedBytes",retained);integer(L,"budget",budget);return 1;}
    auto found=cache.find(web_strings::hash(luaL_checkstring(L,1)));if(found==cache.end()){lua_pushnil(L);return 1;}
    const auto& value=found->second.atlas;lua_newtable(L);
    lua_pushlstring(L,value.texture.data(),value.texture.size());lua_setfield(L,-2,"texture");integer(L,"references",found->second.references);
    integer(L,"retainedBytes",value.retained_bytes);lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");
    const auto& record=found->second;
    lua_pushboolean(L,record.initialized);lua_setfield(L,-2,"initialized");lua_pushboolean(L,record.deferred);lua_setfield(L,-2,"deferred");
    lua_pushboolean(L,record.texture_loaded);lua_setfield(L,-2,"textureLoaded");
    lua_pushboolean(L,record.texture_owned&&web_texture_asset::ready(value.texture));lua_setfield(L,-2,"textureReady");
    lua_newtable(L);int index=0;std::string transcript;
    for(const auto& item:value.elements){lua_newtable(L);integer(L,"id",item.id);
        lua_pushlstring(L,item.name.data(),item.name.size());lua_setfield(L,-2,"name");
        const char* keys[]={"u1","v1","u2","v2"};
        for(int i=0;i<4;++i){lua_pushnumber(L,item.uv[i]);lua_setfield(L,-2,keys[i]);}
        lua_rawseti(L,-2,++index);
        transcript.append(reinterpret_cast<const char*>(&item.id),4);transcript.append(reinterpret_cast<const char*>(item.uv.data()),16);
    }
    lua_setfield(L,-2,"elements");auto hash=web_crypto::sha256(transcript);lua_pushlstring(L,hash.data(),hash.size());lua_setfield(L,-2,"uvSha256");return 1;
}
int decode_lua(lua_State* L){const char* path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=load(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);return inspect(L);
}
int release_lua(lua_State* L){auto path=luaL_checkstring(L,1);auto found=cache.find(web_strings::hash(path));
    if(found!=cache.end()&&found->second.references)return luaL_error(L,"Atlas is owned by loaded prefabs");release(path);return 0;
}
int bind_lua(lua_State* L){auto path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=bind_texture(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);return inspect(L);
}
}
bool load(const std::string& path,std::string& error){
    auto id=web_strings::hash(path);if(cache.count(id))return true;
    std::vector<uint8_t> bytes;if(!web_resource_io::read(path,bytes,error))return false;
    Record record;if(!parse(path,bytes,record.atlas,error)){error=path+": "+error;return false;}
    if(record.atlas.retained_bytes>budget-retained){error="ATLAS memory budget exceeded";return false;}
    retained+=record.atlas.retained_bytes;cache.emplace(id,std::move(record));return true;
}
bool bind_texture(const std::string& path,std::string& error){
    auto found=cache.find(web_strings::hash(path));if(found==cache.end()){error="ATLAS is not decoded";return false;}
    auto& record=found->second;if(record.texture_loaded&&(!client_role||web_texture_asset::ready(record.atlas.texture)))return true;
    if(client_role){if(record.texture_owned)web_texture_asset::release(record.atlas.texture);record.texture_owned=false;
        if(!web_texture_asset::acquire(record.atlas.texture,error))return false;record.texture_owned=true;}
    record.texture_loaded=true;return true;
}
bool acquire(const std::string& path,bool deferred,std::string& error){
    auto existing=cache.find(web_strings::hash(path));
    if(!deferred&&client_role&&!web_texture_asset::backend_ready()&&(existing==cache.end()||!existing->second.initialized)){
        error="UNIMPLEMENTED_NATIVE: client atlas texture upload ("+path+")";return false;
    }
    if(!load(path,error))return false;auto& record=cache.at(web_strings::hash(path));
    // Generic native cache hits increment a lease without reapplying the load
    // flags. A dynamic atlas loaded first stays deferred on a regular hit.
    if(!record.initialized){
        if(!deferred&&!bind_texture(path,error)){if(!record.references)release(path);return false;}
        record.initialized=true;record.deferred=deferred;
    }
    ++record.references;return true;
}
void release(const std::string& path){auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;
    if(found->second.references)--found->second.references;
    if(!found->second.references){if(found->second.texture_owned)web_texture_asset::release(found->second.atlas.texture);retained-=found->second.atlas.retained_bytes;cache.erase(found);}
}
const Atlas* get(const std::string& path){auto found=cache.find(web_strings::hash(path));return found==cache.end()?nullptr:&found->second.atlas;}
const Atlas* get_owned(const std::string& path){auto found=cache.find(web_strings::hash(path));return found==cache.end()||!found->second.references?nullptr:&found->second.atlas;}
const Element* resolve_element(uint32_t atlas_id,uint32_t element_id,std::string* texture_path,bool* texture_ready){
    auto found=cache.find(atlas_id);if(found==cache.end()||!found->second.initialized||!found->second.references)return nullptr;
    auto& record=found->second;const auto& elements=record.atlas.elements;
    auto at=std::lower_bound(elements.begin(),elements.end(),element_id,[](const Element& item,uint32_t id){return item.id<id;});
    if(at==elements.end()||at->id!=element_id)return nullptr;
    if(!record.texture_loaded){
        if(!client_role){record.texture_loaded=true;}
        else if(web_texture_asset::backend_ready()){
            std::string error;if(web_texture_asset::acquire(record.atlas.texture,error)){record.texture_owned=true;record.texture_loaded=true;}
        }
    }
    if(texture_path)*texture_path=record.atlas.texture;
    if(texture_ready)*texture_ready=record.texture_owned&&web_texture_asset::ready(record.atlas.texture);
    return &(*at);
}
void clear(){for(const auto& pair:cache)if(pair.second.texture_owned)web_texture_asset::release(pair.second.atlas.texture);cache.clear();retained=0;}
void install(lua_State* L,bool client){clear();client_role=client;lua_newtable(L);const luaL_Reg methods[]={{"Decode",decode_lua},{"Inspect",inspect},{"BindTexture",bind_lua},{"Release",release_lua},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setglobal(L,"WebAtlases");
    lua_getglobal(L,"TheSim");lua_pushcfunction(L,contains);lua_setfield(L,-2,"AtlasContains");lua_pop(L,1);}
}

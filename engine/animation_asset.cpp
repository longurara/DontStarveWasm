#include "animation_asset.hpp"
#include "asset_zip.hpp"
#include "ktex.hpp"
#include "resource_io.hpp"
#include "sha256.hpp"
#include "string_hash.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
extern "C" {
#include "lauxlib.h"
}
namespace web_animation_asset {
namespace {
constexpr size_t budget=192*1024*1024;
struct Record {Bundle value;uint32_t references=0;uint64_t used=0;};
std::map<uint32_t,Record> cache;
size_t retained=0;
uint64_t usage=0,evictions=0;
struct Reader {
    const std::vector<uint8_t>& bytes;size_t pos=0;bool ok=true;
    explicit Reader(const std::vector<uint8_t>& data):bytes(data){}
    size_t left()const{return bytes.size()-pos;}
    uint32_t integer(size_t count){
        if(count>left()){ok=false;return 0;}uint32_t value=0;
        for(size_t i=0;i<count;++i)value|=static_cast<uint32_t>(bytes[pos++])<<(8*i);return value;
    }
    uint32_t u32(){return integer(4);}
    float number(){uint32_t value=u32();float result;std::memcpy(&result,&value,4);if(!std::isfinite(result))ok=false;return result;}
    std::string text(){uint32_t size=u32();if(size>left()||size>1000000){ok=false;return {};}
        std::string result(reinterpret_cast<const char*>(bytes.data()+pos),size);pos+=size;return result;}
    template<size_t N> std::array<float,N> floats(){std::array<float,N> out;for(float& value:out)value=number();return out;}
    bool done()const{return ok&&pos==bytes.size();}
};
bool build(const std::vector<uint8_t>& bytes,Bundle& out){
    Reader r(bytes);if(r.u32()!=0x444c4942||r.u32()!=6)return false;
    uint32_t symbols=r.u32(),frames=r.u32();out.build=r.text();uint32_t atlases=r.u32();
    if(symbols>100000||frames>1000000||atlases>256)return false;
    out.atlases.reserve(atlases);
    for(uint32_t i=0;i<atlases&&r.ok;++i)out.atlases.push_back(r.text());
    uint64_t observed=0;
    for(uint32_t i=0;i<symbols&&r.ok;++i){
        uint32_t id=r.u32(),count=r.u32();if(count>frames||count>r.left()/32||out.symbols.count(id))return false;
        Symbol symbol;symbol.frames.reserve(count);
        for(uint32_t f=0;f<count;++f){SymbolFrame frame;frame.frame=r.u32();frame.duration=r.u32();frame.bounds=r.floats<4>();frame.offset=r.u32();frame.count=r.u32();symbol.frames.push_back(frame);}
        observed+=count;out.symbols.emplace(id,std::move(symbol));
    }
    uint32_t vertices=r.u32();if(vertices>10000000||vertices>r.left()/24||observed!=frames)return false;
    out.vertices.reserve(vertices);
    for(uint32_t i=0;i<vertices;++i)out.vertices.push_back(r.floats<6>());
    uint32_t names=r.u32();if(names>100000)return false;
    for(uint32_t i=0;i<names&&r.ok;++i){uint32_t id=r.u32();auto name=r.text();auto symbol=out.symbols.find(id);if(symbol!=out.symbols.end())symbol->second.name=std::move(name);}
    uint64_t used=0;
    for(const auto& pair:out.symbols)for(const auto& frame:pair.second.frames){if(frame.offset>vertices||frame.count>vertices-frame.offset)return false;used+=frame.count;}
    return r.done()&&used==vertices;
}
bool animation(const std::vector<uint8_t>& bytes,Bundle& out){
    Reader r(bytes);if(r.u32()!=0x4d494e41||r.u32()!=4)return false;
    uint32_t elements=r.u32(),frames=r.u32(),events=r.u32(),clips=r.u32();
    if(std::max({elements,frames,events,clips})>10000000)return false;
    out.clips.reserve(clips);
    uint64_t observed_elements=0,observed_frames=0,observed_events=0;
    for(uint32_t i=0;i<clips&&r.ok;++i){
        Clip clip;clip.name=r.text();clip.facing=r.integer(1);clip.bank=r.u32();clip.rate=r.number();uint32_t count=r.u32();
        if(clip.rate<=0||clip.rate>240||count>100000||count>r.left()/24)return false;
        clip.frames.reserve(count);
        for(uint32_t j=0;j<count&&r.ok;++j){
            Frame frame;frame.bounds=r.floats<4>();uint32_t evs=r.u32();if(evs>r.left()/4)return false;
            frame.events.reserve(evs);
            for(uint32_t k=0;k<evs;++k)frame.events.push_back(r.u32());
            uint32_t items=r.u32();if(items>r.left()/40)return false;
            frame.elements.reserve(items);
            for(uint32_t k=0;k<items;++k){Element element;element.symbol=r.u32();element.frame=r.u32();element.layer=r.u32();element.matrix=r.floats<6>();element.depth=r.number();frame.elements.push_back(element);}
            observed_elements+=items;observed_events+=evs;clip.frames.push_back(std::move(frame));
        }
        observed_frames+=count;out.clips.push_back(std::move(clip));
    }
    uint32_t names=r.u32();if(names>1000000)return false;
    for(uint32_t i=0;i<names&&r.ok;++i){uint32_t id=r.u32();auto name=r.text();if(!out.names.emplace(id,std::move(name)).second)return false;}
    return r.done()&&observed_elements==elements&&observed_frames==frames&&observed_events==events;
}
bool texture(const std::vector<uint8_t>& bytes,Texture& out){
    web_ktex::Texture decoded;std::string error;if(!web_ktex::parse(bytes,decoded,error))return false;
    out.codec=decoded.codec;out.mips=decoded.mips.size();out.width=decoded.mips[0].width;out.height=decoded.mips[0].height;out.bytes=bytes.size();return true;
}
void integer(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
void append(std::string& text,const void* bytes,size_t size){if(size)text.append(static_cast<const char*>(bytes),size);}
bool decode(const std::vector<uint8_t>& bytes,Bundle& out,bool deferred,bool include_texture_bytes,std::string& error){
    std::map<std::string,std::vector<uint8_t>> files;if(!web_asset_zip::unpack(bytes,files,error))return false;
    auto anim=files.find("anim.bin"),bild=files.find("build.bin");
    if(!files.empty()&&anim==files.end()&&bild==files.end()){error="Animation ZIP has no ANIM/BILD";return false;}
    if(bild!=files.end()&&!build(bild->second,out)){error="Invalid or unsupported BILD (expected version 6)";return false;}
    if(anim!=files.end()&&!animation(anim->second,out)){error="Invalid or unsupported ANIM (expected version 4)";return false;}
    out.textures_deferred=deferred;out.source_hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(bytes.data()),bytes.size()));
    if(!deferred)for(const auto& name:out.atlases){auto file=files.find(name);Texture image;
        if(file==files.end()||!texture(file->second,image)){error="Invalid/missing KTEX atlas: "+name;return false;}out.textures.emplace(name,std::move(image));}
    static_assert(sizeof(Element)==40&&sizeof(std::array<float,6>)==24,"WASM asset layout changed");
    std::string vertices_raw,elements_raw,events_raw,symbols_raw;
    out.vertex_count=out.vertices.size();
    append(vertices_raw,out.vertices.data(),out.vertices.size()*24);
    for(const auto& pair:out.symbols){append(symbols_raw,&pair.first,4);uint32_t count=pair.second.frames.size();append(symbols_raw,&count,4);
        for(const auto& frame:pair.second.frames){append(symbols_raw,&frame.frame,4);append(symbols_raw,&frame.duration,4);append(symbols_raw,frame.bounds.data(),16);append(symbols_raw,&frame.offset,4);append(symbols_raw,&frame.count,4);}}
    out.frame_count=out.element_count=out.event_count=0;
    for(auto& clip:out.clips){
        clip.frame_count=clip.frames.size();
        for(const auto& frame:clip.frames){++out.frame_count;out.element_count+=frame.elements.size();out.event_count+=frame.events.size();append(elements_raw,frame.elements.data(),frame.elements.size()*40);append(events_raw,frame.events.data(),frame.events.size()*4);}
    }
    out.vertex_sha256=web_crypto::sha256(vertices_raw);
    out.element_sha256=web_crypto::sha256(elements_raw);
    out.event_sha256=web_crypto::sha256(events_raw);
    out.symbol_frame_sha256=web_crypto::sha256(symbols_raw);
    bool duplicate_hash=false;
    if(!include_texture_bytes&&!deferred){
        for(const auto& kv:cache)if(kv.second.value.source_hash==out.source_hash){duplicate_hash=true;break;}
    }
    const bool charge_full=include_texture_bytes||duplicate_hash;
    if(charge_full){
        out.retained_bytes=out.build.size()+out.source_hash.size()+out.atlases.capacity()*sizeof(std::string)+out.vertices.capacity()*sizeof(out.vertices[0])+out.clips.capacity()*sizeof(Clip);
        for(const auto& name:out.atlases)out.retained_bytes+=name.size();
        for(const auto& pair:out.symbols)out.retained_bytes+=sizeof(Symbol)+pair.second.name.size()+pair.second.frames.capacity()*sizeof(SymbolFrame);
        for(const auto& clip:out.clips){out.retained_bytes+=clip.name.size()+clip.frames.capacity()*sizeof(Frame);
            for(const auto& frame:clip.frames)out.retained_bytes+=frame.elements.capacity()*sizeof(Element)+frame.events.capacity()*sizeof(uint32_t);}
        for(const auto& image:out.textures)out.retained_bytes+=image.first.size()+image.second.bytes+sizeof(Texture);
        for(const auto& name:out.names)out.retained_bytes+=name.second.size();
    }
    std::vector<std::array<float,6>>().swap(out.vertices);
    for(auto& pair:out.symbols)std::vector<SymbolFrame>().swap(pair.second.frames);
    for(auto& clip:out.clips)std::vector<Frame>().swap(clip.frames);
    out.names.clear();
    if(!charge_full){
        out.retained_bytes=out.build.size()+out.source_hash.size()+out.atlases.capacity()*sizeof(std::string)+out.clips.capacity()*sizeof(Clip);
        for(const auto& name:out.atlases)out.retained_bytes+=name.size();
        for(const auto& pair:out.symbols)out.retained_bytes+=sizeof(Symbol)+pair.second.name.size();
        for(const auto& clip:out.clips)out.retained_bytes+=clip.name.size();
        for(const auto& image:out.textures)out.retained_bytes+=image.first.size()+sizeof(Texture);
    }
    return true;
}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);integer(L,"bundles",cache.size());integer(L,"retainedBytes",retained);integer(L,"budget",budget);integer(L,"evictions",evictions);return 1;}
    auto found=cache.find(web_strings::hash(luaL_checkstring(L,1)));if(found==cache.end()){lua_pushnil(L);return 1;}const auto& value=found->second.value;
    lua_newtable(L);lua_pushlstring(L,value.build.data(),value.build.size());lua_setfield(L,-2,"build");
    integer(L,"symbols",value.symbols.size());integer(L,"vertices",value.vertex_count);integer(L,"textures",value.textures.size());integer(L,"retainedBytes",value.retained_bytes);integer(L,"references",found->second.references);
    lua_pushboolean(L,value.textures_deferred);lua_setfield(L,-2,"texturesDeferred");integer(L,"declaredTextures",value.atlases.size());
    lua_pushlstring(L,value.source_hash.data(),value.source_hash.size());lua_setfield(L,-2,"sourceSha256");
    integer(L,"frames",value.frame_count);integer(L,"elements",value.element_count);integer(L,"events",value.event_count);
    lua_pushlstring(L,value.vertex_sha256.data(),value.vertex_sha256.size());lua_setfield(L,-2,"vertexSha256");
    lua_pushlstring(L,value.element_sha256.data(),value.element_sha256.size());lua_setfield(L,-2,"elementSha256");
    lua_pushlstring(L,value.event_sha256.data(),value.event_sha256.size());lua_setfield(L,-2,"eventSha256");
    lua_pushlstring(L,value.symbol_frame_sha256.data(),value.symbol_frame_sha256.size());lua_setfield(L,-2,"symbolFrameSha256");
    lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");lua_newtable(L);int index=0;
    for(const auto& clip:value.clips){lua_newtable(L);lua_pushlstring(L,clip.name.data(),clip.name.size());lua_setfield(L,-2,"name");integer(L,"bank",clip.bank);integer(L,"facing",clip.facing);integer(L,"frames",clip.frame_count);lua_pushnumber(L,clip.rate);lua_setfield(L,-2,"rate");lua_rawseti(L,-2,++index);}lua_setfield(L,-2,"clips");return 1;
}
int decode_lua(lua_State* L){
    const char* path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=load(path,error,false,true);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);return inspect(L);
}
int decode_render_lua(lua_State* L){
    const char* path=luaL_checkstring(L,1);
    std::string error;std::vector<uint8_t> bytes;
    if(!web_resource_io::read(path,bytes,error)){lua_pushlstring(L,error.data(),error.size());return lua_error(L);}
    std::map<std::string,std::vector<uint8_t>> files;
    if(!web_asset_zip::unpack(bytes,files,error)){lua_pushlstring(L,error.data(),error.size());return lua_error(L);}
    Bundle out;
    auto anim=files.find("anim.bin"),bild=files.find("build.bin");
    if(bild!=files.end()&&!build(bild->second,out)){lua_pushliteral(L,"Invalid BILD");return lua_error(L);}
    if(anim!=files.end()&&!animation(anim->second,out)){lua_pushliteral(L,"Invalid ANIM");return lua_error(L);}
    lua_newtable(L);
    lua_pushlstring(L,out.build.data(),out.build.size());lua_setfield(L,-2,"name");
    lua_createtable(L,static_cast<int>(out.atlases.size()),0);
    for(size_t i=0;i<out.atlases.size();++i){lua_pushlstring(L,out.atlases[i].data(),out.atlases[i].size());lua_rawseti(L,-2,static_cast<int>(i+1));}
    lua_setfield(L,-2,"atlases");
    lua_newtable(L);
    for(const auto& [sym_id,sym]:out.symbols){
        char key[32];std::snprintf(key,sizeof(key),"%u",sym_id);
        lua_newtable(L);
        if(!sym.name.empty()){lua_pushlstring(L,sym.name.data(),sym.name.size());lua_setfield(L,-2,"name");}
        lua_createtable(L,static_cast<int>(sym.frames.size()),0);
        for(size_t f=0;f<sym.frames.size();++f){
            const auto& sf=sym.frames[f];
            lua_newtable(L);
            integer(L,"frame",sf.frame);integer(L,"duration",sf.duration);integer(L,"offset",sf.offset);integer(L,"count",sf.count);
            lua_createtable(L,4,0);for(int b=0;b<4;++b){lua_pushnumber(L,sf.bounds[b]);lua_rawseti(L,-2,b+1);}lua_setfield(L,-2,"bbox");
            lua_rawseti(L,-2,static_cast<int>(f+1));
        }
        lua_setfield(L,-2,"frames");
        lua_setfield(L,-2,key);
    }
    lua_setfield(L,-2,"symbols");
    lua_createtable(L,static_cast<int>(out.vertices.size()),0);
    for(size_t i=0;i<out.vertices.size();++i){
        lua_createtable(L,6,0);
        for(int k=0;k<6;++k){lua_pushnumber(L,out.vertices[i][k]);lua_rawseti(L,-2,k+1);}
        lua_rawseti(L,-2,static_cast<int>(i+1));
    }
    lua_setfield(L,-2,"vertices");
    lua_createtable(L,static_cast<int>(out.clips.size()),0);
    for(size_t c=0;c<out.clips.size();++c){
        const auto& cl=out.clips[c];
        lua_newtable(L);
        lua_pushlstring(L,cl.name.data(),cl.name.size());lua_setfield(L,-2,"name");
        integer(L,"facing",cl.facing);integer(L,"bank",cl.bank);
        lua_pushnumber(L,cl.rate);lua_setfield(L,-2,"rate");
        lua_createtable(L,static_cast<int>(cl.frames.size()),0);
        for(size_t f=0;f<cl.frames.size();++f){
            const auto& fr=cl.frames[f];
            lua_newtable(L);
            lua_createtable(L,static_cast<int>(fr.elements.size()),0);
            for(size_t e=0;e<fr.elements.size();++e){
                const auto& el=fr.elements[e];
                lua_newtable(L);
                char skey[32];std::snprintf(skey,sizeof(skey),"%u",el.symbol);
                lua_pushstring(L,skey);lua_setfield(L,-2,"symbol");
                integer(L,"frame",el.frame);integer(L,"layer",el.layer);
                lua_pushnumber(L,el.depth);lua_setfield(L,-2,"depth");
                lua_createtable(L,6,0);for(int m=0;m<6;++m){lua_pushnumber(L,el.matrix[m]);lua_rawseti(L,-2,m+1);}lua_setfield(L,-2,"matrix");
                lua_rawseti(L,-2,static_cast<int>(e+1));
            }
            lua_setfield(L,-2,"elements");
            lua_rawseti(L,-2,static_cast<int>(f+1));
        }
        lua_setfield(L,-2,"frames");
        lua_rawseti(L,-2,static_cast<int>(c+1));
    }
    lua_setfield(L,-2,"animations");
    return 1;
}
int release_lua(lua_State* L){auto path=luaL_checkstring(L,1);auto found=cache.find(web_strings::hash(path));
    if(found!=cache.end()&&found->second.references)return luaL_error(L,"Asset is owned by loaded prefabs");release(path);return 0;}
}
bool load(const std::string& path,std::string& error,bool deferred,bool include_texture_bytes){
    auto id=web_strings::hash(path);auto existing=cache.find(id);if(existing!=cache.end()){existing->second.used=++usage;return true;}
    std::vector<uint8_t> bytes;if(!web_resource_io::read(path,bytes,error))return false;
    Bundle value;if(!decode(bytes,value,deferred,include_texture_bytes,error)){error=path+": "+error;return false;}
    if(value.retained_bytes>budget){error="Animation asset exceeds memory budget";return false;}
    while(value.retained_bytes>budget-retained){
        auto oldest=cache.end();
        for(auto at=cache.begin();at!=cache.end();++at)if(!at->second.references&&(oldest==cache.end()||at->second.used<oldest->second.used))oldest=at;
        if(oldest==cache.end()){error="Animation asset memory budget exceeded by active resources";return false;}
        retained-=oldest->second.value.retained_bytes;cache.erase(oldest);++evictions;
    }
    retained+=value.retained_bytes;Record record;record.value=std::move(value);record.used=++usage;cache.emplace(id,std::move(record));return true;
}
bool acquire(const std::string& path,std::string& error,bool deferred){if(!load(path,error,deferred,false))return false;++cache.at(web_strings::hash(path)).references;return true;}
void release(const std::string& path){auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;if(found->second.references)--found->second.references;
    if(!found->second.references){retained-=found->second.value.retained_bytes;cache.erase(found);}}
const Bundle* get(const std::string& path){auto found=cache.find(web_strings::hash(path));return found==cache.end()?nullptr:&found->second.value;}
void clear(){cache.clear();retained=0;usage=evictions=0;}
void install(lua_State* L){clear();lua_newtable(L);const luaL_Reg methods[]={{"Decode",decode_lua},{"DecodeRenderData",decode_render_lua},{"Inspect",inspect},{"Release",release_lua},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setglobal(L,"WebAssets");}
}

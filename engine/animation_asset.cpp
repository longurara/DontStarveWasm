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
    for(uint32_t i=0;i<atlases&&r.ok;++i)out.atlases.push_back(r.text());
    uint64_t observed=0;
    for(uint32_t i=0;i<symbols&&r.ok;++i){
        uint32_t id=r.u32(),count=r.u32();if(count>frames||count>r.left()/32||out.symbols.count(id))return false;
        Symbol symbol;
        for(uint32_t f=0;f<count;++f){SymbolFrame frame;frame.frame=r.u32();frame.duration=r.u32();frame.bounds=r.floats<4>();frame.offset=r.u32();frame.count=r.u32();symbol.frames.push_back(frame);}
        observed+=count;out.symbols.emplace(id,std::move(symbol));
    }
    uint32_t vertices=r.u32();if(vertices>10000000||vertices>r.left()/24||observed!=frames)return false;
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
    uint64_t observed_elements=0,observed_frames=0,observed_events=0;
    for(uint32_t i=0;i<clips&&r.ok;++i){
        Clip clip;clip.name=r.text();clip.facing=r.integer(1);clip.bank=r.u32();clip.rate=r.number();uint32_t count=r.u32();
        if(clip.rate<=0||clip.rate>240||count>100000||count>r.left()/24)return false;
        for(uint32_t j=0;j<count&&r.ok;++j){
            Frame frame;frame.bounds=r.floats<4>();uint32_t evs=r.u32();if(evs>r.left()/4)return false;
            for(uint32_t k=0;k<evs;++k)frame.events.push_back(r.u32());
            uint32_t items=r.u32();if(items>r.left()/40)return false;
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
    out.codec=decoded.codec;out.mips=decoded.mips.size();out.width=decoded.mips[0].width;out.height=decoded.mips[0].height;out.data=bytes;return true;
}
bool decode(const std::vector<uint8_t>& bytes,Bundle& out,bool deferred,std::string& error){
    std::map<std::string,std::vector<uint8_t>> files;if(!web_asset_zip::unpack(bytes,files,error))return false;
    auto anim=files.find("anim.bin"),bild=files.find("build.bin");
    if(anim==files.end()&&bild==files.end()){error="Animation ZIP has no ANIM/BILD";return false;}
    if(bild!=files.end()&&!build(bild->second,out)){error="Invalid or unsupported BILD (expected version 6)";return false;}
    if(anim!=files.end()&&!animation(anim->second,out)){error="Invalid or unsupported ANIM (expected version 4)";return false;}
    out.textures_deferred=deferred;out.source_hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(bytes.data()),bytes.size()));
    if(!deferred)for(const auto& name:out.atlases){auto file=files.find(name);Texture image;
        if(file==files.end()||!texture(file->second,image)){error="Invalid/missing KTEX atlas: "+name;return false;}out.textures.emplace(name,std::move(image));}
    out.retained_bytes=1024+out.build.size()+out.source_hash.size()+out.atlases.capacity()*sizeof(std::string)+out.vertices.capacity()*sizeof(out.vertices[0])+out.clips.capacity()*sizeof(Clip);
    for(const auto& name:out.atlases)out.retained_bytes+=name.size();
    for(const auto& pair:out.symbols)out.retained_bytes+=64+sizeof(Symbol)+pair.second.name.size()+pair.second.frames.capacity()*sizeof(SymbolFrame);
    for(const auto& clip:out.clips){out.retained_bytes+=clip.name.size()+clip.frames.capacity()*sizeof(Frame);
        for(const auto& frame:clip.frames)out.retained_bytes+=frame.elements.capacity()*sizeof(Element)+frame.events.capacity()*sizeof(uint32_t);}
    for(const auto& image:out.textures)out.retained_bytes+=64+image.first.size()+image.second.data.capacity()+sizeof(Texture);
    for(const auto& name:out.names)out.retained_bytes+=name.second.size()+64;
    return true;
}
void integer(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
void append(std::string& text,const void* bytes,size_t size){if(size)text.append(static_cast<const char*>(bytes),size);}
void digest(lua_State* L,const char* name,const std::string& bytes){auto hash=web_crypto::sha256(bytes);lua_pushlstring(L,hash.data(),hash.size());lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);integer(L,"bundles",cache.size());integer(L,"retainedBytes",retained);integer(L,"budget",budget);integer(L,"evictions",evictions);return 1;}
    auto found=cache.find(web_strings::hash(luaL_checkstring(L,1)));if(found==cache.end()){lua_pushnil(L);return 1;}const auto& value=found->second.value;
    lua_newtable(L);lua_pushlstring(L,value.build.data(),value.build.size());lua_setfield(L,-2,"build");
    integer(L,"symbols",value.symbols.size());integer(L,"vertices",value.vertices.size());integer(L,"textures",value.textures.size());integer(L,"retainedBytes",value.retained_bytes);integer(L,"references",found->second.references);
    lua_pushboolean(L,value.textures_deferred);lua_setfield(L,-2,"texturesDeferred");integer(L,"declaredTextures",value.atlases.size());
    lua_pushlstring(L,value.source_hash.data(),value.source_hash.size());lua_setfield(L,-2,"sourceSha256");
    std::string vertices,elements,events,symbols;
    static_assert(sizeof(Element)==40&&sizeof(std::array<float,6>)==24,"WASM asset layout changed");
    append(vertices,value.vertices.data(),value.vertices.size()*24);
    for(const auto& pair:value.symbols){append(symbols,&pair.first,4);uint32_t count=pair.second.frames.size();append(symbols,&count,4);
        for(const auto& frame:pair.second.frames){append(symbols,&frame.frame,4);append(symbols,&frame.duration,4);append(symbols,frame.bounds.data(),16);append(symbols,&frame.offset,4);append(symbols,&frame.count,4);}}
    size_t frame_count=0,element_count=0,event_count=0;
    for(const auto& clip:value.clips)for(const auto& frame:clip.frames){++frame_count;element_count+=frame.elements.size();event_count+=frame.events.size();append(elements,frame.elements.data(),frame.elements.size()*40);append(events,frame.events.data(),frame.events.size()*4);}
    integer(L,"frames",frame_count);integer(L,"elements",element_count);integer(L,"events",event_count);
    digest(L,"vertexSha256",vertices);digest(L,"elementSha256",elements);digest(L,"eventSha256",events);digest(L,"symbolFrameSha256",symbols);
    lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");lua_newtable(L);int index=0;
    for(const auto& clip:value.clips){lua_newtable(L);lua_pushlstring(L,clip.name.data(),clip.name.size());lua_setfield(L,-2,"name");integer(L,"bank",clip.bank);integer(L,"facing",clip.facing);integer(L,"frames",clip.frames.size());lua_pushnumber(L,clip.rate);lua_setfield(L,-2,"rate");lua_rawseti(L,-2,++index);}lua_setfield(L,-2,"clips");return 1;
}
int decode_lua(lua_State* L){
    const char* path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=load(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);return inspect(L);
}
int release_lua(lua_State* L){auto path=luaL_checkstring(L,1);auto found=cache.find(web_strings::hash(path));
    if(found!=cache.end()&&found->second.references)return luaL_error(L,"Asset is owned by loaded prefabs");release(path);return 0;}
}
bool load(const std::string& path,std::string& error,bool deferred){
    auto id=web_strings::hash(path);auto existing=cache.find(id);if(existing!=cache.end()){existing->second.used=++usage;return true;}
    std::vector<uint8_t> bytes;if(!web_resource_io::read(path,bytes,error))return false;
    Bundle value;if(!decode(bytes,value,deferred,error)){error=path+": "+error;return false;}
    if(value.retained_bytes>budget){error="Animation asset exceeds memory budget";return false;}
    while(value.retained_bytes>budget-retained){
        auto oldest=cache.end();
        for(auto at=cache.begin();at!=cache.end();++at)if(!at->second.references&&(oldest==cache.end()||at->second.used<oldest->second.used))oldest=at;
        if(oldest==cache.end()){error="Animation asset memory budget exceeded by active resources";return false;}
        retained-=oldest->second.value.retained_bytes;cache.erase(oldest);++evictions;
    }
    retained+=value.retained_bytes;Record record;record.value=std::move(value);record.used=++usage;cache.emplace(id,std::move(record));return true;
}
bool acquire(const std::string& path,std::string& error,bool deferred){if(!load(path,error,deferred))return false;++cache.at(web_strings::hash(path)).references;return true;}
void release(const std::string& path){auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;if(found->second.references)--found->second.references;
    if(!found->second.references){retained-=found->second.value.retained_bytes;cache.erase(found);}}
const Bundle* get(const std::string& path){auto found=cache.find(web_strings::hash(path));return found==cache.end()?nullptr:&found->second.value;}
void clear(){cache.clear();retained=0;usage=evictions=0;}
void install(lua_State* L){clear();lua_newtable(L);const luaL_Reg methods[]={{"Decode",decode_lua},{"Inspect",inspect},{"Release",release_lua},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setglobal(L,"WebAssets");}
}

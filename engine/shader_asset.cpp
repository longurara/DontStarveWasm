#include "shader_asset.hpp"
#include "resource_io.hpp"
#include "sha256.hpp"
#include "string_hash.hpp"
#include <cmath>
#include <cstring>
#include <map>
#include <emscripten.h>
extern "C" {
#include "lauxlib.h"
}
EM_JS(int,dst_shader_backend_ready,(),{
    return typeof Module['compileNativeShader']==='function'&&typeof Module['nativeShaderBackendReady']==='function'&&Module['nativeShaderBackendReady']()?1:0;
});
EM_JS(int,dst_compile_shader,(uint32_t id,const char* path,const char* vertex,const char* fragment,int fallback,char* error,int capacity),{
    try{
        if(typeof Module['compileNativeShader']!=='function')throw new Error('UNIMPLEMENTED_NATIVE: client shader backend');
        Module['compileNativeShader'](id,UTF8ToString(vertex),UTF8ToString(fragment),UTF8ToString(path),!!fallback);return 0;
    }catch(failure){stringToUTF8(String(failure),error,capacity);return 1;}
});
EM_JS(void,dst_release_shader,(uint32_t id),{Module['releaseNativeShader']?.(id);});
namespace web_shader_asset {
namespace {
struct Record {Shader shader;uint32_t references=0;bool compiled=false;};
std::map<uint32_t,Record> cache;
size_t retained=0;bool client_role=false;
constexpr size_t budget=16*1024*1024;
struct Reader {
    const std::vector<uint8_t>& bytes;size_t pos=0;bool ok=true;
    size_t left()const{return bytes.size()-pos;}
    uint32_t u32(){if(left()<4){ok=false;return 0;}uint32_t value=0;for(int i=0;i<4;++i)value|=static_cast<uint32_t>(bytes[pos++])<<(i*8);return value;}
    std::string text(size_t limit){uint32_t size=u32();if(size>limit||size>left()){ok=false;return {};}
        std::string value(reinterpret_cast<const char*>(bytes.data()+pos),size);pos+=size;return value;}
    float number(){uint32_t bits=u32();float value;std::memcpy(&value,&bits,4);if(!std::isfinite(value))ok=false;return value;}
};
bool identifier(const std::string& name){
    if(name.empty())return false;
    for(size_t i=0;i<name.size();++i){unsigned char c=name[i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||c=='_'||(i&&c>='0'&&c<='9')))return false;}
    return true;
}
bool decode(const std::vector<uint8_t>& bytes,Shader& out,std::string& error){
    if(bytes.size()>8*1024*1024){error="KSH exceeds byte limit";return false;}
    Reader r{bytes};out.name=r.text(4096);uint32_t count=r.u32();
    if(!identifier(out.name)||count>4096){error="Invalid KSH name/uniform count";return false;}
    for(uint32_t i=0;i<count&&r.ok;++i){
        Uniform uniform;uniform.name=r.text(4096);uniform.alias=r.text(4096);uniform.kind=r.u32();uniform.count=r.u32();
        if(!identifier(uniform.name)||(!uniform.alias.empty()&&!identifier(uniform.alias))||!uniform.count||uniform.count>4096){error="Invalid KSH uniform name/count";return false;}
        uint32_t components=0;
        switch(uniform.kind){case 0:components=1;break;case 2:components=2;break;case 3:components=3;break;case 4:components=4;break;case 20:components=16;break;case 43:break;default:error="Unsupported KSH uniform kind";return false;}
        if(components){uint32_t defaults=r.u32();if(defaults>components*uniform.count||defaults>r.left()/4){error="Invalid KSH uniform defaults";return false;}
            for(uint32_t n=0;n<defaults;++n)uniform.defaults.push_back(r.number());}
        out.uniforms.push_back(std::move(uniform));
    }
    for(auto& stage:out.stages){
        stage.file=r.text(4096);stage.source=r.text(2*1024*1024);
        if(stage.file.empty()||stage.file.find('\0')!=std::string::npos||stage.source.empty()||stage.source.back()!=0||stage.source.find('\0')!=stage.source.size()-1){error="Invalid KSH source terminator/file";return false;}
    }
    for(auto& stage:out.stages){uint32_t bindings=r.u32();if(bindings>4096||bindings>r.left()/4){error="Invalid KSH stage binding count";return false;}
        for(uint32_t i=0;i<bindings;++i){uint32_t index=r.u32();if(index>=count){error="Invalid KSH stage uniform index";return false;}stage.uniforms.push_back(index);}
    }
    if(!r.ok||r.pos!=bytes.size()){error="Truncated KSH or trailing data";return false;}
    out.source_hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(bytes.data()),bytes.size()));
    out.retained_bytes=sizeof(Shader)+128+out.name.size()+out.source_hash.size()+out.uniforms.capacity()*sizeof(Uniform);
    for(const auto& value:out.uniforms)out.retained_bytes+=value.name.size()+value.alias.size()+value.defaults.capacity()*sizeof(float);
    for(const auto& stage:out.stages)out.retained_bytes+=stage.file.size()+stage.source.size()+stage.uniforms.capacity()*sizeof(uint32_t);
    return true;
}
void integer(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
void text(lua_State* L,const char* name,const std::string& value){lua_pushlstring(L,value.data(),value.size());lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);integer(L,"shaders",cache.size());integer(L,"retainedBytes",retained);integer(L,"budget",budget);return 1;}
    auto found=cache.find(web_strings::hash(luaL_checkstring(L,1)));if(found==cache.end()){lua_pushnil(L);return 1;}
    const auto& value=found->second.shader;lua_newtable(L);text(L,"name",value.name);text(L,"sourceSha256",value.source_hash);
    integer(L,"references",found->second.references);integer(L,"retainedBytes",value.retained_bytes);
    lua_pushboolean(L,found->second.compiled);lua_setfield(L,-2,"programReady");lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");
    lua_newtable(L);int n=0;
    for(const auto& uniform:value.uniforms){lua_newtable(L);text(L,"name",uniform.name);text(L,"alias",uniform.alias);integer(L,"kind",uniform.kind);integer(L,"count",uniform.count);
        lua_newtable(L);int k=0;for(float number:uniform.defaults){lua_pushnumber(L,number);lua_rawseti(L,-2,++k);}lua_setfield(L,-2,"defaults");lua_rawseti(L,-2,++n);}
    lua_setfield(L,-2,"uniforms");lua_newtable(L);n=0;
    for(const auto& stage:value.stages){lua_newtable(L);text(L,"kind",n?"fragment":"vertex");text(L,"file",stage.file);
        // The original JSON encoder does not escape NUL and dst_result is a
        // C-string boundary. Diagnostic text omits the validated terminator;
        // retained KSH bytes/hash and the actual compiler input stay intact.
        lua_pushlstring(L,stage.source.data(),stage.source.size()-1);lua_setfield(L,-2,"source");integer(L,"sourceBytes",stage.source.size());
        lua_pushboolean(L,true);lua_setfield(L,-2,"terminated");
        lua_newtable(L);int k=0;for(uint32_t index:stage.uniforms){lua_pushnumber(L,index);lua_rawseti(L,-2,++k);}lua_setfield(L,-2,"uniforms");lua_rawseti(L,-2,++n);}
    lua_setfield(L,-2,"stages");return 1;
}
int decode_lua(lua_State* L){auto path=luaL_checkstring(L,1);bool ok;
    {std::string error;ok=load(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}
    if(!ok)return lua_error(L);return inspect(L);
}
int release_lua(lua_State* L){auto path=luaL_checkstring(L,1);auto found=cache.find(web_strings::hash(path));
    if(found!=cache.end()&&found->second.references)return luaL_error(L,"Shader is owned by loaded prefabs");release(path);return 0;
}
}
bool load(const std::string& path,std::string& error){
    uint32_t id=web_strings::hash(path);if(cache.count(id))return true;
    std::vector<uint8_t> bytes;if(!web_resource_io::read(path,bytes,error))return false;
    Record record;if(!decode(bytes,record.shader,error)){error=path+": "+error;return false;}
    if(record.shader.retained_bytes>budget-retained){error="KSH memory budget exceeded";return false;}
    retained+=record.shader.retained_bytes;cache.emplace(id,std::move(record));return true;
}
bool backend_ready(){return dst_shader_backend_ready()!=0;}
bool acquire(const std::string& path,bool fallback,std::string& error){
    if(!load(path,error))return false;auto id=web_strings::hash(path);auto& record=cache.at(id);
    if(client_role){char detail[2048]={0};
        if(dst_compile_shader(id,path.c_str(),record.shader.stages[0].source.c_str(),record.shader.stages[1].source.c_str(),fallback,detail,sizeof(detail))){
            error=detail;if(!record.references)release(path);return false;
        }
        record.compiled=true;
    }
    ++record.references;return true;
}
void release(const std::string& path){auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;
    if(found->second.references)--found->second.references;
    if(!found->second.references){if(found->second.compiled)dst_release_shader(found->first);retained-=found->second.shader.retained_bytes;cache.erase(found);}
}
void clear(){for(const auto& pair:cache)if(pair.second.compiled)dst_release_shader(pair.first);cache.clear();retained=0;}
void install(lua_State* L,bool client){clear();client_role=client;lua_newtable(L);const luaL_Reg methods[]={{"Decode",decode_lua},{"Inspect",inspect},{"Release",release_lua},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setglobal(L,"WebShaders");}
}

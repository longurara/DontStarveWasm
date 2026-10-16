#include "postprocessor.hpp"
#include "string_hash.hpp"
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_postprocessor {
namespace {
struct Uniform {uint32_t dimensions=0;std::array<float,4> values{};};
struct Sampler {int32_t wrap=4,min_filter=4,mag_filter=4,mip_filter=3;};
web_components::EntityHost host{};bool client_role=false,enabled=true;
std::set<uint32_t> owners;
// Native components forward to one renderer-owned PostProcessor manager.
// Uniform StringIDs and values are shared across all owner entities.
std::map<uint32_t,Uniform> uniforms;
std::vector<Sampler> samplers;
constexpr size_t owner_budget=50000,uniform_budget=8192,sampler_budget=8192;
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.PostProcessor"));}
void live(lua_State* L){auto id=owner(L);
    if(!host.alive(id)||!owners.count(id))luaL_error(L,"PostProcessor owner is removed");
}
uint32_t native_integer(double value){
    if(!std::isfinite(value)||value<-9223372036854775808.0||value>=9223372036854775808.0)return 0;
    return static_cast<uint32_t>(static_cast<int64_t>(value));
}
int32_t native_i32(double value){
    if(!std::isfinite(value)||value<-2147483648.0||value>=2147483648.0)return INT32_MIN;
    return static_cast<int32_t>(value);
}
int add(lua_State* L){auto id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add PostProcessor to a removed entity");
    if(client_role)return luaL_error(L,"UNIMPLEMENTED_NATIVE: client PostProcessor render graph");
    if(!owners.count(id)){
        if(owners.size()>=owner_budget)return luaL_error(L,"PostProcessor count exceeds budget");
        owners.insert(id);
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.PostProcessor");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"PostProcessor");}lua_pop(L,1);}
    lua_pop(L,1);return 1;
}
int set_enabled(lua_State* L){live(L);luaL_checktype(L,2,LUA_TBOOLEAN);enabled=lua_toboolean(L,2);return 0;}
int add_uniform(lua_State* L){live(L);const char* name=luaL_checkstring(L,2);
    uint32_t dimensions=native_integer(luaL_checknumber(L,3));
    // Native's switch leaves a pointer uninitialized outside 1..4. Report a
    // controlled error rather than copying that invalid memory access.
    if(dimensions<1||dimensions>4)return luaL_error(L,"PostProcessor uniform dimensions outside 1..4");
    uint32_t id=web_strings::hash(name);
    if(!uniforms.count(id)&&uniforms.size()>=uniform_budget)return luaL_error(L,"PostProcessor uniform count exceeds budget");
    uniforms[id]=Uniform{dimensions,{}};lua_pushnumber(L,id);return 1;
}
int set_uniform(lua_State* L){live(L);uint32_t id=native_integer(luaL_checknumber(L,2));auto found=uniforms.find(id);
    // Native does not inspect any values when the StringID is absent.
    if(found==uniforms.end())return 0;
    int count=lua_gettop(L)-2;auto& uniform=found->second;
    if(count>128)return luaL_error(L,"PostProcessor uniform argument count exceeds budget");
    // Native walks every argument without a dimension bound; numeric extras
    // can overwrite the previous-value buffer and then the allocation itself.
    // Skip non-numbers as native does; reject numeric overflow before mutation.
    for(int i=uniform.dimensions;i<count;++i)if(lua_isnumber(L,i+3))
        return luaL_error(L,"PostProcessor uniform value exceeds declared dimensions");
    for(int i=0;i<count&&i<static_cast<int>(uniform.dimensions);++i)
        if(lua_isnumber(L,i+3))uniform.values[i]=static_cast<float>(lua_tonumber(L,i+3));
    return 0;
}
int add_sampler(lua_State* L){live(L);luaL_checkstring(L,2);
    // The dedicated wrapper only looks up a previously loaded IMAGE cache.
    // IMAGE loading is omitted in this native role, so every handle is -1;
    // registration neither fetches bytes nor acquires an image lease.
    if(samplers.size()>=sampler_budget)return luaL_error(L,"PostProcessor sampler count exceeds budget");
    auto id=samplers.size();samplers.emplace_back();lua_pushnumber(L,id);return 1;
}
int set_sampler(lua_State* L){live(L);luaL_checknumber(L,2);luaL_checkstring(L,3);
    // Native cached lookup leaves -1 for both present and absent filenames.
    // Unknown sampler IDs are ignored after validating both parameters.
    return 0;
}
int sampler_wrap(lua_State* L){live(L);uint32_t id=native_integer(luaL_checknumber(L,2));
    auto value=native_i32(luaL_checknumber(L,3));if(id<samplers.size())samplers[id].wrap=value;return 0;
}
int sampler_filter(lua_State* L){live(L);uint32_t id=native_integer(luaL_checknumber(L,2));
    auto min_filter=native_i32(luaL_checknumber(L,3));auto mag_filter=native_i32(luaL_checknumber(L,4));auto mip_filter=native_i32(luaL_checknumber(L,5));
    if(id<samplers.size()){auto& sampler=samplers[id];sampler.min_filter=min_filter;sampler.mag_filter=mag_filter;sampler.mip_filter=mip_filter;}
    return 0;
}
int missing(lua_State* L){live(L);return luaL_error(L,"UNIMPLEMENTED_NATIVE: PostProcessor.%s",lua_tostring(L,lua_upvalueindex(1)));}
int tostring_component(lua_State* L){owner(L);lua_pushfstring(L,"PostProcessor (%p)",lua_touserdata(L,1));return 1;}
void number(lua_State* L,const char* key,double value){lua_pushnumber(L,value);lua_setfield(L,-2,key);}
void push_bits(lua_State* L,const Uniform& uniform){char out[33];const char* digits="0123456789abcdef";size_t at=0;
    for(uint32_t i=0;i<uniform.dimensions;++i){uint32_t bits;std::memcpy(&bits,&uniform.values[i],4);
        for(int j=0;j<4;++j){auto byte=(bits>>(j*8))&255;out[at++]=digits[byte>>4];out[at++]=digits[byte&15];}}
    lua_pushlstring(L,out,at);
}
int inspect(lua_State* L){
    bool single=!lua_isnoneornil(L,1);double raw=0;
    if(single){raw=luaL_checknumber(L,1);
        if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw||!owners.count(static_cast<uint32_t>(raw))){lua_pushnil(L);return 1;}}
    lua_newtable(L);number(L,"managers",owners.size());number(L,"uniformCount",uniforms.size());number(L,"uniformBudget",uniform_budget);
    number(L,"samplerCount",samplers.size());number(L,"samplerBudget",sampler_budget);
    if(single){number(L,"owner",raw);number(L,"typeId",0xf1424772);}
    lua_pushboolean(L,enabled);lua_setfield(L,-2,"enabled");lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");
    lua_newtable(L);size_t index=0;
    for(const auto& entry:uniforms){lua_newtable(L);number(L,"id",entry.first);number(L,"dimensions",entry.second.dimensions);
        push_bits(L,entry.second);lua_setfield(L,-2,"valueBits");lua_newtable(L);
        for(uint32_t i=0;i<entry.second.dimensions;++i){lua_pushnumber(L,entry.second.values[i]);lua_rawseti(L,-2,i+1);}
        lua_setfield(L,-2,"values");lua_rawseti(L,-2,++index);}
    lua_setfield(L,-2,"uniforms");lua_newtable(L);
    for(size_t i=0;i<samplers.size();++i){const auto& sampler=samplers[i];lua_newtable(L);number(L,"id",i);
        number(L,"textureHandle",-1);number(L,"previousHandle",-1);number(L,"wrap",sampler.wrap);number(L,"minFilter",sampler.min_filter);
        number(L,"magFilter",sampler.mag_filter);number(L,"mipFilter",sampler.mip_filter);lua_rawseti(L,-2,i+1);}
    lua_setfield(L,-2,"samplers");return 1;
}
}
void retire(uint32_t id){if(owners.erase(id)){uniforms.clear();samplers.clear();}}
void clear(){owners.clear();uniforms.clear();samplers.clear();enabled=true;}
void install(lua_State* L,web_components::EntityHost callbacks,bool client){clear();host=callbacks;client_role=client;
    luaL_newmetatable(L,"dst.PostProcessor");lua_newtable(L);
    const luaL_Reg methods[]={{"SetPostProcessingEnabled",set_enabled},{"AddUniformVariable",add_uniform},{"SetUniformVariable",set_uniform},
        {"AddTextureSampler",add_sampler},{"SetTextureSampler",set_sampler},{"SetTextureSamplerState",sampler_wrap},{"SetTextureSamplerFilter",sampler_filter},{nullptr,nullptr}};
    luaL_register(L,nullptr,methods);
    for(const char* name:{"AddSamplerEffect","SetSamplerEffectState","SetSamplerEffectFilter","AddPostProcessEffect","SetEffectUniformVariables",
        "AddSampler","EnablePostProcessEffect","SetBasePostProcessEffect","SetPostProcessEffectBefore","SetPostProcessEffectAfter",
        "SetColourCubeSamplerEffect","SetBloomSamplerParams"}){
        lua_pushstring(L,name);lua_pushcclosure(L,missing,1);lua_setfield(L,-2,name);}
    lua_setfield(L,-2,"__index");lua_pushcfunction(L,tostring_component);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddPostProcessor");lua_pop(L,1);
    lua_getglobal(L,"WebComponents");lua_pushcfunction(L,inspect);lua_setfield(L,-2,"PostProcessor");lua_pop(L,1);
}
}

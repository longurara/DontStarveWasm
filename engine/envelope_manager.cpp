#include "envelope_manager.hpp"
#include "string_hash.hpp"
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_envelopes {
namespace {
enum Kind {Colour,Float,Vector2};
struct Point {float time=0;std::array<float,2> value{};uint32_t colour=0;};
struct Curve {uint32_t id=0;Kind kind=Float;std::vector<Point> points;};
struct Manager {std::vector<Curve> entries;};
web_components::EntityHost host{};bool client_role=false;
std::map<uint32_t,Manager> managers;
size_t total_entries=0,total_points=0;
constexpr size_t manager_budget=50000,entry_budget=65536,point_budget=1048576,max_curve=16384,max_owner=4096;
const char* method(Kind kind){return kind==Colour?"AddColourEnvelope":kind==Float?"AddFloatEnvelope":"AddVector2Envelope";}
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.EnvelopeManager"));}
Manager& manager(lua_State* L){auto id=owner(L);auto found=managers.find(id);
    if(!host.alive(id)||found==managers.end())luaL_error(L,"EnvelopeManager owner is removed");return found->second;
}
int add(lua_State* L){auto id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add EnvelopeManager to a removed entity");
    if(client_role)return luaL_error(L,"UNIMPLEMENTED_NATIVE: client EnvelopeManager consumer");
    if(!managers.count(id)){
        if(managers.size()>=manager_budget)return luaL_error(L,"EnvelopeManager count exceeds budget");
        managers.emplace(id,Manager{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.EnvelopeManager");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"EnvelopeManager");}lua_pop(L,1);}
    lua_pop(L,1);return 1;
}
void plain_table(lua_State* L,int index){luaL_checktype(L,index,LUA_TTABLE);
    if(lua_getmetatable(L,index))luaL_error(L,"UNIMPLEMENTED_NATIVE: EnvelopeManager table metamethods");
}
uint8_t channel(float value){float scaled=value*255.f;scaled+=.5f;
    // The native SSE comparisons choose 255 for NaN, then clamp at zero.
    float upper=scaled<255.f?scaled:255.f;return static_cast<uint8_t>(upper>0.f?upper:0.f);
}
int append(lua_State* L){auto& target=manager(L);auto kind=static_cast<Kind>(lua_tointeger(L,lua_upvalueindex(1)));
    const char* name=luaL_checkstring(L,2);plain_table(L,3);
    size_t count=lua_objlen(L,3);
    if(count>max_curve||total_points>point_budget-count)return luaL_error(L,"EnvelopeManager keyframe count exceeds budget");
    if(total_entries>=entry_budget||target.entries.size()>=max_owner)return luaL_error(L,"EnvelopeManager envelope count exceeds budget");
    // Flatten into a Lua-owned scratch table. Validation/metamethod errors
    // cannot longjmp over a C++ vector/string destructor or leak a curve.
    uint32_t id=web_strings::hash(name);lua_newtable(L);int scratch=lua_gettop(L);size_t seen=0,flat=0;
    lua_pushnil(L);
    while(lua_next(L,3)){
        double key=lua_type(L,-2)==LUA_TNUMBER?lua_tonumber(L,-2):0;
        if(key<1||key>count||std::trunc(key)!=key||++seen>count)
            return luaL_error(L,"EnvelopeManager requires a dense keyframe array");
        plain_table(L,-1);
        lua_pushinteger(L,1);lua_gettable(L,-2);float time=static_cast<float>(luaL_checknumber(L,-1));lua_pop(L,1);
        lua_pushnumber(L,time);lua_rawseti(L,scratch,++flat);
        lua_pushinteger(L,2);lua_gettable(L,-2);
        if(kind==Float){
            // Build 756039's native wrapper checks stack index -2 here,
            // i.e. the row table, rather than its scalar at -1. Consequently
            // every ordinary nonempty float envelope raises a type error.
            luaL_checknumber(L,-2);
        }else{
            plain_table(L,-1);std::array<float,4> values{};int dimensions=kind==Colour?4:2;
            for(int j=dimensions-1;j>=0;--j){lua_pushinteger(L,j+1);lua_gettable(L,-2);
                values[j]=static_cast<float>(luaL_checknumber(L,-1));lua_pop(L,1);}
            for(int j=0;j<dimensions;++j){lua_pushnumber(L,values[j]);lua_rawseti(L,scratch,++flat);}
        }
        lua_pop(L,2); // value and row, keep outer key for lua_next
    }
    if(seen!=count)return luaL_error(L,"EnvelopeManager requires a dense keyframe array");
    Curve curve;curve.id=id;curve.kind=kind;curve.points.reserve(count);flat=0;
    // Raw scalar reads only from scratch; no Lua callbacks or validation
    // errors after constructing the C++ staging vector.
    for(size_t i=0;i<count;++i){Point point;
        lua_rawgeti(L,scratch,++flat);point.time=static_cast<float>(lua_tonumber(L,-1));lua_pop(L,1);
        int dimensions=kind==Colour?4:kind==Vector2?2:1;
        for(int j=0;j<dimensions;++j){lua_rawgeti(L,scratch,++flat);float value=static_cast<float>(lua_tonumber(L,-1));lua_pop(L,1);
            if(kind==Colour)point.colour|=static_cast<uint32_t>(channel(value))<<(j*8);else point.value[j]=value;}
        curve.points.push_back(point);
    }
    target.entries.push_back(std::move(curve));++total_entries;total_points+=count;return 0;
}
void number(lua_State* L,const char* key,double value){lua_pushnumber(L,value);lua_setfield(L,-2,key);}
void hex(std::string& out,uint32_t bits){const char* digits="0123456789abcdef";
    for(int j=0;j<4;++j){auto byte=(bits>>(j*8))&255;out+=digits[byte>>4];out+=digits[byte&15];}}
uint32_t bits(float value){uint32_t result;std::memcpy(&result,&value,4);return result;}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);number(L,"managers",managers.size());number(L,"totalEntries",total_entries);
        number(L,"totalPoints",total_points);number(L,"entryBudget",entry_budget);number(L,"pointBudget",point_budget);return 1;}
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto found=managers.find(static_cast<uint32_t>(raw));if(found==managers.end()){lua_pushnil(L);return 1;}
    lua_newtable(L);number(L,"owner",raw);number(L,"typeId",0x391ccfb0);lua_pushboolean(L,false);lua_setfield(L,-2,"consumerReady");
    lua_newtable(L);size_t index=0;
    for(const auto& entry:found->second.entries){lua_newtable(L);number(L,"stringId",entry.id);number(L,"count",entry.points.size());
        lua_pushstring(L,method(entry.kind));lua_setfield(L,-2,"kind");
        std::string encoded;
        for(const auto& point:entry.points){hex(encoded,bits(point.time));
            if(entry.kind==Colour)hex(encoded,point.colour);
            else{hex(encoded,bits(point.value[0]));if(entry.kind==Vector2)hex(encoded,bits(point.value[1]));}}
        lua_pushlstring(L,encoded.data(),encoded.size());lua_setfield(L,-2,"pointBits");lua_rawseti(L,-2,++index);
    }
    lua_setfield(L,-2,"entries");return 1;
}
int tostring_manager(lua_State* L){owner(L);lua_pushfstring(L,"EnvelopeManager (%p)",lua_touserdata(L,1));return 1;}
}
void retire(uint32_t id){auto found=managers.find(id);if(found==managers.end())return;
    for(const auto& entry:found->second.entries)total_points-=entry.points.size();total_entries-=found->second.entries.size();managers.erase(found);
}
void clear(){managers.clear();total_entries=0;total_points=0;}
void install(lua_State* L,web_components::EntityHost callbacks,bool client){clear();host=callbacks;client_role=client;
    luaL_newmetatable(L,"dst.EnvelopeManager");lua_newtable(L);
    for(Kind kind:{Colour,Float,Vector2}){lua_pushinteger(L,kind);lua_pushcclosure(L,append,1);lua_setfield(L,-2,method(kind));}
    lua_setfield(L,-2,"__index");lua_pushcfunction(L,tostring_manager);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddEnvelopeManager");lua_pop(L,1);
    lua_getglobal(L,"WebComponents");lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Envelope");lua_pop(L,1);
}
}

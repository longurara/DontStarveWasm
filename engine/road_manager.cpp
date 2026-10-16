#include "road_manager.hpp"
#include <array>
#include <cmath>
#include <map>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_roads {
namespace {
struct Strip {std::array<int32_t,2> wrap{};std::array<float,2> uv{};};
struct Road {std::vector<std::array<float,2>> points;std::vector<std::array<Strip,4>> strips;};
web_components::EntityHost host{};
bool client_role=false;
std::map<uint32_t,Road> roads;
constexpr size_t max_managers=50000,max_roads=4096,max_points=1048576;
// Aggregate limits also cover many small managers. With vector capacity up
// to twice size these retain at most ~48 MiB of point/strip arrays, plus maps.
constexpr size_t total_point_budget=2097152,total_road_budget=65536;
size_t total_points=0,total_roads=0;
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.RoadManager"));}
Road& road(lua_State* L){auto id=owner(L);auto found=roads.find(id);
    if(!host.alive(id)||found==roads.end())luaL_error(L,"RoadManager owner is removed");return found->second;
}
int add(lua_State* L){auto id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add RoadManager to a removed entity");
    if(client_role)return luaL_error(L,"UNIMPLEMENTED_NATIVE: client RoadManager renderer");
    if(!roads.count(id)){
        if(roads.size()>=max_managers)return luaL_error(L,"RoadManager count exceeds budget");
        roads.emplace(id,Road{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.RoadManager");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"RoadManager");}lua_pop(L,1);}
    lua_pop(L,1);return 1;
}
int begin(lua_State* L){auto& value=road(L);
    if(value.strips.size()>=max_roads)return luaL_error(L,"RoadManager road count exceeds budget");
    if(total_roads>=total_road_budget)return luaL_error(L,"RoadManager aggregate road count exceeds budget");
    // Native BeginRoad only appends strip state. The pending points survive
    // until GenerateVB; calling BeginRoad repeatedly does not clear them.
    value.strips.emplace_back();++total_roads;return 0;
}
int point(lua_State* L){auto& value=road(L);
    // Native validates z before x (the Lua method wrapper removes self).
    float z=static_cast<float>(luaL_checknumber(L,3));float x=static_cast<float>(luaL_checknumber(L,2));
    if(value.points.size()>=max_points)return luaL_error(L,"RoadManager control point count exceeds budget");
    if(total_points>=total_point_budget)return luaL_error(L,"RoadManager aggregate control point count exceeds budget");
    value.points.push_back({x,z});++total_points;return 0;
}
int query(lua_State* L){road(L);
    luaL_checknumber(L,4);luaL_checknumber(L,3);luaL_checknumber(L,2);
    // Native 0x140055a50 returns false when component+0x170 is null. This
    // state persists even with pending control points. GenerateVB/QuadTree
    // cannot silently succeed here: their missing backends report errors.
    lua_pushboolean(L,false);return 1;
}
int32_t integer(lua_State* L,int index){double raw=luaL_checknumber(L,index);
    // The native wrapper truncates to signed 64-bit then stores the low word.
    // Reject undefined/out-of-range conversions explicitly in this adapter.
    double truncated=std::trunc(raw);
    if(!std::isfinite(raw)||truncated<-2147483648.0||truncated>2147483647.0)
        luaL_error(L,"RoadManager integer exceeds supported int32 range");
    return static_cast<int32_t>(truncated);
}
Strip& strip(lua_State* L,Road& value,int32_t index){
    // Native directly indexes this array and can corrupt memory outside it.
    if(value.strips.empty())luaL_error(L,"RoadManager strip requires BeginRoad");
    if(index<0||index>3)luaL_error(L,"RoadManager strip index outside 0..3");
    return value.strips.back()[index];
}
int wrap(lua_State* L){auto& value=road(L);auto index=integer(L,2);auto u=integer(L,3);auto v=integer(L,4);
    strip(L,value,index).wrap={u,v};return 0;
}
int uv(lua_State* L){auto& value=road(L);auto index=integer(L,2);
    float v=static_cast<float>(luaL_checknumber(L,4));float u=static_cast<float>(luaL_checknumber(L,3));
    strip(L,value,index).uv={u,v};return 0;
}
int missing(lua_State* L){road(L);return luaL_error(L,"UNIMPLEMENTED_NATIVE: RoadManager.%s",lua_tostring(L,lua_upvalueindex(1)));}
int tostring_road(lua_State* L){owner(L);lua_pushfstring(L,"RoadManager (%p)",lua_touserdata(L,1));return 1;}
void number(lua_State* L,const char* name,double value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
template<class T> void pair(lua_State* L,const T& value){lua_newtable(L);for(int i=0;i<2;++i){lua_pushnumber(L,value[i]);lua_rawseti(L,-2,i+1);}}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);number(L,"roadManagers",roads.size());number(L,"managerBudget",max_managers);
        number(L,"roadBudget",max_roads);number(L,"pointBudget",max_points);number(L,"totalPoints",total_points);number(L,"totalRoads",total_roads);
        number(L,"totalPointBudget",total_point_budget);number(L,"totalRoadBudget",total_road_budget);return 1;}
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto id=static_cast<uint32_t>(raw);auto found=roads.find(id);if(found==roads.end()){lua_pushnil(L);return 1;}
    const auto& value=found->second;
    lua_newtable(L);number(L,"owner",id);number(L,"typeId",0xdf2fd08d);number(L,"roadIndex",static_cast<double>(value.strips.size())-1);
    lua_pushboolean(L,false);lua_setfield(L,-2,"hasQuadTree");lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");
    lua_newtable(L);for(size_t i=0;i<value.points.size();++i){pair(L,value.points[i]);lua_rawseti(L,-2,i+1);}lua_setfield(L,-2,"points");
    lua_newtable(L);for(size_t i=0;i<value.strips.size();++i){lua_newtable(L);
        for(size_t j=0;j<4;++j){const auto& entry=value.strips[i][j];lua_newtable(L);pair(L,entry.wrap);lua_setfield(L,-2,"wrap");pair(L,entry.uv);lua_setfield(L,-2,"uv");lua_rawseti(L,-2,j+1);}
        lua_rawseti(L,-2,i+1);}
    lua_setfield(L,-2,"strips");return 1;
}
}
void retire(uint32_t id){auto found=roads.find(id);if(found!=roads.end()){
    total_points-=found->second.points.size();total_roads-=found->second.strips.size();roads.erase(found);}}
void clear(){roads.clear();total_points=0;total_roads=0;}
void install(lua_State* L,web_components::EntityHost callbacks,bool client){clear();host=callbacks;client_role=client;
    luaL_newmetatable(L,"dst.RoadManager");lua_newtable(L);
    const luaL_Reg methods[]={{"IsOnRoad",query},{"BeginRoad",begin},{"AddControlPoint",point},{"SetStripWrapMode",wrap},{"SetStripUVAnimStep",uv},{nullptr,nullptr}};
    luaL_register(L,nullptr,methods);
    for(const char* name:{"AddSmoothedControlPoint","SetStripEffect","SetStripTextures","GenerateVB","GenerateQuadTree"}){
        lua_pushstring(L,name);lua_pushcclosure(L,missing,1);lua_setfield(L,-2,name);}
    lua_setfield(L,-2,"__index");lua_pushcfunction(L,tostring_road);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddRoadManager");lua_pop(L,1);
    lua_getglobal(L,"WebComponents");lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Road");lua_pop(L,1);
}
}

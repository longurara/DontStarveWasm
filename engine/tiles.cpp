#include "tiles.hpp"
#include <array>
#include <cmath>
#include <cstdint>
#include <map>
#include <set>
extern "C" {
#include "lauxlib.h"
}

namespace web_tiles {
namespace {
struct Group {
    uint32_t parent=0;
    uint16_t begin=0,end=0;
    std::set<uint16_t> valid,invalid;
};
std::map<uint32_t,Group> groups;
uint32_t next_group=1;
std::array<uint32_t,6> selected{};
std::array<uint16_t,3> special{};
std::set<uint16_t> no_overlays,invisible;
void self(lua_State* L){luaL_checkudata(L,1,"dst.TileGroupManager");}
uint32_t group_id(lua_State* L,int index){return static_cast<uint32_t>(luaL_checknumber(L,index));}
uint16_t tile_id(lua_State* L,int index){
    double value=luaL_checknumber(L,index);
    if(!std::isfinite(value))luaL_error(L,"Tile ID must be finite");
    value=std::fmod(std::trunc(value),65536.0);if(value<0)value+=65536.0;
    return static_cast<uint16_t>(value);
}
int add_group(lua_State* L){
    self(L);uint32_t parent=static_cast<uint32_t>(luaL_optnumber(L,2,0));
    uint32_t id=next_group++;Group value;value.parent=groups.count(parent)?parent:0;
    groups.emplace(id,value);lua_pushnumber(L,id);return 1;
}
int set_range(lua_State* L){
    self(L);uint32_t id=group_id(L,2);uint16_t begin=tile_id(L,3),end=tile_id(L,4);
    if(begin>end)return luaL_error(L,"Invalid tile group range");
    auto found=groups.find(id);if(found!=groups.end()){found->second.begin=begin;found->second.end=end;}
    return 0;
}
int change_tile(lua_State* L){
    self(L);uint32_t id=group_id(L,2);uint16_t tile=tile_id(L,3);
    auto found=groups.find(id);if(found==groups.end())return 0;
    int mode=static_cast<int>(lua_tointeger(L,lua_upvalueindex(1)));
    auto& values=mode<2?found->second.valid:found->second.invalid;
    if(mode%2)values.erase(tile);else values.insert(tile);return 0;
}
int set_group(lua_State* L){
    self(L);uint32_t id=group_id(L,2);
    if(groups.count(id))selected[lua_tointeger(L,lua_upvalueindex(1))]=id;
    return 0;
}
int set_special(lua_State* L){
    self(L);int slot=static_cast<int>(lua_tointeger(L,lua_upvalueindex(1)));uint16_t tile=tile_id(L,2);
    if(slot<3)special[slot]=tile;
    else if(slot==3)no_overlays.insert(tile);
    else invisible.insert(tile);
    return 0;
}
int unknown(lua_State* L){return luaL_error(L,"UNIMPLEMENTED_NATIVE: TileGroupManager.%s",luaL_checkstring(L,2));}
void closure(lua_State* L,const char* name,lua_CFunction fn,int argument){
    lua_pushinteger(L,argument);lua_pushcclosure(L,fn,1);lua_setfield(L,-2,name);
}
}
void install(lua_State* L){
    groups.clear();next_group=1;selected.fill(0);special.fill(0);no_overlays.clear();invisible.clear();
    luaL_newmetatable(L,"dst.TileGroupManager");
    lua_newtable(L);
    const luaL_Reg methods[]={{"AddTileGroup",add_group},{"SetValidTileRange",set_range},{nullptr,nullptr}};
    luaL_register(L,nullptr,methods);
    const char* edits[]={"AddValidTile","RemoveValidTile","AddInvalidTile","RemoveInvalidTile"};
    for(int i=0;i<4;++i)closure(L,edits[i],change_tile,i);
    const char* selectors[]={"SetIsLandTileGroup","SetIsOceanTileGroup","SetIsTransparentOceanTileGroup","SetIsImpassableTileGroup","SetIsInvalidTileGroup","SetIsNoiseTileGroup"};
    for(int i=0;i<6;++i)closure(L,selectors[i],set_group,i);
    const char* tiles[]={"SetInvalidTile","SetDefaultImpassableTile","SetFakeGroundTile","SetNoGroundOverlays","SetInvisibleTile"};
    for(int i=0;i<5;++i)closure(L,tiles[i],set_special,i);
    lua_newtable(L);lua_pushcfunction(L,unknown);lua_setfield(L,-2,"__index");lua_setmetatable(L,-2);
    lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.TileGroupManager");lua_setmetatable(L,-2);lua_setglobal(L,"TileGroupManager");
}
}

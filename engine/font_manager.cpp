#include "font_manager.hpp"
#include "font_asset.hpp"
#include <cmath>
#include <set>
extern "C" {
#include "lauxlib.h"
}
namespace web_font_manager {
namespace {
web_components::EntityHost host{};std::set<uint32_t> owners;
constexpr size_t owner_budget=50000;
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.FontManager"));}
int add(lua_State* L){auto id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add FontManager to a removed entity");
    if(!owners.count(id)){
        if(owners.size()>=owner_budget)return luaL_error(L,"FontManager count exceeds budget");
        owners.insert(id);
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.FontManager");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"FontManager");}lua_pop(L,1);}
    lua_pop(L,1);return 1;
}
int register_font(lua_State* L){auto id=owner(L);
    if(!host.alive(id)||!owners.count(id))return luaL_error(L,"FontManager owner is removed");
    const char* path=luaL_checkstring(L,2);const char* alias=luaL_checkstring(L,3);
    // RegisterFont shares the resource manager's alias table with LoadFont,
    // but neither reads extra arguments nor changes the font colour flag.
    if(!web_font_asset::register_alias(path,alias))return luaL_error(L,"FONT alias count exceeds 8192 budget");
    return 0;
}
int tostring_manager(lua_State* L){owner(L);lua_pushfstring(L,"FontManager (%p)",lua_touserdata(L,1));return 1;}
void number(lua_State* L,const char* name,double value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);number(L,"fontManagers",owners.size());number(L,"budget",owner_budget);return 1;}
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw||!owners.count(static_cast<uint32_t>(raw))){lua_pushnil(L);return 1;}
    lua_newtable(L);number(L,"owner",raw);number(L,"typeId",0xc0ce008f);
    lua_pushboolean(L,true);lua_setfield(L,-2,"sharedRegistry");lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");return 1;
}
}
void retire(uint32_t id){owners.erase(id);}
void clear(){owners.clear();}
void install(lua_State* L,web_components::EntityHost callbacks){clear();host=callbacks;
    luaL_newmetatable(L,"dst.FontManager");lua_newtable(L);lua_pushcfunction(L,register_font);lua_setfield(L,-2,"RegisterFont");lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_manager);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddFontManager");lua_pop(L,1);
    lua_getglobal(L,"WebComponents");lua_pushcfunction(L,inspect);lua_setfield(L,-2,"FontManager");lua_pop(L,1);
}
}

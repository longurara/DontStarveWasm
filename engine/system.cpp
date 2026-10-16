#include "system.hpp"
#include <emscripten/emscripten.h>
extern "C" {
#include "lauxlib.h"
}
namespace web_system {
namespace {
bool storage_available=false,storage_enabled=true,autosave_enabled=true,focused=true,stalling=false;
int operation=4,operation_result=7;
void self(lua_State* L){luaL_checkudata(L,1,"dst.SystemService");}
int get(lua_State* L){
    self(L);int slot=static_cast<int>(lua_tointeger(L,lua_upvalueindex(1)));
    bool value=slot==0?storage_available:slot==1?storage_enabled:slot==2?autosave_enabled:focused;
    lua_pushboolean(L,value);return 1;
}
int set(lua_State* L){
    self(L);int slot=static_cast<int>(lua_tointeger(L,lua_upvalueindex(1)));bool value=lua_toboolean(L,2);
    if(slot==0)stalling=value;else if(slot==1)storage_enabled=value;else autosave_enabled=value;
    return 0;
}
int last_operation(lua_State* L){self(L);lua_pushinteger(L,operation);lua_pushinteger(L,operation_result);return 2;}
int clear_operation(lua_State* L){self(L);operation=4;operation_result=7;return 0;}
int inspect(lua_State* L){
    lua_newtable(L);
    const char* names[]={"storageAvailable","storageEnabled","autosaveEnabled","focus","stalling"};
    bool values[]={storage_available,storage_enabled,autosave_enabled,focused,stalling};
    for(int i=0;i<5;++i){lua_pushboolean(L,values[i]);lua_setfield(L,-2,names[i]);}return 1;
}
int unknown(lua_State* L){return luaL_error(L,"UNIMPLEMENTED_NATIVE: SystemService.%s",luaL_checkstring(L,2));}
void closure(lua_State* L,const char* name,lua_CFunction fn,int slot){lua_pushinteger(L,slot);lua_pushcclosure(L,fn,1);lua_setfield(L,-2,name);}
}
void install(lua_State* L){
    storage_available=false;storage_enabled=autosave_enabled=focused=true;stalling=false;
    operation=4;operation_result=7;
    luaL_newmetatable(L,"dst.SystemService");lua_newtable(L);
    closure(L,"IsStorageAvailable",get,0);closure(L,"IsStorageEnabled",get,1);closure(L,"IsAutosaveEnabled",get,2);closure(L,"HasFocus",get,3);
    closure(L,"SetStalling",set,0);closure(L,"EnableStorage",set,1);closure(L,"EnableAutosave",set,2);
    lua_pushcfunction(L,last_operation);lua_setfield(L,-2,"GetLastOperation");lua_pushcfunction(L,clear_operation);lua_setfield(L,-2,"ClearLastOperation");
    lua_newtable(L);lua_pushcfunction(L,unknown);lua_setfield(L,-2,"__index");lua_setmetatable(L,-2);lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.SystemService");lua_setmetatable(L,-2);lua_setglobal(L,"TheSystemService");
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebSystem");
}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void dst_platform_storage(int available){web_system::storage_available=available!=0;}
EMSCRIPTEN_KEEPALIVE void dst_platform_focus(int focused){web_system::focused=focused!=0;}
}

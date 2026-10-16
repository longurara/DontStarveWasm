#include "input.hpp"
#include <cmath>
#include <set>
#include <emscripten/emscripten.h>
extern "C" {
#include "lauxlib.h"
}
namespace web_input {
namespace {
bool desktop=false,enabled=true,cursor=true;
float mouse_x=0,mouse_y=0;
std::set<int> keys,buttons;
void self(lua_State* L){luaL_checkudata(L,1,"dst.InputProxy");}
int count(lua_State* L){self(L);lua_pushinteger(L,desktop?1:0);return 1;}
int controllers(lua_State* L){self(L);lua_pushboolean(L,false);return 1;}
int any_input(lua_State* L){self(L);lua_pushboolean(L,desktop);return 1;}
int connected(lua_State* L){self(L);lua_pushboolean(L,desktop&&luaL_checkinteger(L,2)==0);return 1;}
int is_enabled(lua_State* L){self(L);lua_pushboolean(L,desktop&&luaL_checkinteger(L,2)==0&&enabled);return 1;}
int enable(lua_State* L){self(L);if(desktop&&luaL_checkinteger(L,2)==0)enabled=lua_toboolean(L,3);return 0;}
int name(lua_State* L){self(L);if(desktop&&luaL_checkinteger(L,2)==0)lua_pushliteral(L,"Keyboard/Mouse");else lua_pushnil(L);return 1;}
int type(lua_State* L){self(L);if(desktop&&luaL_checkinteger(L,2)==0)lua_pushinteger(L,0);else lua_pushnil(L);return 1;}
int active_index(lua_State* L){self(L);return 0;}
int show_cursor(lua_State* L){self(L);cursor=lua_toboolean(L,2);return 0;}
int key_down(lua_State* L){
    int key=static_cast<int>(luaL_checkinteger(L,2));bool down=keys.count(key)>0;
    if(key==400)down=keys.count(307)||keys.count(308);
    else if(key==401)down=keys.count(305)||keys.count(306);
    else if(key==402)down=keys.count(303)||keys.count(304);
    lua_pushboolean(L,desktop&&enabled&&key>=1&&key<=402&&down);return 1;
}
int mouse_button(lua_State* L){lua_pushboolean(L,desktop&&enabled&&buttons.count(luaL_checkinteger(L,2)));return 1;}
int position(lua_State* L){lua_pushnumber(L,mouse_x);lua_pushnumber(L,mouse_y);return 2;}
int unknown(lua_State* L){return luaL_error(L,"UNIMPLEMENTED_NATIVE: InputProxy.%s",luaL_checkstring(L,2));}
}
void install(lua_State* L,bool client){
    desktop=client;enabled=true;cursor=true;keys.clear();buttons.clear();mouse_x=mouse_y=0;
    luaL_newmetatable(L,"dst.InputProxy");lua_newtable(L);
    const luaL_Reg methods[]={{"GetInputDeviceCount",count},{"GetInputDeviceName",name},{"GetInputDeviceType",type},
        {"GetLastActiveControllerIndex",active_index},{"IsAnyControllerActive",controllers},{"IsAnyControllerConnected",controllers},
        {"IsAnyInputDeviceConnected",any_input},{"IsInputDeviceConnected",connected},{"IsInputDeviceEnabled",is_enabled},
        {"EnableInputDevice",enable},{"SetCursorVisible",show_cursor},{nullptr,nullptr}};
    luaL_register(L,nullptr,methods);
    lua_newtable(L);lua_pushcfunction(L,unknown);lua_setfield(L,-2,"__index");lua_setmetatable(L,-2);
    lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.InputProxy");lua_setmetatable(L,-2);lua_setglobal(L,"TheInputProxy");
    lua_getglobal(L,"TheSim");
    for(auto method:std::initializer_list<luaL_Reg>{{"IsKeyDown",key_down},{"GetMouseButtonState",mouse_button},{"GetPosition",position}}){
        lua_pushcfunction(L,method.func);lua_setfield(L,-2,method.name);
    }
    lua_pop(L,1);
}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int dst_input_key(int code,int down){
    if(!web_input::desktop||code<1||code>402||(down!=0&&down!=1))return 1;
    if(down)web_input::keys.insert(code);else web_input::keys.erase(code);return 0;
}
EMSCRIPTEN_KEEPALIVE int dst_input_pointer(float x,float y,int button,int down){
    if(!web_input::desktop||!std::isfinite(x)||!std::isfinite(y)||x<0||y<0||x>32768||y>32768||
       (button!=-1&&(button<1000||button>1004))||(down!=0&&down!=1))return 1;
    web_input::mouse_x=x;web_input::mouse_y=y;
    if(button!=-1){if(down)web_input::buttons.insert(button);else web_input::buttons.erase(button);}return 0;
}
EMSCRIPTEN_KEEPALIVE void dst_input_reset(){web_input::keys.clear();web_input::buttons.clear();}
EMSCRIPTEN_KEEPALIVE int dst_input_cursor_visible(){return web_input::cursor?1:0;}
}

#include "graphics_options.hpp"
#include <cmath>
#include <map>
extern "C" {
#include "lauxlib.h"
}
namespace web_graphics_options {
namespace {
constexpr size_t kBudget=64;
constexpr uint32_t kTypeId=0xab1f3b13u;

struct GraphicsState {
    bool fullscreen=false;
    bool stencil_enabled=false;
    bool light_map_enabled=false;
    bool small_textures_mode=false;
    bool small_textures_setting=false;
    int display_id=0;
    int mode_id=0;
    int refresh_rate=60;
    int width=1280;
    int height=720;
};

web_components::EntityHost host{};
bool client_role=false;
GraphicsState state{};
std::map<uint32_t,bool> instances;

uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.GraphicsOptions"));}

void check_owner(lua_State* L){
    auto id=owner(L);
    if(!host.alive(id)||!instances.count(id))luaL_error(L,"GraphicsOptions owner is removed");
}

int add(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add GraphicsOptions to a removed entity");
    if(!instances.count(id)){
        if(instances.size()>=kBudget)return luaL_error(L,"GraphicsOptions count exceeds budget");
        instances.emplace(id,true);
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.GraphicsOptions");
    lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"GraphicsOptions");}
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int tostring_go(lua_State* L){owner(L);lua_pushfstring(L,"GraphicsOptions (%p)",lua_touserdata(L,1));return 1;}

int toggle_fullscreen(lua_State* L){check_owner(L);state.fullscreen=!state.fullscreen;return 0;}
int set_fullscreen(lua_State* L){check_owner(L);state.fullscreen=lua_toboolean(L,2)!=0;return 0;}
int is_fullscreen(lua_State* L){check_owner(L);lua_pushboolean(L,state.fullscreen?1:0);return 1;}
int is_fullscreen_enabled(lua_State* L){check_owner(L);lua_pushboolean(L,1);return 1;}

int set_display_mode(lua_State* L){
    check_owner(L);
    state.display_id=static_cast<int>(luaL_checkinteger(L,2));
    state.mode_id=static_cast<int>(luaL_checkinteger(L,3));
    state.fullscreen=lua_toboolean(L,4)!=0;
    return 0;
}

int get_num_displays(lua_State* L){
    check_owner(L);
    lua_pushinteger(L,client_role?1:-1);
    return 1;
}

int get_display_name(lua_State* L){
    check_owner(L);
    (void)luaL_checkinteger(L,2);
    lua_pushliteral(L,"");
    return 1;
}

int get_num_refresh_rates(lua_State* L){
    check_owner(L);
    (void)luaL_checkinteger(L,2);
    (void)luaL_checkinteger(L,3);
    (void)luaL_checkinteger(L,4);
    lua_pushinteger(L,1);
    return 1;
}

int get_refresh_rate(lua_State* L){
    check_owner(L);
    (void)luaL_checkinteger(L,2);
    (void)luaL_checkinteger(L,3);
    (void)luaL_checkinteger(L,4);
    (void)luaL_checkinteger(L,5);
    lua_pushinteger(L,client_role?state.refresh_rate:0);
    return 1;
}

int get_num_display_modes(lua_State* L){
    check_owner(L);
    (void)luaL_checkinteger(L,2);
    lua_pushinteger(L,client_role?1:-1);
    return 1;
}

int get_display_mode(lua_State* L){
    check_owner(L);
    (void)luaL_checkinteger(L,2);
    (void)luaL_checkinteger(L,3);
    if(client_role){
        lua_pushinteger(L,state.width);
        lua_pushinteger(L,state.height);
        lua_pushinteger(L,state.refresh_rate);
    }else{
        lua_pushinteger(L,-1);
        lua_pushinteger(L,-1);
        lua_pushinteger(L,-1);
    }
    return 3;
}

int get_fullscreen_display_id(lua_State* L){check_owner(L);lua_pushinteger(L,state.display_id);return 1;}
int get_fullscreen_display_refresh_rate(lua_State* L){check_owner(L);lua_pushinteger(L,state.refresh_rate);return 1;}

int get_current_display_mode_id(lua_State* L){
    check_owner(L);
    (void)luaL_checkinteger(L,2);
    lua_pushinteger(L,state.mode_id);
    return 1;
}

int enable_stencil(lua_State* L){check_owner(L);state.stencil_enabled=true;return 0;}
int disable_stencil(lua_State* L){check_owner(L);state.stencil_enabled=false;return 0;}
int enable_light_map(lua_State* L){check_owner(L);state.light_map_enabled=true;return 0;}
int disable_light_map(lua_State* L){check_owner(L);state.light_map_enabled=false;return 0;}

int is_small_textures_mode(lua_State* L){check_owner(L);lua_pushboolean(L,state.small_textures_mode?1:0);return 1;}
int get_small_textures_setting(lua_State* L){check_owner(L);lua_pushboolean(L,state.small_textures_setting?1:0);return 1;}

int set_small_textures_mode(lua_State* L){
    check_owner(L);
    bool val=lua_toboolean(L,2)!=0;
    state.small_textures_setting=val;
    state.small_textures_mode=val;
    return 0;
}

int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);
        lua_pushnumber(L,instances.size());lua_setfield(L,-2,"count");
        lua_pushnumber(L,kBudget);lua_setfield(L,-2,"budget");
        lua_pushnumber(L,kTypeId);lua_setfield(L,-2,"typeId");
        lua_pushboolean(L,state.fullscreen?1:0);lua_setfield(L,-2,"fullscreen");
        lua_pushboolean(L,state.stencil_enabled?1:0);lua_setfield(L,-2,"stencilEnabled");
        lua_pushboolean(L,state.light_map_enabled?1:0);lua_setfield(L,-2,"lightMapEnabled");
        lua_pushboolean(L,state.small_textures_mode?1:0);lua_setfield(L,-2,"smallTexturesMode");
        return 1;
    }
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto id=static_cast<uint32_t>(raw);
    if(!instances.count(id)){lua_pushnil(L);return 1;}
    lua_newtable(L);
    lua_pushliteral(L,"GraphicsOptions");lua_setfield(L,-2,"kind");
    lua_pushnumber(L,id);lua_setfield(L,-2,"owner");
    lua_pushnumber(L,kTypeId);lua_setfield(L,-2,"typeId");
    lua_pushboolean(L,state.fullscreen?1:0);lua_setfield(L,-2,"fullscreen");
    lua_pushboolean(L,state.stencil_enabled?1:0);lua_setfield(L,-2,"stencilEnabled");
    lua_pushboolean(L,state.light_map_enabled?1:0);lua_setfield(L,-2,"lightMapEnabled");
    lua_pushboolean(L,state.small_textures_mode?1:0);lua_setfield(L,-2,"smallTexturesMode");
    lua_pushnumber(L,state.display_id);lua_setfield(L,-2,"displayId");
    lua_pushnumber(L,state.mode_id);lua_setfield(L,-2,"modeId");
    lua_pushnumber(L,state.refresh_rate);lua_setfield(L,-2,"refreshRate");
    return 1;
}
}

void retire(uint32_t id){instances.erase(id);}
void clear(){instances.clear();state=GraphicsState{};}

void install(lua_State* L,web_components::EntityHost callbacks,bool client){
    clear();
    host=callbacks;
    client_role=client;
    luaL_newmetatable(L,"dst.GraphicsOptions");
    lua_newtable(L);
    const luaL_Reg methods[]={
        {"ToggleFullScreen",toggle_fullscreen},
        {"SetFullScreen",set_fullscreen},
        {"IsFullScreen",is_fullscreen},
        {"IsFullScreenEnabled",is_fullscreen_enabled},
        {"SetDisplayMode",set_display_mode},
        {"GetNumDisplays",get_num_displays},
        {"GetDisplayName",get_display_name},
        {"GetNumRefreshRates",get_num_refresh_rates},
        {"GetRefreshRate",get_refresh_rate},
        {"GetNumDisplayModes",get_num_display_modes},
        {"GetDisplayMode",get_display_mode},
        {"GetFullscreenDisplayID",get_fullscreen_display_id},
        {"GetFullscreenDisplayRefreshRate",get_fullscreen_display_refresh_rate},
        {"GetCurrentDisplayModeID",get_current_display_mode_id},
        {"EnableStencil",enable_stencil},
        {"DisableStencil",disable_stencil},
        {"EnableLightMapComponent",enable_light_map},
        {"DisableLightMapComponent",disable_light_map},
        {"IsSmallTexturesMode",is_small_textures_mode},
        {"GetSmallTexturesModeSettingValue",get_small_textures_setting},
        {"SetSmallTexturesMode",set_small_textures_mode},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,methods);
    lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_go);
    lua_setfield(L,-2,"__tostring");
    lua_pop(L,1);

    lua_getglobal(L,"Entity");
    lua_pushcfunction(L,add);
    lua_setfield(L,-2,"AddGraphicsOptions");
    lua_pop(L,1);

    lua_newtable(L);
    lua_pushcfunction(L,inspect);
    lua_setfield(L,-2,"Inspect");
    lua_setglobal(L,"WebGraphicsOptions");
}
}

#include "camera.hpp"
#include <array>
#include <cmath>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_camera {
namespace {
struct Camera {
    std::array<float,3> position{},direction{},up{};
    std::array<float,9> listener{};
    float fov=0,yaw=0;
    bool position_set=false,direction_set=false,up_set=false,fov_set=false,listener_set=false;
    unsigned dirty=0;
} camera;
bool is_client;
void require_backend(lua_State* L){
    if(is_client)luaL_error(L,"UNIMPLEMENTED_NATIVE: client world camera/audio listener backend");
}
std::array<float,3> vector(lua_State* L){
    // Native Sim wrappers read z, y, x, converting each double to float.
    float z=static_cast<float>(luaL_checknumber(L,4));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float x=static_cast<float>(luaL_checknumber(L,2));
    return {x,y,z};
}
int set_vector(lua_State* L){
    require_backend(L);auto value=vector(L);int kind=lua_tointeger(L,lua_upvalueindex(1));
    auto& previous=kind==0?camera.position:kind==1?camera.direction:camera.up;
    bool& initialized=kind==0?camera.position_set:kind==1?camera.direction_set:camera.up_set;
    if(!initialized||previous!=value){
        previous=value;camera.dirty|=1;
        // Native direction setter 0x1400fd320 also caches heading in degrees;
        // it does not normalize the input vector.
        if(kind==1)camera.yaw=static_cast<float>(std::atan2(value[2],value[0]))/0.01745329238474369f+180.0f;
    }
    initialized=true;return 0;
}
int set_fov(lua_State* L){
    require_backend(L);float value=static_cast<float>(luaL_checknumber(L,2));
    if(!camera.fov_set||camera.fov!=value){camera.fov=value;camera.dirty|=2;}
    camera.fov_set=true;return 0;
}
int set_listener(lua_State* L){
    require_backend(L);std::array<float,9> value{};
    for(int group=0;group<3;++group)for(int axis=2;axis>=0;--axis)
        value[group*3+axis]=static_cast<float>(luaL_checknumber(L,2+group*3+axis));
    camera.listener=value;camera.listener_set=true;return 0;
}
template<size_t N> void field(lua_State* L,const char* name,const std::array<float,N>& value,bool initialized){
    if(!initialized)return;
    lua_createtable(L,N,0);for(size_t i=0;i<N;++i){lua_pushnumber(L,value[i]);lua_rawseti(L,-2,i+1);}
    lua_setfield(L,-2,name);
}
int inspect(lua_State* L){
    lua_newtable(L);field(L,"position",camera.position,camera.position_set);field(L,"direction",camera.direction,camera.direction_set);
    field(L,"up",camera.up,camera.up_set);field(L,"listener",camera.listener,camera.listener_set);
    if(camera.fov_set){lua_pushnumber(L,camera.fov);lua_setfield(L,-2,"fov");}
    if(camera.direction_set){lua_pushnumber(L,camera.yaw);lua_setfield(L,-2,"yaw");}
    lua_pushnumber(L,camera.dirty);lua_setfield(L,-2,"dirty");
    lua_pushboolean(L,false);lua_setfield(L,-2,"worldRendererReady");return 1;
}
}
void install(lua_State* L,bool client){
    camera={};is_client=client;lua_getglobal(L,"TheSim");
    const char* names[]={"SetCameraPos","SetCameraDir","SetCameraUp"};
    for(int i=0;i<3;++i){lua_pushinteger(L,i);lua_pushcclosure(L,set_vector,1);lua_setfield(L,-2,names[i]);}
    lua_pushcfunction(L,set_fov);lua_setfield(L,-2,"SetCameraFOV");
    lua_pushcfunction(L,set_listener);lua_setfield(L,-2,"SetListener");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebCamera");
}
}

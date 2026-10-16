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
void screen_dimensions(lua_State* L,float& sw,float& sh){
    sw=1280.0f;sh=720.0f;
    lua_getglobal(L,"TheSim");
    if(lua_istable(L,-1)){
        lua_getfield(L,-1,"GetScreenSize");
        if(lua_isfunction(L,-1)){
            lua_pushvalue(L,-2);
            if(lua_pcall(L,1,2,0)==0){
                float w=static_cast<float>(lua_tonumber(L,-2));
                float h=static_cast<float>(lua_tonumber(L,-1));
                if(w>1.0f&&h>1.0f){sw=w;sh=h;}
                lua_pop(L,2);
            }
        }else lua_pop(L,1);
    }
    lua_pop(L,1);
}
void camera_basis(std::array<float,3>& fwd,std::array<float,3>& right,std::array<float,3>& up_orth){
    fwd=camera.direction_set?camera.direction:std::array<float,3>{-0.70710678f,-0.5f,0.70710678f};
    float fl=std::sqrt(fwd[0]*fwd[0]+fwd[1]*fwd[1]+fwd[2]*fwd[2]);
    if(fl>1e-5f){fwd[0]/=fl;fwd[1]/=fl;fwd[2]/=fl;}else fwd={-0.70710678f,-0.5f,0.70710678f};
    std::array<float,3> u=camera.up_set?camera.up:std::array<float,3>{0.0f,1.0f,0.0f};
    right={fwd[1]*u[2]-fwd[2]*u[1],fwd[2]*u[0]-fwd[0]*u[2],fwd[0]*u[1]-fwd[1]*u[0]};
    float rl=std::sqrt(right[0]*right[0]+right[1]*right[1]+right[2]*right[2]);
    if(rl>1e-5f){right[0]/=rl;right[1]/=rl;right[2]/=rl;}else right={0.0f,0.0f,-1.0f};
    up_orth={right[1]*fwd[2]-right[2]*fwd[1],right[2]*fwd[0]-right[0]*fwd[2],right[0]*fwd[1]-right[1]*fwd[0]};
}
int project_screen_pos(lua_State* L){
    float sx=static_cast<float>(luaL_optnumber(L,2,0.0));
    float sy=static_cast<float>(luaL_optnumber(L,3,0.0));
    float plane_y=static_cast<float>(luaL_optnumber(L,4,0.0));
    float sw=1280.0f,sh=720.0f;
    screen_dimensions(L,sw,sh);
    float ndc_x=(sx/sw)*2.0f-1.0f;
    float ndc_y=(sy/sh)*2.0f-1.0f;
    float fov_deg=(camera.fov_set&&camera.fov>1.0f)?camera.fov:35.0f;
    float tan_half=std::tan(fov_deg*0.5f*0.01745329238474369f);
    float aspect=sw/sh;
    std::array<float,3> fwd{},right{},up_orth{};
    camera_basis(fwd,right,up_orth);
    float rx=fwd[0]+right[0]*(ndc_x*aspect*tan_half)+up_orth[0]*(ndc_y*tan_half);
    float ry=fwd[1]+right[1]*(ndc_x*aspect*tan_half)+up_orth[1]*(ndc_y*tan_half);
    float rz=fwd[2]+right[2]*(ndc_x*aspect*tan_half)+up_orth[2]*(ndc_y*tan_half);
    std::array<float,3> pos=camera.position_set?camera.position:std::array<float,3>{21.0f,15.0f,-21.0f};
    float wx=pos[0],wz=pos[2];
    if(std::abs(ry)>1e-4f){
        float t=(plane_y-pos[1])/ry;
        if(t>0.0f&&t<2000.0f){wx=pos[0]+rx*t;wz=pos[2]+rz*t;}
    }
    lua_pushnumber(L,wx);lua_pushnumber(L,plane_y);lua_pushnumber(L,wz);
    return 3;
}
int project_world_pos(lua_State* L){
    float wx=static_cast<float>(luaL_optnumber(L,2,0.0));
    float wy=static_cast<float>(luaL_optnumber(L,3,0.0));
    float wz=static_cast<float>(luaL_optnumber(L,4,0.0));
    float sw=1280.0f,sh=720.0f;
    screen_dimensions(L,sw,sh);
    float fov_deg=(camera.fov_set&&camera.fov>1.0f)?camera.fov:35.0f;
    float tan_half=std::tan(fov_deg*0.5f*0.01745329238474369f);
    float aspect=sw/sh;
    std::array<float,3> fwd{},right{},up_orth{};
    camera_basis(fwd,right,up_orth);
    std::array<float,3> pos=camera.position_set?camera.position:std::array<float,3>{21.0f,15.0f,-21.0f};
    float dx=wx-pos[0],dy=wy-pos[1],dz=wz-pos[2];
    float vz=dx*fwd[0]+dy*fwd[1]+dz*fwd[2];
    float vx=dx*right[0]+dy*right[1]+dz*right[2];
    float vy=dx*up_orth[0]+dy*up_orth[1]+dz*up_orth[2];
    float safe_z=vz>0.1f?vz:0.1f;
    float ndc_x=vx/(safe_z*aspect*tan_half);
    float ndc_y=vy/(safe_z*tan_half);
    lua_pushnumber(L,(ndc_x*0.5f+0.5f)*sw);
    lua_pushnumber(L,(ndc_y*0.5f+0.5f)*sh);
    lua_pushnumber(L,vz);
    return 3;
}
}
void install(lua_State* L,bool client){
    camera={};is_client=client;lua_getglobal(L,"TheSim");
    const char* names[]={"SetCameraPos","SetCameraDir","SetCameraUp"};
    for(int i=0;i<3;++i){lua_pushinteger(L,i);lua_pushcclosure(L,set_vector,1);lua_setfield(L,-2,names[i]);}
    lua_pushcfunction(L,set_fov);lua_setfield(L,-2,"SetCameraFOV");
    lua_pushcfunction(L,set_listener);lua_setfield(L,-2,"SetListener");
    lua_pushcfunction(L,project_screen_pos);lua_setfield(L,-2,"ProjectScreenPos");
    lua_pushcfunction(L,project_world_pos);lua_setfield(L,-2,"ProjectWorldPos");
    lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebCamera");
}
}

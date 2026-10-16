#include "physics_waker.hpp"
extern "C" {
#include "lauxlib.h"
}
namespace web_physics_waker {
namespace {
float radius=0;
int set_radius(lua_State* L){radius=static_cast<float>(luaL_checknumber(L,1));return 0;}
int inspect(lua_State* L){lua_newtable(L);lua_pushnumber(L,radius);lua_setfield(L,-2,"maxPhysicsRadius");lua_pushboolean(L,false);lua_setfield(L,-2,"simulationReady");return 1;}
}
float max_radius(){return radius;}
void install(lua_State* L){radius=0;lua_getglobal(L,"PhysicsWaker");if(!lua_istable(L,-1)){lua_pop(L,1);lua_newtable(L);}
    lua_pushcfunction(L,set_radius);lua_setfield(L,-2,"SetMaxPhysicsRadius");lua_setglobal(L,"PhysicsWaker");
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebPhysicsWaker");
}
}

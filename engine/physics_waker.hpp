#pragma once
extern "C" {
#include "lua.h"
}
namespace web_physics_waker {
void install(lua_State* L);
float max_radius();
}

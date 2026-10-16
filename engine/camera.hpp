#pragma once
extern "C" {
#include "lua.h"
}
namespace web_camera { void install(lua_State* L,bool client); }

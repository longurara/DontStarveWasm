#pragma once
extern "C" {
#include "lua.h"
}
namespace web_input { void install(lua_State* L,bool client); }

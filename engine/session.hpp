#pragma once
extern "C" {
#include "lua.h"
}
namespace web_session {
void install(lua_State* L,bool client);
// Protected Lua C entry: JSON settings and the loader's verified content hash.
int configure(lua_State* L);
}

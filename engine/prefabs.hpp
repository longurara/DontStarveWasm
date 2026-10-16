#pragma once
#include <string>
extern "C" {
#include "lua.h"
}
namespace web_prefabs {
using Exists=bool(*)(const std::string&);
void install(lua_State* L,Exists exists,bool client);
}

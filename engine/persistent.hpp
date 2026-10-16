#pragma once
#include <string>
extern "C" {
#include "lua.h"
}
namespace web_persistent {
void install(lua_State* L,const std::string& role);
int pending();
int complete(lua_State* L,bool durable);
}

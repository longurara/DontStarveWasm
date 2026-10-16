#pragma once
#include "components.hpp"
struct lua_State;
namespace web_graphics_options {
void install(lua_State* L, web_components::EntityHost host, bool client);
void retire(uint32_t id);
void clear();
}

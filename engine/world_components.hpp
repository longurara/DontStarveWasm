#pragma once
#include "components.hpp"
namespace web_world_components {
void install(lua_State* L,web_components::EntityHost host);
void retire(uint32_t id);
void clear();
}

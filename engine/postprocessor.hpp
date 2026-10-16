#pragma once
#include "components.hpp"
namespace web_postprocessor {
void install(lua_State* L,web_components::EntityHost host,bool client);
void retire(uint32_t owner);
void clear();
}

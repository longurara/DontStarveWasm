#pragma once
#include "components.hpp"
namespace web_font_manager {
void install(lua_State* L,web_components::EntityHost host);
void retire(uint32_t owner);
void clear();
}

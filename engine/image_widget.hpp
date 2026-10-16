#pragma once
#include "components.hpp"
namespace web_image_widget {
void install(lua_State*,web_components::EntityHost);
void retire(uint32_t);
void clear();
bool contains(uint32_t);
}

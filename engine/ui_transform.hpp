#pragma once
#include "components.hpp"
namespace web_ui {
void install(lua_State*,web_components::EntityHost);
void retire(uint32_t);
void clear();
bool contains(uint32_t);
bool refresh();
bool set_viewport(int width,int height);
}

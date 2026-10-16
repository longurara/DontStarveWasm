#pragma once
#include "components.hpp"
namespace web_sound_emitter {
void install(lua_State*,web_components::EntityHost);
void retire(uint32_t);
void clear();
bool contains(uint32_t);
}

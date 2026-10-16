#pragma once
#include <cstdint>
extern "C" {
#include "lua.h"
}
namespace web_tiles {
void install(lua_State* L);
bool in_group(uint32_t group_id,uint16_t tile);
bool is_land(uint16_t tile);
bool is_ocean(uint16_t tile);
bool is_transparent_ocean(uint16_t tile);
bool is_impassable(uint16_t tile);
bool is_invalid(uint16_t tile);
bool is_noise(uint16_t tile);
uint16_t invalid_tile();
uint16_t default_impassable_tile();
uint16_t fake_ground_tile();
}


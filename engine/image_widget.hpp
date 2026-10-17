#pragma once
#include "components.hpp"
#include <string>
namespace web_image_widget {
struct ImageSnapshot {
    uint32_t atlas_id=0,region_id=0;
    std::string atlas,region;
    float uv[4]{};
    float w=0,h=0;
    uint8_t tint[4]{255,255,255,255};
    uint32_t h_anchor=0,v_anchor=0;
};
void install(lua_State*,web_components::EntityHost);
void retire(uint32_t);
void clear();
bool contains(uint32_t);
bool get_snapshot(uint32_t id,ImageSnapshot& out);
}


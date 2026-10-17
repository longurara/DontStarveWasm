#pragma once
#include "components.hpp"
#include <string>
namespace web_text_widget {
struct TextSnapshot {
    std::string text;
    float size=10.0f,region_w=0,region_h=0;
    uint8_t colour[4]{255,255,255,255};
    uint32_t h_anchor=2,v_anchor=2;
};
void install(lua_State*,web_components::EntityHost);
void retire(uint32_t);
void clear();
bool contains(uint32_t);
bool get_snapshot(uint32_t id,TextSnapshot& out);
}


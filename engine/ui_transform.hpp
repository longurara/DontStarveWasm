#pragma once
#include "components.hpp"
namespace web_ui {
struct UISnapshot {
    float x=0,y=0,z=0,wx=0,wy=0,wz=0,sx=1,sy=1,sz=1,rotation=0;
    int32_t h_anchor=3,v_anchor=3,scale_mode=0;
    float matrix[16]{};
    bool has_scissor=false;
    int16_t scissor[4]{};
};
void install(lua_State*,web_components::EntityHost);
void retire(uint32_t);
void clear();
bool contains(uint32_t);
bool refresh();
bool set_viewport(int width,int height);
bool get_snapshot(uint32_t id,UISnapshot& out);
}


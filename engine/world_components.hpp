#pragma once
#include "components.hpp"
namespace web_world_components {
struct AnimSnapshot {
    const char* bank="";
    const char* build="";
    const char* anim="";
    int layer=4;
    int sort_order=0;
    int facing=3;
    int current_frame=0;
    int num_frames=30;
    float mult_colour[4]={1.0f,1.0f,1.0f,1.0f};
};
struct LightSnapshot {
    bool enabled=false;
    float radius=1.0f,falloff=0.5f,intensity=0.5f;
    float r=1.0f,g=1.0f,b=1.0f;
};
void install(lua_State* L,web_components::EntityHost host);
void retire(uint32_t id);
void clear();
void step(lua_State* L,float dt);
bool get_anim_snapshot(uint32_t id,AnimSnapshot& out);
void push_anim_extra(lua_State* L,uint32_t id);
bool get_light_snapshot(uint32_t id,LightSnapshot& out);
void push_map_window(lua_State* L,float cx,float cz,int tile_radius,int stride);
}

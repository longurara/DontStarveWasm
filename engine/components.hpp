#pragma once
#include <cstdint>
extern "C" {
#include "lua.h"
}
namespace web_components {
struct EntityHost {
    uint32_t (*id)(lua_State*,int);bool (*alive)(uint32_t);
    uint32_t (*parent)(uint32_t)=nullptr;
    bool (*local_matrix)(uint32_t,float*)=nullptr;
};
void install(lua_State* L,EntityHost host,bool client);
void retire(uint32_t owner);
void clear();
}

#pragma once
#include "components.hpp"
struct lua_State;
namespace web_account_manager {
void install(lua_State* L, web_components::EntityHost host);
void retire(uint32_t id);
void clear();
}

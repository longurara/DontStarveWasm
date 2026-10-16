#pragma once
#include <string>
#include <vector>
#include <cstdint>
extern "C" {
#include "lua.h"
}
namespace web_texture_asset {
bool backend_ready();
bool acquire(const std::string& path,std::string& error);
bool acquire_encoded(const std::string& key,const std::vector<uint8_t>& bytes,std::string& error);
bool ready(const std::string& path);
bool dimensions(const std::string& path,uint16_t& width,uint16_t& height);
void release(const std::string& path);
void clear();
void install(lua_State* L);
}

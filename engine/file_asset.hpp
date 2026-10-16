#pragma once
#include <cstdint>
#include <string>
#include <vector>
extern "C" {
#include "lua.h"
}
namespace web_file_asset {
// Like native FileResource, storage includes an extra NUL after the original
// bytes. Embedded NULs in the source remain intact.
bool acquire(const std::string& path,std::string& error);
void release(const std::string& path);
const std::vector<uint8_t>* get(const std::string& path);
void clear();
void install(lua_State* L);
}

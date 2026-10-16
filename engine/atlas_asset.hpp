#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>
extern "C" {
#include "lua.h"
}
namespace web_atlas_asset {
struct Element {uint32_t id;std::string name;std::array<float,4> uv;uint32_t source_index=0;}; // u1,v1,u2,v2
struct Atlas {std::string texture;std::vector<Element> elements;std::vector<uint32_t> source_order;size_t retained_bytes=0;};
bool load(const std::string& path,std::string& error);
bool acquire(const std::string& path,bool deferred,std::string& error);
bool bind_texture(const std::string& path,std::string& error);
void release(const std::string& path);
const Atlas* get(const std::string& path);
const Atlas* get_owned(const std::string& path);
const Element* resolve_element(uint32_t atlas_id,uint32_t element_id,std::string* texture_path=nullptr,bool* texture_ready=nullptr);
void clear();
void install(lua_State* L,bool client);
}

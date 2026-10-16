#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>
extern "C" {
#include "lua.h"
}
namespace web_shader_asset {
struct Uniform {std::string name,alias;uint32_t kind,count;std::vector<float> defaults;};
struct Stage {std::string file,source;std::vector<uint32_t> uniforms;};
struct Shader {std::string name,source_hash;std::vector<Uniform> uniforms;std::array<Stage,2> stages;size_t retained_bytes=0;};
bool load(const std::string& path,std::string& error);
bool acquire(const std::string& path,bool fallback,std::string& error);
bool backend_ready();
void release(const std::string& path);
void clear();
void install(lua_State* L,bool client);
}

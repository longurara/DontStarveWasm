#pragma once
#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>
extern "C" {
#include "lua.h"
}
namespace web_animation_asset {
struct SymbolFrame {uint32_t frame,duration,offset,count;std::array<float,4> bounds;};
struct Symbol {std::string name;std::vector<SymbolFrame> frames;};
struct Element {uint32_t symbol,frame,layer;std::array<float,6> matrix;float depth;};
struct Frame {std::array<float,4> bounds;std::vector<uint32_t> events;std::vector<Element> elements;};
struct Clip {std::string name;uint8_t facing;uint32_t bank;float rate;uint32_t frame_count=0;std::vector<Frame> frames;};
struct Texture {uint32_t codec,width,height,mips;size_t bytes=0;};
struct Bundle {
    std::string build;
    std::vector<std::string> atlases;
    std::map<uint32_t,Symbol> symbols;
    std::vector<std::array<float,6>> vertices;
    std::vector<Clip> clips;
    std::map<uint32_t,std::string> names;
    std::map<std::string,Texture> textures;
    size_t vertex_count=0,frame_count=0,element_count=0,event_count=0;
    std::string vertex_sha256,symbol_frame_sha256,element_sha256,event_sha256;
    size_t retained_bytes=0;
    bool textures_deferred=false;
    std::string source_hash;
};
bool load(const std::string& path,std::string& error,bool deferred=false,bool include_texture_bytes=true);
bool acquire(const std::string& path,std::string& error,bool deferred=false);
void release(const std::string& path);
void clear();
const Bundle* get(const std::string& path);
void install(lua_State* L);
}

#pragma once
#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>
extern "C" {
#include "lua.h"
}
namespace web_font_asset {
struct Glyph {uint32_t id;std::array<float,7> metrics;uint16_t channel;}; // x,y,w,h,xoffset,yoffset,xadvance
struct Font {
    std::string face,source_hash,texture_key,texture_hash;
    uint16_t line_height=0,base=0;float width=0,height=0,outline=0;
    uint32_t material=0;
    float advance=0;
    bool colour_enabled=true;
    std::vector<uint32_t> fallbacks;
    std::map<uint32_t,Glyph> glyphs;
    std::map<std::pair<uint32_t,uint32_t>,float> kernings;
    std::vector<uint8_t> texture;
    size_t retained_bytes=0;
};
bool load(const std::string& path,std::string& error);
bool acquire(const std::string& path,std::string& error);
void release(const std::string& path);
const Font* get(const std::string& path);
const Font* get_by_id(uint32_t id);
const Font* by_alias(const std::string& alias);
bool resolve_alias(const std::string& alias,uint32_t& id_out);
bool register_alias(const char* path,const char* alias);
void clear();
void install(lua_State* L,bool client);
}

#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace web_ktex {
struct Mip {uint32_t width,height,pitch;size_t offset,size;};
struct Texture {uint32_t flags=0,codec=0;std::vector<Mip> mips;};
bool parse(const std::vector<uint8_t>& bytes,Texture& out,std::string& error);
bool decode(const std::vector<uint8_t>& bytes,const Texture& texture,size_t level,std::vector<uint8_t>& rgba,std::string& error);
}

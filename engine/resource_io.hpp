#pragma once
#include <string>
#include <vector>
#include <cstdint>
namespace web_resource_io {
void allow_async(bool value);
bool async_active();
bool read(const std::string& path,std::vector<uint8_t>& bytes,std::string& error);
}

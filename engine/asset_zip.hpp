#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <vector>
namespace web_asset_zip {
bool unpack(const std::vector<uint8_t>& data,std::map<std::string,std::vector<uint8_t>>& files,std::string& error);
}

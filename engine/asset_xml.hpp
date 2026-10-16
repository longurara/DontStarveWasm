#pragma once
#ifndef RAPIDXML_NO_EXCEPTIONS
#define RAPIDXML_NO_EXCEPTIONS
#endif
#include "rapidxml.hpp"
#include <cstdint>
#include <string>
#include <vector>
namespace web_asset_xml {
bool parse(std::vector<uint8_t>& bytes,rapidxml::xml_document<>& document,size_t pool_budget,std::string& error);
}

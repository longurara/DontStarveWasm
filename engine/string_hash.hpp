#pragma once
#include <cstdint>
#include <string>
namespace web_strings {
// Build 756039: C-string SDBM, ASCII case folding and signed input bytes.
// Deliberately independent of the browser/host locale and char signedness.
inline uint32_t hash(const std::string& text) {
    uint32_t result=0;
    for(unsigned char byte:text){
        if(byte==0)break;
        int value=byte<128?byte:static_cast<int>(byte)-256;
        if(value>='A'&&value<='Z')value+='a'-'A';
        result=result*65599u+static_cast<uint32_t>(value);
    }
    return result;
}
}

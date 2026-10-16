#include "sha256.hpp"
#include <array>
#include <cstdint>
#include <cstring>
namespace web_crypto {
namespace {
constexpr std::array<uint32_t,64> constants={
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
uint32_t rotate(uint32_t value,int bits){return (value>>bits)|(value<<(32-bits));}
void block(std::array<uint32_t,8>& state,const unsigned char* data){
    uint32_t words[64];
    for(int i=0;i<16;++i)words[i]=(uint32_t(data[i*4])<<24)|(uint32_t(data[i*4+1])<<16)|(uint32_t(data[i*4+2])<<8)|data[i*4+3];
    for(int i=16;i<64;++i){
        uint32_t a=words[i-15],b=words[i-2];
        words[i]=words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>10));
    }
    auto working=state;
    for(int i=0;i<64;++i){
        uint32_t a=working[0],b=working[1],c=working[2],e=working[4],f=working[5],g=working[6];
        uint32_t first=working[7]+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i];
        uint32_t second=(rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c));
        for(int j=7;j>0;--j)working[j]=working[j-1];
        working[4]+=first;working[0]=first+second;
    }
    for(int i=0;i<8;++i)state[i]+=working[i];
}
}
std::string sha256(const std::string& bytes){
    std::array<uint32_t,8> state={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    const auto* data=reinterpret_cast<const unsigned char*>(bytes.data());size_t offset=0;
    while(bytes.size()-offset>=64){block(state,data+offset);offset+=64;}
    unsigned char tail[128]{};size_t remaining=bytes.size()-offset;
    std::memcpy(tail,data+offset,remaining);tail[remaining]=0x80;
    size_t padded=remaining<56?64:128;uint64_t bits=static_cast<uint64_t>(bytes.size())*8;
    for(int i=0;i<8;++i)tail[padded-1-i]=static_cast<unsigned char>(bits>>(8*i));
    block(state,tail);if(padded==128)block(state,tail+64);
    const char* hex="0123456789abcdef";std::string result;result.reserve(64);
    for(uint32_t word:state)for(int shift=28;shift>=0;shift-=4)result+=hex[(word>>shift)&15];
    return result;
}
}

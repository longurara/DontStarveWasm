#include "ktex.hpp"
#include <algorithm>
#include <array>
#include <cstring>
namespace web_ktex {
namespace {
uint32_t word(const uint8_t* p){return p[0]|(uint32_t(p[1])<<8);}
uint32_t dword(const uint8_t* p){return word(p)|(word(p+2)<<16);}
using Colour=std::array<uint8_t,4>;
Colour rgb565(uint32_t bits){uint32_t r=(bits>>11)&31,g=(bits>>5)&63,b=bits&31;return {uint8_t((r<<3)|(r>>2)),uint8_t((g<<2)|(g>>4)),uint8_t((b<<3)|(b>>2)),255};}
}
bool parse(const std::vector<uint8_t>& bytes,Texture& out,std::string& error){
    out={};if(bytes.size()<8||std::memcmp(bytes.data(),"KTEX",4)){error="Invalid KTEX header";return false;}
    out.flags=dword(bytes.data()+4);out.codec=(out.flags>>4)&31;uint32_t count=(out.flags>>13)&31;
    if(!count||count>20||bytes.size()<8+count*10){error="Invalid KTEX mip count/header length";return false;}
    if(!(out.codec<=2||out.codec==4||out.codec==5)){error="Unsupported KTEX codec";return false;}
    size_t offset=8+count*10;
    for(uint32_t i=0;i<count;++i){const auto* p=bytes.data()+8+i*10;
        Mip mip{word(p),word(p+2),word(p+4),offset,dword(p+6)};
        if(!mip.width||!mip.height||mip.width>8192||mip.height>8192){error="Invalid KTEX dimensions";return false;}
        if(i&&(mip.width!=std::max(1u,out.mips.back().width/2)||mip.height!=std::max(1u,out.mips.back().height/2))){error="Invalid KTEX mip dimensions";return false;}
        size_t expected=out.codec<=2?((mip.width+3)/4)*((mip.height+3)/4)*(out.codec==0?8:16):mip.width*mip.height*(out.codec==4?4:3);
        if(mip.size!=expected||offset>bytes.size()||mip.size>bytes.size()-offset){error="Invalid/truncated KTEX mip payload";return false;}
        out.mips.push_back(mip);offset+=mip.size;
    }
    if(offset!=bytes.size()){error="Trailing KTEX data";return false;}return true;
}
bool decode(const std::vector<uint8_t>& bytes,const Texture& texture,size_t level,std::vector<uint8_t>& rgba,std::string& error){
    if(level>=texture.mips.size()){error="KTEX mip index out of range";return false;}
    const auto& mip=texture.mips[level];size_t size=size_t(mip.width)*mip.height*4;
    if(size>64*1024*1024){error="KTEX decoded mip exceeds 64 MiB budget";return false;}
    rgba.assign(size,0);const uint8_t* payload=bytes.data()+mip.offset;uint32_t codec=texture.codec;
    if(codec>=4){size_t channels=codec==4?4:3;
        for(size_t i=0;i<size/4;++i){std::memcpy(rgba.data()+i*4,payload+i*channels,channels);if(channels==3)rgba[i*4+3]=255;}return true;
    }
    // S3TC colour interpolation and explicit/interpolated alpha; no flip,
    // gamma conversion, or alpha premultiplication at the resource boundary.
    for(uint32_t by=0;by<mip.height;by+=4)for(uint32_t bx=0;bx<mip.width;bx+=4){
        uint32_t block_size=codec==0?8:16;const uint8_t* colours=payload+block_size-8;
        uint32_t c0=word(colours),c1=word(colours+2),bits=dword(colours+4);
        std::array<Colour,4> palette{rgb565(c0),rgb565(c1),Colour{},Colour{}};
        for(int k=0;k<3;++k){
            palette[2][k]=uint8_t((c0>c1||codec!=0)?(2*palette[0][k]+palette[1][k])/3:(palette[0][k]+palette[1][k])/2);
            palette[3][k]=uint8_t((c0>c1||codec!=0)?(palette[0][k]+2*palette[1][k])/3:0);
        }
        palette[2][3]=255;palette[3][3]=(c0>c1||codec!=0)?255:0;
        std::array<uint8_t,8> alpha{};uint64_t alpha_bits=0;
        if(codec==2){alpha[0]=payload[0];alpha[1]=payload[1];
            if(alpha[0]>alpha[1])for(int i=1;i<=6;++i)alpha[i+1]=uint8_t(((7-i)*alpha[0]+i*alpha[1])/7);
            else {for(int i=1;i<=4;++i)alpha[i+1]=uint8_t(((5-i)*alpha[0]+i*alpha[1])/5);alpha[6]=0;alpha[7]=255;}
            for(int i=0;i<6;++i)alpha_bits|=uint64_t(payload[i+2])<<(8*i);
        }else if(codec==1)for(int i=0;i<8;++i)alpha_bits|=uint64_t(payload[i])<<(8*i);
        for(uint32_t y=0;y<4;++y)for(uint32_t x=0;x<4;++x){uint32_t n=y*4+x;auto colour=palette[(bits>>(2*n))&3];
            if(codec==1)colour[3]=uint8_t(((alpha_bits>>(4*n))&15)*17);
            else if(codec==2)colour[3]=alpha[(alpha_bits>>(3*n))&7];
            if(bx+x<mip.width&&by+y<mip.height)std::memcpy(rgba.data()+(size_t(by+y)*mip.width+bx+x)*4,colour.data(),4);
        }
        payload+=block_size;
    }
    return true;
}
}

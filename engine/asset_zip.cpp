#include "asset_zip.hpp"
#include <algorithm>
#include <cstring>
#include <zlib.h>
namespace web_asset_zip {
namespace { constexpr size_t max_expanded=128*1024*1024; }
uint32_t le(const std::vector<uint8_t>& data,size_t pos,size_t length){
    uint32_t value=0;for(size_t i=0;i<length;++i)value|=static_cast<uint32_t>(data[pos+i])<<(i*8);return value;
}
bool unpack(const std::vector<uint8_t>& data,std::map<std::string,std::vector<uint8_t>>& files,std::string& error){
    const auto fail=[&](const char* message){error=message;return false;};
    if(data.size()<22)return fail("Truncated asset ZIP");
    size_t end=data.size()-22;bool found=false;
    for(size_t i=0;i<=std::min<size_t>(65535,end);++i){size_t pos=end-i;
        if(le(data,pos,4)==0x06054b50&&le(data,pos+20,2)==data.size()-pos-22){end=pos;found=true;break;}}
    if(!found||le(data,end+4,2)||le(data,end+6,2))return fail("Unsupported ZIP end record or split archive");
    const size_t count=le(data,end+10,2),size=le(data,end+12,4),start=le(data,end+16,4);
    if(!count||count>512||le(data,end+8,2)!=count||start>end||size>end-start)return fail("Invalid asset ZIP directory");
    size_t pos=start,total=0;
    for(size_t i=0;i<count;++i){
        if(pos>start+size||start+size-pos<46||le(data,pos,4)!=0x02014b50)return fail("Truncated ZIP directory");
        uint32_t flags=le(data,pos+8,2),method=le(data,pos+10,2),crc=le(data,pos+16,4);
        size_t compressed=le(data,pos+20,4),expanded=le(data,pos+24,4),name_size=le(data,pos+28,2),extra=le(data,pos+30,2),comment=le(data,pos+32,2),offset=le(data,pos+42,4);
        if((flags&0x2041)||(method!=0&&method!=8)||expanded>64*1024*1024||expanded>max_expanded-total||name_size>4096||46+name_size+extra+comment>start+size-pos)return fail("Unsupported or oversized asset ZIP entry");
        std::string name(reinterpret_cast<const char*>(data.data()+pos+46),name_size);
        if(name.empty()||name[0]=='/'||name.find("..")!=std::string::npos||name.find_first_of(":\\")!=std::string::npos||name.find('\0')!=std::string::npos||files.count(name))return fail("Invalid or duplicate asset ZIP path");
        if(offset>start||start-offset<30||le(data,offset,4)!=0x04034b50||le(data,offset+8,2)!=method||le(data,offset+6,2)!=flags)return fail("Invalid ZIP local header");
        size_t local_name=le(data,offset+26,2),local_extra=le(data,offset+28,2);
        if(local_name!=name_size||30+local_name+local_extra>start-offset||std::memcmp(data.data()+offset+30,name.data(),name_size))return fail("ZIP local name mismatch");
        size_t begin=offset+30+local_name+local_extra;
        if(compressed>start-begin)return fail("ZIP payload exceeds data section");
        std::vector<uint8_t> bytes(expanded?expanded:1);
        if(method==0){if(compressed!=expanded)return fail("Invalid stored ZIP size");std::memcpy(bytes.data(),data.data()+begin,expanded);}
        else {
            z_stream stream{};stream.next_in=const_cast<Bytef*>(data.data()+begin);stream.avail_in=compressed;
            stream.next_out=bytes.data();stream.avail_out=bytes.size();
            if(inflateInit2(&stream,-MAX_WBITS)!=Z_OK)return fail("Cannot initialize ZIP decoder");
            int status=inflate(&stream,Z_FINISH);inflateEnd(&stream);
            if(status!=Z_STREAM_END||stream.total_in!=compressed||stream.total_out!=expanded)return fail("Invalid deflated ZIP payload");
        }
        bytes.resize(expanded);
        if(crc32(0,bytes.data(),bytes.size())!=crc)return fail("Asset ZIP CRC mismatch");
        total+=expanded;files.emplace(name,std::move(bytes));pos+=46+name_size+extra+comment;
    }
    return pos==start+size?true:fail("Asset ZIP directory size mismatch");
}
}

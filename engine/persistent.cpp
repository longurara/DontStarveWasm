#include "persistent.hpp"
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <iterator>
#include <sys/stat.h>
#include <vector>
#include <zlib.h>
extern "C" {
#include "lauxlib.h"
}

namespace web_persistent {
namespace {
constexpr size_t limit=64*1024*1024;
std::string root;
bool dirty=false;
const char* alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
std::string base64(const std::string& bytes){
    std::string output;output.reserve((bytes.size()+2)/3*4);
    for(size_t i=0;i<bytes.size();i+=3){
        uint32_t value=static_cast<unsigned char>(bytes[i])<<16;
        if(i+1<bytes.size())value|=static_cast<unsigned char>(bytes[i+1])<<8;
        if(i+2<bytes.size())value|=static_cast<unsigned char>(bytes[i+2]);
        output+=alphabet[(value>>18)&63];output+=alphabet[(value>>12)&63];
        output+=i+1<bytes.size()?alphabet[(value>>6)&63]:'=';
        output+=i+2<bytes.size()?alphabet[value&63]:'=';
    }
    return output;
}
bool unbase64(const std::string& text,std::string& output){
    if(text.size()%4)return false;
    int table[256];std::fill(std::begin(table),std::end(table),-1);
    for(int i=0;i<64;++i)table[static_cast<unsigned char>(alphabet[i])]=i;
    output.clear();
    for(size_t i=0;i<text.size();i+=4){
        uint32_t bits=0;int padding=0;
        for(size_t j=0;j<4;++j){
            unsigned char c=text[i+j];
            if(c=='='){if(j<2||i+4!=text.size())return false;++padding;bits<<=6;}
            else {if(padding||table[c]<0)return false;bits=(bits<<6)|table[c];}
        }
        if(padding>2)return false;
        output+=static_cast<char>(bits>>16);
        if(padding<2)output+=static_cast<char>(bits>>8);
        if(padding<1)output+=static_cast<char>(bits);
    }
    return true;
}
void append32(std::string& output,uint32_t n){for(int i=0;i<4;++i)output+=static_cast<char>(n>>(i*8));}
uint32_t read32(const std::string& data,size_t pos){
    uint32_t value=0;for(int i=0;i<4;++i)value|=static_cast<uint32_t>(static_cast<unsigned char>(data[pos+i]))<<(i*8);return value;
}
bool decode(const std::string& file,std::string& data){
    if(file.rfind("KLEI",0)!=0){data=file;return true;}
    if(file.size()<11||file.substr(4,6)!="     1")return false;
    if(file[10]==' '){data=file.substr(11);return true;}
    if(file[10]!='D')return false;
    std::string bytes;if(!unbase64(file.substr(11),bytes)||bytes.size()<22)return false;
    uint32_t size=read32(bytes,8),compressed=read32(bytes,12);
    if(read32(bytes,0)!=1||read32(bytes,4)!=16||size>limit||compressed!=bytes.size()-16)return false;
    data.resize(size);uLongf actual=size;
    int status=uncompress(reinterpret_cast<Bytef*>(data.data()),&actual,reinterpret_cast<const Bytef*>(bytes.data()+16),compressed);
    return status==Z_OK&&actual==size;
}
std::string encode(const std::string& data,bool compress){
    if(!compress)return "KLEI     1 "+data;
    uLongf capacity=compressBound(data.size());std::string bytes(capacity,'\0');
    int status=compress2(reinterpret_cast<Bytef*>(bytes.data()),&capacity,reinterpret_cast<const Bytef*>(data.data()),data.size(),Z_BEST_COMPRESSION);
    if(status!=Z_OK)return {};
    bytes.resize(capacity);std::string header;append32(header,1);append32(header,16);append32(header,data.size());append32(header,bytes.size());
    return "KLEI     1D"+base64(header+bytes);
}
bool path_for(lua_State* L,int argument,std::string& output){
    size_t size=0;const char* text=luaL_checklstring(L,argument,&size);
    if(!size||size>1024||std::memchr(text,0,size))return false;
    std::string name(text,size);
    for(char& c:name)if(c=='\\')c='/';
    if(name[0]=='/'||name.find(':')!=std::string::npos)return false;
    size_t from=0;
    while(from<=name.size()){
        size_t to=name.find('/',from);if(to==std::string::npos)to=name.size();
        std::string component=name.substr(from,to-from);
        if(component.empty()||component=="."||component=="..")return false;
        from=to+1;
    }
    output=root+"/"+name;return true;
}
void directories(const std::string& path){
    for(size_t i=1;i<path.size();++i)if(path[i]=='/')mkdir(path.substr(0,i).c_str(),0700);
}
void callback(lua_State* L,int index,bool success,const std::string* value){
    if(!lua_isfunction(L,index))return;
    lua_pushvalue(L,index);
    lua_pushboolean(L,success);int args=1;
    // Native GetPersistentString likewise pushes a C string, even when the
    // decoded file itself contains further bytes after NUL.
    if(value){lua_pushstring(L,value->c_str());++args;}
    lua_call(L,args,0);
}
int get(lua_State* L){
    std::string path,data;bool success=false;
    if(path_for(L,2,path)){
        FILE* file=std::fopen(path.c_str(),"rb");
        if(file){
            std::fseek(file,0,SEEK_END);long size=std::ftell(file);std::rewind(file);
            if(size>=0&&static_cast<size_t>(size)<=limit){
                std::string encoded(size,'\0');
                success=std::fread(encoded.data(),1,encoded.size(),file)==encoded.size()&&decode(encoded,data);
            }
            std::fclose(file);
        }
    }
    if(!success)data.clear();
    // The retail native wrapper does not read a fourth argument. Native trace
    // confirms synchronous callback order for omitted, true and false values.
    callback(L,3,success,&data);return 0;
}
int set(lua_State* L){
    std::string path;
    if(!path_for(L,2,path))return luaL_error(L,"Invalid persistent path");
    // Native 0x140120f50 passes luaL_checklstring(..., nullptr) to a
    // C-string encoder. Embedded NUL terminates the persisted payload.
    const char* text=luaL_checkstring(L,3);size_t size=std::strlen(text);
    if(size>limit)return luaL_error(L,"Persistent file exceeds 64 MiB");
    const bool has_compression=lua_type(L,4)==LUA_TBOOLEAN;
    std::string encoded=encode(std::string(text,size),has_compression&&lua_toboolean(L,4));
    if(encoded.empty())return luaL_error(L,"Persistent compression failed");
    directories(path);std::string temporary=path+".pending";FILE* file=std::fopen(temporary.c_str(),"wb");
    bool success=false;
    if(file){bool wrote=std::fwrite(encoded.data(),1,encoded.size(),file)==encoded.size();int closed=std::fclose(file);
        success=wrote&&closed==0&&std::rename(temporary.c_str(),path.c_str())==0;}
    if(!success)std::remove(temporary.c_str());else dirty=true;
    callback(L,has_compression?5:4,success,nullptr);return 0;
}
int exists(lua_State* L){
    std::string path;struct stat info{};bool success=path_for(L,2,path)&&stat(path.c_str(),&info)==0&&S_ISREG(info.st_mode);
    callback(L,3,success,nullptr);return 0;
}
int erase(lua_State* L){
    std::string path;bool success=path_for(L,2,path)&&std::remove(path.c_str())==0;
    if(success)dirty=true;callback(L,3,success,nullptr);return 0;
}
}
void install(lua_State* L,const std::string& role){
    root="/persistent/"+role;directories(root+"/");
    dirty=false;
    lua_getglobal(L,"TheSim");
    for(auto binding:std::vector<std::pair<const char*,lua_CFunction>>{{"GetPersistentString",get},{"SetPersistentString",set},{"CheckPersistentStringExists",exists},{"ErasePersistentString",erase}}){
        lua_pushcfunction(L,binding.second);lua_setfield(L,-2,binding.first);
    }
    lua_pop(L,1);
}
int pending(){return dirty?2:0;}
int complete(lua_State*,bool durable){if(durable)dirty=false;return 0;}
}

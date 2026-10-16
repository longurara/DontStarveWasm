#include "persistent.hpp"
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <dirent.h>
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
bool zip_and_encode_raw(const std::string& data,std::string& out_b64){
    uLongf capacity=compressBound(data.size());std::string bytes(capacity,'\0');
    int status=compress2(reinterpret_cast<Bytef*>(bytes.data()),&capacity,reinterpret_cast<const Bytef*>(data.data()),data.size(),Z_BEST_COMPRESSION);
    if(status!=Z_OK)return false;
    bytes.resize(capacity);std::string header;append32(header,1);append32(header,16);append32(header,data.size());append32(header,bytes.size());
    out_b64=base64(header+bytes);
    return true;
}
bool decode_and_unzip_raw(const std::string& b64,std::string& data){
    std::string bytes;if(!unbase64(b64,bytes)||bytes.size()<16)return false;
    uint32_t size=read32(bytes,8),compressed=read32(bytes,12);
    if(read32(bytes,0)!=1||read32(bytes,4)!=16||size>limit||compressed!=bytes.size()-16)return false;
    data.resize(size);uLongf actual=size;
    int status=uncompress(reinterpret_cast<Bytef*>(data.data()),&actual,reinterpret_cast<const Bytef*>(bytes.data()+16),compressed);
    return status==Z_OK&&actual==size;
}
bool decode(const std::string& file,std::string& data){
    if(file.rfind("KLEI",0)!=0){data=file;return true;}
    if(file.size()<11||file.substr(4,6)!="     1")return false;
    if(file[10]==' '){data=file.substr(11);return true;}
    if(file[10]!='D')return false;
    return decode_and_unzip_raw(file.substr(11),data);
}
std::string encode(const std::string& data,bool compress){
    if(!compress)return "KLEI     1 "+data;
    std::string b64;
    if(!zip_and_encode_raw(data,b64))return {};
    return "KLEI     1D"+b64;
}
bool sanitize_rel(const char* text,size_t size,std::string& out){
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
    out=name;return true;
}
bool path_for(lua_State* L,int argument,std::string& output){
    size_t size=0;const char* text=luaL_checklstring(L,argument,&size);
    std::string rel;
    if(!sanitize_rel(text,size,rel))return false;
    output=root+"/"+rel;return true;
}
bool cluster_path_for(lua_State* L,int slot_arg,int shard_arg,int file_arg,std::string& output){
    int slot=static_cast<int>(luaL_checkinteger(L,slot_arg));
    if(slot<0||slot>9999)return false;
    size_t sh_len=0,f_len=0;
    const char* shard=luaL_optlstring(L,shard_arg,"",&sh_len);
    const char* file=luaL_checklstring(L,file_arg,&f_len);
    std::string file_rel;
    if(!sanitize_rel(file,f_len,file_rel))return false;
    std::string prefix=root+"/Cluster_"+std::to_string(slot);
    if(sh_len>0){
        std::string shard_rel;
        if(!sanitize_rel(shard,sh_len,shard_rel))return false;
        prefix+="/"+shard_rel;
    }
    output=prefix+"/"+file_rel;
    return true;
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
int read_file_into(const std::string& path,std::string& data){
    FILE* file=std::fopen(path.c_str(),"rb");
    if(!file)return false;
    std::fseek(file,0,SEEK_END);long size=std::ftell(file);std::rewind(file);
    bool success=false;
    if(size>=0&&static_cast<size_t>(size)<=limit){
        std::string encoded(size,'\0');
        success=std::fread(encoded.data(),1,encoded.size(),file)==encoded.size()&&decode(encoded,data);
    }
    std::fclose(file);
    return success;
}
int get(lua_State* L){
    std::string path,data;
    bool success=path_for(L,2,path)&&read_file_into(path,data);
    if(!success)data.clear();
    callback(L,3,success,&data);return 0;
}
int get_cluster(lua_State* L){
    std::string path,data;
    bool success=cluster_path_for(L,2,3,4,path)&&read_file_into(path,data);
    if(!success)data.clear();
    callback(L,5,success,&data);return 0;
}
bool write_file_from(const std::string& path,const std::string& encoded){
    directories(path);std::string temporary=path+".pending";FILE* file=std::fopen(temporary.c_str(),"wb");
    bool success=false;
    if(file){bool wrote=std::fwrite(encoded.data(),1,encoded.size(),file)==encoded.size();int closed=std::fclose(file);
        success=wrote&&closed==0&&std::rename(temporary.c_str(),path.c_str())==0;}
    if(!success)std::remove(temporary.c_str());else dirty=true;
    return success;
}
int set(lua_State* L){
    std::string path;
    if(!path_for(L,2,path))return luaL_error(L,"Invalid persistent path");
    const char* text=luaL_checkstring(L,3);size_t size=std::strlen(text);
    if(size>limit)return luaL_error(L,"Persistent file exceeds 64 MiB");
    const bool has_compression=lua_type(L,4)==LUA_TBOOLEAN;
    std::string encoded=encode(std::string(text,size),has_compression&&lua_toboolean(L,4));
    if(encoded.empty())return luaL_error(L,"Persistent compression failed");
    bool success=write_file_from(path,encoded);
    callback(L,has_compression?5:4,success,nullptr);return 0;
}
int set_cluster(lua_State* L){
    std::string path;
    if(!cluster_path_for(L,2,3,4,path))return luaL_error(L,"Invalid cluster persistent path");
    const char* text=luaL_checkstring(L,5);size_t size=std::strlen(text);
    if(size>limit)return luaL_error(L,"Persistent file exceeds 64 MiB");
    const bool has_compression=lua_type(L,6)==LUA_TBOOLEAN;
    std::string encoded=encode(std::string(text,size),has_compression&&lua_toboolean(L,6));
    if(encoded.empty())return luaL_error(L,"Persistent compression failed");
    bool success=write_file_from(path,encoded);
    callback(L,has_compression?7:6,success,nullptr);return 0;
}
int exists(lua_State* L){
    std::string path;struct stat info{};bool success=path_for(L,2,path)&&stat(path.c_str(),&info)==0&&S_ISREG(info.st_mode);
    callback(L,3,success,nullptr);return 0;
}
int erase(lua_State* L){
    std::string path;bool success=path_for(L,2,path)&&std::remove(path.c_str())==0;
    if(success)dirty=true;callback(L,3,success,nullptr);return 0;
}
// Native 0x14011bf80: DecodeKleiData
int decode_klei_data(lua_State* L){
    size_t len=0;const char* str=luaL_checklstring(L,2,&len);
    if(len<10||std::memcmp(str,"KLEI",4)!=0){
        lua_pushlstring(L,str,len);
        return 1;
    }
    if(str[10]!='D'){
        size_t off=len>=11?11:len;
        lua_pushlstring(L,str+off,len-off);
        return 1;
    }
    std::string decoded;
    if(!unbase64(std::string(str+11,len-11),decoded))decoded.clear();
    lua_pushstring(L,decoded.c_str());
    return 1;
}
// Native 0x14011c080: ZipAndEncodeString
int zip_and_encode_string(lua_State* L){
    const char* str=luaL_checkstring(L,2);
    std::string b64;
    zip_and_encode_raw(std::string(str),b64);
    lua_pushstring(L,b64.c_str());
    return 1;
}
// Native 0x14011c0f0: DecodeAndUnzipString
int decode_and_unzip_string(lua_State* L){
    const char* b64=luaL_checkstring(L,2);
    std::string out;
    decode_and_unzip_raw(std::string(b64),out);
    lua_pushstring(L,out.c_str());
    return 1;
}
// Native 0x140122120: GetUserPresetFiles
int get_user_preset_files(lua_State* L){
    lua_newtable(L);
    lua_newtable(L);
    std::string dir_path=root+"/world_presets";
    DIR* dir=opendir(dir_path.c_str());
    if(dir){
        int wsp_idx=1,wgp_idx=1;
        while(struct dirent* ent=readdir(dir)){
            std::string name=ent->d_name;
            if(name.rfind("CUSTOM_",0)==0&&name.size()>4){
                std::string ext=name.substr(name.size()-4);
                std::string stem=name.substr(0,name.size()-4);
                if(ext==".wsp"){
                    lua_pushlstring(L,stem.data(),stem.size());
                    lua_rawseti(L,-3,wsp_idx++);
                }else if(ext==".wgp"){
                    lua_pushlstring(L,stem.data(),stem.size());
                    lua_rawseti(L,-2,wgp_idx++);
                }
            }
        }
        closedir(dir);
    }
    return 2;
}
// Native 0x14011ecf0, 0x14011c370, 0x14011c3a0
int always_true(lua_State* L){lua_pushboolean(L,1);return 1;}
}
void install(lua_State* L,const std::string& role){
    root="/persistent/"+role;directories(root+"/");
    dirty=false;
    lua_getglobal(L,"TheSim");
    for(auto binding:std::vector<std::pair<const char*,lua_CFunction>>{
        {"GetPersistentString",get},
        {"GetPersistentStringInClusterSlot",get_cluster},
        {"SetPersistentString",set},
        {"SetPersistentStringInClusterSlot",set_cluster},
        {"CheckPersistentStringExists",exists},
        {"ErasePersistentString",erase},
        {"DecodeKleiData",decode_klei_data},
        {"ZipAndEncodeString",zip_and_encode_string},
        {"DecodeAndUnzipString",decode_and_unzip_string},
        {"GetUserPresetFiles",get_user_preset_files},
        {"HasEnoughFreeDiskSpace",always_true},
        {"CanWriteConfigurationDirectory",always_true},
        {"CanReadConfigurationDirectory",always_true}
    }){
        lua_pushcfunction(L,binding.second);lua_setfield(L,-2,binding.first);
    }
    lua_pop(L,1);
}
int pending(){return dirty?2:0;}
int complete(lua_State*,bool durable){if(durable)dirty=false;return 0;}
}

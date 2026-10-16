#include "file_asset.hpp"
#include "resource_io.hpp"
#include "sha256.hpp"
#include "string_hash.hpp"
#include <map>
extern "C" {
#include "lauxlib.h"
}
namespace web_file_asset {
namespace {
struct Record {std::vector<uint8_t> bytes;uint32_t references=1;size_t retained=0;};
// Native generic resource manager (0x140389040) indexes only the StringID
// hash, including ASCII case folding. A second spelling reuses the record.
std::map<uint32_t,Record> cache;
size_t retained=0;
constexpr size_t budget=64*1024*1024;
void number(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);
        number(L,"files",cache.size());number(L,"retainedBytes",retained);number(L,"budget",budget);return 1;
    }
    auto found=cache.find(web_strings::hash(luaL_checkstring(L,1)));
    if(found==cache.end()){lua_pushnil(L);return 1;}
    lua_newtable(L);
    const auto& value=found->second;
    number(L,"bytes",value.bytes.size()-1);number(L,"references",value.references);number(L,"retainedBytes",value.retained);
    auto hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(value.bytes.data()),value.bytes.size()-1));
    lua_pushlstring(L,hash.data(),hash.size());lua_setfield(L,-2,"sha256");
    lua_pushboolean(L,value.bytes.back()==0);lua_setfield(L,-2,"terminated");return 1;
}
}
bool acquire(const std::string& path,std::string& error){
    auto id=web_strings::hash(path);auto found=cache.find(id);
    if(found!=cache.end()){
        if(found->second.references==UINT32_MAX){error="FILE resource reference count overflow";return false;}
        ++found->second.references;return true;
    }
    Record value;
    if(!web_resource_io::read(path,value.bytes,error))return false;
    // Native loader 0x14000f760 allocates source length + 1, copies length
    // bytes and writes the terminating zero. No decoding or text conversion.
    value.bytes.push_back(0);value.retained=value.bytes.capacity()+path.size()+sizeof(Record)+64;
    if(value.retained>budget-retained){error="FILE asset memory budget exceeded by active resources";return false;}
    retained+=value.retained;cache.emplace(id,std::move(value));return true;
}
void release(const std::string& path){
    auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;
    if(--found->second.references)return;
    retained-=found->second.retained;cache.erase(found);
}
const std::vector<uint8_t>* get(const std::string& path){auto found=cache.find(web_strings::hash(path));return found==cache.end()?nullptr:&found->second.bytes;}
void clear(){cache.clear();retained=0;}
void install(lua_State* L){clear();lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebFileAssets");}
}

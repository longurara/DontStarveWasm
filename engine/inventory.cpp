#include "inventory.hpp"
#include "sha256.hpp"
#include "string_hash.hpp"
#include <cmath>
#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_inventory {
namespace {
struct Restricted {std::string build,item;bool unlocked;};
std::vector<Restricted> restricted;
std::map<std::string,std::map<uint32_t,std::set<std::string>>> sets;
std::map<std::string,std::string> links;
std::map<std::string,std::pair<std::string,std::string>> emojis;
std::map<std::string,std::pair<uint32_t,uint32_t>> dlc;
std::map<std::string,uint16_t> item_ids;
std::set<std::string> keys,free_items;
std::map<uint32_t,std::string> interned;
std::string transcript,signature;
bool signature_recorded=false;
void self(lua_State* L){luaL_checkudata(L,1,"dst.InventoryProxy");}
std::string text(lua_State* L,int index){size_t size=0;const char* value=luaL_checklstring(L,index,&size);return std::string(value,size);}
uint32_t number(lua_State* L,int index){
    double value=luaL_checknumber(L,index);
    if(!std::isfinite(value)||value<0||value>0xffffffffu)luaL_error(L,"Invalid inventory integer");
    return static_cast<uint32_t>(value);
}
void append(lua_State* L,const std::string& value){
    if(transcript.size()+value.size()>16*1024*1024)luaL_error(L,"Skin dataset transcript exceeds 16 MiB");
    transcript+=value;
    signature_recorded=false;
}
void clear_data(){
    restricted.clear();sets.clear();links.clear();emojis.clear();dlc.clear();item_ids.clear();keys.clear();free_items.clear();
    transcript.clear();signature.clear();signature_recorded=false;
}
int clear(lua_State* L){self(L);clear_data();return 0;}
int add_restricted(lua_State* L){
    self(L);auto build=text(L,2),item=text(L,3);bool unlocked=lua_toboolean(L,4);
    append(L,"arbfl"+build+item+(unlocked?"true":"false"));restricted.push_back({build,item,unlocked});return 0;
}
int add_set(lua_State* L){
    self(L);auto item=text(L,2);uint32_t slot=number(L,3);auto member=text(L,4);
    append(L,"assi"+item+std::to_string(slot)+member);sets[item][slot].insert(member);return 0;
}
int add_link(lua_State* L){self(L);auto item=text(L,2),target=text(L,3);append(L,"asli"+item+target);links[item]=target;return 0;}
int add_emoji(lua_State* L){self(L);auto item=text(L,2),name=text(L,3),glyph=text(L,4);append(L,"ae"+item+name+glyph);emojis[item]={name,glyph};return 0;}
int add_dlc(lua_State* L){self(L);auto item=text(L,2);uint32_t app=number(L,3),sub=number(L,4);dlc[item]={app,sub};return 0;}
int add_key(lua_State* L){self(L);auto key=text(L,2);append(L,"aak"+key);keys.insert(key);interned.emplace(web_strings::hash(key),key);return 0;}
int add_item_id(lua_State* L){
    self(L);uint16_t id=static_cast<uint16_t>(number(L,2));auto item=text(L,3);
    append(L,"ip"+std::string(1,static_cast<char>(id&255))+item);item_ids[item]=id;return 0;
}
int add_free(lua_State* L){self(L);auto item=text(L,2);append(L,"zwi"+item);free_items.insert(item);return 0;}
int record_signature(lua_State* L){
    self(L);auto supplied=text(L,2);
    // Native 0x140249540 hashes the transcript and stores the supplied
    // signature; verification/locking occurs later in native initialization.
    // This binding does not report that the signature has been verified.
    transcript=web_crypto::sha256(transcript);signature=supplied;signature_recorded=true;return 0;
}
int ownership(lua_State* L){self(L);auto item=text(L,2);lua_pushboolean(L,free_items.count(item)>0);return 1;}
int lookup(lua_State* L){
    self(L);double value=luaL_checknumber(L,2);
    if(!std::isfinite(value))return luaL_error(L,"Invalid skin hash");
    value=std::fmod(std::trunc(value),4294967296.0);if(value<0)value+=4294967296.0;
    uint32_t key=static_cast<uint32_t>(value);auto found=interned.find(key);
    if(found!=interned.end())lua_pushlstring(L,found->second.data(),found->second.size());
    else lua_pushstring(L,key?"FROMNUM":"");return 1;
}
void count(lua_State* L,const char* name,size_t value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    lua_newtable(L);
    lua_pushlstring(L,transcript.data(),transcript.size());lua_setfield(L,-2,signature_recorded?"datasetSha256":"transcript");
    lua_pushlstring(L,signature.data(),signature.size());lua_setfield(L,-2,"signature");
    lua_pushboolean(L,false);lua_setfield(L,-2,"signatureVerified");
    lua_newtable(L);count(L,"restricted",restricted.size());count(L,"skinSets",sets.size());count(L,"skinLinks",links.size());
    count(L,"emojis",emojis.size());count(L,"dlc",dlc.size());count(L,"keys",keys.size());count(L,"itemIDs",item_ids.size());count(L,"freeItems",free_items.size());
    lua_setfield(L,-2,"counts");return 1;
}
int digest(lua_State* L){auto result=web_crypto::sha256(text(L,1));lua_pushlstring(L,result.data(),result.size());return 1;}
int unknown(lua_State* L){return luaL_error(L,"UNIMPLEMENTED_NATIVE: InventoryProxy.%s",luaL_checkstring(L,2));}
}
void install(lua_State* L){
    clear_data();interned.clear();luaL_newmetatable(L,"dst.InventoryProxy");lua_newtable(L);
    const luaL_Reg methods[]={{"ClearSkinsDataset",clear},{"AddRestrictedBuildFromLua",add_restricted},{"AddSkinSetInput",add_set},
        {"AddSkinLinkInput",add_link},{"AddEmoji",add_emoji},{"AddSkinDLCInput",add_dlc},{"AddItemIDPairing",add_item_id},
        {"AddFreeItemForEveryone",add_free},{"ValidateWithSignature",record_signature},{"AddCookBookKey",add_key},
        {"AddPlantRegistryKey",add_key},{"AddGenericKVKey",add_key},{"AddSkillTreeKey",add_key},
        {"CheckOwnership",ownership},{"LookupSkinname",lookup},{nullptr,nullptr}};
    luaL_register(L,nullptr,methods);
    for(int i=0;i<16;++i){auto name="AddScrapbook"+std::to_string(i)+"Key";lua_pushcfunction(L,add_key);lua_setfield(L,-2,name.c_str());}
    lua_newtable(L);lua_pushcfunction(L,unknown);lua_setfield(L,-2,"__index");lua_setmetatable(L,-2);
    lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.InventoryProxy");lua_setmetatable(L,-2);lua_setglobal(L,"TheInventory");
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_pushcfunction(L,digest);lua_setfield(L,-2,"SHA256");lua_setglobal(L,"WebInventory");
}
}

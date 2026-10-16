#include "map_layers.hpp"
#include "atlas_asset.hpp"
#include "asset_xml.hpp"
#include "file_asset.hpp"
#include "sha256.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_map_layers {
namespace {
using UV=std::array<float,4>;
struct Layer {uint16_t tile=0;int32_t style=0;uint32_t shape_count=0;std::array<UV,4> colours;std::array<std::vector<UV>,48> groups;size_t bytes=0;};
struct Manager {int32_t style=0;std::vector<std::unique_ptr<Layer>> slots;std::vector<uint32_t> free;};
web_components::EntityHost host{};bool client_role=false;
std::map<uint32_t,Manager> managers;
size_t retained=0,active=0,total_slots=0;
constexpr size_t budget=32*1024*1024,owner_budget=50000,slot_budget=8192;
std::string last_error;
uint32_t integer(lua_State* L,int index){double value=luaL_checknumber(L,index);
    if(!std::isfinite(value)||value<-9223372036854775808.0||value>=9223372036854775808.0)return 0;
    return static_cast<uint32_t>(static_cast<int64_t>(value));
}
int32_t signed_word(uint32_t bits){int32_t result;std::memcpy(&result,&bits,4);return result;}
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.MapLayerManager"));}
Manager& manager(lua_State* L){auto id=owner(L);auto found=managers.find(id);
    if(!host.alive(id)||found==managers.end())luaL_error(L,"MapLayerManager owner is removed");return found->second;
}
int add(lua_State* L){auto id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add MapLayerManager to a removed entity");
    if(client_role)return luaL_error(L,"UNIMPLEMENTED_NATIVE: client MapLayerManager renderer");
    if(!managers.count(id)){
        if(managers.size()>=owner_budget)return luaL_error(L,"MapLayerManager count exceeds budget");
        managers.emplace(id,Manager{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.MapLayerManager");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"MapLayerManager");}lua_pop(L,1);}
    lua_pop(L,1);return 1;
}
int style(lua_State* L){auto& value=manager(L);value.style=signed_word(integer(L,2));return 0;}
bool xml_number(rapidxml::xml_node<>* node,const char* name,float& value){
    auto* attr=node->first_attribute(name);if(!attr||!attr->value_size())return false;
    char* end=nullptr;value=std::strtof(attr->value(),&end);
    while(end&&(*end==' '||*end=='\t'||*end=='\r'||*end=='\n'))++end;
    return end&&end!=attr->value()&&!*end&&std::isfinite(value);
}
bool parse_file_elements(const std::vector<uint8_t>& file_bytes,std::vector<std::pair<std::string,UV>>& out){
    std::vector<uint8_t> copy=file_bytes;
    if(!copy.empty()&&copy.back()==0)copy.pop_back();
    const auto doc=std::make_unique<rapidxml::xml_document<>>();
    std::string err;
    if(!web_asset_xml::parse(copy,*doc,16*1024*1024,err))return false;
    auto* root=doc->first_node("Atlas");
    auto* elements=root?root->first_node("Elements"):nullptr;
    if(!elements)return false;
    for(auto* item=elements->first_node("Element");item;item=item->next_sibling("Element")){
        auto* name=item->first_attribute("name");
        if(!name||!name->value_size())return false;
        UV uv{};
        const char* keys[]={"u1","v1","u2","v2"};
        for(int i=0;i<4;++i)if(!xml_number(item,keys[i],uv[i]))return false;
        out.emplace_back(std::string(name->value(),name->value_size()),uv);
    }
    return true;
}
int create(Manager& value,uint16_t tile,const char* path){
    // No Lua callbacks or longjmp errors while staging C++ allocations.
    const auto* atlas=web_atlas_asset::get_owned(path);
    const auto* file_bytes=atlas?nullptr:web_file_asset::get(path);
    if(!atlas&&!file_bytes){last_error="MapLayerManager ATLAS must be loaded before CreateRenderLayer";return -1;}
    if(value.free.empty()&&value.slots.size()>=slot_budget){last_error="MapLayerManager slot count exceeds budget";return -1;}
    if(value.free.empty()&&total_slots>=65536){last_error="MapLayerManager aggregate slot count exceeds budget";return -1;}
    auto layer=std::make_unique<Layer>();layer->tile=tile;layer->style=value.style;
    for(auto& colour:layer->colours)colour.fill(1.f);
    if(atlas){
        layer->shape_count=std::min<size_t>(48,atlas->elements.size());
        for(auto index:atlas->source_order){const auto& element=atlas->elements[index];
            // Native atoi consumes a numeric prefix; 17 is reserved, and names
            // above it are shifted down one slot. XML variant ordering matters.
            char* end=nullptr;long name=std::strtol(element.name.c_str(),&end,10);
            if(end==element.name.c_str()||name<1||name>49){last_error="MapLayerManager atlas element name outside 1..49";return -1;}
            if(name==17)continue;if(name>16)--name;
            layer->groups[name-1].push_back(element.uv);
        }
    }else{
        std::vector<std::pair<std::string,UV>> elements;
        if(!parse_file_elements(*file_bytes,elements)){last_error="MapLayerManager invalid FILE atlas XML";return -1;}
        layer->shape_count=std::min<size_t>(48,elements.size());
        for(const auto& [ename,uv]:elements){
            char* end=nullptr;long name=std::strtol(ename.c_str(),&end,10);
            if(end==ename.c_str()||name<1||name>49){last_error="MapLayerManager atlas element name outside 1..49";return -1;}
            if(name==17)continue;if(name>16)--name;
            layer->groups[name-1].push_back(uv);
        }
    }
    layer->bytes=sizeof(Layer)+64;for(const auto& group:layer->groups)layer->bytes+=group.capacity()*sizeof(UV);
    if(layer->bytes>budget-retained){last_error="MapLayerManager data exceeds 32 MiB budget";return -1;}
    retained+=layer->bytes;++active;
    if(!value.free.empty()){auto handle=value.free.back();value.free.pop_back();value.slots[handle]=std::move(layer);return handle;}
    value.slots.push_back(std::move(layer));++total_slots;return value.slots.size()-1;
}
int create_lua(lua_State* L){auto& value=manager(L);auto tile=static_cast<uint16_t>(integer(L,2));
    const char* atlas=luaL_checkstring(L,3);luaL_checkstring(L,4);luaL_checkstring(L,5);
    // Dedicated texture/noise resolution only checks the IMAGE cache, which
    // is omitted by native dedicated loading; both handles remain -1.
    int handle=create(value,tile,atlas);if(handle<0)return luaL_error(L,"%s",last_error.c_str());lua_pushinteger(L,handle);return 1;
}
Layer& layer(lua_State* L,Manager& value,uint32_t handle){
    if(handle>=value.slots.size()||!value.slots[handle])luaL_error(L,"MapLayerManager invalid or released handle");return *value.slots[handle];
}
int release(lua_State* L){auto& value=manager(L);auto handle=integer(L,2);if(handle==UINT32_MAX)return 0;
    auto& entry=layer(L,value,handle);retained-=entry.bytes;--active;value.slots[handle].reset();value.free.push_back(handle);return 0;
}
int colour(lua_State* L){auto& value=manager(L);auto handle=integer(L,2);UV rgba;
    for(int i=0;i<4;++i)rgba[i]=static_cast<float>(luaL_checknumber(L,i+3));
    layer(L,value,handle).colours[lua_tointeger(L,lua_upvalueindex(1))]=rgba;return 0;
}
void u32(std::string& out,uint32_t value){for(int i=0;i<4;++i)out+=static_cast<char>(value>>(i*8));}
void floating(std::string& out,float value){uint32_t bits;std::memcpy(&bits,&value,4);u32(out,bits);}
void number(lua_State* L,const char* name,double value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
std::string hex(const std::string& bytes){const char* digits="0123456789abcdef";std::string out;out.reserve(bytes.size()*2);
    for(unsigned char byte:bytes){out+=digits[byte>>4];out+=digits[byte&15];}return out;
}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);number(L,"managers",managers.size());number(L,"layers",active);number(L,"slots",total_slots);number(L,"retainedBytes",retained);number(L,"budget",budget);return 1;}
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto found=managers.find(static_cast<uint32_t>(raw));if(found==managers.end()){lua_pushnil(L);return 1;}
    const auto& value=found->second;lua_newtable(L);number(L,"owner",raw);number(L,"typeId",0xfe8cd8b8);number(L,"sampleStyle",value.style);
    lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");lua_newtable(L);int at=0;
    for(size_t i=0;i<value.slots.size();++i){if(!value.slots[i])continue;const auto& entry=*value.slots[i];lua_newtable(L);
        number(L,"handle",i);number(L,"tileId",entry.tile);number(L,"sampleStyle",entry.style);number(L,"shapeCount",entry.shape_count);
        number(L,"textureHandle",-1);number(L,"noiseHandle",-1);
        std::string colours,uv;for(const auto& rgba:entry.colours)for(float component:rgba)floating(colours,component);
        auto encoded=hex(colours);lua_pushlstring(L,encoded.data(),encoded.size());lua_setfield(L,-2,"colourBits");
        lua_newtable(L);for(size_t j=0;j<entry.groups.size();++j){const auto& group=entry.groups[j];u32(uv,group.size());
            for(const auto& coordinates:group)for(float component:coordinates)floating(uv,component);
            lua_pushnumber(L,group.size());lua_rawseti(L,-2,j+1);}
        lua_setfield(L,-2,"uvCounts");auto digest=web_crypto::sha256(uv);lua_pushlstring(L,digest.data(),digest.size());lua_setfield(L,-2,"uvSha256");lua_rawseti(L,-2,++at);
    }
    lua_setfield(L,-2,"layers");return 1;
}
int tostring_manager(lua_State* L){owner(L);lua_pushfstring(L,"MapLayerManager (%p)",lua_touserdata(L,1));return 1;}
}
void retire(uint32_t id){auto found=managers.find(id);if(found==managers.end())return;
    for(const auto& entry:found->second.slots)if(entry){retained-=entry->bytes;--active;}total_slots-=found->second.slots.size();managers.erase(found);
}
void clear(){managers.clear();retained=0;active=0;total_slots=0;last_error.clear();}
void install(lua_State* L,web_components::EntityHost callbacks,bool client){clear();host=callbacks;client_role=client;
    luaL_newmetatable(L,"dst.MapLayerManager");lua_newtable(L);
    const luaL_Reg methods[]={{"CreateRenderLayer",create_lua},{"ReleaseRenderLayer",release},{"SetSampleStyle",style},{nullptr,nullptr}};luaL_register(L,nullptr,methods);
    const char* names[]={"SetPrimaryColor","SetSecondaryColor","SetSecondaryColorDusk","SetMinimapColor"};
    for(int i=0;i<4;++i){lua_pushinteger(L,i);lua_pushcclosure(L,colour,1);lua_setfield(L,-2,names[i]);}
    lua_setfield(L,-2,"__index");lua_pushcfunction(L,tostring_manager);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddMapLayerManager");lua_pop(L,1);
    lua_getglobal(L,"WebComponents");lua_pushcfunction(L,inspect);lua_setfield(L,-2,"MapLayerManager");lua_pop(L,1);
}
}

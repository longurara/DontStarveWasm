#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <sys/stat.h>
#include <emscripten/emscripten.h>
#include <emscripten/heap.h>
#include "persistent.hpp"
#include "tiles.hpp"
#include "input.hpp"
#include "inventory.hpp"
#include "system.hpp"
#include "prefabs.hpp"
#include "game_service.hpp"
#include "string_hash.hpp"
#include "camera.hpp"
#include "session.hpp"
#include "resource_io.hpp"
#include "animation_asset.hpp"
#include "file_asset.hpp"
#include "atlas_asset.hpp"
#include "shader_asset.hpp"
#include "texture_asset.hpp"
#include "font_asset.hpp"
#include "components.hpp"
#include "world_components.hpp"
#include "physics_waker.hpp"
#include "sha256.hpp"
#include "ui_transform.hpp"
#include "image_widget.hpp"
#include "text_widget.hpp"
extern "C" {

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
int luaopen_bit(lua_State*);
void dst_audio_release();
}

namespace {
struct EntityState {
    uint32_t guid;
    explicit EntityState(uint32_t id) : guid(id) {}
    bool valid = true;
    bool sleeping=false,can_sleep=true,components_allow_sleep=true,sleep_state_pending=true;
    bool has_transform=false,prefab_complete=false;
    bool visible=true,clickable=true,in_limbo=false;
    bool in_spatial_grid=false;
    int64_t spatial_cell=0;
    float x = 0, y = 0, z = 0, rotation = 0;
    float sx = 1, sy = 1, sz = 1;
    uint32_t parent = 0, platform = 0;
    std::vector<uint32_t> children;
    std::string name, prefab;
    std::unordered_set<std::string> tags;
};
lua_State* state = nullptr;
std::unordered_map<uint32_t, EntityState> entities;
std::unordered_map<int64_t, std::vector<uint32_t>> spatial_grid;
std::unordered_set<uint32_t> parented_transforms;
int64_t pack_grid_cell(int32_t gx,int32_t gz){
    return (static_cast<int64_t>(gx)<<32)|static_cast<uint32_t>(gz);
}
int64_t coord_grid_cell(float x,float z){
    int32_t gx=std::isfinite(x)?static_cast<int32_t>(std::floor(x*0.0625f)):0;
    int32_t gz=std::isfinite(z)?static_cast<int32_t>(std::floor(z*0.0625f)):0;
    return pack_grid_cell(gx,gz);
}
void remove_from_grid_cell(int64_t cell,uint32_t id){
    auto it=spatial_grid.find(cell);
    if(it==spatial_grid.end())return;
    auto& vec=it->second;
    for(size_t i=0;i<vec.size();++i){
        if(vec[i]==id){vec[i]=vec.back();vec.pop_back();break;}
    }
    if(vec.empty())spatial_grid.erase(it);
}
void update_entity_spatial(EntityState& e){
    if(!e.valid||!e.has_transform){
        if(e.in_spatial_grid){remove_from_grid_cell(e.spatial_cell,e.guid);e.in_spatial_grid=false;}
        parented_transforms.erase(e.guid);
        return;
    }
    if(e.parent!=0){
        if(e.in_spatial_grid){remove_from_grid_cell(e.spatial_cell,e.guid);e.in_spatial_grid=false;}
        if(e.tags.count("CLASSIFIED"))parented_transforms.erase(e.guid);
        else parented_transforms.insert(e.guid);
        return;
    }
    parented_transforms.erase(e.guid);
    int64_t cell=coord_grid_cell(e.x,e.z);
    if(e.in_spatial_grid&&e.spatial_cell==cell)return;
    if(e.in_spatial_grid)remove_from_grid_cell(e.spatial_cell,e.guid);
    spatial_grid[cell].push_back(e.guid);
    e.spatial_cell=cell;
    e.in_spatial_grid=true;
}
std::string result;
uint32_t tick = 0, next_guid = 1;
// Native increments a process-global uint32 in the Sim constructor, not a
// persistent profile statistic. Lua VM/Sim resets keep this counter alive.
uint32_t sim_launches = 0;
// Main application state, also retained while its Sim/Lua VM is rebuilt.
int32_t stashed_play_instance = -1;
uint64_t profile_stat_events=0,profile_stat_bytes=0;
std::string profile_stat_channel,profile_stat_sha256;
int profiler_depth = 0;
std::string runtime_role;
std::map<std::string,uint32_t> resource_catalog;
std::map<uint32_t,std::set<std::string>> texture_groups;
constexpr double tick_time = 0.03333333507180214;
uint64_t rng_state=0;
constexpr uint64_t rng_increment=0xb47c73972972b7b7ULL;
constexpr uint64_t rng_multiplier=0x5851f42d4c957f2dULL;
void seed_rng(uint32_t value){rng_state=(static_cast<uint64_t>(value)+rng_increment)*rng_multiplier+rng_increment;}
uint32_t random_u32(){
    uint64_t old=rng_state;rng_state=old*rng_multiplier+rng_increment;
    uint32_t shifted=static_cast<uint32_t>((old>>45)^(old>>27));
    uint32_t rotation=static_cast<uint32_t>(old>>59);
    return (shifted>>rotation)|(shifted<<((-rotation)&31));
}
int math_randomseed(lua_State* L){seed_rng(static_cast<uint32_t>(luaL_checkinteger(L,1)));return 0;}
int native_hash(lua_State* L){
    // Client hash/smallhash share 0x1400fe6e0 -> 0x1404300a0.
    // luaL_checkstring and the native loop both use C-string termination.
    lua_pushnumber(L,web_strings::hash(luaL_checkstring(L,1)));return 1;
}
int math_random(lua_State* L){
    double random=static_cast<double>(random_u32())/4294967295.0;
    int count=lua_gettop(L);
    if(count==0){lua_pushnumber(L,random);return 1;}
    if(count>2)return luaL_error(L,"wrong number of arguments");
    int64_t lower=count==1?1:static_cast<int32_t>(luaL_checkinteger(L,1));
    int64_t upper=static_cast<int32_t>(luaL_checkinteger(L,count));
    if(upper<lower)return luaL_error(L,"interval is empty");
    lua_pushnumber(L,std::floor(random*static_cast<double>(upper-lower+1))+static_cast<double>(lower));return 1;
}
int get_rng(lua_State* L){char text[17];std::snprintf(text,sizeof(text),"%016llx",static_cast<unsigned long long>(rng_state));lua_pushstring(L,text);return 1;}
int get_num_launches(lua_State* L){lua_pushnumber(L,sim_launches);return 1;}
int get_stashed_play_instance(lua_State* L){lua_pushnumber(L,stashed_play_instance);return 1;}
int stash_play_instance(lua_State* L){
    double value=std::trunc(luaL_checknumber(L,2));
    // x64 CVTTSD2SI returns INT32_MIN for nonfinite/out-of-range inputs.
    stashed_play_instance=std::isfinite(value)&&value>=-2147483648.0&&value<=2147483647.0
        ?static_cast<int32_t>(value):INT32_MIN;
    return 0;
}
int local_profile_stats(lua_State* L){
    // Web platform policy: retain bounded diagnostics, never contact the
    // official telemetry service. Preserve the normal Lua zero-result call.
    const char* payload=luaL_checkstring(L,2);
    const char* channel=luaL_optstring(L,3,"");
    size_t bytes=std::strlen(payload),channel_bytes=std::strlen(channel);
    if(bytes>256*1024||channel_bytes>128||profile_stat_events>=1000000)return luaL_error(L,"Web profile statistics exceed diagnostic limits");
    auto digest=web_crypto::sha256(std::string(payload,bytes));
    profile_stat_channel=channel;profile_stat_sha256=std::move(digest);
    profile_stat_bytes+=bytes;++profile_stat_events;
    if(profile_stat_events==1)std::puts("WEB_COMPAT: profile statistics recorded locally; official telemetry transport disabled");
    return 0;
}
int inspect_profile_stats(lua_State* L){
    lua_newtable(L);lua_pushliteral(L,"local-diagnostics");lua_setfield(L,-2,"policy");
    lua_pushboolean(L,false);lua_setfield(L,-2,"networkEnabled");
    lua_pushnumber(L,profile_stat_events);lua_setfield(L,-2,"events");
    lua_pushnumber(L,profile_stat_bytes);lua_setfield(L,-2,"bytes");
    lua_pushstring(L,profile_stat_channel.c_str());lua_setfield(L,-2,"lastChannel");
    lua_pushstring(L,profile_stat_sha256.c_str());lua_setfield(L,-2,"lastPayloadSha256");return 1;
}
int set_rng(lua_State* L){
    size_t length=0;const char* text=luaL_checklstring(L,1,&length);
    if(length!=16)return luaL_error(L,"Invalid RNG state");
    uint64_t value=0;
    for(size_t i=0;i<length;++i){char c=text[i];int digit=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;
        if(digit<0)return luaL_error(L,"Invalid RNG state");value=(value<<4)|digit;}
    rng_state=value;return 0;
}

EntityState& entity(lua_State* L) {
    auto id = *static_cast<uint32_t*>(luaL_checkudata(L, 1, "dst.Entity"));
    auto it = entities.find(id);
    if (it == entities.end() || !it->second.valid) luaL_error(L, "Entity %d is removed", static_cast<int>(id));
    return it->second;
}
int fail_unknown(lua_State* L) {
    return luaL_error(L, "UNIMPLEMENTED_NATIVE: %s.%s", lua_tostring(L, lua_upvalueindex(1)), luaL_checkstring(L, 2));
}
int index_entity(lua_State* L) {
    lua_getglobal(L, "Entity");
    lua_pushvalue(L, 2);
    lua_rawget(L, -2);
    if (!lua_isnil(L, -1)) return 1;
    return luaL_error(L, "UNIMPLEMENTED_NATIVE: Entity.%s", luaL_checkstring(L, 2));
}
int create_entity(lua_State* L) {
    uint32_t id = next_guid++;
    entities.emplace(id, EntityState{id});
    *static_cast<uint32_t*>(lua_newuserdata(L, sizeof(uint32_t))) = id;
    luaL_getmetatable(L, "dst.Entity");
    lua_setmetatable(L, -2);
    lua_getfield(L,LUA_REGISTRYINDEX,"dst.entities");lua_pushvalue(L,-2);lua_rawseti(L,-2,id);lua_pop(L,1);
    return 1;
}
int guid(lua_State* L) {
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));
    if(entities.count(id))lua_pushnumber(L,id);else lua_pushnil(L);
    return 1;
}
int valid(lua_State* L) {
    uint32_t id = *static_cast<uint32_t*>(luaL_checkudata(L, 1, "dst.Entity"));
    lua_pushboolean(L, entities.count(id) && entities.at(id).valid); return 1;
}
int is_awake(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    lua_pushboolean(L,found!=entities.end()&&found->second.valid&&!found->second.sleeping);return 1;
}
int set_can_sleep(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    // Native skips argument checking when the entity handle has retired.
    if(found==entities.end()||!found->second.valid)return 0;
    luaL_checktype(L,2,LUA_TBOOLEAN);
    found->second.can_sleep=lua_toboolean(L,2)&&found->second.components_allow_sleep;
    return 0;
}
int prefab_construction_complete(lua_State* L){
    auto& e=entity(L);
    // Transform's native finalizer allocates
    // interpolation history only for a networked entity; AddNetwork still
    // fails explicitly. ShadowManager's finalizer is the base no-op 0x14003d000
    // and keeps componentsAllowSleep=true. Other components need their own
    // verified finalizer and sleep permission before joining this registry.
    e.prefab_complete=true;e.can_sleep=e.can_sleep&&e.components_allow_sleep;return 0;
}
int inspect_lifecycle(lua_State* L){
    auto id=static_cast<uint32_t>(luaL_checknumber(L,1));auto found=entities.find(id);
    lua_newtable(L);lua_pushboolean(L,found!=entities.end());lua_setfield(L,-2,"valid");
    if(found==entities.end())return 1;
    const auto& e=found->second;
    const char* names[]={"awake","canSleep","componentsAllowSleep","pending","hasTransform","prefabComplete","visible","clickable"};
    const bool values[]={!e.sleeping,e.can_sleep,e.components_allow_sleep,e.sleep_state_pending,e.has_transform,e.prefab_complete,e.visible,e.clickable};
    for(int i=0;i<8;++i){lua_pushboolean(L,values[i]);lua_setfield(L,-2,names[i]);}
    lua_createtable(L,static_cast<int>(e.children.size()),0);
    for(size_t i=0;i<e.children.size();++i){lua_pushnumber(L,e.children[i]);lua_rawseti(L,-2,static_cast<int>(i+1));}
    lua_setfield(L,-2,"children");
    return 1;
}
void detach_child(uint32_t parent_id,uint32_t child_id){
    auto pit=entities.find(parent_id);if(pit==entities.end())return;
    auto& vec=pit->second.children;
    for(auto it=vec.begin();it!=vec.end();++it)if(*it==child_id){vec.erase(it);break;}
}
int retire(lua_State* L) {
    auto& e=entity(L);auto id=e.guid;
    if(e.parent)detach_child(e.parent,id);
    for(uint32_t child_id:e.children){auto cit=entities.find(child_id);if(cit!=entities.end()){cit->second.parent=0;update_entity_spatial(cit->second);}}
    e.valid=false;update_entity_spatial(e);
    lua_getfield(L,LUA_REGISTRYINDEX,"dst.entities");lua_pushnil(L);lua_rawseti(L,-2,id);lua_pop(L,1);
    web_components::retire(id);entities.erase(id);return 0;
}
int entity_equal(lua_State* L){
    auto* left=static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));
    auto* right=static_cast<uint32_t*>(luaL_checkudata(L,2,"dst.Entity"));
    lua_pushboolean(L,*left==*right);return 1;
}
int set_parent(lua_State* L){
    auto& e=entity(L);
    if(lua_isnoneornil(L,2)){if(e.parent)detach_child(e.parent,e.guid);e.parent=0;update_entity_spatial(e);web_ui::refresh();return 0;}
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,2,"dst.Entity"));
    if(!entities.count(id))return luaL_error(L,"Parent is removed");
    uint32_t ancestor=id;int depth=0;
    while(ancestor){
        if(ancestor==e.guid)return luaL_error(L,"Entity hierarchy cycle");
        if(++depth>512)return luaL_error(L,"Entity hierarchy is too deep");
        auto found=entities.find(ancestor);if(found==entities.end())return luaL_error(L,"Parent hierarchy was retired");ancestor=found->second.parent;
    }
    if(e.parent)detach_child(e.parent,e.guid);
    e.parent=id;entities.at(id).children.push_back(e.guid);update_entity_spatial(e);web_ui::refresh();return 0;
}
int get_parent(lua_State* L){
    auto id=entity(L).parent;
    if(!id){lua_pushnil(L);return 1;}
    lua_getglobal(L,"MAIN");
    bool is_main=!lua_isnil(L,-1);
    lua_pop(L,1);
    if(is_main){
        lua_getglobal(L,"Ents");
        if(lua_istable(L,-1)){
            lua_rawgeti(L,-1,id);
            lua_remove(L,-2);
            return 1;
        }
        lua_pop(L,1);
    }
    lua_getfield(L,LUA_REGISTRYINDEX,"dst.entities");lua_rawgeti(L,-1,id);return 1;
}
int show_entity(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    if(found!=entities.end()&&found->second.valid)found->second.visible=true;
    return 0;
}
int hide_entity(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    if(found!=entities.end()&&found->second.valid)found->second.visible=false;
    return 0;
}
int is_visible(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    if(found==entities.end()||!found->second.valid)return 0;
    lua_pushboolean(L,found->second.visible);return 1;
}
int set_clickable(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));
    if(lua_type(L,2)!=LUA_TBOOLEAN)return luaL_typerror(L,2,"boolean");
    bool clickable=lua_toboolean(L,2)!=0;
    auto found=entities.find(id);
    if(found!=entities.end()&&found->second.valid)found->second.clickable=clickable;
    return 0;
}
int move_to_front(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    if(found==entities.end()||!found->second.valid||!found->second.parent)return 0;
    uint32_t parent_id=found->second.parent;
    detach_child(parent_id,id);
    auto pit=entities.find(parent_id);if(pit!=entities.end())pit->second.children.push_back(id);
    return 0;
}
int move_to_back(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Entity"));auto found=entities.find(id);
    if(found==entities.end()||!found->second.valid||!found->second.parent)return 0;
    uint32_t parent_id=found->second.parent;
    detach_child(parent_id,id);
    auto pit=entities.find(parent_id);if(pit!=entities.end())pit->second.children.insert(pit->second.children.begin(),id);
    return 0;
}
int set_name(lua_State* L){entity(L).name=luaL_checkstring(L,2);return 0;}
int get_name(lua_State* L){lua_pushstring(L,entity(L).name.c_str());return 1;}
int set_prefab(lua_State* L){entity(L).prefab=luaL_checkstring(L,2);return 0;}
int get_prefab(lua_State* L){lua_pushstring(L,entity(L).prefab.c_str());return 1;}
int add_tag(lua_State* L) {
    auto& e = entity(L);
    const char* t = luaL_checkstring(L, 2);
    e.tags.insert(t);
    if (std::strcmp(t, "CLASSIFIED") == 0) parented_transforms.erase(e.guid);
    return 0;
}
int remove_tag(lua_State* L) { entity(L).tags.erase(luaL_checkstring(L, 2)); return 0; }
int has_tag(lua_State* L) { lua_pushboolean(L, entity(L).tags.count(luaL_checkstring(L, 2))); return 1; }
int tags(lua_State* L) {
    bool any = lua_toboolean(L, lua_upvalueindex(1));
    auto& e = entity(L);
    bool matched = !any;
    for (int i = 2; i <= lua_gettop(L); ++i) {
        bool present = e.tags.count(luaL_checkstring(L, i));
        matched = any ? matched || present : matched && present;
    }
    lua_pushboolean(L, matched); return 1;
}
int position(lua_State* L) {
    auto& e=entity(L);float x=e.x,y=e.y,z=e.z;uint32_t parent=e.parent;
    while(parent){
        auto it=entities.find(parent);if(it==entities.end())return luaL_error(L,"Parent was retired");
        auto& p=it->second;
        float px=x*p.sx,pz=z*p.sz;
        x=std::cos(p.rotation)*px+std::sin(p.rotation)*pz+p.x;
        z=-std::sin(p.rotation)*px+std::cos(p.rotation)*pz+p.z;y=y*p.sy+p.y;parent=p.parent;
    }
    lua_pushnumber(L,x);lua_pushnumber(L,y);lua_pushnumber(L,z);return 3;
}
int local_position(lua_State* L){auto& e=entity(L);lua_pushnumber(L,e.x);lua_pushnumber(L,e.y);lua_pushnumber(L,e.z);return 3;}
int set_position(lua_State* L) {
    auto& e = entity(L); e.x = luaL_checknumber(L, 2); e.y = luaL_checknumber(L, 3); e.z = luaL_checknumber(L, 4); update_entity_spatial(e); return 0;
}
int rotation(lua_State* L) { lua_pushnumber(L, static_cast<double>(entity(L).rotation / 0.01745329238474369f)); return 1; }
float normalize_rotation(float radians){
    // Native 0x1403cb460: float32 floor/remainder, with +pi retained.
    constexpr float tau=6.2831854820251465f,pi=3.1415927410125732f;
    float cycles=std::floor(radians/tau);float wrapped=radians+(-cycles*tau);
    return wrapped>pi?wrapped-tau:wrapped;
}
int set_rotation(lua_State* L) { entity(L).rotation = normalize_rotation(static_cast<float>(luaL_checknumber(L, 2)) * 0.01745329238474369f); return 0; }
int scale(lua_State* L) { auto& e = entity(L); lua_pushnumber(L, e.sx); lua_pushnumber(L, e.sy); lua_pushnumber(L, e.sz); return 3; }
int set_scale(lua_State* L) { auto& e = entity(L); e.sx=luaL_checknumber(L,2); e.sy=luaL_checknumber(L,3); e.sz=luaL_checknumber(L,4); return 0; }
int offset_position(lua_State* L) {
    auto& e = entity(L);
    e.x += static_cast<float>(luaL_optnumber(L, 2, 0.0));
    e.y += static_cast<float>(luaL_optnumber(L, 3, 0.0));
    e.z += static_cast<float>(luaL_optnumber(L, 4, 0.0));
    update_entity_spatial(e);
    return 0;
}
int transform_noop(lua_State*) { return 0; }
int add_transform(lua_State* L) {
    auto id=entity(L).guid;
    if(web_ui::contains(id))return luaL_error(L,"UNIMPLEMENTED_NATIVE: mixed Transform/UITransform on one entity");
    auto& e=entities.at(id);
    e.has_transform=true;
    update_entity_spatial(e);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,1);lua_setfield(L,-2,"Transform");}
        lua_pop(L,1);
    }
    lua_pop(L,1);lua_pushvalue(L,1);return 1;
}
int debugger_disabled(lua_State* L){lua_pushboolean(L,0);return 1;}
// Native 756039 implementation at 0x1404431f0 is xor eax,eax; ret.
int validate_line_number(lua_State*){return 0;}
int set_reverb(lua_State* L) {
    // The original null-renderer wrapper does nothing when its sound-manager
    // pointer is null (native VA 0x140128e00). Browser clients need real audio.
    if(runtime_role!="client")return 0;
    return luaL_error(L,"UNIMPLEMENTED_NATIVE: client audio reverb backend (%s)",luaL_checkstring(L,2));
}
bool asset_path(const char* input,std::string& path) {
    path=input;
    for(char& c:path)if(c=='\\')c='/';
    while(path.rfind("./",0)==0)path.erase(0,2);
    if(!path.empty()&&path[0]=='/')path.erase(0,1);
    if(path.empty()||path.find("..")!=std::string::npos||path.find(':')!=std::string::npos)return false;
    path="/"+path;return true;
}
int klei_load(lua_State* L){
    std::string path;
    if(!asset_path(luaL_checkstring(L,1),path)){lua_pushnil(L);return 1;}
    FILE* file=std::fopen(path.c_str(),"rb");
    if(!file){lua_pushnil(L);return 1;}
    std::fseek(file,0,SEEK_END);long length=std::ftell(file);std::rewind(file);
    if(length<0||length>16*1024*1024){std::fclose(file);return luaL_error(L,"Script size limit exceeded");}
    std::vector<char> source(static_cast<size_t>(length));
    size_t count=std::fread(source.data(),1,source.size(),file);std::fclose(file);
    if(count!=source.size())return luaL_error(L,"Cannot read script %s",path.c_str());
    std::string name="@"+std::string(luaL_optstring(L,3,path.c_str()));
    if(luaL_loadbuffer(L,source.data(),source.size(),name.c_str())){
        const char* text=lua_tostring(L,-1);return luaL_error(L,"%s",text?text:"Script compile error");
    }
    return 1;
}
bool resource_exists(const std::string& input){
    std::string path;struct stat info{};
    return asset_path(input.c_str(),path)&&
        (resource_catalog.find(path)!=resource_catalog.end()||(stat(path.c_str(),&info)==0&&S_ISREG(info.st_mode)));
}
int file_exists(lua_State* L){
    lua_pushboolean(L,resource_exists(luaL_checkstring(L,1)));return 1;
}
int file_mtime(lua_State* L){
    std::string path;struct stat info{};
    if(asset_path(luaL_checkstring(L,2),path)&&stat(path.c_str(),&info)==0)lua_pushnumber(L,info.st_mtime);
    else lua_pushnumber(L,0);
    return 1;
}
std::vector<size_t> utf8_offsets(lua_State* L,const char* bytes,size_t length){
    std::vector<size_t> offsets;
    size_t index=0;
    while(index<length){
        offsets.push_back(index);
        unsigned char first=static_cast<unsigned char>(bytes[index]);
        size_t size=first<0x80?1:first>=0xc2&&first<=0xdf?2:first<=0xef&&first>=0xe0?3:first>=0xf0&&first<=0xf4?4:0;
        if(!size||index+size>length)luaL_error(L,"Invalid UTF-8 sequence");
        uint32_t point=first&((1u<<(7-size))-1u);
        if(size==1)point=first;
        for(size_t j=1;j<size;++j){
            unsigned char next=static_cast<unsigned char>(bytes[index+j]);
            if((next&0xc0)!=0x80)luaL_error(L,"Invalid UTF-8 continuation");
            point=(point<<6)|(next&0x3f);
        }
        if((size==2&&point<0x80)||(size==3&&point<0x800)||(size==4&&point<0x10000)||point>0x10ffff||(point>=0xd800&&point<=0xdfff))luaL_error(L,"Invalid UTF-8 codepoint");
        index+=size;
    }
    offsets.push_back(length);return offsets;
}
int utf8_char(lua_State* L){
    lua_Integer input=luaL_checkinteger(L,1);
    if(input<0||input>0x10ffff||(input>=0xd800&&input<=0xdfff))return luaL_error(L,"Invalid Unicode codepoint");
    uint32_t point=static_cast<uint32_t>(input);char bytes[4];size_t size=0;
    if(point<0x80){bytes[0]=point;size=1;}
    else if(point<0x800){bytes[0]=0xc0|(point>>6);bytes[1]=0x80|(point&63);size=2;}
    else if(point<0x10000){bytes[0]=0xe0|(point>>12);bytes[1]=0x80|((point>>6)&63);bytes[2]=0x80|(point&63);size=3;}
    else {bytes[0]=0xf0|(point>>18);bytes[1]=0x80|((point>>12)&63);bytes[2]=0x80|((point>>6)&63);bytes[3]=0x80|(point&63);size=4;}
    lua_pushlstring(L,bytes,size);return 1;
}
int utf8_length(lua_State* L){size_t size=0;const char* text=luaL_checklstring(L,1,&size);auto offsets=utf8_offsets(L,text,size);lua_pushinteger(L,offsets.size()-1);return 1;}
int utf8_substr(lua_State* L){
    size_t bytes=0;const char* text=luaL_checklstring(L,1,&bytes);auto positions=utf8_offsets(L,text,bytes);
    lua_Integer count=positions.size()-1,start=luaL_checkinteger(L,2),last=luaL_optinteger(L,3,-1);
    if(start<0)start=count+1+start;if(last<0)last=count+1+last;
    if(start<1)start=1;if(last>count)last=count;
    if(start>last||start>count||last<1){lua_pushliteral(L,"");return 1;}
    size_t first=positions[start-1],end=positions[last];lua_pushlstring(L,text+first,end-first);return 1;
}
int utf8_case(lua_State* L){
    size_t bytes=0;const char* text=luaL_checklstring(L,1,&bytes);
    utf8_offsets(L,text,bytes);
    bool upper=lua_toboolean(L,lua_upvalueindex(1));std::string converted(text,bytes);
    // Native 756039 uses C-locale casing: non-ASCII scalars are preserved.
    for(char& c:converted){
        if(upper&&c>='a'&&c<='z')c=static_cast<char>(c-'a'+'A');
        else if(!upper&&c>='A'&&c<='Z')c=static_cast<char>(c-'A'+'a');
    }
    lua_pushlstring(L,converted.data(),converted.size());return 1;
}
int get_tick(lua_State* L) { lua_pushnumber(L, tick); return 1; }
int get_time(lua_State* L) { lua_pushnumber(L, tick * tick_time); return 1; }
int get_tick_time(lua_State* L) { lua_pushnumber(L, tick_time); return 1; }
int wall_time(lua_State* L){lua_pushnumber(L,emscripten_get_now()/1000.0);return 1;}
int unavailable_event_call(lua_State*){return 0;}
int unavailable_event_index(lua_State* L){lua_pushcfunction(L,unavailable_event_call);return 1;}
int require_event_file(lua_State* L){
    const char* name=luaL_checkstring(L,1);
    // Build 756039's native loader at server 0x140119380 logs unavailable data
    // and returns this exact proxy. Its __index (0x140118be0) returns a C
    // function with zero results, rather than loading hidden event server Lua.
    printf("[lua] Event data unavailable: %s\n",name);
    lua_newtable(L);lua_newtable(L);lua_pushcfunction(L,unavailable_event_index);
    lua_setfield(L,-2,"__index");lua_setmetatable(L,-2);return 1;
}
int get_entity_count(lua_State* L) {
    size_t count=0; for (auto& p : entities) if (p.second.valid) ++count;
    lua_pushnumber(L, count); return 1;
}
int profiler_push(lua_State* L) { luaL_checkstring(L, 2); ++profiler_depth; return 0; }
int profiler_pop(lua_State* L) { if (profiler_depth == 0) return luaL_error(L,"Unbalanced ProfilerPop"); --profiler_depth; return 0; }
int is_dedicated(lua_State* L) { lua_pushboolean(L,runtime_role!="client");return 1; }
std::string server_language="en";
int get_server_language(lua_State* L){lua_pushlstring(L,server_language.data(),server_language.size());return 1;}
int set_server_language(lua_State* L){server_language=luaL_checkstring(L,2);return 0;}
int get_language_code(lua_State* L){lua_pushliteral(L,"english");return 1;}
int string_id_sorter(lua_State* L){
    size_t first_length=0,second_length=0;
    const char* first=luaL_checklstring(L,1,&first_length);
    const char* second=luaL_checklstring(L,2,&second_length);
    int comparison=std::memcmp(first,second,std::min(first_length,second_length));
    lua_pushboolean(L,comparison<0||(comparison==0&&first_length<second_length));return 1;
}
int native_print(lua_State* L) {
    std::string message;
    for (int i=1; i<=lua_gettop(L); ++i) {
        if(i>1) message+='\t';
        const char* s=lua_tostring(L,i); message+=s?s:lua_typename(L,lua_type(L,i));
    }
    printf("[lua] %s\n", message.c_str()); return 0;
}
int lua_print(lua_State* L){
    size_t length=0;const char* text=luaL_checklstring(L,2,&length);
    printf("[lua] %.*s\n",static_cast<int>(length),text);return 0;
}
int texture_group(lua_State* L){
    int id=luaL_checkinteger(L,2);size_t length=0;const char* path=luaL_checklstring(L,3,&length);
    if(id<0||id>65535||length==0||length>4096||std::memchr(path,0,length))return luaL_error(L,"Invalid texture streaming group reference");
    texture_groups[static_cast<uint32_t>(id)].insert(std::string(path,length));return 0;
}
int texture_group_stats(lua_State* L){
    size_t entries=0;for(const auto& group:texture_groups)entries+=group.second.size();
    lua_newtable(L);lua_pushnumber(L,texture_groups.size());lua_setfield(L,-2,"groups");
    lua_pushnumber(L,entries);lua_setfield(L,-2,"textures");return 1;
}
int headless_sound(lua_State* L){
    if(runtime_role=="client")return luaL_error(L,"UNIMPLEMENTED_NATIVE: client audio backend (%s)",lua_tostring(L,lua_upvalueindex(1)));
    // Retail null-renderer paths return before reading any Lua arguments when
    // there is no sound manager. Do not treat this as client DSP support.
    return 0;
}
int send_hardware_stats(lua_State* L){
    if(runtime_role=="client")return luaL_error(L,"UNIMPLEMENTED_NATIVE: client hardware telemetry");
    // Build 756039 dedicated binding is 0x1403dde80: xor eax,eax; ret.
    return 0;
}
int sound_volume(lua_State* L){
    if(runtime_role=="client")return luaL_error(L,"UNIMPLEMENTED_NATIVE: client audio bus volume backend");
    lua_pushnumber(L,0);return 1;
}
std::map<std::pair<std::string,std::string>,std::string> sim_settings;
std::string lower_ascii(const char* s,size_t len){
    std::string out(s,len);
    for(char& c:out)if(c>='A'&&c<='Z')c=static_cast<char>(c-'A'+'a');
    return out;
}
int sim_get_setting(lua_State* L){
    size_t slen=0,klen=0;
    const char* sec=luaL_checklstring(L,2,&slen);
    const char* key=luaL_checklstring(L,3,&klen);
    auto it=sim_settings.find({lower_ascii(sec,slen),lower_ascii(key,klen)});
    if(it==sim_settings.end())return 0;
    lua_pushlstring(L,it->second.data(),it->second.size());
    return 1;
}
int sim_set_setting(lua_State* L){
    size_t slen=0,klen=0,vlen=0;
    const char* sec=luaL_checklstring(L,2,&slen);
    const char* key=luaL_checklstring(L,3,&klen);
    const char* val=luaL_checklstring(L,4,&vlen);
    if(slen>256||klen>256||vlen>4096||sim_settings.size()>=4096)return luaL_error(L,"Sim setting exceeds budget");
    sim_settings[{lower_ascii(sec,slen),lower_ascii(key,klen)}]=std::string(val,vlen);
    return 0;
}
int sim_get_data_collection(lua_State* L){lua_pushboolean(L,0);return 1;}
int sim_set_data_collection(lua_State* L){(void)lua_toboolean(L,2);lua_pushboolean(L,0);return 1;}
int sim_is_data_collection_disabled(lua_State* L){lua_pushboolean(L,1);return 1;}
std::map<int,std::string> render_pass_effects;
std::string erosion_texture,holo_texture,motd_target;
uint32_t ui_root_guid=0;
bool netbook_mode=false;
int sim_has_player_skeletons(lua_State* L){lua_pushboolean(L,1);return 1;}
int sim_set_render_pass_default_effect(lua_State* L){
    int pass=static_cast<int>(luaL_checknumber(L,2));
    render_pass_effects[pass]=luaL_checkstring(L,3);
    return 0;
}
int sim_set_erosion_texture(lua_State* L){erosion_texture=luaL_checkstring(L,2);return 0;}
int sim_set_holo_texture(lua_State* L){holo_texture=luaL_checkstring(L,2);return 0;}
int sim_set_ui_root(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,2,"dst.Entity"));
    auto found=entities.find(id);
    if(found!=entities.end()&&found->second.valid)ui_root_guid=id;
    return 0;
}
int sim_should_play_intro_movie(lua_State* L){
    auto it=sim_settings.find({"graphics","intro_movie"});
    bool play=it!=sim_settings.end()&&lower_ascii(it->second.data(),it->second.size())=="true";
    lua_pushboolean(L,play?1:0);return 1;
}
int sim_is_netbook_mode(lua_State* L){lua_pushboolean(L,netbook_mode?1:0);return 1;}
int sim_set_netbook_mode(lua_State* L){netbook_mode=lua_toboolean(L,2)!=0;return 0;}
int sim_is_logged_on(lua_State* L){lua_pushnil(L);return 1;}
int sim_false(lua_State* L){lua_pushboolean(L,0);return 1;}
int sim_true(lua_State* L){lua_pushboolean(L,1);return 1;}
std::string instance_parameters;
bool sim_reset_requested=false;
int sim_set_instance_parameters(lua_State* L){
    instance_parameters=luaL_optstring(L,2,"");
    lua_pushlstring(L,instance_parameters.data(),instance_parameters.size());
    lua_setglobal(L,"json_settings");
    return 0;
}
int sim_reset(lua_State*){sim_reset_requested=true;return 0;}
int sim_set_dlc_enabled(lua_State* L){(void)luaL_checkinteger(L,2);luaL_checktype(L,3,LUA_TBOOLEAN);return 0;}
int sim_is_dlc_enabled(lua_State* L){(void)luaL_checkinteger(L,2);lua_pushboolean(L,0);return 1;}
int sim_get_users_name(lua_State* L){lua_pushliteral(L,"Player");return 1;}
int sim_get_steam_id_number(lua_State* L){lua_pushnumber(L,0);return 1;}
int sim_get_steam_beta_branch_name(lua_State* L){lua_pushliteral(L,"non-Steam");return 1;}
int sim_log_bulk_metric(lua_State* L){luaL_checkstring(L,2);return 0;}
int sim_set_motd_target(lua_State* L){motd_target=std::string("https://")+luaL_checkstring(L,2)+"/motd.json";return 0;}
int sim_get_motd_query_url(lua_State* L){lua_pushliteral(L,"https://motd.klei.com/motd.json/?game=dst");return 1;}
int sim_has_motd_image(lua_State* L){(void)lua_tostring(L,2);lua_pushboolean(L,0);return 1;}
int sim_download_motd_image(lua_State* L){luaL_checkstring(L,2);luaL_checkstring(L,3);return 0;}
int sim_load_motd_image(lua_State* L){luaL_checkstring(L,2);return 0;}
int sim_download_motd_images(lua_State*){return 0;}
int sim_update_device_caps(lua_State* L){
    int a=static_cast<int>(luaL_checknumber(L,2));
    int b=static_cast<int>(luaL_checknumber(L,3));
    lua_pushnumber(L,a);lua_pushnumber(L,b);return 2;
}
int sim_render_one_frame(lua_State*){web_ui::refresh();return 0;}
struct TagFilter {
    std::set<std::string> must;
    std::set<std::string> cant;
    std::set<std::string> one_of;
};
std::vector<TagFilter> registered_find_tags;
float sim_time_scale=1.0f;
uint8_t ambient_r=0,ambient_g=0,ambient_b=0;
uint8_t visual_ambient_r=0,visual_ambient_g=0,visual_ambient_b=0;
void read_tag_set(lua_State* L,int index,std::set<std::string>& out){
    if(!lua_istable(L,index))return;
    lua_pushvalue(L,index);
    lua_pushnil(L);
    while(lua_next(L,-2)!=0){
        if(lua_isstring(L,-1))out.insert(lua_tostring(L,-1));
        lua_pop(L,1);
    }
    lua_pop(L,1);
}
TagFilter parse_tag_filter(lua_State* L,int must_idx,int cant_idx,int one_of_idx){
    TagFilter f;
    int top=lua_gettop(L);
    if(must_idx<=top)read_tag_set(L,must_idx,f.must);
    if(cant_idx<=top)read_tag_set(L,cant_idx,f.cant);
    if(one_of_idx<=top)read_tag_set(L,one_of_idx,f.one_of);
    if(!f.must.count("INLIMBO")&&!f.one_of.count("INLIMBO"))f.cant.insert("INLIMBO");
    return f;
}
bool entity_world_pos(const EntityState& e,float& x,float& y,float& z){
    x=e.x;y=e.y;z=e.z;uint32_t parent=e.parent;int depth=0;
    while(parent){
        if(++depth>512)return false;
        auto it=entities.find(parent);if(it==entities.end()||!it->second.valid)return false;
        const auto& p=it->second;
        float px=x*p.sx,pz=z*p.sz;
        x=std::cos(p.rotation)*px+std::sin(p.rotation)*pz+p.x;
        z=-std::sin(p.rotation)*px+std::cos(p.rotation)*pz+p.z;
        y=y*p.sy+p.y;parent=p.parent;
    }
    return true;
}
bool entity_matches_filter(const EntityState& e,const TagFilter& f){
    if(!f.one_of.empty()){
        bool any=false;
        for(const auto& t:f.one_of)if(e.tags.count(t)){any=true;break;}
        if(!any)return false;
    }
    for(const auto& t:f.must)if(!e.tags.count(t))return false;
    for(const auto& t:f.cant)if(e.tags.count(t))return false;
    return true;
}
std::vector<uint32_t> query_entities(float x,float y,float z,float radius,const TagFilter& f){
    float r_sq=radius*radius;
    std::vector<std::pair<float,uint32_t>> hits;
    if(std::isfinite(x)&&std::isfinite(z)&&std::isfinite(radius)&&radius>=0.0f&&radius<=256.0f){
        int32_t gx0=static_cast<int32_t>(std::floor((x-radius)*0.0625f));
        int32_t gx1=static_cast<int32_t>(std::floor((x+radius)*0.0625f));
        int32_t gz0=static_cast<int32_t>(std::floor((z-radius)*0.0625f));
        int32_t gz1=static_cast<int32_t>(std::floor((z+radius)*0.0625f));
        for(int32_t gz=gz0;gz<=gz1;++gz){
            for(int32_t gx=gx0;gx<=gx1;++gx){
                auto cit=spatial_grid.find(pack_grid_cell(gx,gz));
                if(cit==spatial_grid.end())continue;
                for(uint32_t id:cit->second){
                    auto eit=entities.find(id);
                    if(eit==entities.end())continue;
                    const auto& e=eit->second;
                    if(!e.valid||!e.has_transform)continue;
                    float dx=e.x-x,dy=e.y-y,dz=e.z-z;
                    float d_sq=dx*dx+dy*dy+dz*dz;
                    if(d_sq<=r_sq&&entity_matches_filter(e,f))hits.emplace_back(d_sq,e.guid);
                }
            }
        }
        for(uint32_t id:parented_transforms){
            auto eit=entities.find(id);
            if(eit==entities.end())continue;
            const auto& e=eit->second;
            if(!e.valid||!e.has_transform||!entity_matches_filter(e,f))continue;
            float ex=0,ey=0,ez=0;
            if(!entity_world_pos(e,ex,ey,ez))continue;
            float dx=ex-x,dy=ey-y,dz=ez-z;
            float d_sq=dx*dx+dy*dy+dz*dz;
            if(d_sq<=r_sq)hits.emplace_back(d_sq,e.guid);
        }
    }else{
        for(const auto& kv:entities){
            const auto& e=kv.second;
            if(!e.valid||!e.has_transform||!entity_matches_filter(e,f))continue;
            float ex=0,ey=0,ez=0;
            if(!entity_world_pos(e,ex,ey,ez))continue;
            float dx=ex-x,dy=ey-y,dz=ez-z;
            float d_sq=dx*dx+dy*dy+dz*dz;
            if(d_sq<=r_sq)hits.emplace_back(d_sq,e.guid);
        }
    }
    std::sort(hits.begin(),hits.end(),[](const auto& a,const auto& b){
        return a.first<b.first||(a.first==b.first&&a.second<b.second);
    });
    std::vector<uint32_t> out;out.reserve(hits.size());
    for(const auto& h:hits)out.push_back(h.second);
    return out;
}
void push_entity_table(lua_State* L,const std::vector<uint32_t>& ids){
    lua_getglobal(L,"Ents");
    int ents_idx=lua_gettop(L);
    lua_createtable(L,static_cast<int>(ids.size()),0);
    int out_idx=lua_gettop(L);
    int out_i=1;
    if(lua_istable(L,ents_idx)){
        for(uint32_t id:ids){
            lua_rawgeti(L,ents_idx,id);
            if(!lua_isnil(L,-1))lua_rawseti(L,out_idx,out_i++);
            else lua_pop(L,1);
        }
    }
    lua_remove(L,ents_idx);
}
int sim_register_find_tags(lua_State* L){
    TagFilter f=parse_tag_filter(L,2,3,4);
    for(size_t i=0;i<registered_find_tags.size();++i){
        const auto& ex=registered_find_tags[i];
        if(ex.must==f.must&&ex.cant==f.cant&&ex.one_of==f.one_of){
            lua_pushinteger(L,static_cast<lua_Integer>(i));return 1;
        }
    }
    if(registered_find_tags.size()>=256){lua_pushinteger(L,0xffff);return 1;}
    size_t idx=registered_find_tags.size();
    registered_find_tags.push_back(std::move(f));
    lua_pushinteger(L,static_cast<lua_Integer>(idx));return 1;
}
int sim_find_entities_registered(lua_State* L){
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    float r=static_cast<float>(luaL_checknumber(L,5));
    uint32_t idx=static_cast<uint32_t>(luaL_checknumber(L,6))&0xffffu;
    std::vector<uint32_t> ids;
    if(idx<registered_find_tags.size())ids=query_entities(x,y,z,r,registered_find_tags[idx]);
    push_entity_table(L,ids);return 1;
}
int sim_find_entities(lua_State* L){
    lua_getglobal(L,"WEB_PROBE");
    bool diag=!lua_isnil(L,-1);
    lua_pop(L,1);
    if(diag)return luaL_error(L,"UNIMPLEMENTED_NATIVE: Sim.FindEntities");
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    float r=static_cast<float>(luaL_checknumber(L,5));
    TagFilter f=parse_tag_filter(L,6,7,8);
    push_entity_table(L,query_entities(x,y,z,r,f));return 1;
}
int sim_count_entities(lua_State* L){
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    float r=static_cast<float>(luaL_checknumber(L,5));
    TagFilter f=parse_tag_filter(L,6,7,8);
    lua_pushinteger(L,static_cast<lua_Integer>(query_entities(x,y,z,r,f).size()));return 1;
}
int sim_find_first_entity_with_tag(lua_State* L){
    const char* tag=luaL_checkstring(L,2);
    uint32_t best=0;
    for(const auto& kv:entities){
        if(kv.second.valid&&kv.second.tags.count(tag)){
            if(best==0||kv.first<best)best=kv.first;
        }
    }
    if(best!=0){
        lua_getglobal(L,"Ents");
        if(lua_istable(L,-1)){
            lua_rawgeti(L,-1,best);
            lua_remove(L,-2);
            return 1;
        }
        lua_pop(L,1);
    }
    lua_pushnil(L);return 1;
}
int sim_world_point_in_poly(lua_State* L){
    float px=static_cast<float>(luaL_checknumber(L,2));
    float py=static_cast<float>(luaL_checknumber(L,3));
    luaL_checktype(L,4,LUA_TTABLE);
    std::vector<std::pair<float,float>> verts;
    lua_pushvalue(L,4);
    lua_pushnil(L);
    while(lua_next(L,-2)!=0){
        if(lua_istable(L,-1)){
            lua_rawgeti(L,-1,1);float vx=static_cast<float>(luaL_checknumber(L,-1));lua_pop(L,1);
            lua_rawgeti(L,-1,2);float vy=static_cast<float>(luaL_checknumber(L,-1));lua_pop(L,1);
            verts.emplace_back(vx,vy);
        }
        lua_pop(L,1);
    }
    lua_pop(L,1);
    int winding=0;
    size_t n=verts.size();
    for(size_t i=0;i<n;++i){
        float x0=verts[i].first,y0=verts[i].second;
        float x1=verts[(i+1)%n].first,y1=verts[(i+1)%n].second;
        float cross=(py-y0)*(x1-x0)-(px-x0)*(y1-y0);
        if(py<y0){if(y1<=py&&cross<0.0f)--winding;}
        else if(py<y1&&cross>0.0f)++winding;
    }
    lua_pushboolean(L,winding!=0);return 1;
}
int sim_set_time_scale(lua_State* L){
    float s=static_cast<float>(luaL_checknumber(L,2));
    sim_time_scale=s<=0.0f?0.0f:s;return 0;
}
int sim_get_time_scale(lua_State* L){lua_pushnumber(L,sim_time_scale);return 1;}
uint8_t pack_colour_byte(float v){
    float scaled=v*255.0f+0.5f;
    if(scaled>=255.0f)return 255;
    if(scaled<=0.0f)return 0;
    return static_cast<uint8_t>(static_cast<int>(scaled));
}
int sim_set_ambient_colour(lua_State* L){
    ambient_r=pack_colour_byte(static_cast<float>(luaL_checknumber(L,2)));
    ambient_g=pack_colour_byte(static_cast<float>(luaL_checknumber(L,3)));
    ambient_b=pack_colour_byte(static_cast<float>(luaL_checknumber(L,4)));
    return 0;
}
int sim_get_ambient_colour(lua_State* L){
    lua_pushnumber(L,ambient_r);lua_pushnumber(L,ambient_g);lua_pushnumber(L,ambient_b);return 3;
}
int sim_set_visual_ambient_colour(lua_State* L){
    visual_ambient_r=pack_colour_byte(static_cast<float>(luaL_checknumber(L,2)));
    visual_ambient_g=pack_colour_byte(static_cast<float>(luaL_checknumber(L,3)));
    visual_ambient_b=pack_colour_byte(static_cast<float>(luaL_checknumber(L,4)));
    return 0;
}
int sim_get_light_at_point(lua_State* L){
    (void)luaL_checknumber(L,2);(void)luaL_checknumber(L,3);(void)luaL_checknumber(L,4);
    (void)luaL_optnumber(L,5,10000.0);
    float r=static_cast<float>(ambient_r)/255.0f;
    float g=static_cast<float>(ambient_g)/255.0f;
    float b=static_cast<float>(ambient_b)/255.0f;
    lua_pushnumber(L,std::sqrt(r*r+g*g+b*b));return 1;
}
int sim_get_entities_at_screen_point(lua_State* L){
    float sx=static_cast<float>(luaL_checknumber(L,2));
    float sy=static_cast<float>(luaL_checknumber(L,3));
    float wx=0.0f,wy=0.0f,wz=0.0f;
    bool projected=false;
    lua_getglobal(L,"TheSim");
    if(lua_istable(L,-1)){
        lua_getfield(L,-1,"ProjectScreenPos");
        if(lua_isfunction(L,-1)){
            lua_pushvalue(L,-2);
            lua_pushnumber(L,sx);
            lua_pushnumber(L,sy);
            if(lua_pcall(L,3,3,0)==0){
                wx=static_cast<float>(lua_tonumber(L,-3));
                wy=static_cast<float>(lua_tonumber(L,-2));
                wz=static_cast<float>(lua_tonumber(L,-1));
                projected=true;
                lua_pop(L,3);
            }
        }else lua_pop(L,1);
    }
    lua_pop(L,1);
    if(!projected){lua_createtable(L,0,0);return 1;}
    TagFilter f;
    f.cant={"INLIMBO","NOCLICK","FX","DECOR"};
    auto raw=query_entities(wx,wy,wz,2.4f,f);
    std::vector<uint32_t> clickable;
    clickable.reserve(raw.size());
    for(uint32_t id:raw){
        auto it=entities.find(id);
        if(it!=entities.end()&&it->second.visible&&it->second.clickable)clickable.push_back(id);
    }
    push_entity_table(L,clickable);
    return 1;
}
int sim_get_real_time(lua_State* L){
    lua_pushnumber(L,static_cast<double>(tick)*tick_time);
    return 1;
}
int sim_apply_local_word_filter(lua_State* L){
    size_t len=0;
    const char* s=luaL_optlstring(L,2,"",&len);
    lua_pushlstring(L,s,len);
    return 1;
}
int update_spatial_sleep(lua_State* L){
    float px=static_cast<float>(luaL_optnumber(L,1,0.0));
    float pz=static_cast<float>(luaL_optnumber(L,2,0.0));
    float wake_r=static_cast<float>(luaL_optnumber(L,3,56.0));
    float sleep_r=static_cast<float>(luaL_optnumber(L,4,68.0));
    float wake_sq=wake_r*wake_r;
    float sleep_sq=sleep_r*sleep_r;
    lua_pushliteral(L,"OnEntitySleep");lua_rawget(L,LUA_GLOBALSINDEX);bool has_sleep=lua_isfunction(L,-1);lua_pop(L,1);
    lua_pushliteral(L,"OnEntityWake");lua_rawget(L,LUA_GLOBALSINDEX);bool has_wake=lua_isfunction(L,-1);lua_pop(L,1);
    if(!has_sleep||!has_wake){lua_pushinteger(L,0);return 1;}
    std::vector<std::pair<uint32_t,bool>> transitions;
    for(const auto& kv:entities){
        const auto& e=kv.second;
        if(!e.valid)continue;
        if(!e.has_transform||e.parent!=0||!e.can_sleep||e.tags.count("player")||e.tags.count("CLASSIFY")){
            if(e.sleeping)transitions.emplace_back(e.guid,false);
            continue;
        }
        float dx=e.x-px,dz=e.z-pz;
        float d_sq=dx*dx+dz*dz;
        if(e.sleeping){
            if(d_sq<=wake_sq)transitions.emplace_back(e.guid,false);
        }else{
            if(d_sq>=sleep_sq||e.sleep_state_pending)transitions.emplace_back(e.guid,d_sq>=sleep_sq);
        }
    }
    int changed=0;
    for(const auto& tr:transitions){
        auto found=entities.find(tr.first);
        if(found==entities.end()||!found->second.valid)continue;
        auto& e=found->second;
        if(!e.sleep_state_pending&&e.sleeping==tr.second)continue;
        e.sleeping=tr.second;
        e.sleep_state_pending=false;
        if(!tr.second&&e.has_transform)e.rotation=normalize_rotation((e.rotation/0.01745329238474369f)*0.01745329238474369f);
        lua_pushstring(L,tr.second?"OnEntitySleep":"OnEntityWake");
        lua_rawget(L,LUA_GLOBALSINDEX);
        lua_pushnumber(L,tr.first);
        if(lua_pcall(L,1,0,0)!=0)lua_pop(L,1);
        ++changed;
    }
    lua_pushinteger(L,changed);
    return 1;
}
const char* classify_entity_kind(const EntityState& e){
    if(e.tags.count("player"))return "player";
    if(e.tags.count("campfire")||e.tags.count("fire"))return "fire";
    if(e.tags.count("tree"))return "tree";
    if(e.tags.count("boulder")||e.prefab.find("rock")!=std::string::npos)return "rock";
    if(e.tags.count("monster")||e.tags.count("hostile"))return "monster";
    if(e.tags.count("animal")||e.tags.count("smallcreature")||e.tags.count("insect")||e.tags.count("bird")||e.tags.count("character"))return "creature";
    if(e.tags.count("structure")||e.tags.count("wall"))return "structure";
    if(e.tags.count("pickable")||e.tags.count("bush")||e.tags.count("plant")||e.tags.count("flower"))return "plant";
    if(e.tags.count(" _inventoryitem")||e.tags.count("_inventoryitem"))return "item";
    if(e.tags.count("FX")||e.tags.count("DECOR")||e.tags.count("NOCLICK"))return "fx";
    return "prop";
}
int snapshot_scene(lua_State* L){
    float cx=static_cast<float>(luaL_optnumber(L,1,0.0));
    float cz=static_cast<float>(luaL_optnumber(L,2,0.0));
    float radius=static_cast<float>(luaL_optnumber(L,3,44.0));
    int tile_radius=static_cast<int>(luaL_optinteger(L,4,13));
    lua_newtable(L);
    lua_pushinteger(L,static_cast<lua_Integer>(tick));lua_setfield(L,-2,"tick");
    lua_pushnumber(L,static_cast<double>(tick)*tick_time);lua_setfield(L,-2,"time");
    lua_createtable(L,3,0);
    lua_pushinteger(L,ambient_r);lua_rawseti(L,-2,1);
    lua_pushinteger(L,ambient_g);lua_rawseti(L,-2,2);
    lua_pushinteger(L,ambient_b);lua_rawseti(L,-2,3);
    lua_setfield(L,-2,"ambient");
    web_world_components::push_map_window(L,cx,cz,std::clamp(tile_radius,4,24),1);
    lua_setfield(L,-2,"tiles");
    web_world_components::push_map_window(L,cx,cz,20,3);
    lua_setfield(L,-2,"minimap");
    TagFilter f;
    f.cant={"INLIMBO","CLASSIFIED"};
    auto ids=query_entities(cx,0.0f,cz,std::clamp(radius,8.0f,120.0f),f);
    lua_createtable(L,static_cast<int>(ids.size()),0);
    int out_i=1;
    for(uint32_t id:ids){
        auto it=entities.find(id);
        if(it==entities.end())continue;
        const auto& e=it->second;
        if(!e.valid||!e.visible||!e.has_transform)continue;
        if(e.prefab.empty()&&!web_world_components::AnimSnapshot{}.bank[0]){
            web_world_components::AnimSnapshot chk;
            if(!web_world_components::get_anim_snapshot(id,chk))continue;
        }
        float wx=0,wy=0,wz=0;
        if(!entity_world_pos(e,wx,wy,wz))continue;
        lua_createtable(L,0,20);
        lua_pushinteger(L,static_cast<lua_Integer>(e.guid));lua_setfield(L,-2,"guid");
        lua_pushlstring(L,e.prefab.data(),e.prefab.size());lua_setfield(L,-2,"prefab");
        lua_pushlstring(L,e.name.data(),e.name.size());lua_setfield(L,-2,"name");
        lua_pushstring(L,classify_entity_kind(e));lua_setfield(L,-2,"kind");
        lua_pushnumber(L,wx);lua_setfield(L,-2,"x");
        lua_pushnumber(L,wy);lua_setfield(L,-2,"y");
        lua_pushnumber(L,wz);lua_setfield(L,-2,"z");
        float deg_rot=e.rotation/0.01745329238474369f;
        lua_pushnumber(L,deg_rot);lua_setfield(L,-2,"rotation");
        lua_pushnumber(L,deg_rot);lua_setfield(L,-2,"rot");
        lua_pushnumber(L,e.sx);lua_setfield(L,-2,"sx");
        lua_pushnumber(L,e.sy);lua_setfield(L,-2,"sy");
        lua_pushnumber(L,e.sz);lua_setfield(L,-2,"sz");
        lua_pushboolean(L,e.clickable);lua_setfield(L,-2,"clickable");
        lua_pushboolean(L,!e.sleeping);lua_setfield(L,-2,"awake");
        lua_pushboolean(L,e.tags.count("CHOP_workable")>0);lua_setfield(L,-2,"choppable");
        lua_pushboolean(L,e.tags.count("MINE_workable")>0);lua_setfield(L,-2,"mineable");
        lua_pushboolean(L,e.tags.count("pickable")>0);lua_setfield(L,-2,"pickable");
        lua_pushboolean(L,e.tags.count("_inventoryitem")>0);lua_setfield(L,-2,"pickupable");
        web_world_components::AnimSnapshot anim{};
        if(web_world_components::get_anim_snapshot(id,anim)){
            lua_pushstring(L,anim.bank);lua_setfield(L,-2,"bank");
            lua_pushstring(L,anim.build);lua_setfield(L,-2,"build");
            lua_pushstring(L,anim.anim);lua_setfield(L,-2,"anim");
            lua_pushinteger(L,anim.layer);lua_setfield(L,-2,"layer");
            lua_pushinteger(L,anim.sort_order);lua_setfield(L,-2,"sortOrder");
            lua_pushinteger(L,anim.facing);lua_setfield(L,-2,"facing");
            lua_pushinteger(L,anim.current_frame);lua_setfield(L,-2,"frame");
            lua_pushinteger(L,anim.num_frames);lua_setfield(L,-2,"numFrames");
            web_world_components::push_anim_extra(L,id);
        }
        web_world_components::LightSnapshot light{};
        if(web_world_components::get_light_snapshot(id,light)){
            lua_pushnumber(L,light.radius);lua_setfield(L,-2,"lightRadius");
            lua_pushnumber(L,light.intensity);lua_setfield(L,-2,"lightIntensity");
            lua_pushnumber(L,light.falloff);lua_setfield(L,-2,"lightFalloff");
            lua_createtable(L,3,0);
            lua_pushinteger(L,static_cast<int>(std::clamp(light.r*255.0f,0.0f,255.0f)));lua_rawseti(L,-2,1);
            lua_pushinteger(L,static_cast<int>(std::clamp(light.g*255.0f,0.0f,255.0f)));lua_rawseti(L,-2,2);
            lua_pushinteger(L,static_cast<int>(std::clamp(light.b*255.0f,0.0f,255.0f)));lua_rawseti(L,-2,3);
            lua_setfield(L,-2,"lightColour");
            lua_createtable(L,0,6);
            lua_pushnumber(L,light.radius);lua_setfield(L,-2,"radius");
            lua_pushnumber(L,light.intensity);lua_setfield(L,-2,"intensity");
            lua_pushnumber(L,light.falloff);lua_setfield(L,-2,"falloff");
            lua_pushnumber(L,light.r);lua_setfield(L,-2,"r");
            lua_pushnumber(L,light.g);lua_setfield(L,-2,"g");
            lua_pushnumber(L,light.b);lua_setfield(L,-2,"b");
            lua_setfield(L,-2,"light");
        }
        lua_rawseti(L,-2,out_i++);
    }
    lua_setfield(L,-2,"entities");
    return 1;
}
int snapshot_ui(lua_State* L){
    int max_nodes=static_cast<int>(luaL_optinteger(L,1,512));
    if(max_nodes<1)max_nodes=1;
    if(max_nodes>4096)max_nodes=4096;
    web_ui::refresh();
    lua_newtable(L);
    lua_pushinteger(L,static_cast<lua_Integer>(ui_root_guid));lua_setfield(L,-2,"rootGuid");
    lua_newtable(L);
    int out_i=1;
    std::vector<std::pair<uint32_t,int>> stack;
    if(ui_root_guid!=0&&entities.count(ui_root_guid)){
        stack.emplace_back(ui_root_guid,0);
    }else{
        for(const auto& kv:entities){
            if(kv.second.valid&&kv.second.parent==0&&web_ui::contains(kv.first)){
                stack.emplace_back(kv.first,0);
            }
        }
    }
    std::unordered_set<uint32_t> visited;
    while(!stack.empty()&&out_i<=max_nodes){
        auto [id,depth]=stack.back();
        stack.pop_back();
        if(!visited.insert(id).second||depth>128)continue;
        auto it=entities.find(id);
        if(it==entities.end())continue;
        const auto& e=it->second;
        if(!e.valid||!e.visible)continue;
        web_ui::UISnapshot ui{};
        bool has_ui=web_ui::get_snapshot(id,ui);
        web_image_widget::ImageSnapshot img{};
        bool has_img=web_image_widget::get_snapshot(id,img);
        web_text_widget::TextSnapshot txt{};
        bool has_txt=web_text_widget::get_snapshot(id,txt);
        web_world_components::AnimSnapshot anim{};
        bool has_anim=web_world_components::get_anim_snapshot(id,anim);
        if(has_ui||has_img||has_txt||has_anim||id==ui_root_guid){
            lua_createtable(L,0,16);
            lua_pushinteger(L,static_cast<lua_Integer>(id));lua_setfield(L,-2,"guid");
            lua_pushinteger(L,static_cast<lua_Integer>(e.parent));lua_setfield(L,-2,"parent");
            lua_pushinteger(L,depth);lua_setfield(L,-2,"depth");
            lua_pushlstring(L,e.name.data(),e.name.size());lua_setfield(L,-2,"name");
            if(has_ui){
                lua_pushnumber(L,ui.x);lua_setfield(L,-2,"x");
                lua_pushnumber(L,ui.y);lua_setfield(L,-2,"y");
                lua_pushnumber(L,ui.wx);lua_setfield(L,-2,"wx");
                lua_pushnumber(L,ui.wy);lua_setfield(L,-2,"wy");
                lua_pushnumber(L,ui.sx);lua_setfield(L,-2,"sx");
                lua_pushnumber(L,ui.sy);lua_setfield(L,-2,"sy");
                lua_pushnumber(L,ui.rotation);lua_setfield(L,-2,"rot");
                lua_pushinteger(L,ui.h_anchor);lua_setfield(L,-2,"hAnchor");
                lua_pushinteger(L,ui.v_anchor);lua_setfield(L,-2,"vAnchor");
                lua_pushinteger(L,ui.scale_mode);lua_setfield(L,-2,"scaleMode");
            }
            if(has_img){
                lua_createtable(L,0,8);
                lua_pushlstring(L,img.atlas.data(),img.atlas.size());lua_setfield(L,-2,"atlas");
                lua_pushlstring(L,img.region.data(),img.region.size());lua_setfield(L,-2,"region");
                lua_pushnumber(L,img.w);lua_setfield(L,-2,"w");
                lua_pushnumber(L,img.h);lua_setfield(L,-2,"h");
                lua_createtable(L,4,0);
                for(int i=0;i<4;++i){lua_pushinteger(L,img.tint[i]);lua_rawseti(L,-2,i+1);}
                lua_setfield(L,-2,"tint");
                lua_setfield(L,-2,"image");
            }
            if(has_txt){
                lua_createtable(L,0,6);
                lua_pushlstring(L,txt.text.data(),txt.text.size());lua_setfield(L,-2,"text");
                lua_pushnumber(L,txt.size);lua_setfield(L,-2,"size");
                lua_pushnumber(L,txt.region_w);lua_setfield(L,-2,"regionW");
                lua_pushnumber(L,txt.region_h);lua_setfield(L,-2,"regionH");
                lua_createtable(L,4,0);
                for(int i=0;i<4;++i){lua_pushinteger(L,txt.colour[i]);lua_rawseti(L,-2,i+1);}
                lua_setfield(L,-2,"colour");
                lua_setfield(L,-2,"text");
            }
            if(has_anim){
                lua_createtable(L,0,5);
                lua_pushstring(L,anim.bank);lua_setfield(L,-2,"bank");
                lua_pushstring(L,anim.build);lua_setfield(L,-2,"build");
                lua_pushstring(L,anim.anim);lua_setfield(L,-2,"anim");
                lua_pushinteger(L,anim.current_frame);lua_setfield(L,-2,"frame");
                lua_pushinteger(L,anim.num_frames);lua_setfield(L,-2,"numFrames");
                lua_setfield(L,-2,"anim");
            }
            lua_rawseti(L,-2,out_i++);
        }
        for(auto cit=e.children.rbegin();cit!=e.children.rend();++cit){
            stack.emplace_back(*cit,depth+1);
        }
    }
    lua_setfield(L,-2,"nodes");
    lua_pushinteger(L,out_i-1);lua_setfield(L,-2,"count");
    return 1;
}

void apply_entity_skin(lua_State* L,const char* skin_name,uint32_t id,int skin_id){
    int top=lua_gettop(L);
    lua_getglobal(L,"Prefabs");
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    lua_getfield(L,-1,skin_name);
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    int prefab_idx=lua_gettop(L);
    lua_getglobal(L,"Ents");
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    lua_rawgeti(L,-1,id);
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    int ent_idx=lua_gettop(L);
    lua_pushstring(L,skin_name);lua_setfield(L,ent_idx,"skinname");
    lua_pushnil(L);lua_setfield(L,ent_idx,"skin_build_name");
    lua_pushnumber(L,skin_id);lua_setfield(L,ent_idx,"skin_id");
    lua_getfield(L,prefab_idx,"init_fn");
    if(lua_isfunction(L,-1)){
        lua_pushvalue(L,ent_idx);
        lua_pushnil(L);
        lua_call(L,2,0);
    }
    lua_settop(L,top);
}
void clear_entity_skin(lua_State* L,const char* old_skin,uint32_t id){
    int top=lua_gettop(L);
    lua_getglobal(L,"Ents");
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    lua_rawgeti(L,-1,id);
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    int ent_idx=lua_gettop(L);
    if(!old_skin||!old_skin[0]){
        lua_getfield(L,ent_idx,"clear_fn");
        if(lua_isfunction(L,-1)){lua_pushvalue(L,ent_idx);lua_call(L,1,0);}
        lua_settop(L,top);return;
    }
    lua_getglobal(L,"Prefabs");
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    lua_getfield(L,-1,old_skin);
    if(!lua_istable(L,-1)){lua_settop(L,top);return;}
    int prefab_idx=lua_gettop(L);
    lua_pushnil(L);lua_setfield(L,ent_idx,"skinname");
    lua_pushnil(L);lua_setfield(L,ent_idx,"skin_build_name");
    lua_pushnil(L);lua_setfield(L,ent_idx,"skin_id");
    lua_getfield(L,prefab_idx,"clear_fn");
    if(lua_isfunction(L,-1)){lua_pushvalue(L,ent_idx);lua_call(L,1,0);}
    lua_settop(L,top);
}
int sim_spawn_prefab(lua_State* L){
    const char* name=luaL_checkstring(L,2);
    const char* skin=luaL_optstring(L,3,nullptr);
    int skin_id=static_cast<int>(luaL_optinteger(L,4,-1));
    lua_getglobal(L,"SpawnPrefabFromSim");
    if(!lua_isfunction(L,-1)){lua_pop(L,1);lua_pushnil(L);return 1;}
    lua_pushstring(L,name);
    lua_call(L,1,1);
    if(!lua_isnumber(L,-1)){lua_pop(L,1);lua_pushnil(L);return 1;}
    uint32_t id=static_cast<uint32_t>(lua_tointeger(L,-1));
    lua_pop(L,1);
    auto found=entities.find(id);
    if(found==entities.end()||!found->second.valid){lua_pushnil(L);return 1;}
    found->second.prefab_complete=true;
    found->second.can_sleep=found->second.can_sleep&&found->second.components_allow_sleep;
    if(skin&&skin[0])apply_entity_skin(L,skin,id,skin_id>=0?skin_id:0);
    lua_pushnumber(L,id);return 1;
}
int sim_reskin_entity(lua_State* L){
    uint32_t id=static_cast<uint32_t>(luaL_checknumber(L,2));
    const char* old_skin=luaL_optstring(L,3,nullptr);
    const char* new_skin=luaL_optstring(L,4,nullptr);
    int skin_id=static_cast<int>(luaL_optinteger(L,5,-1));
    auto found=entities.find(id);
    if(found==entities.end()||!found->second.valid)return 0;
    clear_entity_skin(L,old_skin,id);
    if(new_skin&&new_skin[0])apply_entity_skin(L,new_skin,id,skin_id>=0?skin_id:0);
    return 0;
}
const uint8_t perlin_perm[256]={
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
    247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
    74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
    65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
    52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
    119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
    218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
    184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
};
double perlin_fade(double t){return t*t*t*(t*(t*6.0-15.0)+10.0);}
double perlin_lerp(double t,double a,double b){return a+t*(b-a);}
double perlin_grad(int hash,double x,double y,double z){
    int h=hash&15;
    double u=h<8?x:y;
    double v=h<4?y:((h==12||h==14)?x:z);
    return ((h&1)==0?u:-u)+((h&2)==0?v:-v);
}
int perlin_fn(lua_State* L){
    double z=luaL_checknumber(L,3);
    double y=luaL_checknumber(L,2);
    double x=luaL_checknumber(L,1);
    double fx=std::floor(x),fy=std::floor(y),fz=std::floor(z);
    int X=static_cast<int>(fx)&255;
    int Y=static_cast<int>(fy)&255;
    int Z=static_cast<int>(fz)&255;
    x-=fx;y-=fy;z-=fz;
    double u=perlin_fade(x),v=perlin_fade(y),w=perlin_fade(z);
    auto p=[](int i)->int{return perlin_perm[i&255];};
    int A=p(X)+Y,AA=p(A)+Z,AB=p(A+1)+Z;
    int B=p(X+1)+Y,BA=p(B)+Z,BB=p(B+1)+Z;
    double res=perlin_lerp(w,
        perlin_lerp(v,
            perlin_lerp(u,perlin_grad(p(AA),x,y,z),perlin_grad(p(BA),x-1.0,y,z)),
            perlin_lerp(u,perlin_grad(p(AB),x,y-1.0,z),perlin_grad(p(BB),x-1.0,y-1.0,z))),
        perlin_lerp(v,
            perlin_lerp(u,perlin_grad(p(AA+1),x,y,z-1.0),perlin_grad(p(BA+1),x-1.0,y,z-1.0)),
            perlin_lerp(u,perlin_grad(p(AB+1),x,y-1.0,z-1.0),perlin_grad(p(BB+1),x-1.0,y-1.0,z-1.0))));
    lua_pushnumber(L,(res+1.0)*0.5);
    return 1;
}
int dam_lev_dist(const char* a,size_t a_len,const char* b,size_t b_len,int limit){
    int diff=static_cast<int>(a_len>b_len?a_len-b_len:b_len-a_len);
    if(diff>limit)return diff;
    size_t cols=b_len+1;
    std::vector<int> d((a_len+1)*cols,0);
    for(size_t i=0;i<=a_len;++i)d[i*cols]=static_cast<int>(i);
    for(size_t j=0;j<=b_len;++j)d[j]=static_cast<int>(j);
    for(size_t i=1;i<=a_len;++i){
        int low=limit+1;
        for(size_t j=1;j<=b_len;++j){
            int cost=(a[i-1]!=b[j-1])?1:0;
            int del=d[(i-1)*cols+j]+1;
            int ins=d[i*cols+(j-1)]+1;
            int sub=d[(i-1)*cols+(j-1)]+cost;
            int cur=std::min({del,ins,sub});
            if(i>1&&j>1&&a[i-1]==b[j-2]&&a[i-2]==b[j-1]){
                cur=std::min(cur,d[(i-2)*cols+(j-2)]+cost);
            }
            d[i*cols+j]=cur;
            if(cur<low)low=cur;
        }
        if(low>limit)return low;
    }
    return d[a_len*cols+b_len];
}
int string_search_subwords_fn(lua_State* L){
    size_t s_len=0,str_len=0;
    const char* search=luaL_checklstring(L,1,&s_len);
    const char* str=luaL_checklstring(L,2,&str_len);
    int sub_len=static_cast<int>(luaL_checkinteger(L,3));
    int limit=static_cast<int>(luaL_checkinteger(L,4));
    if(sub_len>0&&static_cast<int>(str_len)>=sub_len){
        int count=static_cast<int>(str_len)-sub_len+1;
        for(int i=0;i<count;++i){
            if(dam_lev_dist(search,s_len,str+i,static_cast<size_t>(sub_len),limit)<=limit){
                lua_pushboolean(L,1);return 1;
            }
        }
    }
    lua_pushboolean(L,0);return 1;
}
int klei_register_mods(lua_State*){return 0;}
int create_table_fn(lua_State* L){
    int narr=static_cast<int>(luaL_optinteger(L,1,0));
    int nrec=static_cast<int>(luaL_optinteger(L,2,0));
    lua_createtable(L,narr,nrec);return 1;
}
int visit_url_fn(lua_State* L){luaL_checkstring(L,1);return 0;}
int anglediff_fn(lua_State* L){
    float a2=static_cast<float>(luaL_checknumber(L,2))*0.01745329238474369f;
    float a1=static_cast<float>(luaL_checknumber(L,1))*0.01745329238474369f;
    float diff=normalize_rotation(a1-a2);
    lua_pushnumber(L,static_cast<double>(diff/0.01745329238474369f));return 1;
}
int inspect_sim_settings(lua_State* L){
    lua_newtable(L);
    for(const auto& kv:sim_settings){
        std::string full=kv.first.first+"."+kv.first.second;
        lua_pushlstring(L,kv.second.data(),kv.second.size());
        lua_setfield(L,-2,full.c_str());
    }
    return 1;
}
int clear_file_aliases(lua_State* L){
    lua_pushliteral(L,"MODS_ENABLED");lua_rawget(L,LUA_GLOBALSINDEX);bool mods=lua_toboolean(L,-1);lua_pop(L,1);
    if(mods)return luaL_error(L,"UNIMPLEMENTED_NATIVE: mod filesystem aliases");
    // The web resource filesystem has only canonical, manifest-indexed paths;
    // its alias set is empty while mods are disabled.
    return 0;
}
int to_array(lua_State* L) {
    int n=lua_gettop(L);
    if(n==0&&lua_toboolean(L,lua_upvalueindex(1))){lua_pushnil(L);return 1;}
    lua_createtable(L,n,0);
    for(int i=1;i<=n;++i){lua_pushvalue(L,i);lua_rawseti(L,-2,i);}
    return 1;
}
int timeout(lua_State* L) { return luaL_error(L,"Instruction budget exceeded"); }
void hook(lua_State* L, lua_Debug*) { timeout(L); }
void register_table(const char* name, const luaL_Reg* methods) {
    lua_newtable(state); luaL_register(state,nullptr,methods);
    lua_newtable(state); lua_pushstring(state,name); lua_pushcclosure(state,fail_unknown,1);
    lua_setfield(state,-2,"__index"); lua_setmetatable(state,-2);
    lua_setglobal(state,name);
}
int evaluate(const char* code,int instruction_budget=2000000) {
    int top=lua_gettop(state);
    lua_sethook(state,hook,LUA_MASKCOUNT,instruction_budget);
    int status=luaL_loadstring(state,code);
    if(status==0) status=lua_pcall(state,0,LUA_MULTRET,0);
    lua_sethook(state,nullptr,0,0);
    if(status) result=lua_tostring(state,-1)?lua_tostring(state,-1):"Unknown Lua error";
    else if(lua_gettop(state)>top) {
        const char* str=lua_tostring(state,-1); result=str?str:lua_typename(state,lua_type(state,-1));
    } else result="ok";
    lua_settop(state,top);
    return status;
}
struct MemoryBudget { size_t used=0; size_t limit=64*1024*1024; };
void* bounded_allocator(void* opaque,void* pointer,size_t old_size,size_t new_size) {
    auto* budget=static_cast<MemoryBudget*>(opaque);
    if(!pointer)old_size=0;
    if(new_size==0){free(pointer);budget->used-=old_size;return nullptr;}
    if(new_size>budget->limit-(budget->used-old_size))return nullptr;
    void* value=realloc(pointer,new_size);
    if(value)budget->used=budget->used-old_size+new_size;
    return value;
}
std::string escape_json(const char* value) {
    std::string out="\"";
    if(value)for(const unsigned char* p=reinterpret_cast<const unsigned char*>(value);*p;++p){
        if(*p=='"'||*p=='\\'){out+='\\';out+=static_cast<char>(*p);}
        else if(*p>=32)out+=static_cast<char>(*p);
        else {char encoded[7];std::snprintf(encoded,sizeof(encoded),"\\u%04x",*p);out+=encoded;}
    }
    return out+'"';
}
}

extern "C" {
EMSCRIPTEN_KEEPALIVE int dst_init(int role) {
    if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}
    dst_audio_release();
    if(state) lua_close(state);
    state=luaL_newstate(); if(!state){result="Cannot allocate Lua state";return 1;}
    ++sim_launches;profile_stat_events=0;profile_stat_bytes=0;profile_stat_channel.clear();profile_stat_sha256.clear();
    luaL_openlibs(state);
    lua_pushcfunction(state,luaopen_bit);lua_call(state,0,0);
    // No shell, process execution or dynamic native loading in browser runtime.
    lua_pushnil(state); lua_setglobal(state,"io");
    lua_getglobal(state,"os"); lua_pushnil(state); lua_setfield(state,-2,"execute");
    lua_pushnil(state); lua_setfield(state,-2,"exit"); lua_pop(state,1);
    lua_getglobal(state,"package"); lua_pushnil(state); lua_setfield(state,-2,"loadlib"); lua_pop(state,1);
    entities.clear();spatial_grid.clear();parented_transforms.clear();resource_catalog.clear();texture_groups.clear();sim_settings.clear();render_pass_effects.clear();erosion_texture.clear();holo_texture.clear();motd_target.clear();ui_root_guid=0;netbook_mode=false;registered_find_tags.clear();sim_time_scale=1.0f;ambient_r=0;ambient_g=0;ambient_b=0;visual_ambient_r=0;visual_ambient_g=0;visual_ambient_b=0;instance_parameters.clear();sim_reset_requested=false; tick=0; next_guid=1; profiler_depth=0;seed_rng(0);server_language="en";
    runtime_role=role==0?"client":role==1?"master":"caves";
    lua_getglobal(state,"math");
    lua_pushcfunction(state,math_randomseed);lua_setfield(state,-2,"randomseed");
    lua_pushcfunction(state,math_random);lua_setfield(state,-2,"random");lua_pop(state,1);
    const luaL_Reg rng[]={{"GetState",get_rng},{"SetState",set_rng},{nullptr,nullptr}};register_table("WebRNG",rng);
    lua_pushstring(state,role==0?"client":role==1?"master":"caves"); lua_setglobal(state,"WEB_ROLE");
    lua_pushboolean(state,0); lua_setglobal(state,"PRINT_TEXTURE_INFO");
    lua_pushboolean(state,1); lua_setglobal(state,"CONSOLE_ENABLED");
    lua_pushliteral(state,"Steam"); lua_setglobal(state,"DIST_PLATFORM");
    lua_pushliteral(state,"NONE"); lua_setglobal(state,"APP_REGION");
    lua_pushliteral(state,"2026-04-08"); lua_setglobal(state,"APP_BUILD_DATE");
    lua_pushliteral(state,"01:32:15"); lua_setglobal(state,"APP_BUILD_TIME");
    lua_pushliteral(state,"/"); lua_setglobal(state,"CWD");
    lua_pushcfunction(state,create_table_fn); lua_setglobal(state,"createTable");
    lua_pushcfunction(state,visit_url_fn); lua_setglobal(state,"VisitURL");
    lua_pushcfunction(state,anglediff_fn); lua_setglobal(state,"anglediff");
    lua_pushcfunction(state,perlin_fn); lua_setglobal(state,"perlin");
    lua_pushcfunction(state,string_search_subwords_fn); lua_setglobal(state,"string_search_subwords");
    lua_pushcfunction(state,klei_register_mods); lua_setglobal(state,"kleiregistermods");
    lua_pushcfunction(state,native_print); lua_setglobal(state,"print");
    lua_pushcfunction(state,wall_time);lua_setglobal(state,"walltime");
    lua_pushcfunction(state,require_event_file);lua_setglobal(state,"requireeventfile");
    lua_pushcfunction(state,native_hash);lua_setglobal(state,"hash");
    lua_pushcfunction(state,native_hash);lua_setglobal(state,"smallhash");
    lua_pushcfunction(state,klei_load);lua_setglobal(state,"kleiloadlua");
    lua_pushcfunction(state,file_exists);lua_setglobal(state,"kleifileexists");
    lua_pushcfunction(state,utf8_char);lua_setglobal(state,"utf8char");
    lua_pushcfunction(state,utf8_length);lua_setglobal(state,"utf8strlen");
    lua_pushcfunction(state,utf8_substr);lua_setglobal(state,"utf8substr");
    lua_pushcfunction(state,string_id_sorter);lua_setglobal(state,"stringidsorter");
    lua_pushboolean(state,1);lua_pushcclosure(state,utf8_case,1);lua_setglobal(state,"utf8strtoupper");
    lua_pushboolean(state,0);lua_pushcclosure(state,utf8_case,1);lua_setglobal(state,"utf8strtolower");
    lua_pushboolean(state,1);lua_pushcclosure(state,to_array,1);lua_setglobal(state,"toarrayornil");
    lua_pushboolean(state,0);lua_pushcclosure(state,to_array,1);lua_setglobal(state,"toarray");
    lua_newtable(state);lua_setfield(state,LUA_REGISTRYINDEX,"dst.entities");
    const luaL_Reg methods[]={{"GetGUID",guid},{"IsValid",valid},{"Retire",retire},{"IsAwake",is_awake},
        {"SetCanSleep",set_can_sleep},{"CallPrefabConstructionComplete",prefab_construction_complete},
        {"SetParent",set_parent},{"GetParent",get_parent},{"SetName",set_name},{"GetName",get_name},{"SetPrefabName",set_prefab},{"GetPrefabName",get_prefab},
        {"Show",show_entity},{"Hide",hide_entity},{"IsVisible",is_visible},{"SetClickable",set_clickable},{"MoveToFront",move_to_front},{"MoveToBack",move_to_back},
        {"AddTag",add_tag},{"RemoveTag",remove_tag},{"HasTag",has_tag},
        {"AddTransform",add_transform},{"GetWorldPosition",position},{"GetLocalPosition",local_position},{"GetPredictionPosition",position},
        {"SetPosition",set_position},{"OffsetPosition",offset_position},{"GetRotation",rotation},{"SetRotation",set_rotation},{"LoadRotation",set_rotation},
        {"GetScale",scale},{"GetWorldScale",scale},{"SetScale",set_scale},
        {"SetNoFaced",transform_noop},{"SetTwoFaced",transform_noop},{"SetFourFaced",transform_noop},{"SetSixFaced",transform_noop},{"SetEightFaced",transform_noop},{"SetFacing",transform_noop},
        {"SetPredictedNoFaced",transform_noop},{"SetPredictedTwoFaced",transform_noop},{"SetPredictedFourFaced",transform_noop},{"SetPredictedSixFaced",transform_noop},{"SetPredictedEightFaced",transform_noop},{"ClearPredictedFacingModel",transform_noop},
        {"SetInterpolateRotation",transform_noop},{"ClearTransformationHistory",transform_noop},{"SetIsOnPlatform",transform_noop},{"SetFromProxy",transform_noop},{"UpdateTransform",transform_noop},
        {"LoadPostPass",transform_noop},{"LongUpdate",transform_noop},{nullptr,nullptr}};
    register_table("Entity",methods);
    const luaL_Reg lifecycle[]={{"Inspect",inspect_lifecycle},{"UpdateSpatialSleep",update_spatial_sleep},{nullptr,nullptr}};register_table("WebEntity",lifecycle);
    const luaL_Reg scene_methods[]={{"Snapshot",snapshot_scene},{nullptr,nullptr}};register_table("WebScene",scene_methods);
    lua_getglobal(state,"Entity");
    lua_pushboolean(state,0); lua_pushcclosure(state,tags,1); lua_setfield(state,-2,"HasAllTags");
    lua_pushboolean(state,1); lua_pushcclosure(state,tags,1); lua_setfield(state,-2,"HasAnyTag"); lua_pop(state,1);
    luaL_newmetatable(state,"dst.Entity"); lua_pushcfunction(state,index_entity); lua_setfield(state,-2,"__index");
    lua_pushcfunction(state,entity_equal);lua_setfield(state,-2,"__eq");lua_pop(state,1);
    const luaL_Reg sim[]={{"CreateEntity",create_entity},{"GetTick",get_tick},{"GetStaticTick",get_tick},
        {"GetTime",get_time},{"GetRealTime",sim_get_real_time},{"GetTickTime",get_tick_time},{"GetNumberOfEntities",get_entity_count},{"GetNumLaunches",get_num_launches},
        {"GetStashedPlayInstance",get_stashed_play_instance},{"StashPlayInstance",stash_play_instance},
        {"SendProfileStats",local_profile_stats},
        {"GetSetting",sim_get_setting},{"SetSetting",sim_set_setting},{"GetLocalSetting",sim_get_setting},
        {"GetDataCollectionSetting",sim_get_data_collection},{"SetDataCollectionSetting",sim_set_data_collection},{"IsDataCollectionDisabled",sim_is_data_collection_disabled},
        {"HasPlayerSkeletons",sim_has_player_skeletons},{"SetRenderPassDefaultEffect",sim_set_render_pass_default_effect},
        {"SetErosionTexture",sim_set_erosion_texture},{"SetHoloTexture",sim_set_holo_texture},{"SetUIRoot",sim_set_ui_root},
        {"ShouldPlayIntroMovie",sim_should_play_intro_movie},{"IsNetbookMode",sim_is_netbook_mode},{"SetNetbookMode",sim_set_netbook_mode},
        {"IsLoggedOn",sim_is_logged_on},{"GetUserHasLicenseForApp",sim_false},{"IsSteamChinaClient",sim_false},{"IsBorrowed",sim_false},
        {"CanWriteConfigurationDirectory",sim_true},{"CanReadConfigurationDirectory",sim_true},{"HasValidLogFile",sim_true},{"HasEnoughFreeDiskSpace",sim_true},
        {"SetInstanceParameters",sim_set_instance_parameters},{"Reset",sim_reset},
        {"SetDLCEnabled",sim_set_dlc_enabled},{"IsDLCEnabled",sim_is_dlc_enabled},{"IsDLCInstalled",sim_is_dlc_enabled},
        {"GetUsersName",sim_get_users_name},{"GetSteamIDNumber",sim_get_steam_id_number},{"GetSteamBetaBranchName",sim_get_steam_beta_branch_name},
        {"LogBulkMetric",sim_log_bulk_metric},{"SetMOTDTarget",sim_set_motd_target},{"GetMOTDQueryURL",sim_get_motd_query_url},
        {"HasMOTDImage",sim_has_motd_image},{"DownloadMOTDImage",sim_download_motd_image},{"LoadMOTDImage",sim_load_motd_image},{"DownloadMOTDImages",sim_download_motd_images},
        {"UpdateDeviceCaps",sim_update_device_caps},{"RenderOneFrame",sim_render_one_frame},
        {"RegisterFindTags",sim_register_find_tags},{"FindEntities",sim_find_entities},{"FindEntities_Registered",sim_find_entities_registered},
        {"CountEntities",sim_count_entities},{"FindFirstEntityWithTag",sim_find_first_entity_with_tag},{"WorldPointInPoly",sim_world_point_in_poly},
        {"SetTimeScale",sim_set_time_scale},{"GetTimeScale",sim_get_time_scale},
        {"SetAmbientColour",sim_set_ambient_colour},{"GetAmbientColour",sim_get_ambient_colour},{"SetVisualAmbientColour",sim_set_visual_ambient_colour},
        {"GetLightAtPoint",sim_get_light_at_point},{"GetEntitiesAtScreenPoint",sim_get_entities_at_screen_point},
        {"SpawnPrefab",sim_spawn_prefab},{"ReskinEntity",sim_reskin_entity},{"ApplyLocalWordFilter",sim_apply_local_word_filter},
        {"ProfilerPush",profiler_push},{"ProfilerPop",profiler_pop},{"ShouldInitDebugger",debugger_disabled},
        {"SetReverbPreset",set_reverb},{"GetFileModificationTime",file_mtime},{"LuaPrint",lua_print},
        {"AddTextureToStreamingGroup",texture_group},{"ClearFileSystemAliases",clear_file_aliases},{"SendHardwareStats",send_hardware_stats},{nullptr,nullptr}};
    // Runtime source-line annotation hook has no behavior in the retail build.
    register_table("TheSim",sim);
    const luaL_Reg profile_stats[]={{"Inspect",inspect_profile_stats},{nullptr,nullptr}};register_table("WebProfileStats",profile_stats);
    const luaL_Reg settings_inspect[]={{"Inspect",inspect_sim_settings},{nullptr,nullptr}};register_table("WebSettings",settings_inspect);
    lua_getglobal(state,"TheSim");
    for(const char* name:{"SetSoundVolume","SetLowPassFilter","SetHighPassFilter","ClearDSP","TurnOffReverb"}){
        lua_pushstring(state,name);lua_pushcclosure(state,headless_sound,1);lua_setfield(state,-2,name);
    }
    lua_pushcfunction(state,sound_volume);lua_setfield(state,-2,"GetSoundVolume");lua_pop(state,1);
    web_persistent::install(state,runtime_role);
    web_tiles::install(state);
    web_input::install(state,role==0);
    web_inventory::install(state);
    web_system::install(state);
    web_prefabs::install(state,resource_exists,role==0);
    web_animation_asset::install(state);
    web_file_asset::install(state);
    web_atlas_asset::install(state,role==0);
    web_shader_asset::install(state,runtime_role=="client");
    web_font_asset::install(state,role==0);
    web_texture_asset::install(state);
    web_components::install(state,{
        [](lua_State* L,int index){return *static_cast<uint32_t*>(luaL_checkudata(L,index,"dst.Entity"));},
        [](uint32_t id){auto found=entities.find(id);return found!=entities.end()&&found->second.valid;},
        [](uint32_t id){auto found=entities.find(id);return found==entities.end()?0u:found->second.parent;},
        [](uint32_t id,float* matrix){
            auto found=entities.find(id);if(found==entities.end()||!found->second.has_transform)return false;
            const auto& e=found->second;float c=std::cos(e.rotation),s=std::sin(e.rotation);
            const float local[16]={c*e.sx,0,s*e.sz,e.x,0,e.sy,0,e.y,-s*e.sx,0,c*e.sz,e.z,0,0,0,1};
            std::memcpy(matrix,local,sizeof(local));return true;
        },
        [](uint32_t id,float* out_x,float* out_y,float* out_z,float* out_rot){
            auto found=entities.find(id);if(found==entities.end()||!found->second.has_transform)return false;
            const auto& e=found->second;
            if(out_x)*out_x=e.x;if(out_y)*out_y=e.y;if(out_z)*out_z=e.z;if(out_rot)*out_rot=e.rotation;
            return true;
        },
        [](uint32_t id,float x,float y,float z){
            auto found=entities.find(id);if(found==entities.end()||!found->second.has_transform)return false;
            auto& e=found->second;e.x=x;e.y=y;e.z=z;update_entity_spatial(e);return true;
        },
        [](uint32_t id){
            auto found=entities.find(id);return found!=entities.end()&&found->second.valid&&!found->second.sleeping;
        }
    },role==0);
    lua_getglobal(state,"WebUI");if(lua_istable(state,-1)){lua_pushcfunction(state,snapshot_ui);lua_setfield(state,-2,"Snapshot");}lua_pop(state,1);
    web_game_service::install(state);
    web_physics_waker::install(state);

    web_camera::install(state,role==0);
    lua_newtable(state);lua_pushcfunction(state,texture_group_stats);lua_setfield(state,-2,"Inspect");lua_setglobal(state,"WebTextureGroups");
    lua_getglobal(state,"TheSim");lua_pushcfunction(state,validate_line_number);lua_setfield(state,-2,"ValidateLineNumber");lua_pop(state,1);
    const luaL_Reg net[]={{"IsDedicated",is_dedicated},{"GetDefaultServerLanguage",get_server_language},
        {"SetDefaultServerLanguage",set_server_language},{"GetLanguageCode",get_language_code},{nullptr,nullptr}}; register_table("TheNet",net);
    const luaL_Reg shard[]={{nullptr,nullptr}}; register_table("TheShard",shard);
    web_session::install(state,role==0);
    for(auto p : std::vector<std::pair<const char*,lua_CFunction>>{{"GetTick",get_tick},{"GetStaticTick",get_tick},
        {"GetTime",get_time},{"GetStaticTime",get_time},{"GetTickTime",get_tick_time}}) {
        lua_pushcfunction(state,p.second);lua_setglobal(state,p.first);
    }
    result="ok"; return 0;
}
EMSCRIPTEN_KEEPALIVE int dst_eval(const char* code) { if(!state){result="Engine not initialized";return 1;}if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}return evaluate(code); }
EMSCRIPTEN_KEEPALIVE int dst_ui_viewport(int width,int height){
    if(!state||web_resource_io::async_active()){result="UI viewport unavailable during initialization or resource I/O";return 1;}
    if(!web_ui::set_viewport(width,height)){result="Invalid UI viewport or hierarchy";return 1;}return 0;
}
EMSCRIPTEN_KEEPALIVE int dst_configure_session(const char* json,const char* content_hash){
    if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}
    if(!state||!json||!content_hash){result="Missing engine/session parameters";return 1;}
    int top=lua_gettop(state);lua_pushcfunction(state,web_session::configure);lua_pushstring(state,json);lua_pushstring(state,content_hash);
    lua_sethook(state,hook,LUA_MASKCOUNT,2000000);int status=lua_pcall(state,2,0,0);lua_sethook(state,nullptr,0,0);
    result=status?lua_tostring(state,-1):"ok";lua_settop(state,top);return status;
}
EMSCRIPTEN_KEEPALIVE int dst_eval_budget(const char* code,int budget) {
    if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}
    if(!state||budget<1000||budget>200000000){result="Invalid Lua instruction budget";return 1;}
    return evaluate(code,budget);
}
EMSCRIPTEN_KEEPALIVE int dst_eval_async(const char* code,int budget){
    if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}
    if(!state||budget<1000||budget>200000000){result="Invalid Lua instruction budget";return 1;}
    web_resource_io::allow_async(true);int status=evaluate(code,budget);web_resource_io::allow_async(false);return status;
}
EMSCRIPTEN_KEEPALIVE const char* dst_result() { return result.c_str(); }
EMSCRIPTEN_KEEPALIVE int dst_index_assets(const char* listing){
    if(!listing){result="Missing resource index";return -1;}
    std::map<std::string,uint32_t> next;
    const char* cursor=listing;
    while(*cursor){
        char* end=nullptr;unsigned long long bytes=std::strtoull(cursor,&end,10);
        if(end==cursor||*end!='\t'||bytes>128*1024*1024){result="Invalid resource size";return -1;}
        cursor=end+1;const char* newline=std::strchr(cursor,'\n');
        if(!newline||newline-cursor>1024){result="Invalid resource path length";return -1;}
        std::string name(cursor,newline-cursor),path;
        if(name.find_first_of("\t\r")!=std::string::npos||!asset_path(name.c_str(),path)||next.count(path)){
            result="Invalid or duplicate resource path";return -1;
        }
        next.emplace(path,static_cast<uint32_t>(bytes));cursor=newline+1;
        if(next.size()>50000){result="Resource index exceeds 50000 files";return -1;}
    }
    resource_catalog=std::move(next);result="ok";return static_cast<int>(resource_catalog.size());
}
EMSCRIPTEN_KEEPALIVE uint32_t dst_tick_count() { return tick; }
EMSCRIPTEN_KEEPALIVE int dst_apply_entity_sleep(const uint32_t* decisions,uint32_t count){
    if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}
    // Input pairs are {GUID, sleeping}. These are final authoritative spatial
    // decisions, not a replacement for the missing Map/WorldSim interest policy.
    const auto address=reinterpret_cast<uintptr_t>(decisions);
    if(!state||count>100000||(count&&(!decisions||address%4||static_cast<uint64_t>(address)+count*8ULL>emscripten_get_heap_size()))){
        result="Invalid entity sleep decision batch";return 1;
    }
    std::vector<std::pair<uint32_t,bool>> batch;std::set<uint32_t> seen;
    for(uint32_t i=0;i<count;++i){
        auto id=decisions[i*2],sleeping=decisions[i*2+1];
        if(sleeping>1||!entities.count(id)||!seen.insert(id).second){result="Invalid, duplicate or retired entity sleep decision";return 1;}
        batch.emplace_back(id,sleeping!=0);
    }
    int top=lua_gettop(state);
    if(count)for(const char* name:{"OnEntitySleep","OnEntityWake"}){
        lua_pushstring(state,name);lua_rawget(state,LUA_GLOBALSINDEX);bool present=lua_isfunction(state,-1);lua_pop(state,1);
        if(!present){result=std::string("UNIMPLEMENTED_NATIVE: lifecycle callback ")+name;return 1;}
    }
    lua_sethook(state,hook,LUA_MASKCOUNT,2000000);
    for(const auto& [id,sleeping]:batch){
        auto found=entities.find(id);
        if(found==entities.end())continue; // An earlier callback may remove it.
        auto& e=found->second;
        if(!e.sleep_state_pending&&e.sleeping==sleeping)continue;
        lua_pushstring(state,sleeping?"OnEntitySleep":"OnEntityWake");lua_rawget(state,LUA_GLOBALSINDEX);
        e.sleeping=sleeping;e.sleep_state_pending=false;
        // Native Transform wake re-applies its local rotation before Lua.
        if(!sleeping&&e.has_transform)e.rotation=normalize_rotation((e.rotation/0.01745329238474369f)*0.01745329238474369f);
        lua_pushnumber(state,id);
        int status=lua_pcall(state,1,0,0);
        // No entity reference is used after a callback: it may retire/create.
        if(status){
            const char* error=lua_tostring(state,-1);result=error?error:"Entity lifecycle callback failed";
            lua_sethook(state,nullptr,0,0);lua_settop(state,top);return status;
        }
    }
    lua_sethook(state,nullptr,0,0);lua_settop(state,top);result="ok";return 0;
}
EMSCRIPTEN_KEEPALIVE int dst_io_pending(){return web_persistent::pending();}
EMSCRIPTEN_KEEPALIVE int dst_complete_io(int durable){
    if(!state){result="Engine not initialized";return 1;}
    lua_sethook(state,hook,LUA_MASKCOUNT,2000000);
    int status=web_persistent::complete(state,durable!=0);
    lua_sethook(state,nullptr,0,0);
    if(status){result=lua_tostring(state,-1);lua_pop(state,1);}
    else result="ok";
    return status;
}
EMSCRIPTEN_KEEPALIVE void dst_restore_clock(uint32_t value) { tick=value; }
EMSCRIPTEN_KEEPALIVE int dst_inspect_save(const char* bytes,uint32_t length) {
    if(!bytes||length==0||length>8*1024*1024){result="Save must be between 1 byte and 8 MiB";return 1;}
    while(length&&bytes[length-1]=='\0')--length;
    if(!length||static_cast<unsigned char>(bytes[0])==27){result="Bytecode saves are not supported";return 1;}
    if(length>=4&&std::memcmp(bytes,"KLEI",4)==0){result="Encoded KLEI save decoder is not implemented";return 1;}
    MemoryBudget memory;
    lua_State* isolated=lua_newstate(bounded_allocator,&memory);
    if(!isolated){result="Cannot allocate isolated save decoder";return 1;}
    // Empty environment: no globals, standard libraries, filesystem or native
    // bindings. Only serialization expressions are evaluated, under budgets.
    lua_sethook(isolated,hook,LUA_MASKCOUNT,5000000);
    int status=luaL_loadbuffer(isolated,bytes,length,"native-save");
    if(!status)status=lua_pcall(isolated,0,1,0);
    if(status){result=lua_tostring(isolated,-1)?lua_tostring(isolated,-1):"Native save decoding failed";lua_close(isolated);return 1;}
    if(!lua_istable(isolated,-1)){result="Native save must return a table";lua_close(isolated);return 1;}
    lua_getfield(isolated,-1,"meta");
    if(!lua_istable(isolated,-1)){result="Save metadata is missing";lua_close(isolated);return 1;}
    lua_getfield(isolated,-1,"build_version");
    const char* build=lua_tostring(isolated,-1);
    if(!build||std::strcmp(build,"756039")!=0){result="Native save build must be 756039";lua_close(isolated);return 1;}
    lua_pop(isolated,1);
    lua_getfield(isolated,-1,"seed");double seed=lua_tonumber(isolated,-1);lua_pop(isolated,1);
    lua_getfield(isolated,-1,"level_id");std::string level=escape_json(lua_tostring(isolated,-1));lua_pop(isolated,2);
    lua_getfield(isolated,-1,"mods");
    if(lua_istable(isolated,-1)){
        lua_pushnil(isolated);if(lua_next(isolated,-2)){result="Modded native saves are not supported";lua_close(isolated);return 1;}
    }
    lua_pop(isolated,1);
    size_t prefab_types=0,instances=0;
    lua_getfield(isolated,-1,"ents");
    if(!lua_istable(isolated,-1)){result="Native world entity table is missing";lua_close(isolated);return 1;}
    lua_pushnil(isolated);
    while(lua_next(isolated,-2)){
        ++prefab_types;if(lua_istable(isolated,-1))instances+=lua_objlen(isolated,-1);lua_pop(isolated,1);
    }
    lua_pop(isolated,1);lua_getfield(isolated,-1,"map");
    if(!lua_istable(isolated,-1)){result="Native world map is missing";lua_close(isolated);return 1;}
    lua_getfield(isolated,-1,"width");int width=lua_tointeger(isolated,-1);lua_pop(isolated,1);
    lua_getfield(isolated,-1,"height");int height=lua_tointeger(isolated,-1);lua_pop(isolated,1);
    char values[384];
    std::snprintf(values,sizeof(values),"{\"kind\":\"native-save-inspection-v1\",\"gameBuild\":\"756039\",\"seed\":%.0f,\"prefabTypes\":%zu,\"entityInstances\":%zu,\"mapWidth\":%d,\"mapHeight\":%d,\"decodedBytes\":%u,\"levelId\":",seed,prefab_types,instances,width,height,length);
    result=std::string(values)+level+",\"playableImport\":false}";
    lua_close(isolated);return 0;
}
EMSCRIPTEN_KEEPALIVE int dst_entity_count() { int n=0;for(auto& p:entities)if(p.second.valid)++n;return n; }
EMSCRIPTEN_KEEPALIVE int dst_tick(uint32_t count) {
    if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return 1;}
    if(!state || count>3000){result="Invalid tick request";return 1;}
    const char* expr="_WEB_Tick()";
    if(count){
        lua_pushliteral(state,"_WEB_Tick");lua_rawget(state,LUA_GLOBALSINDEX);
        bool fn=lua_isfunction(state,-1);lua_pop(state,1);
        if(!fn){
            lua_pushliteral(state,"Update");lua_rawget(state,LUA_GLOBALSINDEX);
            fn=lua_isfunction(state,-1);lua_pop(state,1);
            expr="Update(GetTickTime())";
        }
        if(!fn){result="UNIMPLEMENTED_NATIVE: main simulation update dispatch";return 1;}
    }
    for(uint32_t i=0;i<count;++i){
        ++tick;
        web_world_components::step(state,static_cast<float>(tick_time)*sim_time_scale);
        if(evaluate(expr,50000000)) return 1;
    }
    result="ok";return 0;
}
EMSCRIPTEN_KEEPALIVE void dst_close() { if(web_resource_io::async_active()){result="Lua evaluation is waiting for resource I/O";return;}if(state)lua_close(state);state=nullptr;entities.clear();spatial_grid.clear();parented_transforms.clear();resource_catalog.clear();web_animation_asset::clear();web_file_asset::clear();web_atlas_asset::clear();web_shader_asset::clear();web_font_asset::clear();web_texture_asset::clear();web_components::clear();dst_audio_release(); }
}

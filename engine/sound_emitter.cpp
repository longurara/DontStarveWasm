#include "sound_emitter.hpp"
#include "string_hash.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_sound_emitter {
namespace {
constexpr size_t kBudget=16384;
constexpr uint32_t kTypeId=0xeea70effu;

struct NamedSound {
    std::string name;
    std::string event;
    float volume=1.0f;
    bool autonamed=false;
    std::map<std::string,float> params;
};

struct SoundNode {
    bool muted=false;
    float volume_multiplier=1.0f;
    std::map<uint32_t,NamedSound> active_sounds;
    std::vector<std::string> one_shot_events;
    std::string last_param_event;
    float last_param_volume=1.0f;
    bool last_param_autonamed=false;
    std::map<std::string,float> last_params;
};

web_components::EntityHost host{};
std::map<uint32_t,SoundNode> nodes;

uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.SoundEmitter"));}

SoundNode* sound_node(lua_State* L,uint32_t* out_id=nullptr){
    auto id=owner(L);
    if(out_id)*out_id=id;
    if(!host.alive(id))return nullptr;
    auto it=nodes.find(id);
    return it==nodes.end()?nullptr:&it->second;
}

int add(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add SoundEmitter to a removed entity");
    if(!nodes.count(id)){
        if(nodes.size()>=kBudget)return luaL_error(L,"SoundEmitter count exceeds budget");
        nodes.emplace(id,SoundNode{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.SoundEmitter");
    lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"SoundEmitter");}
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int tostring_se(lua_State* L){owner(L);lua_pushfstring(L,"SoundEmitter (%p)",lua_touserdata(L,1));return 1;}

int play_sound(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    const char* event=luaL_checklstring(L,2,nullptr);
    const char* name=luaL_optlstring(L,3,"",nullptr);
    float volume=static_cast<float>(luaL_optnumber(L,4,1.0));
    bool autonamed=lua_toboolean(L,5)!=0;
    if(node->muted)return 0;
    if(!name||name[0]=='\0'){
        if(std::find(node->one_shot_events.begin(),node->one_shot_events.end(),event)==node->one_shot_events.end()){
            if(node->one_shot_events.size()<256)node->one_shot_events.emplace_back(event);
        }
    }else{
        uint32_t name_id=web_strings::hash(name);
        if(name_id!=0&&!node->active_sounds.count(name_id)){
            if(node->active_sounds.size()<256){
                node->active_sounds.emplace(name_id,NamedSound{name,event,volume,autonamed,{}});
            }
        }
    }
    return 0;
}

int play_sound_with_params(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    const char* event=luaL_checklstring(L,2,nullptr);
    float volume=static_cast<float>(luaL_optnumber(L,4,1.0));
    bool autonamed=lua_toboolean(L,5)!=0;
    std::map<std::string,float> params;
    if(lua_type(L,3)==LUA_TTABLE){
        lua_pushnil(L);
        while(lua_next(L,3)!=0){
            const char* k=luaL_checklstring(L,-2,nullptr);
            float v=static_cast<float>(luaL_checknumber(L,-1));
            params[k]=v;
            lua_pop(L,1);
        }
    }
    if(node->muted)return 0;
    if(params.empty()){
        if(std::find(node->one_shot_events.begin(),node->one_shot_events.end(),event)==node->one_shot_events.end()){
            if(node->one_shot_events.size()<256)node->one_shot_events.emplace_back(event);
        }
    }
    node->last_param_event=event;
    node->last_param_volume=volume;
    node->last_param_autonamed=autonamed;
    node->last_params=std::move(params);
    return 0;
}

int kill_sound(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    const char* name=luaL_checklstring(L,2,nullptr);
    if(node->muted)return 0;
    node->active_sounds.erase(web_strings::hash(name));
    return 0;
}

int kill_all_sounds(lua_State* L){
    auto* node=sound_node(L);
    if(!node||node->muted)return 0;
    node->active_sounds.clear();
    return 0;
}

int playing_sound(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    const char* name=luaL_checklstring(L,2,nullptr);
    uint32_t name_id=web_strings::hash(name);
    bool playing=!node->muted&&name_id!=0&&node->active_sounds.count(name_id)!=0;
    lua_pushboolean(L,playing);
    return 1;
}

int set_parameter(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    const char* name=luaL_checklstring(L,2,nullptr);
    const char* param_name=luaL_checklstring(L,3,nullptr);
    float value=static_cast<float>(luaL_checknumber(L,4));
    if(node->muted)return 0;
    auto it=node->active_sounds.find(web_strings::hash(name));
    if(it!=node->active_sounds.end()&&it->second.params.size()<64){
        it->second.params[param_name]=value;
    }
    return 0;
}

int set_volume(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    const char* name=luaL_checklstring(L,2,nullptr);
    float volume=static_cast<float>(luaL_checknumber(L,3));
    if(node->muted)return 0;
    auto it=node->active_sounds.find(web_strings::hash(name));
    if(it!=node->active_sounds.end())it->second.volume=volume;
    return 0;
}

int override_volume_multiplier(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    node->volume_multiplier=static_cast<float>(luaL_checknumber(L,2));
    return 0;
}

int set_mute(lua_State* L){
    auto* node=sound_node(L);
    if(!node)return 0;
    if(lua_type(L,2)!=LUA_TBOOLEAN)return luaL_typerror(L,2,"boolean");
    bool mute=lua_toboolean(L,2)!=0;
    if(node->muted!=mute){
        if(mute)node->active_sounds.clear();
        node->muted=mute;
    }
    return 0;
}

int get_entity(lua_State* L){
    uint32_t id=0;
    auto* node=sound_node(L,&id);
    if(!node)return 0;
    lua_getglobal(L,"Ents");
    int ents_idx=lua_gettop(L);
    lua_pushnumber(L,id);
    lua_gettable(L,ents_idx);
    lua_remove(L,ents_idx);
    return 1;
}

void scalar(lua_State* L,const char* key,double value){lua_pushnumber(L,value);lua_setfield(L,-2,key);}
void boolean(lua_State* L,const char* key,bool value){lua_pushboolean(L,value);lua_setfield(L,-2,key);}

int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);
        scalar(L,"soundEmitters",nodes.size());
        scalar(L,"budget",kBudget);
        boolean(L,"audioBackendReady",false);
        return 1;
    }
    double id=luaL_checknumber(L,1);
    if(!std::isfinite(id)||id<0||id>4294967295.0||std::trunc(id)!=id){lua_pushnil(L);return 1;}
    auto it=nodes.find(static_cast<uint32_t>(id));
    if(it==nodes.end()){lua_pushnil(L);return 1;}
    const auto& v=it->second;
    lua_newtable(L);
    scalar(L,"owner",id);
    scalar(L,"typeId",kTypeId);
    boolean(L,"muted",v.muted);
    scalar(L,"volumeMultiplier",v.volume_multiplier);
    scalar(L,"activeSoundCount",v.active_sounds.size());
    scalar(L,"oneShotCount",v.one_shot_events.size());
    lua_newtable(L);
    for(const auto& [hash,snd]:v.active_sounds){
        lua_newtable(L);
        scalar(L,"id",hash);
        lua_pushlstring(L,snd.event.data(),snd.event.size());lua_setfield(L,-2,"event");
        scalar(L,"volume",snd.volume);
        boolean(L,"autonamed",snd.autonamed);
        lua_newtable(L);
        for(const auto& [pk,pv]:snd.params)scalar(L,pk.c_str(),pv);
        lua_setfield(L,-2,"params");
        lua_setfield(L,-2,snd.name.c_str());
    }
    lua_setfield(L,-2,"activeSounds");
    return 1;
}
}

bool contains(uint32_t id){return nodes.count(id)!=0;}
void retire(uint32_t id){nodes.erase(id);}
void clear(){nodes.clear();}
void install(lua_State* L,web_components::EntityHost callbacks){
    clear();host=callbacks;
    luaL_newmetatable(L,"dst.SoundEmitter");lua_newtable(L);
    const luaL_Reg methods[]={
        {"KillSound",kill_sound},
        {"KillAllSounds",kill_all_sounds},
        {"PlaySound",play_sound},
        {"PlaySoundWithParams",play_sound_with_params},
        {"SetParameter",set_parameter},
        {"SetVolume",set_volume},
        {"OverrideVolumeMultiplier",override_volume_multiplier},
        {"PlayingSound",playing_sound},
        {"SetMute",set_mute},
        {"GetEntity",get_entity},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,methods);
    lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_se);lua_setfield(L,-2,"__tostring");
    lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddSoundEmitter");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebSoundEmitters");
}
}

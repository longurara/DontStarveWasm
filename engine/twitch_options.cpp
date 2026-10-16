#include "twitch_options.hpp"
#include <cmath>
#include <map>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_twitch_options {
namespace {
constexpr size_t kBudget=64;
constexpr uint32_t kTypeId=0x4eb52701u;

struct TwitchState {
    int streaming_state=0;
    bool broadcasting_enabled=false;
    bool visible_chat_enabled=false;
    std::string username;
    std::string custom_state;
};

web_components::EntityHost host{};
TwitchState state{};
std::map<uint32_t,bool> instances;

uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.TwitchOptions"));}

void check_owner(lua_State* L){
    auto id=owner(L);
    if(!host.alive(id)||!instances.count(id))luaL_error(L,"TwitchOptions owner is removed");
}

const char* state_string(const TwitchState& s){
    if(!s.custom_state.empty())return s.custom_state.c_str();
    switch(s.streaming_state){
        case 0: return "Uninitialized";
        case 1: return "Stream Logged Out";
        case 2: return "Authenticating";
        case 3: return "Streaming Authenticated";
        case 4: return "Logging In";
        case 5: return "Logged In";
        case 6: return "Finding Ingest Server";
        case 7: return "Found Ingest Server";
        case 8: return "Ready To Stream";
        case 9: return "Streaming";
        case 10: return "Paused";
        default: return "Invalid State";
    }
}

int add(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add TwitchOptions to a removed entity");
    if(!instances.count(id)){
        if(instances.size()>=kBudget)return luaL_error(L,"TwitchOptions count exceeds budget");
        instances.emplace(id,true);
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.TwitchOptions");
    lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"TwitchOptions");}
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int tostring_to(lua_State* L){owner(L);lua_pushfstring(L,"TwitchOptions (%p)",lua_touserdata(L,1));return 1;}

// Native 0x140032810: state == 9 || state == 10
int is_streaming(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,(state.streaming_state==9||state.streaming_state==10)?1:0);
    return 1;
}

// Native 0x14005b080: no-op on retail build (0x14003d000 / 0x140245ba0)
int toggle_streaming(lua_State* L){check_owner(L);return 0;}

// Native 0x14005b0f0: no-op on retail build (0x14003d000)
int stop(lua_State* L){check_owner(L);return 0;}

// Native 0x14005b0c0: calls 0x140245ba0 -> false
int start_or_supported(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,0);
    return 1;
}

// Native 0x14005b110 -> 0x140032ae0: if (state == 0) broadcasting_enabled = true
int login(lua_State* L){
    check_owner(L);
    if(state.streaming_state==0)state.broadcasting_enabled=true;
    return 0;
}

// Native 0x14005b130 -> 0x140032ad0: state = 1
int forget(lua_State* L){
    check_owner(L);
    state.streaming_state=1;
    return 0;
}

// Native 0x14005b150 -> 0x140032af0: flushes settings
int save_settings(lua_State* L){check_owner(L);return 0;}

// Native 0x14005b170 -> 0x140032830: state != 0 && state != 1
int is_past_initialized(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,(state.streaming_state!=0&&state.streaming_state!=1)?1:0);
    return 1;
}

// Native 0x14005b1a0 -> 0x140032850: state != 0
int is_initialized(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.streaming_state!=0?1:0);
    return 1;
}

// Native 0x14005b270 -> 0x140032880
int get_username(lua_State* L){
    check_owner(L);
    lua_pushlstring(L,state.username.data(),state.username.size());
    return 1;
}

// Native 0x14005b2e0 -> 0x140032870
int get_broadcasting_enabled(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.broadcasting_enabled?1:0);
    return 1;
}

// Native 0x14005b1d0 -> 0x1400328a0
int get_streaming_state_string(lua_State* L){
    check_owner(L);
    lua_pushstring(L,state_string(state));
    return 1;
}

// Native 0x14005b240
int get_streaming_state(lua_State* L){
    check_owner(L);
    lua_pushinteger(L,state.streaming_state);
    return 1;
}

// Native 0x14005b310 -> 0x140032860
int get_visible_chat_enabled(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.visible_chat_enabled?1:0);
    return 1;
}

// Native 0x14005b340 -> 0x140384140 -> ""
int get_empty_channel_string(lua_State* L){
    check_owner(L);
    lua_pushliteral(L,"");
    return 1;
}

// Native 0x14005b3b0: reads boolean arg, calls 0x14003d000 (no-op), returns 1
int set_broadcasting_enabled(lua_State* L){
    check_owner(L);
    (void)lua_toboolean(L,2);
    lua_pushnil(L);
    return 1;
}

// Native 0x14005b3e0 -> 0x140032a40: sets visible_chat_enabled = bool(arg), returns 1
int set_visible_chat_enabled(lua_State* L){
    check_owner(L);
    state.visible_chat_enabled=lua_toboolean(L,2)!=0;
    lua_pushnil(L);
    return 1;
}

int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);
        lua_pushnumber(L,instances.size());lua_setfield(L,-2,"count");
        lua_pushnumber(L,kBudget);lua_setfield(L,-2,"budget");
        lua_pushnumber(L,kTypeId);lua_setfield(L,-2,"typeId");
        lua_pushnumber(L,state.streaming_state);lua_setfield(L,-2,"streamingState");
        lua_pushstring(L,state_string(state));lua_setfield(L,-2,"streamingStateString");
        lua_pushboolean(L,state.broadcasting_enabled?1:0);lua_setfield(L,-2,"broadcastingEnabled");
        lua_pushboolean(L,state.visible_chat_enabled?1:0);lua_setfield(L,-2,"visibleChatEnabled");
        return 1;
    }
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto id=static_cast<uint32_t>(raw);
    if(!instances.count(id)){lua_pushnil(L);return 1;}
    lua_newtable(L);
    lua_pushliteral(L,"TwitchOptions");lua_setfield(L,-2,"kind");
    lua_pushnumber(L,id);lua_setfield(L,-2,"owner");
    lua_pushnumber(L,kTypeId);lua_setfield(L,-2,"typeId");
    lua_pushnumber(L,state.streaming_state);lua_setfield(L,-2,"streamingState");
    lua_pushstring(L,state_string(state));lua_setfield(L,-2,"streamingStateString");
    lua_pushboolean(L,state.broadcasting_enabled?1:0);lua_setfield(L,-2,"broadcastingEnabled");
    lua_pushboolean(L,state.visible_chat_enabled?1:0);lua_setfield(L,-2,"visibleChatEnabled");
    return 1;
}
}

void retire(uint32_t id){instances.erase(id);}
void clear(){instances.clear();state=TwitchState{};}

void install(lua_State* L,web_components::EntityHost callbacks){
    clear();
    host=callbacks;
    luaL_newmetatable(L,"dst.TwitchOptions");
    lua_newtable(L);
    const luaL_Reg methods[]={
        {"IsStreaming",is_streaming},
        {"ToggleStreaming",toggle_streaming},
        {"Stop",stop},
        {"Start",start_or_supported},
        {"Login",login},
        {"Forget",forget},
        {"SaveSettings",save_settings},
        {"SupportedByPlatform",start_or_supported},
        {"IsPastInitializedState",is_past_initialized},
        {"IsInitialized",is_initialized},
        {"GetUserName",get_username},
        {"GetBroadcastingEnabled",get_broadcasting_enabled},
        {"GetStreamingStateString",get_streaming_state_string},
        {"GetStreamingState",get_streaming_state},
        {"GetVisibleChatEnabled",get_visible_chat_enabled},
        {"GetChannelURL",get_empty_channel_string},
        {"GetChannelName",get_empty_channel_string},
        {"SetBroadcastingEnabled",set_broadcasting_enabled},
        {"SetVisibleChatEnabled",set_visible_chat_enabled},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,methods);
    lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_to);
    lua_setfield(L,-2,"__tostring");
    lua_pop(L,1);

    lua_getglobal(L,"Entity");
    lua_pushcfunction(L,add);
    lua_setfield(L,-2,"AddTwitchOptions");
    lua_pop(L,1);

    lua_newtable(L);
    lua_pushcfunction(L,inspect);
    lua_setfield(L,-2,"Inspect");
    lua_setglobal(L,"WebTwitchOptions");
}
}

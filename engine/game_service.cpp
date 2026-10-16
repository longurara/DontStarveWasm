#include "game_service.hpp"
#include <map>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_game_service {
namespace {
std::map<std::string,std::string> achievements;
int register_achievement(lua_State* L){
    luaL_checkudata(L,1,"dst.GameService");
    const char* name=luaL_checkstring(L,2);const char* platform_id=luaL_checkstring(L,3);
    // The PC wrapper consumes the name and Steam identifier. PSN's extra
    // argument is ignored by that wrapper. No platform account call is made.
    achievements[name]=platform_id;return 0;
}
int inspect(lua_State* L){lua_newtable(L);for(const auto& item:achievements){lua_pushlstring(L,item.second.data(),item.second.size());lua_setfield(L,-2,item.first.c_str());}return 1;}
int unknown(lua_State* L){return luaL_error(L,"UNIMPLEMENTED_NATIVE: GameService.%s",luaL_checkstring(L,2));}
int no_haptic_device(lua_State* L){
    luaL_checkudata(L,1,"dst.HapticsProxy");
    // All retail proxy methods return zero Lua results before parsing their
    // arguments when the platform support byte is false. This web build has
    // keyboard/mouse only and deliberately has no controller haptic device.
    return 0;
}
}
void install(lua_State* L){
    achievements.clear();luaL_newmetatable(L,"dst.GameService");lua_newtable(L);
    lua_pushcfunction(L,register_achievement);lua_setfield(L,-2,"RegisterAchievement");
    lua_newtable(L);lua_pushcfunction(L,unknown);lua_setfield(L,-2,"__index");lua_setmetatable(L,-2);
    lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.GameService");lua_setmetatable(L,-2);lua_setglobal(L,"TheGameService");
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebAchievements");
    luaL_newmetatable(L,"dst.HapticsProxy");lua_newtable(L);
    for(const char* name:{"RegisterEffect","GetEffect","TuneEffect","Enable","EnableVibration","EnableAudio","EnableCategory","SetStrength","PauseEffects","UpdateDevice"}){
        lua_pushcfunction(L,no_haptic_device);lua_setfield(L,-2,name);
    }
    lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.HapticsProxy");lua_setmetatable(L,-2);lua_setglobal(L,"TheHaptics");
    lua_newtable(L);lua_pushboolean(L,false);lua_setfield(L,-2,"Supported");lua_setglobal(L,"WebHaptics");
}
}

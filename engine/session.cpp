#include "session.hpp"
#include "session_json.hpp"
#include <cmath>
#include <cstring>
#include <map>
#include <set>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_session {
namespace {
bool configured=false;
bool is_client=false;
std::map<std::string,std::string> strings;
std::map<std::string,bool> flags;
int max_players=0;
std::string default_mode;
void ready(lua_State* L){if(!configured)luaL_error(L,"Session parameters must be configured before network queries");}
int get_string(lua_State* L){ready(L);auto& value=strings.at(lua_tostring(L,lua_upvalueindex(1)));lua_pushlstring(L,value.data(),value.size());return 1;}
int get_flag(lua_State* L){ready(L);lua_pushboolean(L,flags.at(lua_tostring(L,lua_upvalueindex(1))));return 1;}
int get_max(lua_State* L){ready(L);lua_pushinteger(L,max_players);return 1;}
int get_user_id(lua_State* L){ready(L);lua_pushstring(L,strings.at("localUserId").c_str());return 1;}
int get_default_mode(lua_State* L){ready(L);lua_pushlstring(L,default_mode.data(),default_mode.size());return 1;}
int set_default_mode(lua_State* L){
    ready(L);std::string value=luaL_checkstring(L,2);
    // 0x1401e7df0: replace signed bytes < 32, trim, then canonicalize only
    // the three built-in names from 0x14026d3a0's table.
    for(char& byte:value)if(static_cast<unsigned char>(byte)>=128||byte<32)byte=' ';
    auto first=value.find_first_not_of(" \t\n\r");
    value=first==std::string::npos?"":value.substr(first,value.find_last_not_of(" \t\n\r")-first+1);
    std::string lower=value;for(char& byte:lower)if(byte>='A'&&byte<='Z')byte+='a'-'A';
    if(lower=="survival"||lower=="lavaarena"||lower=="quagmire")value=lower;
    default_mode=value;return 0;
}
int inspect(lua_State* L){
    lua_newtable(L);lua_pushboolean(L,configured);lua_setfield(L,-2,"configured");
    if(!configured)return 1;
    for(const auto& [key,value]:strings){lua_pushlstring(L,value.data(),value.size());lua_setfield(L,-2,key.c_str());}
    for(const auto& [key,value]:flags){lua_pushboolean(L,value);lua_setfield(L,-2,key.c_str());}
    lua_pushinteger(L,max_players);lua_setfield(L,-2,"maxPlayers");
    lua_pushinteger(L,1);lua_setfield(L,-2,"schemaVersion");return 1;
}
void closure(lua_State* L,const char* method,const char* key,lua_CFunction fn){lua_pushstring(L,key);lua_pushcclosure(L,fn,1);lua_setfield(L,-2,method);}
std::string configure_data(const std::string& json,const char* expected){
    using Value=web_session_json::Value;
    std::map<std::string,Value> fields;
    web_session_json::Parser parser(json);
    if(!parser.parse(fields))return "Invalid flat session JSON";
    const std::set<std::string> allowed={"gameBuild","engineVersion","schemaVersion","contentHash","gameMode","serverName","serverDescription","serverIntention","maxPlayers","pvp","friendsOnly","lanOnly","platformOnline","offlineCluster","serverDedicated","serverClientHosted","localUserId"};
    for(const auto& field:fields)if(!allowed.count(field.first))return "Unknown session parameter";
    std::map<std::string,std::string> next_strings;
    for(const auto& [name,limit]:std::map<std::string,size_t>{{"gameBuild",32},{"engineVersion",32},{"contentHash",64},{"gameMode",128},{"serverName",1024},{"serverDescription",4096},{"serverIntention",128},{"localUserId",36}}){
        auto found=fields.find(name);
        if(found==fields.end()||found->second.kind!=Value::String||found->second.text.size()>limit||found->second.text.find('\0')!=std::string::npos)return "Invalid session "+name;
        next_strings[name]=found->second.text;
    }
    if(next_strings["gameBuild"]!="756039"||next_strings["engineVersion"]!="0.1.0")return "Incompatible session build or engine version";
    const auto& hash=next_strings["contentHash"];
    if(hash.size()!=64||hash.find_first_not_of("0123456789abcdef")!=std::string::npos||hash!=expected)return "Incompatible session content hash";
    auto schema=fields.find("schemaVersion");
    if(schema==fields.end()||schema->second.kind!=Value::Number||schema->second.number!=1)return "Incompatible session schema version";
    const std::set<std::string> modes={"survival","endless","wilderness","lavaarena","quagmire"};
    if(!modes.count(next_strings["gameMode"]))return "Unsupported session gameMode";
    auto players=fields.find("maxPlayers");
    if(players==fields.end()||players->second.kind!=Value::Number)return "Invalid session maxPlayers";
    double count=players->second.number;
    if(count<1||count>6||std::floor(count)!=count)return "Session supports one to six players";
    std::map<std::string,bool> next_flags;
    for(const char* key:{"pvp","friendsOnly","lanOnly","platformOnline","offlineCluster","serverDedicated","serverClientHosted"}){
        auto found=fields.find(key);if(found==fields.end()||found->second.kind!=Value::Boolean)return std::string("Invalid session ")+key;
        next_flags[key]=found->second.flag;
    }
    if(next_flags["platformOnline"]||!next_flags["offlineCluster"]||next_flags["friendsOnly"])return "Native account/friends services are not implemented";
    if(!next_flags["serverDedicated"]||next_flags["serverClientHosted"])return "Session requires separate authoritative shard workers";
    const auto& identity=next_strings.at("localUserId");
    if(!identity.empty()&&(identity.size()!=36||identity.compare(0,4,"WEB_")!=0||identity.find_first_not_of("0123456789abcdef",4)!=std::string::npos))return "Invalid session localUserId";
    if(!is_client&&!identity.empty())return "Authoritative shard has no local player identity";
    strings=std::move(next_strings);flags=std::move(next_flags);max_players=static_cast<int>(count);default_mode=strings.at("gameMode");configured=true;return "";
}
}
int configure(lua_State* L){
    if(configured)return luaL_error(L,"Session parameters already configured; create a new engine instance");
    size_t length=0;const char* json=luaL_checklstring(L,1,&length);
    if(length>65536||std::memchr(json,0,length))return luaL_error(L,"Session JSON exceeds limits");
    const char* expected=luaL_checkstring(L,2);bool success;
    {
        const auto error=configure_data(std::string(json,length),expected);success=error.empty();
        if(!success)lua_pushlstring(L,error.data(),error.size());
    } // Destroy parser/validation allocations before Lua's longjmp error path.
    return success?0:lua_error(L);
}
void install(lua_State* L,bool client){
    is_client=client;configured=false;strings.clear();flags.clear();max_players=0;default_mode.clear();lua_getglobal(L,"TheNet");
    for(auto [method,key]:std::map<const char*,const char*>{{"GetServerGameMode","gameMode"},{"GetServerName","serverName"},{"GetServerDescription","serverDescription"},{"GetServerIntention","serverIntention"}})closure(L,method,key,get_string);
    for(auto [method,key]:std::map<const char*,const char*>{{"GetServerFriendsOnly","friendsOnly"},{"GetServerLANOnly","lanOnly"},{"GetServerPVP","pvp"},{"GetPVPEnabled","pvp"},{"IsOnlineMode","platformOnline"},{"IsDedicatedOfflineCluster","offlineCluster"},{"GetServerIsDedicated","serverDedicated"},{"GetServerIsClientHosted","serverClientHosted"}})closure(L,method,key,get_flag);
    lua_pushcfunction(L,get_max);lua_setfield(L,-2,"GetServerMaxPlayers");
    lua_pushcfunction(L,get_user_id);lua_setfield(L,-2,"GetUserID");
    lua_pushcfunction(L,get_default_mode);lua_setfield(L,-2,"GetDefaultGameMode");lua_pushcfunction(L,set_default_mode);lua_setfield(L,-2,"SetDefaultGameMode");
    // Native NetworkProxy is userdata with an __index method table. Preserve
    // the existing methods/fallback while replacing the temporary namespace.
    luaL_newmetatable(L,"dst.NetworkProxy");lua_pushvalue(L,-2);lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.NetworkProxy");lua_setmetatable(L,-2);lua_setglobal(L,"TheNet");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebSession");
}
}

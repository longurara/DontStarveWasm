#include "session.hpp"
#include "session_json.hpp"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <map>
#include <set>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
extern "C" {
#include "lauxlib.h"
}
namespace web_session {
namespace {
bool configured=false;
bool is_client=false;
bool server_started=false;
bool client_started=false;
std::map<std::string,std::string> strings;
std::map<std::string,bool> flags;
int max_players=0;
std::string default_mode;
std::string server_playstyle;
std::string server_tags;
std::string session_identifier;
std::string world_gen_data;
void ready(lua_State* L){if(!configured)luaL_error(L,"Session parameters must be configured before network queries");}
std::string persistent_root(){return is_client?"/persistent/client":"/persistent/master";}
bool valid_segment(const char* s,size_t len){
    if(!len||len>256||std::memchr(s,0,len))return false;
    std::string v(s,len);
    return v!="."&&v!=".."&&v.find('/')==std::string::npos&&v.find('\\')==std::string::npos&&v.find(':')==std::string::npos;
}
void ensure_dirs(const std::string& path){
    for(size_t i=1;i<=path.size();++i)if(i==path.size()||path[i]=='/')mkdir(path.substr(0,i).c_str(),0700);
}
bool latest_snapshot_in_dir(const std::string& session_dir,const std::string& sid,std::string& out){
    // Native 0x1402704a0 -> 0x14026f3d0: scan session/<sid>/ for highest
    // snapshot integer (> 0), ignoring .meta and .User files.
    DIR* dir=opendir(session_dir.c_str());
    if(!dir)return false;
    int max_num=0;
    while(struct dirent* ent=readdir(dir)){
        const char* name=ent->d_name;
        if(name[0]=='.'||std::strstr(name,".meta")||std::strstr(name,".User"))continue;
        int num=std::atoi(name);
        if(num>max_num)max_num=num;
    }
    closedir(dir);
    if(max_num<=0)return false;
    char formatted[16];
    std::snprintf(formatted,sizeof(formatted),"%010u",static_cast<unsigned int>(max_num));
    struct stat st{};
    if(stat((session_dir+"/"+formatted).c_str(),&st)!=0||!S_ISREG(st.st_mode))return false;
    out="session/"+sid+"/"+formatted;
    return true;
}
std::string trim_ascii_control(std::string value){
    for(char& byte:value)if(static_cast<unsigned char>(byte)>=128||byte<32)byte=' ';
    auto first=value.find_first_not_of(" \t\n\r");
    return first==std::string::npos?"":value.substr(first,value.find_last_not_of(" \t\n\r")-first+1);
}
int get_string(lua_State* L){ready(L);auto& value=strings.at(lua_tostring(L,lua_upvalueindex(1)));lua_pushlstring(L,value.data(),value.size());return 1;}
int get_flag(lua_State* L){ready(L);lua_pushboolean(L,flags.at(lua_tostring(L,lua_upvalueindex(1))));return 1;}
int get_max(lua_State* L){ready(L);lua_pushinteger(L,max_players);return 1;}
int get_user_id(lua_State* L){ready(L);lua_pushstring(L,strings.at("localUserId").c_str());return 1;}
int get_default_mode(lua_State* L){ready(L);lua_pushlstring(L,default_mode.data(),default_mode.size());return 1;}
int set_default_mode(lua_State* L){
    ready(L);
    // 0x1401e7df0: replace signed bytes < 32, trim, then canonicalize only
    // the three built-in names from 0x14026d3a0's table.
    std::string value=trim_ascii_control(luaL_checkstring(L,2));
    std::string lower=value;for(char& byte:lower)if(byte>='A'&&byte<='Z')byte+='a'-'A';
    if(lower=="survival"||lower=="lavaarena"||lower=="quagmire")value=lower;
    default_mode=value;return 0;
}
int get_is_server(lua_State* L){ready(L);lua_pushboolean(L,server_started?1:0);return 1;}
int get_is_client(lua_State* L){ready(L);lua_pushboolean(L,client_started?1:0);return 1;}
int get_is_hosting(lua_State* L){ready(L);lua_pushboolean(L,!is_client?1:0);return 1;}
int start_server(lua_State* L){
    ready(L);
    // 0x140237f70 -> 0x14023803e: luaL_optboolean(L, 2, true)
    bool start_in_online_mode=lua_isnoneornil(L,2)?true:(lua_toboolean(L,2)!=0);
    if(is_client||start_in_online_mode)return luaL_error(L,"UNIMPLEMENTED_NATIVE: NetworkProxy.StartServer");
    server_started=true;
    lua_pushboolean(L,1);return 1;
}
int get_empty_string(lua_State* L){ready(L);lua_pushliteral(L,"");return 1;}
int get_false(lua_State* L){ready(L);lua_pushboolean(L,0);return 1;}
int get_true(lua_State* L){ready(L);lua_pushboolean(L,1);return 1;}
int get_session_identifier(lua_State* L){ready(L);lua_pushlstring(L,session_identifier.data(),session_identifier.size());return 1;}
int begin_session(lua_State* L){
    // Native 0x14023a5b0 -> 0x1401f4810
    ready(L);size_t len=0;const char* sid=luaL_checklstring(L,2,&len);
    if(!valid_segment(sid,len))return luaL_error(L,"Invalid session identifier");
    session_identifier.assign(sid,len);
    ensure_dirs(persistent_root()+"/session/"+session_identifier);
    return 0;
}
int delete_session(lua_State* L){
    // Native 0x14023a5e0 -> 0x1401eb2b0
    ready(L);size_t len=0;const char* sid=luaL_checklstring(L,2,&len);
    std::string id(sid,len);
    if(session_identifier==id)session_identifier.clear();
    if(valid_segment(sid,len)){
        std::string dir_path=persistent_root()+"/session/"+id;
        if(DIR* dir=opendir(dir_path.c_str())){
            while(struct dirent* ent=readdir(dir)){
                if(ent->d_name[0]=='.')continue;
                std::remove((dir_path+"/"+ent->d_name).c_str());
            }
            closedir(dir);
            rmdir(dir_path.c_str());
        }
    }
    return 0;
}
int get_world_session_file(lua_State* L){
    // Native 0x14023a640 -> 0x1402704a0
    ready(L);size_t len=0;const char* sid=luaL_checklstring(L,2,&len);
    if(!valid_segment(sid,len))return 0;
    std::string id(sid,len),out;
    if(!latest_snapshot_in_dir(persistent_root()+"/session/"+id,id,out))return 0;
    lua_pushlstring(L,out.data(),out.size());return 1;
}
int get_world_session_file_in_cluster_slot(lua_State* L){
    // Native 0x14023a760
    ready(L);int slot=static_cast<int>(luaL_checkinteger(L,2));
    size_t sh_len=0,sid_len=0;
    const char* shard=luaL_checklstring(L,3,&sh_len);
    const char* sid=luaL_checklstring(L,4,&sid_len);
    if(slot<0||slot>9999||!valid_segment(shard,sh_len)||!valid_segment(sid,sid_len))return 0;
    std::string id(sid,sid_len),out;
    std::string dir=persistent_root()+"/Cluster_"+std::to_string(slot)+"/"+std::string(shard,sh_len)+"/session/"+id;
    if(!latest_snapshot_in_dir(dir,id,out))return 0;
    lua_pushlstring(L,out.data(),out.size());return 1;
}
int get_server_playstyle(lua_State* L){ready(L);lua_pushlstring(L,server_playstyle.data(),server_playstyle.size());return 1;}
int set_server_playstyle(lua_State* L){ready(L);server_playstyle=trim_ascii_control(luaL_checkstring(L,2));return 0;}
int set_server_tags(lua_State* L){
    ready(L);std::string v=luaL_checkstring(L,2);
    if(v.size()>1024){auto pos=v.rfind(',',1024);v=pos==std::string::npos?v.substr(0,1024):v.substr(0,pos);}
    server_tags=std::move(v);return 0;
}
int set_world_gen_data(lua_State* L){
    ready(L);size_t len=0;const char* s=luaL_checklstring(L,2,&len);
    world_gen_data.assign(s,len>5120?5120:len);return 0;
}
int notify_loading_state(lua_State* L){ready(L);(void)luaL_checkinteger(L,2);(void)luaL_optstring(L,3,"");return 0;}
int net_noop(lua_State* L){ready(L);return 0;}
int shard_false(lua_State* L){lua_pushboolean(L,0);return 1;}
int shard_get_id(lua_State* L){lua_pushliteral(L,"0");return 1;}
int shard_set_secondary_loading(lua_State* L){luaL_checktype(L,2,LUA_TBOOLEAN);return 0;}
int shard_is_migrating(lua_State*){return 0;}
int shard_start_migration(lua_State* L){lua_pushboolean(L,0);return 1;}
int shard_get_secondary_player_counts(lua_State* L){(void)luaL_checknumber(L,2);lua_pushinteger(L,0);lua_pushinteger(L,0);return 2;}
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
    strings=std::move(next_strings);flags=std::move(next_flags);max_players=static_cast<int>(count);default_mode=strings.at("gameMode");
    server_started=false;client_started=false;server_playstyle.clear();server_tags.clear();session_identifier.clear();world_gen_data.clear();
    configured=true;return "";
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
    is_client=client;configured=false;server_started=false;client_started=false;
    strings.clear();flags.clear();max_players=0;default_mode.clear();server_playstyle.clear();server_tags.clear();session_identifier.clear();world_gen_data.clear();
    lua_getglobal(L,"TheNet");
    for(auto [method,key]:std::map<const char*,const char*>{
        {"GetServerGameMode","gameMode"},{"GetServerName","serverName"},{"GetServerDescription","serverDescription"},{"GetServerIntention","serverIntention"},
        {"GetDefaultServerName","serverName"},{"GetDefaultServerDescription","serverDescription"},{"GetDefaultServerIntention","serverIntention"}
    })closure(L,method,key,get_string);
    for(auto [method,key]:std::map<const char*,const char*>{
        {"GetServerFriendsOnly","friendsOnly"},{"GetServerLANOnly","lanOnly"},{"GetServerPVP","pvp"},{"GetPVPEnabled","pvp"},
        {"IsOnlineMode","platformOnline"},{"IsDedicatedOfflineCluster","offlineCluster"},{"GetServerIsDedicated","serverDedicated"},{"GetServerIsClientHosted","serverClientHosted"},
        {"GetDefaultPvpSetting","pvp"},{"GetDefaultFriendsOnlyServer","friendsOnly"},{"GetDefaultLANOnlyServer","lanOnly"}
    })closure(L,method,key,get_flag);
    for(auto [method,fn]:std::map<const char*,lua_CFunction>{
        {"GetServerMaxPlayers",get_max},{"GetDefaultMaxPlayers",get_max},
        {"GetUserID",get_user_id},
        {"GetDefaultGameMode",get_default_mode},{"SetDefaultGameMode",set_default_mode},
        {"GetIsServer",get_is_server},{"GetIsMasterSimulation",get_is_server},
        {"GetIsClient",get_is_client},{"GetIsHosting",get_is_hosting},
        {"StartServer",start_server},
        {"GetDefaultServerPassword",get_empty_string},{"GetDefaultClanID",get_empty_string},
        {"GetDefaultClanOnly",get_false},{"GetDefaultClanAdmins",get_false},{"GetDefaultVoteEnabled",get_false},
        {"GetDefaultEncodeUserPath",get_true},{"TryDefaultEncodeUserPath",get_true},
        {"GetSessionIdentifier",get_session_identifier},
        {"BeginSession",begin_session},{"DeleteSession",delete_session},
        {"GetWorldSessionFile",get_world_session_file},{"GetWorldSessionFileInClusterSlot",get_world_session_file_in_cluster_slot},
        {"GetServerPlaystyle",get_server_playstyle},{"SetServerPlaystyle",set_server_playstyle},
        {"SetServerTags",set_server_tags},{"SetWorldGenData",set_world_gen_data},{"NotifyLoadingState",notify_loading_state},
        {"DoneLoadingMap",net_noop},{"IncrementSnapshot",net_noop},{"TruncateSnapshots",net_noop},{"CleanupSessionCache",net_noop}
    }){lua_pushcfunction(L,fn);lua_setfield(L,-2,method);}
    // Native NetworkProxy is userdata with an __index method table. Preserve
    // the existing methods/fallback while replacing the temporary namespace.
    luaL_newmetatable(L,"dst.NetworkProxy");lua_pushvalue(L,-2);lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.NetworkProxy");lua_setmetatable(L,-2);lua_setglobal(L,"TheNet");lua_pop(L,1);
    lua_getglobal(L,"TheShard");
    for(auto [method,fn]:std::map<const char*,lua_CFunction>{
        {"IsMaster",shard_false},{"IsSecondary",shard_false},{"IsPlayer",shard_false},
        {"GetShardId",shard_get_id},{"GetDefaultShardEnabled",shard_false},
        {"SetSecondaryLoading",shard_set_secondary_loading},{"IsMigrating",shard_is_migrating},
        {"StartMigration",shard_start_migration},{"GetSecondaryShardPlayerCounts",shard_get_secondary_player_counts}
    }){lua_pushcfunction(L,fn);lua_setfield(L,-2,method);}
    luaL_newmetatable(L,"dst.ShardNetworkProxy");lua_pushvalue(L,-2);lua_setfield(L,-2,"__index");lua_pop(L,1);
    lua_newuserdata(L,1);luaL_getmetatable(L,"dst.ShardNetworkProxy");lua_setmetatable(L,-2);lua_setglobal(L,"TheShard");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebSession");
}
}

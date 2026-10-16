#include "account_manager.hpp"
#include <cmath>
#include <map>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_account_manager {
namespace {
constexpr size_t kBudget=64;
constexpr uint32_t kTypeId=0x49b209a0u;

struct AccountState {
    std::string username;
    std::string auth_token;
    std::string token_purpose;
    std::string steam_ticket;
    std::string banned_reason;
    std::string last_visited_page;
    bool is_banned=false;
    bool waiting_for_response=false;
    bool must_upgrade_client=false;
    bool communication_succeeded=false;
};

web_components::EntityHost host{};
AccountState state{};
std::map<uint32_t,bool> instances;

uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.AccountManager"));}

void check_owner(lua_State* L){
    auto id=owner(L);
    if(!host.alive(id)||!instances.count(id))luaL_error(L,"AccountManager owner is removed");
}

int add(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add AccountManager to a removed entity");
    if(!instances.count(id)){
        if(instances.size()>=kBudget)return luaL_error(L,"AccountManager count exceeds budget");
        instances.emplace(id,true);
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.AccountManager");
    lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"AccountManager");}
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int tostring_am(lua_State* L){owner(L);lua_pushfstring(L,"AccountManager (%p)",lua_touserdata(L,1));return 1;}

// Native 0x140059de0
int login(lua_State* L){
    check_owner(L);
    const char* purpose=luaL_checkstring(L,2);
    state.token_purpose=purpose;
    state.waiting_for_response=false;
    lua_pushliteral(L,"");
    return 1;
}

// Native 0x140059e80
int logout(lua_State* L){
    check_owner(L);
    state.auth_token.clear();
    state.token_purpose.clear();
    state.waiting_for_response=false;
    return 0;
}

// Native 0x140059fa0
int create_account(lua_State* L){
    check_owner(L);
    (void)luaL_checkstring(L,2);
    (void)luaL_checkstring(L,3);
    (void)luaL_checkstring(L,4);
    lua_pushliteral(L,"");
    return 1;
}

// Native 0x140059c30
int add_game_key(lua_State* L){
    check_owner(L);
    (void)luaL_checkstring(L,2);
    (void)luaL_checkstring(L,3);
    lua_pushnil(L);
    return 1;
}

// Native 0x14005a0b0
int recover_password(lua_State* L){
    check_owner(L);
    (void)luaL_checkstring(L,2);
    (void)luaL_checkstring(L,3);
    lua_pushliteral(L,"");
    return 1;
}

// Native 0x1403dde80
int noop_zero(lua_State* L){
    check_owner(L);
    return 0;
}

// Native 0x14005a180
int get_username(lua_State* L){
    check_owner(L);
    lua_pushlstring(L,state.username.data(),state.username.size());
    return 1;
}

// Native 0x140059f00
int token_purpose(lua_State* L){
    check_owner(L);
    const char* arg=luaL_optstring(L,2,nullptr);
    if(arg)state.token_purpose=arg;
    lua_pushlstring(L,state.token_purpose.data(),state.token_purpose.size());
    return 1;
}

// Native 0x14005a1f0
int visit_account_page(lua_State* L){
    check_owner(L);
    const char* page=luaL_optstring(L,2,"");
    state.last_visited_page=page;
    return 0;
}

// Native 0x14005a370
int has_auth_token(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,!state.auth_token.empty()?1:0);
    return 1;
}

// Native 0x14005a3a0
int is_waiting_for_response(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.waiting_for_response?1:0);
    return 1;
}

// Native 0x14005a3e0
int must_upgrade_client(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.must_upgrade_client?1:0);
    return 1;
}

// Native 0x14005a420: pushes (bool is_banned, string banned_reason) -> return 2
int is_banned(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.is_banned?1:0);
    if(state.is_banned){
        lua_pushlstring(L,state.banned_reason.data(),state.banned_reason.size());
    }else{
        lua_pushliteral(L,"");
    }
    return 2;
}

// Native 0x14005a4f0
int communication_succeeded(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,state.communication_succeeded?1:0);
    return 1;
}

// Native 0x14005a530
int has_steam_ticket(lua_State* L){
    check_owner(L);
    lua_pushboolean(L,!state.steam_ticket.empty()?1:0);
    return 1;
}

// Native 0x14005a590
int cancel_login(lua_State* L){
    check_owner(L);
    bool was_waiting=state.waiting_for_response;
    state.waiting_for_response=false;
    lua_pushboolean(L,was_waiting?1:0);
    return 1;
}

int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);
        lua_pushnumber(L,instances.size());lua_setfield(L,-2,"count");
        lua_pushnumber(L,kBudget);lua_setfield(L,-2,"budget");
        lua_pushnumber(L,kTypeId);lua_setfield(L,-2,"typeId");
        lua_pushboolean(L,!state.auth_token.empty()?1:0);lua_setfield(L,-2,"hasAuthToken");
        lua_pushboolean(L,state.is_banned?1:0);lua_setfield(L,-2,"isBanned");
        return 1;
    }
    double raw=luaL_checknumber(L,1);
    if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto id=static_cast<uint32_t>(raw);
    if(!instances.count(id)){lua_pushnil(L);return 1;}
    lua_newtable(L);
    lua_pushliteral(L,"AccountManager");lua_setfield(L,-2,"kind");
    lua_pushnumber(L,id);lua_setfield(L,-2,"owner");
    lua_pushnumber(L,kTypeId);lua_setfield(L,-2,"typeId");
    lua_pushlstring(L,state.username.data(),state.username.size());lua_setfield(L,-2,"username");
    lua_pushlstring(L,state.token_purpose.data(),state.token_purpose.size());lua_setfield(L,-2,"tokenPurpose");
    lua_pushlstring(L,state.last_visited_page.data(),state.last_visited_page.size());lua_setfield(L,-2,"lastVisitedPage");
    lua_pushboolean(L,!state.auth_token.empty()?1:0);lua_setfield(L,-2,"hasAuthToken");
    lua_pushboolean(L,state.is_banned?1:0);lua_setfield(L,-2,"isBanned");
    return 1;
}
}

void retire(uint32_t id){instances.erase(id);}
void clear(){instances.clear();state=AccountState{};}

void install(lua_State* L,web_components::EntityHost callbacks){
    clear();
    host=callbacks;
    luaL_newmetatable(L,"dst.AccountManager");
    lua_newtable(L);
    const luaL_Reg methods[]={
        {"Login",login},
        {"Logout",logout},
        {"CreateAccount",create_account},
        {"AddGameKeyToAccount",add_game_key},
        {"RecoverPassword",recover_password},
        {"ValidateToken",noop_zero},
        {"GetToken",noop_zero},
        {"GetUsername",get_username},
        {"TokenPurpose",token_purpose},
        {"VisitAccountPage",visit_account_page},
        {"HasAuthToken",has_auth_token},
        {"IsWaitingForResponse",is_waiting_for_response},
        {"MustUpgradeClient",must_upgrade_client},
        {"IsBanned",is_banned},
        {"CommunicationSucceeded",communication_succeeded},
        {"HasSteamTicket",has_steam_ticket},
        {"CancelLogin",cancel_login},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,methods);
    lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_am);
    lua_setfield(L,-2,"__tostring");
    lua_pop(L,1);

    lua_getglobal(L,"Entity");
    lua_pushcfunction(L,add);
    lua_setfield(L,-2,"AddAccountManager");
    lua_pop(L,1);

    lua_newtable(L);
    lua_pushcfunction(L,inspect);
    lua_setfield(L,-2,"Inspect");
    lua_setglobal(L,"WebAccountManager");
}
}

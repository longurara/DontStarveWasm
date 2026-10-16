#include "prefabs.hpp"
#include "animation_asset.hpp"
#include "file_asset.hpp"
#include "atlas_asset.hpp"
#include "shader_asset.hpp"
#include "texture_asset.hpp"
#include "font_asset.hpp"
#include <map>
#include <set>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_prefabs {
namespace {
struct Asset {std::string type,file,text;uint32_t kind=0;float native_param=0;int param_type=LUA_TNIL;double number=0;bool boolean=false;};
struct Prefab {std::vector<Asset> assets,ignored_assets;std::vector<std::string> dependencies;};
struct Kind {const char* name;uint32_t value;};
constexpr Kind kinds[]={{"IMAGE",6},{"ANIM",1},{"DYNAMIC_ANIM",2},{"ATLAS_BUILD",3},{"SOUND",4},{"SOUNDPACKAGE",5},{"FILE",7},{"SHADER",8},{"FONT",9},{"PKGREF",10},{"ATLAS",11},{"DYNAMIC_ATLAS",12}};
uint32_t asset_kind(const std::string& type){
    for(const auto& kind:kinds){size_t i=0;for(;i<type.size()&&kind.name[i];++i){unsigned char c=type[i];if(c>='a'&&c<='z')c-='a'-'A';if(c!=kind.name[i])break;}
        if(i==type.size()&&!kind.name[i])return kind.value;}return 0;
}
std::map<std::string,Prefab> definitions;
std::set<std::string> verification_queue;
std::map<std::string,uint32_t> loaded;
bool client_role=false;
Exists resource_exists=nullptr;
std::string string(lua_State* L,int index){size_t size=0;const char* value=luaL_checklstring(L,index,&size);if(size>4096)luaL_error(L,"Prefab string exceeds 4096 bytes");return std::string(value);}
std::string field(lua_State* L,const char* name){lua_getfield(L,-1,name);auto value=string(L,-1);lua_pop(L,1);return value;}
int register_prefab(lua_State* L){
    auto name=string(L,2);
    // Build 756039 RegisterPrefab returns before reading replacement assets
    // when a definition already exists (server 0x1401235e4).
    if(definitions.count(name))return 0;
    luaL_checktype(L,3,LUA_TTABLE);luaL_checktype(L,4,LUA_TTABLE);
    if(definitions.size()>=50000||lua_objlen(L,3)>50000||lua_objlen(L,4)>50000)return luaL_error(L,"Prefab registration exceeds limits");
    Prefab value;
    for(size_t i=1;i<=lua_objlen(L,3);++i){
        lua_rawgeti(L,3,i);luaL_checktype(L,-1,LUA_TTABLE);Asset asset;
        asset.type=field(L,"type");asset.file=field(L,"file");
        asset.kind=asset_kind(asset.type);
        // Native 0x1400fcec0 / client 0x140108f10 only append the fixed
        // twelve kinds. MINIMAP_IMAGE is Lua metadata, not a thirteenth kind.
        if(!asset.kind){value.ignored_assets.push_back(std::move(asset));lua_pop(L,1);continue;}
        for(const auto& kind:kinds)if(kind.value==asset.kind){asset.type=kind.name;break;}
        lua_getfield(L,-1,"param");asset.param_type=lua_type(L,-1);asset.native_param=static_cast<float>(lua_tonumber(L,-1));
        switch(asset.param_type){
            case LUA_TNIL:break;
            case LUA_TSTRING:asset.text=string(L,-1);break;
            case LUA_TNUMBER:asset.number=lua_tonumber(L,-1);break;
            case LUA_TBOOLEAN:asset.boolean=lua_toboolean(L,-1);break;
            default:asset.param_type=LUA_TNIL;break; // lua_tonumber yields zero for non-numeric values.
        }
        lua_pop(L,2);value.assets.push_back(std::move(asset));
    }
    for(size_t i=1;i<=lua_objlen(L,4);++i){lua_rawgeti(L,4,i);value.dependencies.push_back(string(L,-1));lua_pop(L,1);}
    definitions[name]=std::move(value);return 0;
}
int add_verify(lua_State* L){
    auto path=string(L,2);if(verification_queue.size()>=50000)return luaL_error(L,"Prefab asset verification exceeds limits");
    verification_queue.insert(path);return 0;
}
int verify(lua_State* L){
    lua_newtable(L);lua_pushnumber(L,verification_queue.size());lua_setfield(L,-2,"checkedFiles");lua_newtable(L);int i=0;
    for(const auto& path:verification_queue)if(!resource_exists(path)){lua_pushlstring(L,path.data(),path.size());lua_rawseti(L,-2,++i);}
    lua_setfield(L,-2,"missing");return 1;
}
bool ignored(const Asset& asset){
    // Hash-verified dispatch tables: server 0x1400fcbd0, client 0x140108c14.
    // Package references remain in definitions for on-demand lookup; loading
    // a prefab does not eagerly open all referenced packages.
    return asset.type=="PKGREF"||asset.type=="SOUND"||
        (!client_role&&asset.type=="IMAGE")|| // Null renderer Load returns -1 without I/O (0x140385190).
        (!client_role&&(asset.type=="SOUNDPACKAGE"||asset.type=="ATLAS_BUILD"))||
        (asset.type=="FILE"&&asset.file.find(".fsb")!=std::string::npos);
}
bool plan(const std::string& name,std::map<std::string,uint32_t>& delta,std::vector<std::string>& order,std::string& error){
    auto found=definitions.find(name);if(found==definitions.end()){error="Unknown prefab: "+name;return false;}
    if(loaded[name]+(++delta[name])>1)return true;
    order.push_back(name);
    for(const auto& dep:found->second.dependencies)if(!plan(dep,delta,order,error))return false;
    return true;
}
std::string load(const std::vector<std::string>& names){
    std::map<std::string,uint32_t> delta;std::vector<std::string> order;std::string error;
    for(const auto& name:names)if(!plan(name,delta,order,error))return error;
    // Reject unsupported formats before changing ownership or downloading a
    // partial prefab. A decoded CPU bundle is not a ready client renderer.
    for(const auto& name:order)for(const auto& asset:definitions.at(name).assets){
        if(ignored(asset))continue;
        if(asset.type!="ANIM"&&asset.type!="DYNAMIC_ANIM"&&asset.type!="FILE"&&asset.type!="ATLAS"&&asset.type!="DYNAMIC_ATLAS"&&asset.type!="IMAGE"&&asset.type!="SHADER"&&asset.type!="FONT")return "UNIMPLEMENTED_NATIVE: prefab asset "+asset.type+" ("+asset.file+")";
        if((asset.type=="ANIM"||asset.type=="DYNAMIC_ANIM")&&client_role)return "UNIMPLEMENTED_NATIVE: client animation resource upload ("+asset.file+")";
        if(asset.type=="IMAGE"&&client_role&&!web_texture_asset::backend_ready())return "UNIMPLEMENTED_NATIVE: client texture backend ("+asset.file+")";
        if(asset.type=="SHADER"&&client_role&&!web_shader_asset::backend_ready())return "UNIMPLEMENTED_NATIVE: client shader backend ("+asset.file+")";
        if(asset.type=="FONT"&&client_role&&!web_texture_asset::backend_ready())return "UNIMPLEMENTED_NATIVE: client font texture backend ("+asset.file+")";
    }
    std::vector<const Asset*> acquired;
    for(const auto& name:order)for(const auto& asset:definitions.at(name).assets){
        if(ignored(asset))continue;
        bool ok=asset.type=="FILE"?web_file_asset::acquire(asset.file,error):(asset.type=="ATLAS"||asset.type=="DYNAMIC_ATLAS")?web_atlas_asset::acquire(asset.file,asset.type=="DYNAMIC_ATLAS",error):
            asset.type=="IMAGE"?web_texture_asset::acquire(asset.file,error):
            asset.type=="FONT"?web_font_asset::acquire(asset.file,error):
            asset.type=="SHADER"?web_shader_asset::acquire(asset.file,asset.native_param==1.f,error):web_animation_asset::acquire(asset.file,error,asset.type=="DYNAMIC_ANIM");
        if(!ok){
            for(const auto* previous:acquired){
                if(previous->type=="FILE")web_file_asset::release(previous->file);
                else if(previous->type=="ATLAS"||previous->type=="DYNAMIC_ATLAS")web_atlas_asset::release(previous->file);
                else if(previous->type=="IMAGE")web_texture_asset::release(previous->file);
                else if(previous->type=="SHADER")web_shader_asset::release(previous->file);
                else if(previous->type=="FONT")web_font_asset::release(previous->file);
                else web_animation_asset::release(previous->file);
            }
            return error;
        }
        acquired.push_back(&asset);
    }
    for(const auto& value:delta)loaded[value.first]+=value.second;return "";
}
int load_prefabs(lua_State* L){
    int table=lua_gettop(L);luaL_checktype(L,table,LUA_TTABLE);bool ok;
    {
        std::vector<std::string> names;lua_pushnil(L);
        // Native iterates table values, not just the consecutive array part.
        while(lua_next(L,table)){if(lua_type(L,-1)==LUA_TSTRING)names.push_back(string(L,-1));lua_pop(L,1);}
        const auto error=load(names);ok=error.empty();if(!ok)lua_pushlstring(L,error.data(),error.size());
    }
    return ok?0:lua_error(L);
}
void unload(const std::string& name){
    auto found=loaded.find(name);if(found==loaded.end()||!found->second)return;
    if(--found->second)return;
    const auto& prefab=definitions.at(name);
    for(const auto& asset:prefab.assets)if(!ignored(asset)){
        if(asset.type=="ANIM"||asset.type=="DYNAMIC_ANIM")web_animation_asset::release(asset.file);
        else if(asset.type=="FILE")web_file_asset::release(asset.file);
        else if(asset.type=="ATLAS"||asset.type=="DYNAMIC_ATLAS")web_atlas_asset::release(asset.file);
        else if(asset.type=="IMAGE")web_texture_asset::release(asset.file);
        else if(asset.type=="SHADER")web_shader_asset::release(asset.file);
        else if(asset.type=="FONT")web_font_asset::release(asset.file);
    }
    for(const auto& dep:prefab.dependencies)unload(dep);
}
int unload_prefabs(lua_State* L){
    int table=lua_gettop(L);luaL_checktype(L,table,LUA_TTABLE);lua_pushnil(L);
    while(lua_next(L,table)){if(lua_type(L,-1)==LUA_TSTRING)unload(string(L,-1));lua_pop(L,1);}return 0;
}
bool ends_with_global(const std::string& name){
    return name.size()>=6&&name.compare(name.size()-6,6,"global")==0;
}
int unregister_all_prefabs(lua_State*){
    // Native 0x14000beb0: unload and erase all registered prefabs except those
    // whose name ends with "global".
    std::vector<std::string> remove_names;
    for(const auto& kv:definitions)if(!ends_with_global(kv.first))remove_names.push_back(kv.first);
    for(const auto& name:remove_names){
        while(loaded[name]>0)unload(name);
        loaded.erase(name);
        definitions.erase(name);
    }
    return 0;
}
int start_file_exists_async(lua_State*){return 0;}
int loaded_info(lua_State* L){
    lua_newtable(L);for(const auto& value:loaded)if(value.second){lua_pushnumber(L,value.second);lua_setfield(L,-2,value.first.c_str());}return 1;
}
int kind_info(lua_State* L){lua_newtable(L);int i=0;for(const auto& kind:kinds){lua_newtable(L);lua_pushstring(L,kind.name);lua_setfield(L,-2,"name");lua_pushnumber(L,kind.value);lua_setfield(L,-2,"kind");lua_rawseti(L,-2,++i);}return 1;}
int native_assets(lua_State* L){
    auto found=definitions.find(string(L,1));if(found==definitions.end()){lua_pushnil(L);return 1;}lua_newtable(L);int i=0;
    for(const auto& asset:found->second.assets){lua_newtable(L);lua_pushnumber(L,asset.kind);lua_setfield(L,-2,"kind");lua_pushlstring(L,asset.file.data(),asset.file.size());lua_setfield(L,-2,"file");lua_pushnumber(L,asset.native_param);lua_setfield(L,-2,"param");lua_rawseti(L,-2,++i);}return 1;
}
int ignored_assets(lua_State* L){
    auto found=definitions.find(string(L,1));if(found==definitions.end()){lua_pushnil(L);return 1;}lua_newtable(L);int i=0;
    for(const auto& asset:found->second.ignored_assets){lua_newtable(L);lua_pushlstring(L,asset.type.data(),asset.type.size());lua_setfield(L,-2,"type");lua_pushlstring(L,asset.file.data(),asset.file.size());lua_setfield(L,-2,"file");lua_pushliteral(L,"unrecognized native asset kind");lua_setfield(L,-2,"reason");lua_rawseti(L,-2,++i);}return 1;
}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);lua_pushnumber(L,definitions.size());lua_setfield(L,-2,"registered");
        lua_pushnumber(L,verification_queue.size());lua_setfield(L,-2,"queuedFiles");return 1;
    }
    auto found=definitions.find(string(L,1));if(found==definitions.end()){lua_pushnil(L);return 1;}
    lua_newtable(L);lua_newtable(L);int i=0;
    for(const auto& asset:found->second.assets){
        lua_newtable(L);lua_pushlstring(L,asset.type.data(),asset.type.size());lua_setfield(L,-2,"type");
        lua_pushlstring(L,asset.file.data(),asset.file.size());lua_setfield(L,-2,"file");
        switch(asset.param_type){
            case LUA_TSTRING:lua_pushlstring(L,asset.text.data(),asset.text.size());break;
            case LUA_TNUMBER:lua_pushnumber(L,asset.number);break;
            case LUA_TBOOLEAN:lua_pushboolean(L,asset.boolean);break;
            default:lua_pushnil(L);break;
        }
        lua_setfield(L,-2,"param");lua_rawseti(L,-2,++i);
    }
    lua_setfield(L,-2,"assets");lua_newtable(L);i=0;
    for(const auto& dep:found->second.dependencies){lua_pushlstring(L,dep.data(),dep.size());lua_rawseti(L,-2,++i);}
    lua_setfield(L,-2,"deps");return 1;
}
}
void install(lua_State* L,Exists exists,bool client){
    definitions.clear();verification_queue.clear();loaded.clear();resource_exists=exists;client_role=client;
    lua_getglobal(L,"TheSim");lua_pushcfunction(L,register_prefab);lua_setfield(L,-2,"RegisterPrefab");
    lua_pushcfunction(L,unregister_all_prefabs);lua_setfield(L,-2,"UnregisterAllPrefabs");
    lua_pushcfunction(L,add_verify);lua_setfield(L,-2,"AddBatchVerifyFileExists");
    lua_pushcfunction(L,start_file_exists_async);lua_setfield(L,-2,"StartFileExistsAsync");
    lua_pushcfunction(L,load_prefabs);lua_setfield(L,-2,"LoadPrefabs");lua_pushcfunction(L,unload_prefabs);lua_setfield(L,-2,"UnloadPrefabs");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_pushcfunction(L,verify);lua_setfield(L,-2,"VerifyBatch");lua_setglobal(L,"WebPrefabs");
    lua_getglobal(L,"WebPrefabs");lua_pushcfunction(L,loaded_info);lua_setfield(L,-2,"Loaded");
    lua_pushcfunction(L,kind_info);lua_setfield(L,-2,"Kinds");lua_pushcfunction(L,native_assets);lua_setfield(L,-2,"NativeAssets");lua_pushcfunction(L,ignored_assets);lua_setfield(L,-2,"IgnoredAssets");lua_pop(L,1);
}
}

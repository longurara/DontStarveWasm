#include "components.hpp"
#include "road_manager.hpp"
#include "envelope_manager.hpp"
#include "postprocessor.hpp"
#include "font_manager.hpp"
#include "map_layers.hpp"
#include "ui_transform.hpp"
#include "text_widget.hpp"
#include "image_widget.hpp"
#include "sound_emitter.hpp"
#include "graphics_options.hpp"
#include <cmath>
#include <map>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_components {
namespace {
struct Shadow {std::string requested_texture;};
EntityHost host{};bool client_role=false;
std::map<uint32_t,Shadow> shadows;
constexpr uint32_t shadow_type=0x4a610c8d;
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.ShadowManager"));}
Shadow& shadow(lua_State* L){auto id=owner(L);auto found=shadows.find(id);
    if(!host.alive(id)||found==shadows.end())luaL_error(L,"ShadowManager owner is removed");return found->second;
}
int add_shadow(lua_State* L){
    uint32_t id=host.id(L,1);
    // Native's factory can dereference a retired entity proxy and terminate
    // the process. The browser adapter reports a Lua error before mutation.
    if(!host.alive(id))return luaL_error(L,"Cannot add ShadowManager to a removed entity");
    if(client_role)return luaL_error(L,"UNIMPLEMENTED_NATIVE: client ShadowManager renderer");
    if(!shadows.count(id)){
        if(shadows.size()>=50000)return luaL_error(L,"ShadowManager count exceeds budget");
        shadows.emplace(id,Shadow{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.ShadowManager");lua_setmetatable(L,-2);
    // Native attaches the most recent wrapper to the Lua entity table;
    // each call returns a distinct wrapper over the same component.
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"ShadowManager");}lua_pop(L,1);}
    lua_pop(L,1);return 1;
}
int set_texture(lua_State* L){auto& value=shadow(L);const char* path=luaL_checkstring(L,2);
    // Dedicated IMAGE assets do not enter a texture cache; native 0x140083e70
    // only looks up the existing cache and leaves handle -1. No fetch/lease.
    value.requested_texture=path;return 0;
}
int generate_static(lua_State* L){shadow(L);return luaL_error(L,"UNIMPLEMENTED_NATIVE: ShadowManager.GenerateStaticShadows (static geometry backend)");}
int tostring_shadow(lua_State* L){owner(L);lua_pushfstring(L,"ShadowManager (%p)",lua_touserdata(L,1));return 1;}
void number(lua_State* L,const char* name,double value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);number(L,"shadowManagers",shadows.size());number(L,"budget",50000);lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");return 1;}
    double raw=luaL_checknumber(L,1);if(!std::isfinite(raw)||raw<0||raw>4294967295.0||std::trunc(raw)!=raw){lua_pushnil(L);return 1;}
    auto id=static_cast<uint32_t>(raw);auto found=shadows.find(id);if(found==shadows.end()){lua_pushnil(L);return 1;}
    lua_newtable(L);lua_pushliteral(L,"ShadowManager");lua_setfield(L,-2,"kind");number(L,"owner",id);number(L,"typeId",shadow_type);
    number(L,"textureHandle",-1);number(L,"staticHandle",-1);lua_pushlstring(L,found->second.requested_texture.data(),found->second.requested_texture.size());lua_setfield(L,-2,"requestedTexture");lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");return 1;
}
}
void retire(uint32_t id){shadows.erase(id);web_roads::retire(id);web_envelopes::retire(id);web_postprocessor::retire(id);web_font_manager::retire(id);web_map_layers::retire(id);web_ui::retire(id);web_text_widget::retire(id);web_image_widget::retire(id);web_sound_emitter::retire(id);web_graphics_options::retire(id);}
void clear(){shadows.clear();web_roads::clear();web_envelopes::clear();web_postprocessor::clear();web_font_manager::clear();web_map_layers::clear();web_ui::clear();web_text_widget::clear();web_image_widget::clear();web_sound_emitter::clear();web_graphics_options::clear();}
void install(lua_State* L,EntityHost callbacks,bool client){clear();host=callbacks;client_role=client;
    luaL_newmetatable(L,"dst.ShadowManager");lua_newtable(L);const luaL_Reg methods[]={{"SetTexture",set_texture},{"GenerateStaticShadows",generate_static},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setfield(L,-2,"__index");lua_pushcfunction(L,tostring_shadow);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add_shadow);lua_setfield(L,-2,"AddShadowManager");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebComponents");
    web_roads::install(L,callbacks,client);
    web_envelopes::install(L,callbacks,client);
    web_postprocessor::install(L,callbacks,client);
    web_font_manager::install(L,callbacks);
    web_map_layers::install(L,callbacks,client);
    web_ui::install(L,callbacks);
    web_text_widget::install(L,callbacks);
    web_image_widget::install(L,callbacks);
    web_sound_emitter::install(L,callbacks);
    web_graphics_options::install(L,callbacks,client);
}
}

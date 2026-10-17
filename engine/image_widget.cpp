#include "image_widget.hpp"
#include "atlas_asset.hpp"
#include "string_hash.hpp"
#include "texture_asset.hpp"
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_image_widget {
namespace {
constexpr size_t kBudget=16384;
constexpr uint32_t kTypeId=0x38c7a65fu;

struct ImageNode {
    int32_t texture_handle=-1;
    uint32_t atlas_id=0;
    uint32_t region_id=0;
    std::string atlas_name;
    std::string region_name;
    bool has_region=false;
    std::array<float,4> uv{0.0f,0.0f,0.0f,0.0f};
    int32_t blend_mode=3;
    int32_t uv_mode=1;
    std::string effect;
    std::array<float,2> size{0.0f,0.0f};
    uint32_t h_anchor=0;
    uint32_t v_anchor=0;
    std::array<uint8_t,4> tint{0xff,0xff,0xff,0xff};
    std::array<float,3> uv_scale{1.0f,1.0f,1.0f};
    std::array<float,2> alpha_range{0.0f,1.0f};
    std::array<float,4> effect_params{0.0f,0.0f,0.0f,0.0f};
    std::array<float,4> effect_params2{0.0f,0.0f,0.0f,0.0f};
    bool enable_effect_params=false;
    bool enable_effect_params2=false;
    float radius_sq=0.0f;
};

web_components::EntityHost host{};
std::map<uint32_t,ImageNode> nodes;

uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.ImageWidget"));}

ImageNode* image_node(lua_State* L){
    auto id=owner(L);
    if(!host.alive(id))return nullptr;
    auto it=nodes.find(id);
    return it==nodes.end()?nullptr:&it->second;
}

int32_t integer(double value){
    value=std::trunc(value);
    return std::isfinite(value)&&value>=-2147483648.0&&value<=2147483647.0?static_cast<int32_t>(value):INT32_MIN;
}

uint32_t string_id(lua_State* L,int index){
    if(lua_type(L,index)==LUA_TSTRING)return web_strings::hash(lua_tostring(L,index));
    double value=luaL_checknumber(L,index);
    if(!std::isfinite(value)||value<-9223372036854775808.0||value>=9223372036854775808.0)return 0;
    return static_cast<uint32_t>(static_cast<int64_t>(value));
}

uint8_t pack_colour_byte(double raw){
    float x=static_cast<float>(raw)*255.0f+0.5f;
    if(!(x>=0.0f))x=0.0f;
    else if(x>255.0f)x=255.0f;
    return static_cast<uint8_t>(static_cast<int32_t>(x));
}

int add(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add ImageWidget to a removed entity");
    if(!nodes.count(id)){
        if(nodes.size()>=kBudget)return luaL_error(L,"ImageWidget count exceeds budget");
        nodes.emplace(id,ImageNode{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.ImageWidget");
    lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"ImageWidget");}
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int tostring_iw(lua_State* L){owner(L);lua_pushfstring(L,"ImageWidget (%p)",lua_touserdata(L,1));return 1;}

bool apply_atlas_region(ImageNode& node,uint32_t atlas_id,uint32_t region_id){
    std::string tex_path;bool tex_ready=false;
    const auto* element=web_atlas_asset::resolve_element(atlas_id,region_id,&tex_path,&tex_ready);
    if(!element)return false;
    node.atlas_id=atlas_id;
    node.region_id=region_id;
    node.has_region=true;
    node.uv=element->uv;
    uint16_t tex_w=0,tex_h=0;
    if(tex_ready&&web_texture_asset::dimensions(tex_path,tex_w,tex_h)){
        node.size[0]=(element->uv[2]-element->uv[0])*static_cast<float>(tex_w);
        node.size[1]=(element->uv[3]-element->uv[1])*static_cast<float>(tex_h);
    }
    return true;
}

int set_texture(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    if(lua_type(L,2)==LUA_TSTRING)node->atlas_name=lua_tostring(L,2);
    if(lua_type(L,3)==LUA_TSTRING)node->region_name=lua_tostring(L,3);
    uint32_t atlas_id=string_id(L,2);
    uint32_t tex_id=string_id(L,3);
    uint32_t default_id=0;
    if(!lua_isnoneornil(L,4))default_id=string_id(L,4);
    if(!apply_atlas_region(*node,atlas_id,tex_id)&&default_id!=0){
        apply_atlas_region(*node,atlas_id,default_id);
    }
    return 0;
}

int set_texture_handle(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    double value=luaL_checknumber(L,2);
    int64_t handle=(!std::isfinite(value)||value<-9223372036854775808.0||value>=9223372036854775808.0)?INT64_MIN:static_cast<int64_t>(value);
    node->texture_handle=static_cast<int32_t>(handle);
    return 0;
}

int set_anchor(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    int32_t a=integer(luaL_checknumber(L,2));
    if(static_cast<uint32_t>(a)<4u){
        if(lua_toboolean(L,lua_upvalueindex(1)))node->v_anchor=static_cast<uint32_t>(a);
        else node->h_anchor=static_cast<uint32_t>(a);
    }
    return 0;
}

int set_size(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    float w=static_cast<float>(luaL_checknumber(L,2));
    float h=static_cast<float>(luaL_checknumber(L,3));
    node->size={w,h};
    return 0;
}

int get_size(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    lua_pushnumber(L,node->size[0]);
    lua_pushnumber(L,node->size[1]);
    return 2;
}

int set_tint(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    for(int i=0;i<4;++i)node->tint[i]=pack_colour_byte(luaL_checknumber(L,2+i));
    return 0;
}

int set_alpha_range(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    float min_a=static_cast<float>(luaL_checknumber(L,2));
    float max_a=static_cast<float>(luaL_checknumber(L,3));
    node->alpha_range={min_a,max_a};
    return 0;
}

int set_blend_mode(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    node->blend_mode=integer(luaL_checknumber(L,2));
    return 0;
}

int set_uv_mode(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    node->uv_mode=integer(luaL_checknumber(L,2));
    return 0;
}

int set_uv_scale(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    float sx=static_cast<float>(luaL_checknumber(L,2));
    float sy=static_cast<float>(luaL_checknumber(L,3));
    node->uv_scale={sx,sy,1.0f};
    return 0;
}

int set_effect(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    const char* effect=luaL_checklstring(L,2,nullptr);
    node->effect=effect;
    return 0;
}

int set_effect_params(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    std::array<float,4> p{};
    for(int i=0;i<4;++i)p[i]=static_cast<float>(luaL_checknumber(L,2+i));
    if(lua_toboolean(L,lua_upvalueindex(1))){
        node->effect_params2=p;
        node->enable_effect_params2=true;
    }else{
        node->effect_params=p;
        node->enable_effect_params=true;
    }
    return 0;
}

int enable_effect_params(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    if(lua_type(L,2)!=LUA_TBOOLEAN)return luaL_typerror(L,2,"boolean");
    bool enabled=lua_toboolean(L,2)!=0;
    if(lua_toboolean(L,lua_upvalueindex(1)))node->enable_effect_params2=enabled;
    else node->enable_effect_params=enabled;
    return 0;
}

int set_radius_for_ray_traces(lua_State* L){
    auto* node=image_node(L);
    if(!node)return 0;
    float r=static_cast<float>(luaL_checknumber(L,2));
    node->radius_sq=r*r;
    return 0;
}

void scalar(lua_State* L,const char* key,double value){lua_pushnumber(L,value);lua_setfield(L,-2,key);}
void boolean(lua_State* L,const char* key,bool value){lua_pushboolean(L,value);lua_setfield(L,-2,key);}
void hex_bytes(lua_State* L,const char* key,const void* data,size_t len){
    static const char kHex[]="0123456789abcdef";
    const auto* raw=static_cast<const uint8_t*>(data);
    std::string out;out.reserve(len*2);
    for(size_t i=0;i<len;++i){out+=kHex[raw[i]>>4];out+=kHex[raw[i]&15];}
    lua_pushlstring(L,out.data(),out.size());
    lua_setfield(L,-2,key);
}

int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){
        lua_newtable(L);
        scalar(L,"imageWidgets",nodes.size());
        scalar(L,"budget",kBudget);
        boolean(L,"rendererReady",false);
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
    scalar(L,"textureHandle",v.texture_handle);
    scalar(L,"atlasId",v.atlas_id);
    scalar(L,"regionId",v.region_id);
    boolean(L,"hasRegion",v.has_region);
    hex_bytes(L,"uvBits",v.uv.data(),16);
    scalar(L,"blendMode",v.blend_mode);
    scalar(L,"uvMode",v.uv_mode);
    lua_pushlstring(L,v.effect.data(),v.effect.size());lua_setfield(L,-2,"effect");
    hex_bytes(L,"sizeBits",v.size.data(),8);
    scalar(L,"hAnchor",v.h_anchor);
    scalar(L,"vAnchor",v.v_anchor);
    hex_bytes(L,"tintBits",v.tint.data(),4);
    hex_bytes(L,"uvScaleBits",v.uv_scale.data(),12);
    hex_bytes(L,"alphaRangeBits",v.alpha_range.data(),8);
    hex_bytes(L,"effectParamsBits",v.effect_params.data(),16);
    hex_bytes(L,"effectParams2Bits",v.effect_params2.data(),16);
    boolean(L,"enableEffectParams",v.enable_effect_params);
    boolean(L,"enableEffectParams2",v.enable_effect_params2);
    hex_bytes(L,"radiusSqBits",&v.radius_sq,4);
    boolean(L,"rendererReady",false);
    return 1;
}
}

bool contains(uint32_t id){return nodes.count(id)!=0;}
bool get_snapshot(uint32_t id,ImageSnapshot& out){
    auto it=nodes.find(id);
    if(it==nodes.end())return false;
    const auto& v=it->second;
    out.atlas_id=v.atlas_id;out.region_id=v.region_id;
    out.atlas=v.atlas_name;out.region=v.region_name;
    std::memcpy(out.uv,v.uv.data(),sizeof(out.uv));
    out.w=v.size[0];out.h=v.size[1];
    std::memcpy(out.tint,v.tint.data(),sizeof(out.tint));
    out.h_anchor=v.h_anchor;out.v_anchor=v.v_anchor;
    return true;
}
void retire(uint32_t id){nodes.erase(id);}

void clear(){nodes.clear();}
void install(lua_State* L,web_components::EntityHost callbacks){
    clear();host=callbacks;
    luaL_newmetatable(L,"dst.ImageWidget");lua_newtable(L);
    const luaL_Reg methods[]={
        {"SetTexture",set_texture},
        {"SetTextureHandle",set_texture_handle},
        {"SetSize",set_size},
        {"GetSize",get_size},
        {"SetTint",set_tint},
        {"SetAlphaRange",set_alpha_range},
        {"SetBlendMode",set_blend_mode},
        {"SetUVMode",set_uv_mode},
        {"SetUVScale",set_uv_scale},
        {"SetEffect",set_effect},
        {"SetRadiusForRayTraces",set_radius_for_ray_traces},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,methods);
    for(int i=0;i<2;++i){
        lua_pushboolean(L,i);
        lua_pushcclosure(L,set_anchor,1);
        lua_setfield(L,-2,i?"SetVAnchor":"SetHAnchor");
    }
    for(int i=0;i<2;++i){
        lua_pushboolean(L,i);
        lua_pushcclosure(L,set_effect_params,1);
        lua_setfield(L,-2,i?"SetEffectParams2":"SetEffectParams");
    }
    for(int i=0;i<2;++i){
        lua_pushboolean(L,i);
        lua_pushcclosure(L,enable_effect_params,1);
        lua_setfield(L,-2,i?"EnableEffectParams2":"EnableEffectParams");
    }
    lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_iw);lua_setfield(L,-2,"__tostring");
    lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddImageWidget");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebImageWidgets");
}
}

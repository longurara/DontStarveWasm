#include "world_components.hpp"
#include "tiles.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}

namespace web_world_components {
namespace {
web_components::EntityHost host{};
const char* b64_alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64_encode(const std::string& bytes){
    std::string out;out.reserve((bytes.size()+2)/3*4);
    for(size_t i=0;i<bytes.size();i+=3){
        uint32_t v=static_cast<unsigned char>(bytes[i])<<16;
        if(i+1<bytes.size())v|=static_cast<unsigned char>(bytes[i+1])<<8;
        if(i+2<bytes.size())v|=static_cast<unsigned char>(bytes[i+2]);
        out+=b64_alphabet[(v>>18)&63];out+=b64_alphabet[(v>>12)&63];
        out+=i+1<bytes.size()?b64_alphabet[(v>>6)&63]:'=';
        out+=i+2<bytes.size()?b64_alphabet[v&63]:'=';
    }
    return out;
}

bool b64_decode(const char* text,size_t len,std::string& out){
    if(len==0)return false;
    int table[256];std::fill(std::begin(table),std::end(table),-1);
    for(int i=0;i<64;++i)table[static_cast<unsigned char>(b64_alphabet[i])]=i;
    out.clear();out.reserve(len*3/4);
    uint32_t bits=0;int count=0,padding=0;
    for(size_t i=0;i<len;++i){
        unsigned char c=static_cast<unsigned char>(text[i]);
        if(c=='\r'||c=='\n'||c==' '||c=='\t')continue;
        if(c=='='){++padding;bits<<=6;++count;}
        else if(table[c]>=0){if(padding)return false;bits=(bits<<6)|table[c];++count;}
        else return false;
        if(count==4){
            out+=static_cast<char>(bits>>16);
            if(padding<2)out+=static_cast<char>(bits>>8);
            if(padding<1)out+=static_cast<char>(bits);
            bits=0;count=0;padding=0;
        }
    }
    return count==0;
}

struct Grid2D {
    int width=0,height=0;
    uint16_t fill_value=0xffff;
    std::vector<uint16_t> cells;
    void resize(int w,int h,uint16_t def){
        width=std::max(0,w);height=std::max(0,h);fill_value=def;
        cells.assign(static_cast<size_t>(width)*static_cast<size_t>(height),def);
    }
    bool in_bounds(int x,int y)const{return x>=0&&x<width&&y>=0&&y<height;}
    uint16_t get(int x,int y,uint16_t fallback)const{
        if(!in_bounds(x,y))return fallback;
        return cells[static_cast<size_t>(y)*static_cast<size_t>(width)+static_cast<size_t>(x)];
    }
    void set(int x,int y,uint16_t v){
        if(in_bounds(x,y))cells[static_cast<size_t>(y)*static_cast<size_t>(width)+static_cast<size_t>(x)]=v;
    }
    std::string encode()const{
        std::string raw(9+cells.size()*2,'\0');
        std::memcpy(raw.data(),"VRSN\0",5);
        uint32_t ver=1;
        raw[5]=static_cast<char>(ver&0xff);raw[6]=static_cast<char>((ver>>8)&0xff);
        raw[7]=static_cast<char>((ver>>16)&0xff);raw[8]=static_cast<char>((ver>>24)&0xff);
        for(size_t i=0;i<cells.size();++i){
            uint16_t v=cells[i];
            raw[9+i*2]=static_cast<char>(v&0xff);
            raw[9+i*2+1]=static_cast<char>((v>>8)&0xff);
        }
        return b64_encode(raw);
    }
    bool decode(const char* b64,size_t len,bool legacy=false){
        std::string raw;
        if(!b64_decode(b64,len,raw)||raw.size()<9)return false;
        if(std::memcmp(raw.data(),"VRSN\0",5)!=0)return false;
        uint32_t ver=static_cast<unsigned char>(raw[5])|(static_cast<uint32_t>(static_cast<unsigned char>(raw[6]))<<8)|
            (static_cast<uint32_t>(static_cast<unsigned char>(raw[7]))<<16)|(static_cast<uint32_t>(static_cast<unsigned char>(raw[8]))<<24);
        if(ver!=1)return false;
        size_t count=cells.size();
        size_t stride=legacy&&(raw.size()>=9+count*4)?4:2;
        if(raw.size()<9+count*stride)return false;
        for(size_t i=0;i<count;++i){
            size_t off=9+i*stride;
            cells[i]=static_cast<uint16_t>(static_cast<unsigned char>(raw[off])|(static_cast<uint16_t>(static_cast<unsigned char>(raw[off+1]))<<8));
        }
        return true;
    }
};

struct MapComponent {
    Grid2D tiles{0,0,1,{}};
    Grid2D tiledata{0,0,0,{}};
    Grid2D nodeids{0,0,0xffff,{}};
    Grid2D nav{0,0,0xffff,{}};
    std::vector<int> render_layers;
    bool finalized=false;
    bool ocean_enabled=false;
    bool do_ocean_render=false;
    bool always_draw_waves=false;
    void set_size(int w,int h){
        tiles.resize(w,h,web_tiles::default_impassable_tile());
        tiledata.resize(w,h,0);
        nodeids.resize(w,h,0xffff);
    }
    void world_to_tile(float wx,float wz,int& tx,int& ty)const{
        tx=static_cast<int>(std::trunc(((wx+2.0f)+static_cast<float>(tiles.width)*2.0f)*0.25f));
        ty=static_cast<int>(std::trunc(((wz+2.0f)+static_cast<float>(tiles.height)*2.0f)*0.25f));
    }
    void tile_to_world(int tx,int ty,float& cx,float& cz)const{
        cx=(static_cast<float>(tx)-static_cast<float>(tiles.width)*0.5f)*4.0f;
        cz=(static_cast<float>(ty)-static_cast<float>(tiles.height)*0.5f)*4.0f;
    }
};

struct PathSearch {
    float x0=0,y0=0,z0=0,x1=0,y1=0,z1=0;
};

struct PathfinderComponent {
    std::set<std::pair<int,int>> walls;
    std::set<std::pair<int,int>> platforms;
    std::map<int,PathSearch> searches;
    int next_search_id=1;
};

struct GroundCreepComponent {
    float update_interval=1.0f;
    float max_radius=10.0f;
    std::vector<int> render_layers;
    std::string serialized;
};

struct MiniMapComponent {
    std::vector<std::string> atlases;
    std::string effect_shader_1;
    std::string effect_shader_2;
    bool visible=false;
    bool fog_of_war=false;
    bool continuous_clear=false;
    bool draw_forgotten_fow=false;
    float zoom=1.0f;
    float offset_x=0.0f;
    float offset_y=0.0f;
    std::vector<int> render_layers;
};

std::map<uint32_t,MapComponent> maps;
std::map<uint32_t,PathfinderComponent> pathfinders;
std::map<uint32_t,GroundCreepComponent> creeps;
std::map<uint32_t,MiniMapComponent> minimaps;

MapComponent* get_map(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Map"));
    if(!host.alive(id))return nullptr;
    auto it=maps.find(id);
    return it==maps.end()?nullptr:&it->second;
}

PathfinderComponent* get_pf(lua_State* L,uint32_t* out_id=nullptr){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Pathfinder"));
    if(out_id)*out_id=id;
    if(!host.alive(id))return nullptr;
    auto it=pathfinders.find(id);
    return it==pathfinders.end()?nullptr:&it->second;
}

GroundCreepComponent* get_creep(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.GroundCreep"));
    if(!host.alive(id))return nullptr;
    auto it=creeps.find(id);
    return it==creeps.end()?nullptr:&it->second;
}

MiniMapComponent* get_minimap(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.MiniMap"));
    if(!host.alive(id))return nullptr;
    auto it=minimaps.find(id);
    return it==minimaps.end()?nullptr:&it->second;
}

int add_map(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Map to a removed entity");
    if(!maps.count(id))maps.emplace(id,MapComponent{});
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.Map");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"Map");}
        lua_pop(L,1);
    }
    lua_pop(L,1);return 1;
}

int add_pathfinder(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Pathfinder to a removed entity");
    if(!pathfinders.count(id))pathfinders.emplace(id,PathfinderComponent{});
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.Pathfinder");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"Pathfinder");}
        lua_pop(L,1);
    }
    lua_pop(L,1);return 1;
}

int add_ground_creep(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add GroundCreep to a removed entity");
    if(!creeps.count(id))creeps.emplace(id,GroundCreepComponent{});
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.GroundCreep");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"GroundCreep");}
        lua_pop(L,1);
    }
    lua_pop(L,1);return 1;
}

int add_minimap(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add MiniMap to a removed entity");
    if(!minimaps.count(id))minimaps.emplace(id,MiniMapComponent{});
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.MiniMap");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"MiniMap");}
        lua_pop(L,1);
    }
    lua_pop(L,1);return 1;
}

int tostring_map(lua_State* L){luaL_checkudata(L,1,"dst.Map");lua_pushfstring(L,"Map (%p)",lua_touserdata(L,1));return 1;}
int tostring_pf(lua_State* L){luaL_checkudata(L,1,"dst.Pathfinder");lua_pushfstring(L,"Pathfinder (%p)",lua_touserdata(L,1));return 1;}
int tostring_creep(lua_State* L){luaL_checkudata(L,1,"dst.GroundCreep");lua_pushfstring(L,"GroundCreep (%p)",lua_touserdata(L,1));return 1;}
int tostring_minimap(lua_State* L){luaL_checkudata(L,1,"dst.MiniMap");lua_pushfstring(L,"MiniMap (%p)",lua_touserdata(L,1));return 1;}

// --- Map methods ---
int map_set_size(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int w=static_cast<int>(luaL_checkinteger(L,2));
    int h=static_cast<int>(luaL_checkinteger(L,3));
    m->set_size(w,h);
    return 0;
}
int map_get_size(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    lua_pushnumber(L,m->tiles.width);
    lua_pushnumber(L,m->tiles.height);
    return 2;
}
int map_set_tile(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int x=static_cast<int>(luaL_checkinteger(L,2));
    int y=static_cast<int>(luaL_checkinteger(L,3));
    uint16_t t=static_cast<uint16_t>(luaL_checkinteger(L,4));
    m->tiles.set(x,y,t);
    return 0;
}
int map_get_tile(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int x=static_cast<int>(luaL_checkinteger(L,2));
    int y=static_cast<int>(luaL_checkinteger(L,3));
    lua_pushnumber(L,m->tiles.get(x,y,web_tiles::default_impassable_tile()));
    return 1;
}
int map_get_tile_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    lua_pushnumber(L,m->tiles.get(tx,ty,web_tiles::default_impassable_tile()));
    return 1;
}
int map_get_tile_coords_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    lua_pushnumber(L,tx);
    lua_pushnumber(L,ty);
    return 2;
}
int map_get_tile_xy_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    lua_pushinteger(L,tx);
    lua_pushinteger(L,ty);
    return 2;
}
int map_get_tile_center_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int top=lua_gettop(L);
    bool two_arg=(top==3)||(top>3&&lua_isnil(L,4));
    int tx=0,ty=0;
    if(two_arg){
        tx=static_cast<int>(luaL_checkinteger(L,2));
        ty=static_cast<int>(luaL_checkinteger(L,3));
    }else{
        float wx=static_cast<float>(luaL_checknumber(L,2));
        (void)luaL_checknumber(L,3);
        float wz=static_cast<float>(luaL_checknumber(L,4));
        m->world_to_tile(wx,wz,tx,ty);
    }
    float cx=0,cz=0;
    m->tile_to_world(tx,ty,cx,cz);
    lua_pushnumber(L,cx);
    lua_pushnumber(L,0.0);
    lua_pushnumber(L,cz);
    return 3;
}
int map_fill(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    uint16_t t=static_cast<uint16_t>(luaL_checkinteger(L,2));
    std::fill(m->tiles.cells.begin(),m->tiles.cells.end(),t);
    return 0;
}
int map_replace(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    uint16_t a=static_cast<uint16_t>(luaL_checkinteger(L,2));
    uint16_t b=static_cast<uint16_t>(luaL_checkinteger(L,3));
    for(auto& c:m->tiles.cells)if(c==a)c=b;
    return 0;
}
int map_visit_tile(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int x=static_cast<int>(luaL_checkinteger(L,2));
    int y=static_cast<int>(luaL_checkinteger(L,3));
    m->tiledata.set(x,y,m->tiledata.get(x,y,0)|0x1000u);
    return 0;
}
int map_reset_visited(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    for(auto& c:m->tiledata.cells)c&=static_cast<uint16_t>(~0x1000u);
    return 0;
}
int map_tile_visited(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int x=static_cast<int>(luaL_checkinteger(L,2));
    int y=static_cast<int>(luaL_checkinteger(L,3));
    lua_pushboolean(L,(m->tiledata.get(x,y,0)&0x1000u)!=0);
    return 1;
}
int map_finalize(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    m->finalized=true;
    return 0;
}
int map_add_render_layer(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    m->render_layers.push_back(static_cast<int>(luaL_checkinteger(L,2)));
    return 0;
}
int map_get_string_encode(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    std::string s=m->tiles.encode();
    lua_pushlstring(L,s.data(),s.size());
    return 1;
}
int map_get_data_string_encode(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    std::string s=m->tiledata.encode();
    lua_pushlstring(L,s.data(),s.size());
    return 1;
}
int map_get_nodeid_string_encode(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    std::string s=m->nodeids.encode();
    lua_pushlstring(L,s.data(),s.size());
    return 1;
}
int map_get_nav_string_encode(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    std::string s=m->nav.encode();
    lua_pushlstring(L,s.data(),s.size());
    return 1;
}
int map_set_from_string(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    size_t len=0;const char* s=lua_tolstring(L,2,&len);
    if(s)m->tiles.decode(s,len,false);
    return 0;
}
int map_set_from_string_legacy(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    size_t len=0;const char* s=lua_tolstring(L,2,&len);
    if(s)m->tiles.decode(s,len,true);
    return 0;
}
int map_set_map_data_from_string(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    size_t len=0;const char* s=lua_tolstring(L,2,&len);
    if(s)m->tiledata.decode(s,len,false);
    return 0;
}
int map_set_nodeid_from_string(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    size_t len=0;const char* s=lua_tolstring(L,2,&len);
    if(s)m->nodeids.decode(s,len,false);
    return 0;
}
int map_set_nav_size(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int w=static_cast<int>(luaL_checkinteger(L,2));
    int h=static_cast<int>(luaL_checkinteger(L,3));
    m->nav.resize(w,h,0xffff);
    return 0;
}
int map_set_nav_from_string(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    size_t len=0;const char* s=lua_tolstring(L,2,&len);
    if(s)m->nav.decode(s,len,false);
    return 0;
}
int map_do_dynamic_tile_conversion(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    if(!lua_istable(L,2))return 0;
    std::map<uint16_t,uint16_t> conv;
    lua_pushnil(L);
    while(lua_next(L,2)!=0){
        uint16_t from=static_cast<uint16_t>(luaL_checkinteger(L,-2));
        uint16_t to=static_cast<uint16_t>(luaL_checkinteger(L,-1));
        conv[from]=to;
        lua_pop(L,1);
    }
    if(!conv.empty()){
        for(auto& c:m->tiles.cells){
            auto it=conv.find(c);
            if(it!=conv.end())c=it->second;
        }
    }
    return 0;
}
int map_get_nodeid_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    lua_pushinteger(L,m->nodeids.get(tx,ty,0));
    return 1;
}
int map_set_tile_nodeid(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int x=static_cast<int>(luaL_checkinteger(L,2));
    int y=static_cast<int>(luaL_checkinteger(L,3));
    uint16_t nid=static_cast<uint16_t>(luaL_checkinteger(L,4));
    m->nodeids.set(x,y,nid);
    return 0;
}
int map_get_tile_nodeid(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int x=static_cast<int>(luaL_checkinteger(L,2));
    int y=static_cast<int>(luaL_checkinteger(L,3));
    lua_pushinteger(L,m->nodeids.get(x,y,0));
    return 1;
}
int map_get_island_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    uint16_t v=m->nav.get(tx,ty,0xffff);
    if(v==0xffff)lua_pushnil(L);
    else lua_pushinteger(L,v);
    return 1;
}

bool point_in_poly(float px,float py,const std::vector<std::pair<float,float>>& verts){
    int winding=0;
    size_t n=verts.size();
    for(size_t i=0;i<n;++i){
        float x0=verts[i].first,y0=verts[i].second;
        float x1=verts[(i+1)%n].first,y1=verts[(i+1)%n].second;
        float cross=(py-y0)*(x1-x0)-(px-x0)*(y1-y0);
        if(py<y0){if(y1<=py&&cross<0.0f)--winding;}
        else if(py<y1&&cross>0.0f)++winding;
    }
    return winding!=0;
}

std::vector<std::pair<float,float>> read_poly_table(lua_State* L,int idx){
    std::vector<std::pair<float,float>> poly;
    if(!lua_istable(L,idx))return poly;
    size_t n=lua_objlen(L,idx);
    poly.reserve(n);
    for(size_t i=1;i<=n;++i){
        lua_rawgeti(L,idx,static_cast<int>(i));
        if(lua_istable(L,-1)){
            lua_rawgeti(L,-1,1);float vx=static_cast<float>(lua_tonumber(L,-1));lua_pop(L,1);
            lua_rawgeti(L,-1,2);float vy=static_cast<float>(lua_tonumber(L,-1));lua_pop(L,1);
            poly.emplace_back(vx,vy);
        }
        lua_pop(L,1);
    }
    return poly;
}

int map_repopulate_nodeid_tile_map(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    uint16_t node_id=static_cast<uint16_t>(luaL_checkinteger(L,2));
    (void)luaL_checknumber(L,3);
    (void)luaL_checknumber(L,4);
    auto poly=read_poly_table(L,5);
    if(poly.size()<3)return 0;
    float min_x=poly[0].first,max_x=poly[0].first,min_z=poly[0].second,max_z=poly[0].second;
    for(const auto& p:poly){
        min_x=std::min(min_x,p.first);max_x=std::max(max_x,p.first);
        min_z=std::min(min_z,p.second);max_z=std::max(max_z,p.second);
    }
    int tx0=0,ty0=0,tx1=0,ty1=0;
    m->world_to_tile(min_x,min_z,tx0,ty0);
    m->world_to_tile(max_x,max_z,tx1,ty1);
    tx0=std::max(0,tx0-1);ty0=std::max(0,ty0-1);
    tx1=std::min(m->tiles.width-1,tx1+1);ty1=std::min(m->tiles.height-1,ty1+1);
    for(int ty=ty0;ty<=ty1;++ty){
        for(int tx=tx0;tx<=tx1;++tx){
            float cx=0,cz=0;
            m->tile_to_world(tx,ty,cx,cz);
            if(point_in_poly(cx,cz,poly))m->nodeids.set(tx,ty,node_id);
        }
    }
    return 0;
}

int map_get_random_points_for_site(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float sx=static_cast<float>(luaL_checknumber(L,2));
    float sz=static_cast<float>(luaL_checknumber(L,3));
    auto poly=read_poly_table(L,4);
    int count= std::max(0,static_cast<int>(luaL_checkinteger(L,5)));
    std::vector<std::pair<int,int>> pts;
    if(!poly.empty()){
        float min_x=poly[0].first,max_x=poly[0].first,min_z=poly[0].second,max_z=poly[0].second;
        for(const auto& p:poly){
            min_x=std::min(min_x,p.first);max_x=std::max(max_x,p.first);
            min_z=std::min(min_z,p.second);max_z=std::max(max_z,p.second);
        }
        for(float z=min_z;z<=max_z&&static_cast<int>(pts.size())<count;z+=4.0f){
            for(float x=min_x;x<=max_x&&static_cast<int>(pts.size())<count;x+=4.0f){
                if(point_in_poly(x,z,poly))pts.emplace_back(static_cast<int>(x),static_cast<int>(z));
            }
        }
    }
    while(static_cast<int>(pts.size())<count){
        pts.emplace_back(static_cast<int>(sx),static_cast<int>(sz));
    }
    lua_createtable(L,static_cast<int>(pts.size()),0);
    int x_tbl=lua_gettop(L);
    lua_createtable(L,static_cast<int>(pts.size()),0);
    int z_tbl=lua_gettop(L);
    for(size_t i=0;i<pts.size();++i){
        lua_pushnumber(L,pts[i].first);lua_rawseti(L,x_tbl,static_cast<int>(i+1));
        lua_pushnumber(L,pts[i].second);lua_rawseti(L,z_tbl,static_cast<int>(i+1));
    }
    return 2;
}

int map_get_entities_on_tile_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    float cx=0,cz=0;
    m->tile_to_world(tx,ty,cx,cz);
    lua_createtable(L,0,0);
    int out_idx=lua_gettop(L);
    lua_getglobal(L,"TheSim");
    if(lua_istable(L,-1)){
        lua_getfield(L,-1,"FindEntities");
        if(lua_isfunction(L,-1)){
            lua_pushvalue(L,-2);
            lua_pushnumber(L,cx);
            lua_pushnumber(L,0.0);
            lua_pushnumber(L,cz);
            lua_pushnumber(L,2.83842712);
            if(lua_pcall(L,5,1,0)==0&&lua_istable(L,-1)){
                int hits_idx=lua_gettop(L);
                size_t n=lua_objlen(L,hits_idx);
                int out_i=1;
                for(size_t i=1;i<=n;++i){
                    lua_rawgeti(L,hits_idx,static_cast<int>(i));
                    if(lua_istable(L,-1)){
                        lua_getfield(L,-1,"Transform");
                        if(!lua_isnil(L,-1)){
                            lua_getfield(L,-1,"GetWorldPosition");
                            if(lua_isfunction(L,-1)){
                                lua_pushvalue(L,-2);
                                if(lua_pcall(L,1,3,0)==0){
                                    float ex=static_cast<float>(lua_tonumber(L,-3));
                                    float ez=static_cast<float>(lua_tonumber(L,-1));
                                    lua_pop(L,3);
                                    int etx=0,ety=0;
                                    m->world_to_tile(ex,ez,etx,ety);
                                    if(etx==tx&&ety==ty){
                                        lua_pushvalue(L,-2);
                                        lua_rawseti(L,out_idx,out_i++);
                                    }
                                }
                            }else lua_pop(L,1);
                        }
                        lua_pop(L,1);
                    }
                    lua_pop(L,1);
                }
            }
            lua_pop(L,1);
        }else lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int map_calc_percent_ocean(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    float r=static_cast<float>(luaL_checknumber(L,5));
    int tx0=0,ty0=0,tx1=0,ty1=0;
    m->world_to_tile(wx-r,wz-r,tx0,ty0);
    m->world_to_tile(wx+r,wz+r,tx1,ty1);
    int total=0,ocean=0;
    for(int ty=ty0;ty<=ty1;++ty){
        for(int tx=tx0;tx<=tx1;++tx){
            ++total;
            if(web_tiles::is_ocean(m->tiles.get(tx,ty,web_tiles::default_impassable_tile())))++ocean;
        }
    }
    lua_pushnumber(L,total>0?static_cast<double>(ocean)/static_cast<double>(total):0.0);
    return 1;
}
int map_calc_percent_land(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    float r=static_cast<float>(luaL_checknumber(L,5));
    int tx0=0,ty0=0,tx1=0,ty1=0;
    m->world_to_tile(wx-r,wz-r,tx0,ty0);
    m->world_to_tile(wx+r,wz+r,tx1,ty1);
    int total=0,land=0;
    for(int ty=ty0;ty<=ty1;++ty){
        for(int tx=tx0;tx<=tx1;++tx){
            ++total;
            if(web_tiles::is_land(m->tiles.get(tx,ty,web_tiles::default_impassable_tile())))++land;
        }
    }
    lua_pushnumber(L,total>0?static_cast<double>(land)/static_cast<double>(total):0.0);
    return 1;
}
int map_calc_total_seeable_tiles(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    int count=0;
    for(uint16_t t:m->tiles.cells){
        if(!web_tiles::is_impassable(t)&&!web_tiles::is_invalid(t))++count;
    }
    lua_pushinteger(L,count);
    return 1;
}
int map_is_visual_ground_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    uint16_t t=m->tiles.get(tx,ty,web_tiles::default_impassable_tile());
    lua_pushboolean(L,web_tiles::is_land(t));
    return 1;
}
int map_is_not_valid_ground_at_point(lua_State* L){
    auto* m=get_map(L);if(!m)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    int tx=0,ty=0;
    m->world_to_tile(wx,wz,tx,ty);
    uint16_t t=m->tiles.get(tx,ty,web_tiles::default_impassable_tile());
    lua_pushboolean(L,web_tiles::is_invalid(t));
    return 1;
}
int map_noop(lua_State* L){(void)get_map(L);return 0;}
int map_generate_blended_map(lua_State* L){(void)get_map(L);lua_pushboolean(L,1);return 1;}

// --- Pathfinder methods ---
int pf_is_clear(lua_State* L){
    uint32_t id=0;
    auto* pf=get_pf(L,&id);if(!pf)return 0;
    float x0=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float z0=static_cast<float>(luaL_checknumber(L,4));
    float x1=static_cast<float>(luaL_checknumber(L,5));
    (void)luaL_checknumber(L,6);
    float z1=static_cast<float>(luaL_checknumber(L,7));
    bool ignore_walls=false,ignore_creep=false,allow_ocean=false;
    if(lua_istable(L,8)){
        lua_getfield(L,8,"ignorewalls");ignore_walls=lua_toboolean(L,-1)!=0;lua_pop(L,1);
        lua_getfield(L,8,"ignorecreep");ignore_creep=lua_toboolean(L,-1)!=0;lua_pop(L,1);
        lua_getfield(L,8,"allowocean");allow_ocean=lua_toboolean(L,-1)!=0;lua_pop(L,1);
    }
    (void)ignore_creep;
    auto mit=maps.find(id);
    if(mit!=maps.end()){
        const auto& m=mit->second;
        float dx=x1-x0,dz=z1-z0;
        float dist=std::sqrt(dx*dx+dz*dz);
        int steps=std::max(1,static_cast<int>( std::ceil(dist)));
        for(int i=0;i<=steps;++i){
            float t=static_cast<float>(i)/static_cast<float>(steps);
            float x=x0+dx*t,z=z0+dz*t;
            if(!ignore_walls&&pf->walls.count({static_cast<int>(std::floor(x)),static_cast<int>(std::floor(z))})){
                lua_pushboolean(L,0);return 1;
            }
            int tx=0,ty=0;
            m.world_to_tile(x,z,tx,ty);
            uint16_t tile=m.tiles.get(tx,ty,web_tiles::default_impassable_tile());
            if(web_tiles::is_impassable(tile)||web_tiles::is_invalid(tile)||(!allow_ocean&&web_tiles::is_ocean(tile))){
                lua_pushboolean(L,0);return 1;
            }
        }
    }
    lua_pushboolean(L,1);
    return 1;
}
int pf_add_wall(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int x=static_cast<int>(std::floor(luaL_checknumber(L,2)));
    (void)luaL_checknumber(L,3);
    int z=static_cast<int>(std::floor(luaL_checknumber(L,4)));
    pf->walls.insert({x,z});
    return 0;
}
int pf_remove_wall(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int x=static_cast<int>(std::floor(luaL_checknumber(L,2)));
    (void)luaL_checknumber(L,3);
    int z=static_cast<int>(std::floor(luaL_checknumber(L,4)));
    pf->walls.erase({x,z});
    return 0;
}
int pf_has_wall(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int x=static_cast<int>(std::floor(luaL_checknumber(L,2)));
    (void)luaL_checknumber(L,3);
    int z=static_cast<int>(std::floor(luaL_checknumber(L,4)));
    lua_pushboolean(L,pf->walls.count({x,z})!=0);
    return 1;
}
int pf_add_platform(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int x=static_cast<int>(std::floor(luaL_checknumber(L,2)));
    (void)luaL_checknumber(L,3);
    int z=static_cast<int>(std::floor(luaL_checknumber(L,4)));
    pf->platforms.insert({x,z});
    return 0;
}
int pf_remove_platform(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int x=static_cast<int>(std::floor(luaL_checknumber(L,2)));
    (void)luaL_checknumber(L,3);
    int z=static_cast<int>(std::floor(luaL_checknumber(L,4)));
    pf->platforms.erase({x,z});
    return 0;
}
int pf_has_platform(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int x=static_cast<int>(std::floor(luaL_checknumber(L,2)));
    (void)luaL_checknumber(L,3);
    int z=static_cast<int>(std::floor(luaL_checknumber(L,4)));
    lua_pushboolean(L,pf->platforms.count({x,z})!=0);
    return 1;
}
int pf_submit_search(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    PathSearch s;
    s.x0=static_cast<float>(luaL_checknumber(L,2));
    s.y0=static_cast<float>(luaL_checknumber(L,3));
    s.z0=static_cast<float>(luaL_checknumber(L,4));
    s.x1=static_cast<float>(luaL_checknumber(L,5));
    s.y1=static_cast<float>(luaL_checknumber(L,6));
    s.z1=static_cast<float>(luaL_checknumber(L,7));
    int h=pf->next_search_id++;
    pf->searches[h]=s;
    lua_pushnumber(L,h);
    return 1;
}
int pf_get_search_status(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int h=static_cast<int>(luaL_checkinteger(L,2));
    lua_pushnumber(L,pf->searches.count(h)?1:2);
    return 1;
}
int pf_get_search_result(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int h=static_cast<int>(luaL_checkinteger(L,2));
    auto it=pf->searches.find(h);
    if(it==pf->searches.end()){lua_pushnil(L);return 1;}
    lua_newtable(L);
    lua_createtable(L,2,0);
    lua_newtable(L);
    lua_pushnumber(L,it->second.x0);lua_setfield(L,-2,"x");
    lua_pushnumber(L,it->second.y0);lua_setfield(L,-2,"y");
    lua_pushnumber(L,it->second.z0);lua_setfield(L,-2,"z");
    lua_rawseti(L,-2,1);
    lua_newtable(L);
    lua_pushnumber(L,it->second.x1);lua_setfield(L,-2,"x");
    lua_pushnumber(L,it->second.y1);lua_setfield(L,-2,"y");
    lua_pushnumber(L,it->second.z1);lua_setfield(L,-2,"z");
    lua_rawseti(L,-2,2);
    lua_setfield(L,-2,"steps");
    return 1;
}
int pf_kill_search(lua_State* L){
    auto* pf=get_pf(L);if(!pf)return 0;
    int h=static_cast<int>(luaL_checkinteger(L,2));
    pf->searches.erase(h);
    return 0;
}
int pf_get_path_tile_index(lua_State* L){
    uint32_t id=0;
    auto* pf=get_pf(L,&id);if(!pf)return 0;
    float wx=static_cast<float>(luaL_checknumber(L,2));
    (void)luaL_checknumber(L,3);
    float wz=static_cast<float>(luaL_checknumber(L,4));
    auto mit=maps.find(id);
    if(mit==maps.end()){lua_pushinteger(L,-1);return 1;}
    int tx=0,ty=0;
    mit->second.world_to_tile(wx,wz,tx,ty);
    if(!mit->second.tiles.in_bounds(tx,ty)){lua_pushinteger(L,-1);return 1;}
    lua_pushinteger(L,ty*mit->second.tiles.width+tx);
    return 1;
}

// --- GroundCreep methods ---
int creep_on_creep(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    (void)luaL_checknumber(L,2);(void)luaL_checknumber(L,3);(void)luaL_checknumber(L,4);
    lua_pushboolean(L,0);
    return 1;
}
int creep_set_update_interval(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    c->update_interval=static_cast<float>(luaL_checknumber(L,2));
    return 0;
}
int creep_trigger_spawners(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    (void)luaL_checknumber(L,2);(void)luaL_checknumber(L,3);(void)luaL_checknumber(L,4);
    return 0;
}
int creep_get_triggered_spawners(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    (void)luaL_checknumber(L,2);(void)luaL_checknumber(L,3);(void)luaL_checknumber(L,4);
    lua_createtable(L,0,0);
    return 1;
}
int creep_add_render_layer(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    c->render_layers.push_back(static_cast<int>(luaL_checkinteger(L,2)));
    return 0;
}
int creep_get_as_string(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    lua_pushlstring(L,c->serialized.data(),c->serialized.size());
    return 1;
}
int creep_set_from_string(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    size_t len=0;const char* s=lua_tolstring(L,2,&len);
    if(s)c->serialized.assign(s,len);
    return 0;
}
int creep_fast_forward(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    (void)luaL_checknumber(L,2);
    return 0;
}
int creep_set_max_radius(lua_State* L){
    auto* c=get_creep(L);if(!c)return 0;
    c->max_radius=static_cast<float>(luaL_checknumber(L,2));
    return 0;
}

// --- MiniMap methods ---
int mm_add_atlas(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    const char* s=lua_tostring(L,2);
    if(s)mm->atlases.emplace_back(s);
    return 0;
}
int mm_set_effects(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    const char* s1=lua_tostring(L,2);
    const char* s2=lua_tostring(L,3);
    if(s1)mm->effect_shader_1=s1;
    if(s2)mm->effect_shader_2=s2;
    return 0;
}
int mm_toggle_visibility(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->visible=!mm->visible;
    return 0;
}
int mm_is_visible(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    lua_pushboolean(L,mm->visible);
    return 1;
}
int mm_show_area(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    (void)luaL_checknumber(L,2);(void)luaL_checknumber(L,3);
    (void)luaL_checknumber(L,4);(void)luaL_checknumber(L,5);
    return 0;
}
int mm_enable_fow(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->fog_of_war=lua_toboolean(L,2)!=0;
    return 0;
}
int mm_continuously_clear(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->continuous_clear=lua_toboolean(L,2)!=0;
    return 0;
}
int mm_clear_revealed(lua_State* L){
    (void)get_minimap(L);
    return 0;
}
int mm_get_texture_handle(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    lua_pushinteger(L,-1);
    return 1;
}
int mm_rebuild_layer(lua_State* L){
    (void)get_minimap(L);
    return 0;
}
int mm_zoom(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    float delta=static_cast<float>(luaL_checknumber(L,2));
    mm->zoom=std::clamp(mm->zoom+delta,1.0f,20.0f);
    return 0;
}
int mm_get_zoom(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    lua_pushnumber(L,mm->zoom);
    return 1;
}
int mm_offset(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->offset_x+=static_cast<float>(luaL_checknumber(L,2));
    mm->offset_y+=static_cast<float>(luaL_checknumber(L,3));
    return 0;
}
int mm_reset_offset(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->offset_x=0.0f;
    mm->offset_y=0.0f;
    return 0;
}
int mm_add_render_layer(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->render_layers.push_back(static_cast<int>(luaL_checkinteger(L,2)));
    return 0;
}
int mm_draw_forgotten_fow(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    mm->draw_forgotten_fow=lua_toboolean(L,2)!=0;
    return 0;
}
int mm_world_to_map(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    (void)z;
    lua_pushnumber(L,(x+mm->offset_x)/mm->zoom);
    lua_pushnumber(L,(y+mm->offset_y)/mm->zoom);
    lua_pushnumber(L,0.0);
    return 3;
}
int mm_map_to_world(lua_State* L){
    auto* mm=get_minimap(L);if(!mm)return 0;
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    (void)z;
    lua_pushnumber(L,x*mm->zoom-mm->offset_x);
    lua_pushnumber(L,y*mm->zoom-mm->offset_y);
    lua_pushnumber(L,0.0);
    return 3;
}
}

void retire(uint32_t id){
    maps.erase(id);
    pathfinders.erase(id);
    creeps.erase(id);
    minimaps.erase(id);
}

void clear(){
    maps.clear();
    pathfinders.clear();
    creeps.clear();
    minimaps.clear();
}

void install(lua_State* L,web_components::EntityHost callbacks){
    clear();host=callbacks;
    luaL_newmetatable(L,"dst.Map");lua_newtable(L);
    const luaL_Reg map_methods[]={
        {"SetSize",map_set_size},{"SetTile",map_set_tile},{"SetInstantPhysicsRebuild",map_noop},
        {"GetTile",map_get_tile},{"GetTileAtPoint",map_get_tile_at_point},{"GetTileCoordsAtPoint",map_get_tile_coords_at_point},
        {"Fill",map_fill},{"Replace",map_replace},{"RebuildLayer",map_noop},
        {"VisitTile",map_visit_tile},{"ResetVisited",map_reset_visited},{"TileVisited",map_tile_visited},
        {"Finalize",map_finalize},{"AddRenderLayer",map_add_render_layer},{"AddFalloffTexture",map_noop},
        {"AddTileCollisionSet",map_noop},{"SetUndergroundRenderLayer",map_noop},{"SetImpassableType",map_noop},
        {"GetSize",map_get_size},{"GetWorldSize",map_get_size},
        {"GetStringEncode",map_get_string_encode},{"GetDataStringEncode",map_get_data_string_encode},
        {"SetFromString",map_set_from_string},{"SetFromStringLegacy",map_set_from_string_legacy},{"SetMapDataFromString",map_set_map_data_from_string},
        {"DoDynamicTileConversion",map_do_dynamic_tile_conversion},
        {"SetOverlayTexture",map_noop},{"SetOverlayLerp",map_noop},{"SetOverlayColor0",map_noop},{"SetOverlayColor1",map_noop},{"SetOverlayColor2",map_noop},
        {"GetTileXYAtPoint",map_get_tile_xy_at_point},{"GetTileCenterPoint",map_get_tile_center_point},{"SetPhysicsWallDistance",map_noop},
        {"GetNodeIdTileMapStringEncode",map_get_nodeid_string_encode},{"SetNodeIdTileMapFromString",map_set_nodeid_from_string},
        {"GetNodeIdAtPoint",map_get_nodeid_at_point},{"SetTileNodeId",map_set_tile_nodeid},{"GetTileNodeId",map_get_tile_nodeid},
        {"SetNavSize",map_set_nav_size},{"GetNavStringEncode",map_get_nav_string_encode},{"SetNavFromString",map_set_nav_from_string},
        {"GetIslandAtPoint",map_get_island_at_point},{"GetRandomPointsForSite",map_get_random_points_for_site},
        {"RepopulateNodeIdTileMap",map_repopulate_nodeid_tile_map},{"GetEntitiesOnTileAtPoint",map_get_entities_on_tile_at_point},
        {"SetClearColor",map_noop},{"SetUndergroundFadeHeight",map_noop},
        {"CalcPercentOceanTilesAtPoint",map_calc_percent_ocean},{"CalcPercentLandTilesAtPoint",map_calc_percent_land},{"CalcTotalSeeableTiles",map_calc_total_seeable_tiles},
        {"IsVisualGroundAtPoint",map_is_visual_ground_at_point},{"IsVisualGroundAtPointDebug",map_is_visual_ground_at_point},{"IsNotValidGroundAtPoint",map_is_not_valid_ground_at_point},
        {"SetTransparentOcean",map_noop},{"DoOceanRender",map_noop},{"AlwaysDrawWaves",map_noop},{"SetOceanEnabled",map_noop},{"SetOceanTextureBlendAmount",map_noop},
        {"SetOceanNoiseParameters0",map_noop},{"SetOceanNoiseParameters1",map_noop},{"SetOceanNoiseParameters2",map_noop},
        {"SetWaterfallNoiseParameters0",map_noop},{"SetWaterfallNoiseParameters1",map_noop},{"SetWaterfallFadeParameters",map_noop},
        {"GenerateBlendedMap",map_generate_blended_map},{"RetrofitNavGrid",map_noop},
        {"SetMinimapOceanEdgeColor0",map_noop},{"SetMinimapOceanEdgeParams0",map_noop},
        {"SetMinimapOceanEdgeColor1",map_noop},{"SetMinimapOceanEdgeParams1",map_noop},
        {"SetMinimapOceanEdgeShadowColor",map_noop},{"SetMinimapOceanEdgeShadowParams",map_noop},
        {"SetMinimapOceanEdgeFadeParams",map_noop},{"SetMinimapOceanEdgeNoiseParams",map_noop},
        {"SetOceanTextureBlurParameters",map_noop},{"SetMinimapOceanTextureBlurParameters",map_noop},{"SetMinimapOceanMaskBlurParameters",map_noop},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,map_methods);lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_map);lua_setfield(L,-2,"__tostring");lua_pop(L,1);

    luaL_newmetatable(L,"dst.Pathfinder");lua_newtable(L);
    const luaL_Reg pf_methods[]={
        {"IsClear",pf_is_clear},{"AddWall",pf_add_wall},{"RemoveWall",pf_remove_wall},{"HasWall",pf_has_wall},
        {"AddStaticHoppablePlatform",pf_add_platform},{"RemoveStaticHoppablePlatform",pf_remove_platform},{"HasStaticHoppablePlatform",pf_has_platform},
        {"SubmitSearch",pf_submit_search},{"GetSearchStatus",pf_get_search_status},{"GetSearchResult",pf_get_search_result},{"KillSearch",pf_kill_search},
        {"GetPathTileIndexFromPoint",pf_get_path_tile_index},{nullptr,nullptr}
    };
    luaL_register(L,nullptr,pf_methods);lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_pf);lua_setfield(L,-2,"__tostring");lua_pop(L,1);

    luaL_newmetatable(L,"dst.GroundCreep");lua_newtable(L);
    const luaL_Reg creep_methods[]={
        {"OnCreep",creep_on_creep},{"SetUpdateInterval",creep_set_update_interval},
        {"TriggerCreepSpawners",creep_trigger_spawners},{"GetTriggeredCreepSpawners",creep_get_triggered_spawners},
        {"AddRenderLayer",creep_add_render_layer},{"GetAsString",creep_get_as_string},{"SetFromString",creep_set_from_string},
        {"FastForward",creep_fast_forward},{"SetMaxRadius",creep_set_max_radius},{nullptr,nullptr}
    };
    luaL_register(L,nullptr,creep_methods);lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_creep);lua_setfield(L,-2,"__tostring");lua_pop(L,1);

    luaL_newmetatable(L,"dst.MiniMap");lua_newtable(L);
    const luaL_Reg mm_methods[]={
        {"AddAtlas",mm_add_atlas},{"SetEffects",mm_set_effects},
        {"ToggleVisibility",mm_toggle_visibility},{"IsVisible",mm_is_visible},
        {"ShowArea",mm_show_area},{"EnableFogOfWar",mm_enable_fow},
        {"ContinuouslyClearRevealedAreas",mm_continuously_clear},{"ClearRevealedAreas",mm_clear_revealed},
        {"GetTextureHandle",mm_get_texture_handle},{"RebuildLayer",mm_rebuild_layer},
        {"Zoom",mm_zoom},{"GetZoom",mm_get_zoom},{"Offset",mm_offset},{"ResetOffset",mm_reset_offset},
        {"AddRenderLayer",mm_add_render_layer},{"DrawForgottenFogOfWar",mm_draw_forgotten_fow},
        {"WorldPosToMapPos",mm_world_to_map},{"MapPosToWorldPos",mm_map_to_world},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,mm_methods);lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_minimap);lua_setfield(L,-2,"__tostring");lua_pop(L,1);

    lua_getglobal(L,"Entity");
    lua_pushcfunction(L,add_map);lua_setfield(L,-2,"AddMap");
    lua_pushcfunction(L,add_pathfinder);lua_setfield(L,-2,"AddPathfinder");
    lua_pushcfunction(L,add_ground_creep);lua_setfield(L,-2,"AddGroundCreep");
    lua_pushcfunction(L,add_minimap);lua_setfield(L,-2,"AddMiniMap");
    lua_pop(L,1);
}
}

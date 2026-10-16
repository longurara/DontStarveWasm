#include "world_components.hpp"
#include "string_hash.hpp"
#include "tiles.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
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

struct WaveComponentState {
    float u_repeat=0.0f,forward_dist=0.0f,speed=0.0f;
    float width=0.0f,height=0.0f;
    std::string texture;
    std::string effect;
};

struct NetworkComponentState {
    std::string client_name="Wilson";
    std::string user_id="KU_local";
    uint32_t classified_target=0;
    uint16_t player_age=1;
    uint32_t user_flags=0;
    bool server_admin=true;
    bool consecutive_match=false;
    bool playing_with_friends=false;
    bool borrowed=false;
};

enum class NetVarType : uint8_t {
    BOOL,TINYBYTE,SMALLBYTE,BYTE,SHORTINT,USHORTINT,INT,UINT,FLOAT,HASH,STRING,ENTITY,BYTEARRAY,SMALLBYTEARRAY,USHORTARRAY
};

struct NetVarState {
    uint32_t entity_id=0;
    std::string var_name;
    std::string dirty_event;
    NetVarType type=NetVarType::BOOL;
    bool dirty=false;
    bool local_dirty=false;
    bool bool_val=false;
    double num_val=0.0;
    uint32_t hash_val=0;
    uint32_t ent_val=0;
    std::string str_val;
    std::vector<uint16_t> arr_val;
};

struct EntityNetState {
    bool pristine=false;
    bool in_limbo=false;
    bool selected=false;
    bool movement_prediction=false;
    bool is_predicting_movement=false;
    uint32_t platform_id=0;
    float aabb_x=0.0f,aabb_y=0.0f;
    std::vector<uint32_t> netvar_ids;
};

std::map<uint32_t,MapComponent> maps;
std::map<uint32_t,PathfinderComponent> pathfinders;
std::map<uint32_t,GroundCreepComponent> creeps;
std::map<uint32_t,MiniMapComponent> minimaps;
std::map<uint32_t,WaveComponentState> waves;
std::unordered_map<uint32_t,NetworkComponentState> networks;
std::set<uint32_t> shard_networks;
std::set<uint32_t> shard_clients;
std::set<uint32_t> server_non_sleepables;
std::set<uint32_t> client_sleepables;
std::unordered_map<uint32_t,EntityNetState> entity_net_states;
std::unordered_map<uint32_t,NetVarState> netvars;
uint32_t next_netvar_id=1;

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

WaveComponentState* get_wave(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.WaveComponent"));
    if(!host.alive(id))return nullptr;
    auto it=waves.find(id);
    return it==waves.end()?nullptr:&it->second;
}

NetworkComponentState* get_network(lua_State* L,uint32_t* out_id=nullptr){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.Network"));
    if(out_id)*out_id=id;
    if(!host.alive(id))return nullptr;
    auto it=networks.find(id);
    return it==networks.end()?nullptr:&it->second;
}

void attach_component_userdata(lua_State* L,uint32_t id,const char* mt,const char* field){
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,mt);lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,field);}
        lua_pop(L,1);
    }
    lua_pop(L,1);
}

int add_map(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Map to a removed entity");
    if(!maps.count(id))maps.emplace(id,MapComponent{});
    attach_component_userdata(L,id,"dst.Map","Map");
    return 1;
}

int add_pathfinder(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Pathfinder to a removed entity");
    if(!pathfinders.count(id))pathfinders.emplace(id,PathfinderComponent{});
    attach_component_userdata(L,id,"dst.Pathfinder","Pathfinder");
    return 1;
}

int add_ground_creep(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add GroundCreep to a removed entity");
    if(!creeps.count(id))creeps.emplace(id,GroundCreepComponent{});
    attach_component_userdata(L,id,"dst.GroundCreep","GroundCreep");
    return 1;
}

int add_minimap(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add MiniMap to a removed entity");
    if(!minimaps.count(id))minimaps.emplace(id,MiniMapComponent{});
    attach_component_userdata(L,id,"dst.MiniMap","MiniMap");
    return 1;
}

int add_wave(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add WaveComponent to a removed entity");
    if(!waves.count(id))waves.emplace(id,WaveComponentState{});
    attach_component_userdata(L,id,"dst.WaveComponent","WaveComponent");
    return 1;
}

int add_network(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Network to a removed entity");
    if(!networks.count(id))networks.emplace(id,NetworkComponentState{});
    attach_component_userdata(L,id,"dst.Network","Network");
    return 1;
}

int add_shard_network(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add ShardNetwork to a removed entity");
    shard_networks.insert(id);
    attach_component_userdata(L,id,"dst.ShardNetwork","ShardNetwork");
    return 1;
}

int add_shard_client(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add ShardClient to a removed entity");
    shard_clients.insert(id);
    attach_component_userdata(L,id,"dst.ShardClient","ShardClient");
    return 1;
}

int add_server_non_sleepable(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add ServerNonSleepable to a removed entity");
    server_non_sleepables.insert(id);
    attach_component_userdata(L,id,"dst.ServerNonSleepable","ServerNonSleepable");
    return 1;
}

int add_client_sleepable(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add ClientSleepable to a removed entity");
    client_sleepables.insert(id);
    attach_component_userdata(L,id,"dst.ClientSleepable","ClientSleepable");
    return 1;
}

int tostring_map(lua_State* L){luaL_checkudata(L,1,"dst.Map");lua_pushfstring(L,"Map (%p)",lua_touserdata(L,1));return 1;}
int tostring_pf(lua_State* L){luaL_checkudata(L,1,"dst.Pathfinder");lua_pushfstring(L,"Pathfinder (%p)",lua_touserdata(L,1));return 1;}
int tostring_creep(lua_State* L){luaL_checkudata(L,1,"dst.GroundCreep");lua_pushfstring(L,"GroundCreep (%p)",lua_touserdata(L,1));return 1;}
int tostring_minimap(lua_State* L){luaL_checkudata(L,1,"dst.MiniMap");lua_pushfstring(L,"MiniMap (%p)",lua_touserdata(L,1));return 1;}
int tostring_wave(lua_State* L){luaL_checkudata(L,1,"dst.WaveComponent");lua_pushfstring(L,"WaveComponent (%p)",lua_touserdata(L,1));return 1;}
int tostring_network(lua_State* L){luaL_checkudata(L,1,"dst.Network");lua_pushfstring(L,"Network (%p)",lua_touserdata(L,1));return 1;}
int tostring_shard_network(lua_State* L){luaL_checkudata(L,1,"dst.ShardNetwork");lua_pushfstring(L,"ShardNetwork (%p)",lua_touserdata(L,1));return 1;}
int tostring_shard_client(lua_State* L){luaL_checkudata(L,1,"dst.ShardClient");lua_pushfstring(L,"ShardClient (%p)",lua_touserdata(L,1));return 1;}
int tostring_server_non_sleepable(lua_State* L){luaL_checkudata(L,1,"dst.ServerNonSleepable");lua_pushfstring(L,"ServerNonSleepable (%p)",lua_touserdata(L,1));return 1;}
int tostring_client_sleepable(lua_State* L){luaL_checkudata(L,1,"dst.ClientSleepable");lua_pushfstring(L,"ClientSleepable (%p)",lua_touserdata(L,1));return 1;}

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
    (void)luaL_optnumber(L,2,0.0);
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

// --- WaveComponent methods ---
int wave_set_params(lua_State* L){
    auto* w=get_wave(L);if(!w)return 0;
    w->u_repeat=static_cast<float>(luaL_checknumber(L,2));
    w->forward_dist=static_cast<float>(luaL_checknumber(L,3));
    w->speed=static_cast<float>(luaL_optnumber(L,4,0.0));
    return 0;
}
int wave_set_size(lua_State* L){
    auto* w=get_wave(L);if(!w)return 0;
    w->width=static_cast<float>(luaL_checknumber(L,2));
    w->height=static_cast<float>(luaL_checknumber(L,3));
    return 0;
}
int wave_set_texture(lua_State* L){
    auto* w=get_wave(L);if(!w)return 0;
    const char* s=lua_tostring(L,2);
    if(s)w->texture=s;
    return 0;
}
int wave_set_effect(lua_State* L){
    auto* w=get_wave(L);if(!w)return 0;
    const char* s=lua_tostring(L,2);
    if(s)w->effect=s;
    return 0;
}
int wave_init(lua_State* L){
    auto* w=get_wave(L);if(!w)return 0;
    (void)luaL_optnumber(L,2,0.0);
    (void)luaL_optnumber(L,3,0.0);
    return 0;
}
int wave_set_motion(lua_State* L){
    auto* w=get_wave(L);if(!w)return 0;
    (void)luaL_optnumber(L,2,0.0);
    (void)luaL_optnumber(L,3,0.0);
    (void)luaL_optnumber(L,4,0.0);
    return 0;
}

// --- Network methods ---
int net_get_client_name(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushlstring(L,n->client_name.data(),n->client_name.size());
    return 1;
}
int net_get_user_id(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushlstring(L,n->user_id.data(),n->user_id.size());
    return 1;
}
int net_set_classified_target(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    if(lua_isnoneornil(L,2)){n->classified_target=0;return 0;}
    if(lua_isuserdata(L,2))n->classified_target=host.id(L,2);
    else if(lua_istable(L,2)){
        lua_getfield(L,2,"GUID");
        n->classified_target=static_cast<uint32_t>(lua_tointeger(L,-1));
        lua_pop(L,1);
    }
    return 0;
}
int net_set_player_age(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    n->player_age=static_cast<uint16_t>(luaL_checkinteger(L,2));
    return 0;
}
int net_get_player_age(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushnumber(L,n->player_age);
    return 1;
}
int net_get_player_colour(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_createtable(L,4,0);
    for(int i=1;i<=4;++i){lua_pushnumber(L,1.0);lua_rawseti(L,-2,i);}
    return 1;
}
int net_add_user_flag(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    n->user_flags|=static_cast<uint32_t>(luaL_checknumber(L,2));
    return 0;
}
int net_remove_user_flag(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    n->user_flags&=~static_cast<uint32_t>(luaL_checknumber(L,2));
    return 0;
}
int net_get_user_flags(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushnumber(L,n->user_flags);
    return 1;
}
int net_set_player_equip(lua_State* L){(void)get_network(L);return 0;}
int net_set_player_skin(lua_State* L){(void)get_network(L);return 0;}
int net_set_player_skill_selection(lua_State* L){(void)get_network(L);return 0;}
int net_is_server_admin(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushboolean(L,n->server_admin);
    return 1;
}
int net_is_consecutive_match(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushboolean(L,n->consecutive_match);
    return 1;
}
int net_set_consecutive_match(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    n->consecutive_match=lua_toboolean(L,2)!=0;
    return 0;
}
int net_is_playing_with_friends(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushboolean(L,n->playing_with_friends);
    return 1;
}
int net_is_borrowed(lua_State* L){
    auto* n=get_network(L);if(!n)return 0;
    lua_pushboolean(L,n->borrowed);
    return 1;
}
int net_get_network_id(lua_State* L){
    uint32_t id=0;
    auto* n=get_network(L,&id);if(!n)return 0;
    lua_pushinteger(L,static_cast<lua_Integer>(id));
    return 1;
}

// --- NetVar methods ---
NetVarState* get_netvar(lua_State* L){
    auto id=*static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.NetVar"));
    auto it=netvars.find(id);
    return it==netvars.end()?nullptr:&it->second;
}

int netvar_set_impl(lua_State* L,bool is_local){
    auto* v=get_netvar(L);if(!v)return 0;
    bool changed=false;
    switch(v->type){
        case NetVarType::BOOL:{
            bool nv=lua_toboolean(L,2)!=0;
            changed=(nv!=v->bool_val);
            v->bool_val=nv;
            break;
        }
        case NetVarType::TINYBYTE:
        case NetVarType::SMALLBYTE:
        case NetVarType::BYTE:
        case NetVarType::SHORTINT:
        case NetVarType::USHORTINT:
        case NetVarType::INT:
        case NetVarType::UINT:
        case NetVarType::FLOAT:{
            double nv=luaL_optnumber(L,2,0.0);
            changed=(nv!=v->num_val);
            v->num_val=nv;
            break;
        }
        case NetVarType::HASH:{
            uint32_t nv=0;
            if(lua_type(L,2)==LUA_TSTRING){
                const char* s=lua_tostring(L,2);
                nv=(s&&*s)?web_strings::hash(s):0;
            }else if(lua_type(L,2)==LUA_TNUMBER){
                nv=static_cast<uint32_t>(static_cast<int64_t>(lua_tonumber(L,2)));
            }
            changed=(nv!=v->hash_val);
            v->hash_val=nv;
            break;
        }
        case NetVarType::STRING:{
            size_t len=0;
            const char* s=lua_tolstring(L,2,&len);
            std::string nv=s?std::string(s,len):std::string();
            changed=(nv!=v->str_val);
            v->str_val=std::move(nv);
            break;
        }
        case NetVarType::ENTITY:{
            uint32_t nv=0;
            if(lua_istable(L,2)){
                lua_getfield(L,2,"GUID");
                nv=static_cast<uint32_t>(lua_tointeger(L,-1));
                lua_pop(L,1);
            }else if(lua_isuserdata(L,2)){
                nv=host.id(L,2);
            }
            changed=(nv!=v->ent_val);
            v->ent_val=nv;
            break;
        }
        case NetVarType::BYTEARRAY:
        case NetVarType::SMALLBYTEARRAY:
        case NetVarType::USHORTARRAY:{
            std::vector<uint16_t> nv;
            if(lua_istable(L,2)){
                size_t n=std::min<size_t>(31,lua_objlen(L,2));
                nv.reserve(n);
                for(size_t i=1;i<=n;++i){
                    lua_rawgeti(L,2,static_cast<int>(i));
                    nv.push_back(static_cast<uint16_t>(lua_tointeger(L,-1)));
                    lua_pop(L,1);
                }
            }
            changed=(nv!=v->arr_val);
            v->arr_val=std::move(nv);
            break;
        }
    }
    if(is_local){
        v->local_dirty=true;
    }else{
        if(changed||v->local_dirty){
            v->dirty=true;
        }
        v->local_dirty=false;
    }
    return 0;
}

int netvar_set(lua_State* L){return netvar_set_impl(L,false);}
int netvar_set_local(lua_State* L){return netvar_set_impl(L,true);}

int netvar_value(lua_State* L){
    auto* v=get_netvar(L);if(!v)return 0;
    switch(v->type){
        case NetVarType::BOOL:
            lua_pushboolean(L,v->bool_val);
            return 1;
        case NetVarType::TINYBYTE:
        case NetVarType::SMALLBYTE:
        case NetVarType::BYTE:
        case NetVarType::SHORTINT:
        case NetVarType::USHORTINT:
        case NetVarType::INT:
        case NetVarType::UINT:
        case NetVarType::FLOAT:
            lua_pushnumber(L,v->num_val);
            return 1;
        case NetVarType::HASH:
            lua_pushnumber(L,v->hash_val);
            return 1;
        case NetVarType::STRING:
            lua_pushlstring(L,v->str_val.data(),v->str_val.size());
            return 1;
        case NetVarType::ENTITY:
            if(v->ent_val!=0&&host.alive(v->ent_val)){
                lua_getglobal(L,"Ents");
                if(lua_istable(L,-1)){
                    lua_rawgeti(L,-1,v->ent_val);
                    lua_remove(L,-2);
                    return 1;
                }
                lua_pop(L,1);
            }
            lua_pushnil(L);
            return 1;
        case NetVarType::BYTEARRAY:
        case NetVarType::SMALLBYTEARRAY:
        case NetVarType::USHORTARRAY:{
            lua_createtable(L,static_cast<int>(v->arr_val.size()),0);
            for(size_t i=0;i<v->arr_val.size();++i){
                lua_pushinteger(L,v->arr_val[i]);
                lua_rawseti(L,-2,static_cast<int>(i+1));
            }
            return 1;
        }
    }
    return 0;
}

int tostring_netvar(lua_State* L){luaL_checkudata(L,1,"dst.NetVar");lua_pushfstring(L,"NetVar (%p)",lua_touserdata(L,1));return 1;}

int create_netvar(lua_State* L){
    NetVarType type=static_cast<NetVarType>(lua_tointeger(L,lua_upvalueindex(1)));
    int base=lua_istable(L,1)?2:1;
    uint32_t entity_id=static_cast<uint32_t>(luaL_checkinteger(L,base));
    const char* var_name=luaL_checkstring(L,base+1);
    const char* dirty_ev=lua_isstring(L,base+2)?lua_tostring(L,base+2):"";
    uint32_t nvid=next_netvar_id++;
    NetVarState st;
    st.entity_id=entity_id;
    st.var_name=var_name?var_name:"";
    st.dirty_event=dirty_ev?dirty_ev:"";
    st.type=type;
    netvars.emplace(nvid,std::move(st));
    entity_net_states[entity_id].netvar_ids.push_back(nvid);
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=nvid;
    luaL_getmetatable(L,"dst.NetVar");
    lua_setmetatable(L,-2);
    return 1;
}

// --- Entity additional methods ---
int entity_set_pristine(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    auto& st=entity_net_states[id];
    st.pristine=true;
    for(uint32_t nvid:st.netvar_ids){
        auto it=netvars.find(nvid);
        if(it!=netvars.end()){
            it->second.dirty=false;
            it->second.local_dirty=false;
        }
    }
    return 0;
}

int entity_flush_local_dirty_netvars(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    auto it=entity_net_states.find(id);
    if(it==entity_net_states.end())return 0;
    std::vector<std::string> events;
    for(uint32_t nvid:it->second.netvar_ids){
        auto nit=netvars.find(nvid);
        if(nit!=netvars.end()&&nit->second.dirty){
            nit->second.dirty=false;
            if(!nit->second.dirty_event.empty()){
                if(std::find(events.begin(),events.end(),nit->second.dirty_event)==events.end()){
                    events.push_back(nit->second.dirty_event);
                }
            }
        }
    }
    if(!events.empty()){
        lua_getglobal(L,"Ents");
        if(lua_istable(L,-1)){
            lua_rawgeti(L,-1,id);
            if(lua_istable(L,-1)){
                for(const auto& ev:events){
                    lua_getfield(L,-1,"PushEvent");
                    if(lua_isfunction(L,-1)){
                        lua_pushvalue(L,-2);
                        lua_pushlstring(L,ev.data(),ev.size());
                        lua_call(L,2,0);
                    }else{
                        lua_pop(L,1);
                    }
                }
            }
            lua_pop(L,1);
        }
        lua_pop(L,1);
    }
    return 0;
}

int entity_set_aabb(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    auto& st=entity_net_states[id];
    st.aabb_x=static_cast<float>(luaL_checknumber(L,2));
    st.aabb_y=static_cast<float>(luaL_checknumber(L,3));
    return 0;
}
int entity_set_selected(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    entity_net_states[id].selected=lua_toboolean(L,2)!=0;
    return 0;
}
int entity_set_in_limbo(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    entity_net_states[id].in_limbo=lua_toboolean(L,2)!=0;
    return 0;
}
int entity_frustum_check(lua_State* L){
    uint32_t id=host.id(L,1);
    lua_pushboolean(L,host.alive(id));
    return 1;
}
int entity_set_platform(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    if(lua_isnoneornil(L,2)){entity_net_states[id].platform_id=0;return 0;}
    entity_net_states[id].platform_id=host.id(L,2);
    return 0;
}
int entity_get_platform(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id)){lua_pushnil(L);return 1;}
    auto it=entity_net_states.find(id);
    if(it==entity_net_states.end()||it->second.platform_id==0||!host.alive(it->second.platform_id)){
        lua_pushnil(L);return 1;
    }
    lua_getglobal(L,"MAIN");
    bool is_main=!lua_isnil(L,-1);
    lua_pop(L,1);
    if(is_main){
        lua_getglobal(L,"Ents");
        if(lua_istable(L,-1)){
            lua_rawgeti(L,-1,it->second.platform_id);
            lua_remove(L,-2);
            return 1;
        }
        lua_pop(L,1);
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=it->second.platform_id;
    luaL_getmetatable(L,"dst.Entity");lua_setmetatable(L,-2);
    return 1;
}
int entity_get_debug_string(lua_State* L){
    uint32_t id=host.id(L,1);
    lua_pushfstring(L,"Entity[%d]",static_cast<int>(id));
    return 1;
}
int entity_enable_movement_prediction(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    entity_net_states[id].movement_prediction=lua_toboolean(L,2)!=0;
    return 0;
}
int entity_can_predict_movement(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id)){lua_pushboolean(L,0);return 1;}
    lua_pushboolean(L,entity_net_states[id].movement_prediction);
    return 1;
}
int entity_set_is_predicting_movement(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return 0;
    entity_net_states[id].is_predicting_movement=lua_toboolean(L,2)!=0;
    return 0;
}
int entity_movement_noop(lua_State* L){(void)host.id(L,1);return 0;}
int entity_get_history_data(lua_State* L){(void)host.id(L,1);return 0;}
int entity_get_anim_state_data(lua_State* L){(void)host.id(L,1);return 0;}
int entity_world_to_local_space(lua_State* L){
    uint32_t id=host.id(L,1);
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    float m[16]={};
    float ex=0,ey=0,ez=0;
    if(host.alive(id)&&host.local_matrix&&host.local_matrix(id,m)){ex=m[12];ey=m[13];ez=m[14];}
    lua_pushnumber(L,x-ex);lua_pushnumber(L,y-ey);lua_pushnumber(L,z-ez);
    return 3;
}
int entity_local_to_world_space(lua_State* L){
    uint32_t id=host.id(L,1);
    float x=static_cast<float>(luaL_checknumber(L,2));
    float y=static_cast<float>(luaL_checknumber(L,3));
    float z=static_cast<float>(luaL_checknumber(L,4));
    float m[16]={};
    float ex=0,ey=0,ez=0;
    if(host.alive(id)&&host.local_matrix&&host.local_matrix(id,m)){ex=m[12];ey=m[13];ez=m[14];}
    lua_pushnumber(L,x+ex);lua_pushnumber(L,y+ey);lua_pushnumber(L,z+ez);
    return 3;
}
// ============================================================================
// Entity Simulation & Rendering Components
// ============================================================================

struct AnimStateData {
    std::string bank;
    std::string build;
    std::string skin_build;
    std::string anim;
    int layer=4;
    int sort_order=0;
    int facing=3;
    bool inherits_sort_key=true;
    float mult_colour[4]={1.0f,1.0f,1.0f,1.0f};
    float add_colour[4]={0.0f,0.0f,0.0f,0.0f};
    float hue=0.0f,saturation=1.0f,brightness=1.0f;
    float anim_time=0.0f,anim_length=0.5f;
    double start_clock=0.0;
    int num_frames=15,current_frame=0;
    bool loop=false,playing=false,done=true;
    std::vector<std::pair<std::string,bool>> queue;
    std::map<std::string,std::string> symbol_overrides;
};
std::unordered_map<uint32_t,AnimStateData> anim_states;
std::unordered_set<uint32_t> active_anim_ids;
double global_anim_clock=0.0;

struct PhysicsData {
    float vx=0.0f,vy=0.0f,vz=0.0f;
    float mx=0.0f,my=0.0f,mz=0.0f;
    float radius=0.5f,height=1.0f,mass=1.0f;
    uint32_t collision_group=0,collision_mask=0;
    bool active=true,passable=false,use_motor=false;
};
std::unordered_map<uint32_t,PhysicsData> physics_states;
std::unordered_set<uint32_t> active_physics_ids;

struct LightData {
    bool enabled=false;
    bool disable_on_scene_removal=true;
    float radius=1.0f,falloff=0.5f,intensity=0.5f;
    float r=1.0f,g=1.0f,b=1.0f;
};
std::unordered_map<uint32_t,LightData> light_states;

struct ImageCompData {
    float w=0.0f,h=0.0f;
};
std::map<uint32_t,ImageCompData> image_comp_states;

struct TextEditCompData {
    std::string text;
    int cursor_pos=0;
};
std::map<uint32_t,TextEditCompData> text_edit_states;

struct VideoCompData {
    float w=100.0f,h=100.0f;
};
std::map<uint32_t,VideoCompData> video_states;

std::set<uint32_t> followers;
std::set<uint32_t> minimap_entities;
std::set<uint32_t> dynamic_shadows;
std::set<uint32_t> static_shadows;
std::set<uint32_t> light_watchers;
std::set<uint32_t> ground_creep_entities;
std::set<uint32_t> map_explorers;
std::set<uint32_t> debug_renders;
std::set<uint32_t> particle_emitters;
std::set<uint32_t> vfx_effects;
std::set<uint32_t> labels;

int comp_noop(lua_State*){return 0;}
int comp_true(lua_State* L){lua_pushboolean(L,1);return 1;}
int comp_false(lua_State* L){lua_pushboolean(L,0);return 1;}
int comp_zero(lua_State* L){lua_pushnumber(L,0);return 1;}
int comp_one(lua_State* L){lua_pushnumber(L,1.0);return 1;}
int comp_empty_str(lua_State* L){lua_pushliteral(L,"");return 1;}

uint32_t check_comp_owner(lua_State* L,const char* mt){
    return *static_cast<uint32_t*>(luaL_checkudata(L,1,mt));
}

int add_simple_comp(lua_State* L,std::set<uint32_t>& store,const char* mt,const char* field,const char* err){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,err);
    store.insert(id);
    attach_component_userdata(L,id,mt,field);
    return 1;
}

// AnimState
void start_anim_clip_raw(AnimStateData& a,const std::string& name,bool loop){
    a.anim=name;
    a.loop=loop;
    a.anim_time=0.0f;
    a.start_clock=global_anim_clock;
    a.current_frame=0;
    if(name.find("start")!=std::string::npos||name.find("stop")!=std::string::npos||
       name.find("pre")!=std::string::npos||name.find("pst")!=std::string::npos){
        a.num_frames=5;
    }else if(name.find("pickup")!=std::string::npos||name.find("give")!=std::string::npos||
             name.find("atk")!=std::string::npos||name.find("chop")!=std::string::npos||
             name.find("mine")!=std::string::npos||name.find("work")!=std::string::npos||
             name.find("eat")!=std::string::npos||name.find("hit")!=std::string::npos){
        a.num_frames=10;
    }else{
        a.num_frames=20;
    }
    a.anim_length=static_cast<float>(a.num_frames)/30.0f;
    a.playing=!name.empty();
    a.done=!a.playing;
}
void start_anim_clip(uint32_t id,AnimStateData& a,const std::string& name,bool loop){
    start_anim_clip_raw(a,name,loop);
    if(a.playing&&(!a.loop||!a.queue.empty()))active_anim_ids.insert(id);
    else active_anim_ids.erase(id);
}
AnimStateData* get_anim(lua_State* L,uint32_t* out_id=nullptr){
    uint32_t id=check_comp_owner(L,"dst.AnimState");
    if(out_id)*out_id=id;
    auto it=anim_states.find(id);
    return (host.alive(id)&&it!=anim_states.end())?&it->second:nullptr;
}
int add_anim_state(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add AnimState to a removed entity");
    anim_states.try_emplace(id);
    attach_component_userdata(L,id,"dst.AnimState","AnimState");
    return 1;
}
int tostring_anim_state(lua_State* L){check_comp_owner(L,"dst.AnimState");lua_pushfstring(L,"AnimState (%p)",lua_touserdata(L,1));return 1;}
int anim_play(lua_State* L){
    uint32_t id=0;
    if(auto* a=get_anim(L,&id)){
        a->queue.clear();
        start_anim_clip(id,*a,luaL_optstring(L,2,""),lua_toboolean(L,3)!=0);
    }
    return 0;
}
int anim_push(lua_State* L){
    uint32_t id=0;
    if(auto* a=get_anim(L,&id)){
        std::string name=luaL_optstring(L,2,"");
        bool loop=lua_toboolean(L,3)!=0;
        if(!a->playing||a->done||a->loop||a->anim.empty()){
            a->queue.clear();
            start_anim_clip(id,*a,name,loop);
        }else{
            a->queue.emplace_back(name,loop);
            active_anim_ids.insert(id);
        }
    }
    return 0;
}
int anim_done(lua_State* L){
    auto* a=get_anim(L);
    lua_pushboolean(L,a?a->done:1);
    return 1;
}
int anim_set_bank(lua_State* L){if(auto* a=get_anim(L))a->bank=luaL_optstring(L,2,"");return 0;}
int anim_set_bank_and_play(lua_State* L){
    uint32_t id=0;
    if(auto* a=get_anim(L,&id)){
        a->bank=luaL_optstring(L,2,"");
        a->queue.clear();
        start_anim_clip(id,*a,luaL_optstring(L,3,""),lua_toboolean(L,4)!=0);
    }
    return 0;
}
int anim_set_build(lua_State* L){if(auto* a=get_anim(L)){a->build=luaL_optstring(L,2,"");a->skin_build.clear();}return 0;}
int anim_set_skin(lua_State* L){if(auto* a=get_anim(L)){a->skin_build=luaL_optstring(L,2,"");a->build=luaL_optstring(L,3,a->build.c_str());}return 0;}
int anim_set_layer(lua_State* L){if(auto* a=get_anim(L))a->layer=static_cast<int>(luaL_optinteger(L,2,4));return 0;}
int anim_get_layer(lua_State* L){auto* a=get_anim(L);lua_pushinteger(L,a?a->layer:4);return 1;}
int anim_set_sort_order(lua_State* L){if(auto* a=get_anim(L))a->sort_order=static_cast<int>(luaL_optinteger(L,2,0));return 0;}
int anim_get_sort_order(lua_State* L){auto* a=get_anim(L);lua_pushinteger(L,a?a->sort_order:0);return 1;}
int anim_set_inherits_sort_key(lua_State* L){if(auto* a=get_anim(L))a->inherits_sort_key=lua_toboolean(L,2)!=0;return 0;}
int anim_get_inherits_sort_key(lua_State* L){auto* a=get_anim(L);lua_pushboolean(L,a?a->inherits_sort_key:1);return 1;}
int anim_set_mult_colour(lua_State* L){
    if(auto* a=get_anim(L)){
        a->mult_colour[0]=static_cast<float>(luaL_optnumber(L,2,1.0));
        a->mult_colour[1]=static_cast<float>(luaL_optnumber(L,3,1.0));
        a->mult_colour[2]=static_cast<float>(luaL_optnumber(L,4,1.0));
        a->mult_colour[3]=static_cast<float>(luaL_optnumber(L,5,1.0));
    }
    return 0;
}
int anim_get_mult_colour(lua_State* L){
    auto* a=get_anim(L);
    for(int i=0;i<4;++i)lua_pushnumber(L,a?a->mult_colour[i]:1.0f);
    return 4;
}
int anim_set_add_colour(lua_State* L){
    if(auto* a=get_anim(L)){
        a->add_colour[0]=static_cast<float>(luaL_optnumber(L,2,0.0));
        a->add_colour[1]=static_cast<float>(luaL_optnumber(L,3,0.0));
        a->add_colour[2]=static_cast<float>(luaL_optnumber(L,4,0.0));
        a->add_colour[3]=static_cast<float>(luaL_optnumber(L,5,0.0));
    }
    return 0;
}
int anim_get_add_colour(lua_State* L){
    auto* a=get_anim(L);
    for(int i=0;i<4;++i)lua_pushnumber(L,a?a->add_colour[i]:0.0f);
    return 4;
}
int anim_set_hue(lua_State* L){if(auto* a=get_anim(L))a->hue=static_cast<float>(luaL_optnumber(L,2,0.0));return 0;}
int anim_get_hue(lua_State* L){auto* a=get_anim(L);lua_pushnumber(L,a?a->hue:0.0f);return 1;}
int anim_set_saturation(lua_State* L){if(auto* a=get_anim(L))a->saturation=static_cast<float>(luaL_optnumber(L,2,1.0));return 0;}
int anim_get_saturation(lua_State* L){auto* a=get_anim(L);lua_pushnumber(L,a?a->saturation:1.0f);return 1;}
int anim_set_brightness(lua_State* L){if(auto* a=get_anim(L))a->brightness=static_cast<float>(luaL_optnumber(L,2,1.0));return 0;}
int anim_get_brightness(lua_State* L){auto* a=get_anim(L);lua_pushnumber(L,a?a->brightness:1.0f);return 1;}
int anim_override_symbol(lua_State* L){
    if(auto* a=get_anim(L)){
        const char* sym=luaL_optstring(L,2,"");
        const char* build=luaL_optstring(L,3,"");
        if(sym[0])a->symbol_overrides[sym]=build;
    }
    return 0;
}
int anim_clear_override_symbol(lua_State* L){
    if(auto* a=get_anim(L)){
        const char* sym=luaL_optstring(L,2,"");
        a->symbol_overrides.erase(sym);
    }
    return 0;
}
int anim_clear_all_override_symbols(lua_State* L){if(auto* a=get_anim(L))a->symbol_overrides.clear();return 0;}
int anim_get_symbol_override(lua_State* L){
    auto* a=get_anim(L);
    const char* sym=luaL_optstring(L,2,"");
    if(a){
        auto it=a->symbol_overrides.find(sym);
        if(it!=a->symbol_overrides.end()){lua_pushlstring(L,it->second.data(),it->second.size());return 1;}
    }
    lua_pushnil(L);return 1;
}
int anim_is_symbol_overridden(lua_State* L){
    auto* a=get_anim(L);
    const char* sym=luaL_optstring(L,2,"");
    lua_pushboolean(L,a&&a->symbol_overrides.count(sym)>0);
    return 1;
}
int anim_compare_symbol_builds(lua_State* L){
    auto* a=get_anim(L);
    const char* sym=luaL_optstring(L,2,"");
    const char* build=luaL_optstring(L,3,"");
    if(!a){lua_pushboolean(L,0);return 1;}
    auto it=a->symbol_overrides.find(sym);
    const std::string& actual=(it!=a->symbol_overrides.end())?it->second:a->build;
    lua_pushboolean(L,actual==build);
    return 1;
}
int anim_get_symbol_position(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.AnimState");
    float ox=static_cast<float>(luaL_optnumber(L,3,0.0));
    float oy=static_cast<float>(luaL_optnumber(L,4,0.0));
    float oz=static_cast<float>(luaL_optnumber(L,5,0.0));
    float m[16]={};
    if(host.local_matrix&&host.local_matrix(id,m)){
        lua_pushnumber(L,m[3]+ox);lua_pushnumber(L,m[7]+oy);lua_pushnumber(L,m[11]+oz);
    }else{
        lua_pushnumber(L,ox);lua_pushnumber(L,oy);lua_pushnumber(L,oz);
    }
    return 3;
}
int anim_get_visual_bb(lua_State* L){
    lua_pushnumber(L,-0.5);lua_pushnumber(L,0.0);lua_pushnumber(L,-0.5);
    lua_pushnumber(L,0.5);lua_pushnumber(L,1.0);lua_pushnumber(L,0.5);
    return 6;
}
int anim_get_symbol_mult_colour(lua_State* L){
    lua_pushnumber(L,1.0);lua_pushnumber(L,1.0);lua_pushnumber(L,1.0);lua_pushnumber(L,1.0);
    return 4;
}
int anim_get_symbol_add_colour(lua_State* L){
    lua_pushnumber(L,0.0);lua_pushnumber(L,0.0);lua_pushnumber(L,0.0);lua_pushnumber(L,0.0);
    return 4;
}
int anim_get_symbol_hsb(lua_State* L){
    lua_pushnumber(L,0.0);lua_pushnumber(L,1.0);lua_pushnumber(L,1.0);
    return 3;
}
int anim_is_current_animation(lua_State* L){
    auto* a=get_anim(L);
    const char* name=luaL_optstring(L,2,"");
    lua_pushboolean(L,a&&a->anim==name);
    return 1;
}
int anim_get_current_anim_hash(lua_State* L){
    auto* a=get_anim(L);
    lua_pushnumber(L,a?web_strings::hash(a->anim.c_str()):0);
    return 1;
}
int anim_get_current_anim_length(lua_State* L){auto* a=get_anim(L);lua_pushnumber(L,a?a->anim_length:1.0f);return 1;}
int anim_get_current_anim_time(lua_State* L){
    auto* a=get_anim(L);
    if(!a){lua_pushnumber(L,0.0f);return 1;}
    if(a->playing&&a->loop&&a->queue.empty()){
        double t=std::fmod(std::max(0.0,global_anim_clock-a->start_clock),std::max(0.033,static_cast<double>(a->anim_length)));
        lua_pushnumber(L,t);
        return 1;
    }
    lua_pushnumber(L,a->anim_time);
    return 1;
}
int anim_get_current_anim_num_frames(lua_State* L){auto* a=get_anim(L);lua_pushinteger(L,a?a->num_frames:30);return 1;}
int anim_get_current_anim_frame(lua_State* L){
    auto* a=get_anim(L);
    if(!a){lua_pushinteger(L,0);return 1;}
    if(a->playing&&a->loop&&a->queue.empty()){
        double t=std::fmod(std::max(0.0,global_anim_clock-a->start_clock),std::max(0.033,static_cast<double>(a->anim_length)));
        int f=std::clamp(static_cast<int>(t*30.0),0,std::max(0,a->num_frames-1));
        lua_pushinteger(L,f);
        return 1;
    }
    lua_pushinteger(L,a->current_frame);
    return 1;
}
int anim_get_current_bank_name(lua_State* L){auto* a=get_anim(L);lua_pushstring(L,a?a->bank.c_str():"");return 1;}
int anim_get_bank_hash(lua_State* L){auto* a=get_anim(L);lua_pushnumber(L,a?web_strings::hash(a->bank.c_str()):0);return 1;}
int anim_get_skin_build(lua_State* L){auto* a=get_anim(L);lua_pushstring(L,a?a->skin_build.c_str():"");return 1;}
int anim_is_skin_build(lua_State* L){auto* a=get_anim(L);lua_pushboolean(L,a&&!a->skin_build.empty());return 1;}
int anim_get_build(lua_State* L){auto* a=get_anim(L);lua_pushstring(L,a?a->build.c_str():"");return 1;}
int anim_get_current_facing(lua_State* L){auto* a=get_anim(L);lua_pushinteger(L,a?a->facing:3);return 1;}
int anim_get_history_data(lua_State* L){lua_pushnumber(L,0);lua_pushnumber(L,0);return 2;}

// Physics
PhysicsData* get_physics(lua_State* L,uint32_t* out_id=nullptr){
    uint32_t id=check_comp_owner(L,"dst.Physics");
    if(out_id)*out_id=id;
    auto it=physics_states.find(id);
    return (host.alive(id)&&it!=physics_states.end())?&it->second:nullptr;
}
int add_physics(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Physics to a removed entity");
    physics_states.try_emplace(id);
    attach_component_userdata(L,id,"dst.Physics","Physics");
    return 1;
}
int tostring_physics(lua_State* L){check_comp_owner(L,"dst.Physics");lua_pushfstring(L,"Physics (%p)",lua_touserdata(L,1));return 1;}
int phys_set_motor_vel(lua_State* L){
    uint32_t id=0;
    if(auto* p=get_physics(L,&id)){
        p->use_motor=true;
        p->mx=static_cast<float>(luaL_optnumber(L,2,0.0));
        p->my=static_cast<float>(luaL_optnumber(L,3,0.0));
        p->mz=static_cast<float>(luaL_optnumber(L,4,0.0));
        float x=0,y=0,z=0,rot=0;
        if(host.get_transform&&host.get_transform(id,&x,&y,&z,&rot)){
            float c=std::cos(rot),s=std::sin(rot);
            p->vx=c*p->mx+s*p->mz;
            p->vy=p->my;
            p->vz=-s*p->mx+c*p->mz;
        }else{
            p->vx=p->mx;p->vy=p->my;p->vz=p->mz;
        }
        if(p->mx!=0.0f||p->my!=0.0f||p->mz!=0.0f)active_physics_ids.insert(id);
        else active_physics_ids.erase(id);
    }
    return 0;
}
int phys_get_motor_vel(lua_State* L){
    auto* p=get_physics(L);
    lua_pushnumber(L,p?p->mx:0.0f);lua_pushnumber(L,p?p->my:0.0f);lua_pushnumber(L,p?p->mz:0.0f);
    return 3;
}
int phys_get_motor_speed(lua_State* L){auto* p=get_physics(L);lua_pushnumber(L,p?p->mx:0.0f);return 1;}
int phys_set_vel(lua_State* L){
    uint32_t id=0;
    if(auto* p=get_physics(L,&id)){
        p->use_motor=false;
        p->vx=static_cast<float>(luaL_optnumber(L,2,0.0));
        p->vy=static_cast<float>(luaL_optnumber(L,3,0.0));
        p->vz=static_cast<float>(luaL_optnumber(L,4,0.0));
        if(p->vx!=0.0f||p->vy!=0.0f||p->vz!=0.0f)active_physics_ids.insert(id);
        else active_physics_ids.erase(id);
    }
    return 0;
}
int phys_stop(lua_State* L){
    uint32_t id=0;
    if(auto* p=get_physics(L,&id)){
        p->use_motor=false;p->vx=p->vy=p->vz=0.0f;p->mx=p->my=p->mz=0.0f;
        active_physics_ids.erase(id);
    }
    return 0;
}
int phys_get_velocity(lua_State* L){
    auto* p=get_physics(L);
    lua_pushnumber(L,p?p->vx:0.0f);lua_pushnumber(L,p?p->vy:0.0f);lua_pushnumber(L,p?p->vz:0.0f);
    return 3;
}
int phys_set_sphere(lua_State* L){if(auto* p=get_physics(L))p->radius=static_cast<float>(luaL_optnumber(L,2,0.5));return 0;}
int phys_set_capsule(lua_State* L){
    if(auto* p=get_physics(L)){
        p->radius=static_cast<float>(luaL_optnumber(L,2,0.5));
        p->height=static_cast<float>(luaL_optnumber(L,3,1.0));
    }
    return 0;
}
int phys_get_radius(lua_State* L){auto* p=get_physics(L);lua_pushnumber(L,p?p->radius:0.5f);return 1;}
int phys_get_height(lua_State* L){auto* p=get_physics(L);lua_pushnumber(L,p?p->height:1.0f);return 1;}
int phys_get_mass(lua_State* L){auto* p=get_physics(L);lua_pushnumber(L,p?p->mass:1.0f);return 1;}
int phys_set_mass(lua_State* L){if(auto* p=get_physics(L))p->mass=static_cast<float>(luaL_optnumber(L,2,1.0));return 0;}
int phys_teleport(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.Physics");
    if(!host.alive(id))return 0;
    double x=luaL_optnumber(L,2,0.0);
    double y=luaL_optnumber(L,3,0.0);
    double z=luaL_optnumber(L,4,0.0);
    lua_getfield(L,LUA_REGISTRYINDEX,"dst.entities");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_isuserdata(L,-1)){
            lua_getglobal(L,"Entity");
            if(lua_istable(L,-1)){
                lua_getfield(L,-1,"SetPosition");
                if(lua_isfunction(L,-1)){
                    lua_pushvalue(L,-3);
                    lua_pushnumber(L,x);lua_pushnumber(L,y);lua_pushnumber(L,z);
                    lua_pcall(L,4,0,0);
                }else lua_pop(L,1);
            }
            lua_pop(L,1);
        }
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 0;
}
int phys_set_active(lua_State* L){if(auto* p=get_physics(L))p->active=lua_toboolean(L,2)!=0;return 0;}
int phys_is_active(lua_State* L){auto* p=get_physics(L);lua_pushboolean(L,p?p->active:1);return 1;}
int phys_is_passable(lua_State* L){auto* p=get_physics(L);lua_pushboolean(L,p?p->passable:0);return 1;}
int phys_get_collision_mask(lua_State* L){auto* p=get_physics(L);lua_pushinteger(L,p?p->collision_mask:0);return 1;}
int phys_set_collision_mask(lua_State* L){if(auto* p=get_physics(L))p->collision_mask=static_cast<uint32_t>(luaL_optinteger(L,2,0));return 0;}
int phys_clear_collision_mask(lua_State* L){if(auto* p=get_physics(L))p->collision_mask=0;return 0;}
int phys_collides_with(lua_State* L){if(auto* p=get_physics(L))p->collision_mask|=static_cast<uint32_t>(luaL_optinteger(L,2,0));return 0;}
int phys_clear_collides_with(lua_State* L){if(auto* p=get_physics(L))p->collision_mask&=~static_cast<uint32_t>(luaL_optinteger(L,2,0));return 0;}
int phys_get_collision_group(lua_State* L){auto* p=get_physics(L);lua_pushinteger(L,p?p->collision_group:0);return 1;}
int phys_set_collision_group(lua_State* L){if(auto* p=get_physics(L))p->collision_group=static_cast<uint32_t>(luaL_optinteger(L,2,0));return 0;}

// Light
LightData* get_light(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.Light");
    auto it=light_states.find(id);
    return (host.alive(id)&&it!=light_states.end())?&it->second:nullptr;
}
int add_light(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Light to a removed entity");
    light_states.try_emplace(id);
    attach_component_userdata(L,id,"dst.Light","Light");
    return 1;
}
int tostring_light(lua_State* L){check_comp_owner(L,"dst.Light");lua_pushfstring(L,"Light (%p)",lua_touserdata(L,1));return 1;}
int light_enable(lua_State* L){if(auto* l=get_light(L))l->enabled=lua_toboolean(L,2)!=0;return 0;}
int light_is_enabled(lua_State* L){auto* l=get_light(L);lua_pushboolean(L,l?l->enabled:0);return 1;}
int light_set_radius(lua_State* L){if(auto* l=get_light(L))l->radius=static_cast<float>(luaL_optnumber(L,2,1.0));return 0;}
int light_get_radius(lua_State* L){auto* l=get_light(L);lua_pushnumber(L,l?l->radius:1.0f);return 1;}
int light_set_falloff(lua_State* L){if(auto* l=get_light(L))l->falloff=static_cast<float>(luaL_optnumber(L,2,0.5));return 0;}
int light_get_falloff(lua_State* L){auto* l=get_light(L);lua_pushnumber(L,l?l->falloff:0.5f);return 1;}
int light_set_intensity(lua_State* L){if(auto* l=get_light(L))l->intensity=static_cast<float>(luaL_optnumber(L,2,0.5));return 0;}
int light_get_intensity(lua_State* L){auto* l=get_light(L);lua_pushnumber(L,l?l->intensity:0.5f);return 1;}
int light_set_colour(lua_State* L){
    if(auto* l=get_light(L)){
        l->r=static_cast<float>(luaL_optnumber(L,2,1.0));
        l->g=static_cast<float>(luaL_optnumber(L,3,1.0));
        l->b=static_cast<float>(luaL_optnumber(L,4,1.0));
    }
    return 0;
}
int light_get_colour(lua_State* L){
    auto* l=get_light(L);
    lua_pushnumber(L,l?l->r:1.0f);lua_pushnumber(L,l?l->g:1.0f);lua_pushnumber(L,l?l->b:1.0f);
    return 3;
}
int light_set_disable_on_removal(lua_State* L){if(auto* l=get_light(L))l->disable_on_scene_removal=lua_toboolean(L,2)!=0;return 0;}
int light_get_disable_on_removal(lua_State* L){auto* l=get_light(L);lua_pushboolean(L,l?l->disable_on_scene_removal:1);return 1;}

// Follower, MiniMapEntity, DynamicShadow, StaticShadow, LightWatcher, GroundCreepEntity, MapExplorer, DebugRender, ParticleEmitter, VFXEffect, Image, Label, TextEditWidget, VideoWidget
int add_follower(lua_State* L){return add_simple_comp(L,followers,"dst.Follower","Follower","Cannot add Follower to a removed entity");}
int tostring_follower(lua_State* L){check_comp_owner(L,"dst.Follower");lua_pushfstring(L,"Follower (%p)",lua_touserdata(L,1));return 1;}

int add_minimap_entity(lua_State* L){return add_simple_comp(L,minimap_entities,"dst.MiniMapEntity","MiniMapEntity","Cannot add MiniMapEntity to a removed entity");}
int tostring_minimap_entity(lua_State* L){check_comp_owner(L,"dst.MiniMapEntity");lua_pushfstring(L,"MiniMapEntity (%p)",lua_touserdata(L,1));return 1;}

int add_dynamic_shadow(lua_State* L){return add_simple_comp(L,dynamic_shadows,"dst.DynamicShadow","DynamicShadow","Cannot add DynamicShadow to a removed entity");}
int tostring_dynamic_shadow(lua_State* L){check_comp_owner(L,"dst.DynamicShadow");lua_pushfstring(L,"DynamicShadow (%p)",lua_touserdata(L,1));return 1;}

int add_static_shadow(lua_State* L){return add_simple_comp(L,static_shadows,"dst.StaticShadow","StaticShadow","Cannot add StaticShadow to a removed entity");}
int tostring_static_shadow(lua_State* L){check_comp_owner(L,"dst.StaticShadow");lua_pushfstring(L,"StaticShadow (%p)",lua_touserdata(L,1));return 1;}

int add_light_watcher(lua_State* L){return add_simple_comp(L,light_watchers,"dst.LightWatcher","LightWatcher","Cannot add LightWatcher to a removed entity");}
int tostring_light_watcher(lua_State* L){check_comp_owner(L,"dst.LightWatcher");lua_pushfstring(L,"LightWatcher (%p)",lua_touserdata(L,1));return 1;}

int add_ground_creep_entity(lua_State* L){return add_simple_comp(L,ground_creep_entities,"dst.GroundCreepEntity","GroundCreepEntity","Cannot add GroundCreepEntity to a removed entity");}
int tostring_ground_creep_entity(lua_State* L){check_comp_owner(L,"dst.GroundCreepEntity");lua_pushfstring(L,"GroundCreepEntity (%p)",lua_touserdata(L,1));return 1;}

int add_map_explorer(lua_State* L){return add_simple_comp(L,map_explorers,"dst.MapExplorer","MapExplorer","Cannot add MapExplorer to a removed entity");}
int tostring_map_explorer(lua_State* L){check_comp_owner(L,"dst.MapExplorer");lua_pushfstring(L,"MapExplorer (%p)",lua_touserdata(L,1));return 1;}

int add_debug_render(lua_State* L){return add_simple_comp(L,debug_renders,"dst.DebugRender","DebugRender","Cannot add DebugRender to a removed entity");}
int tostring_debug_render(lua_State* L){check_comp_owner(L,"dst.DebugRender");lua_pushfstring(L,"DebugRender (%p)",lua_touserdata(L,1));return 1;}

int add_particle_emitter(lua_State* L){return add_simple_comp(L,particle_emitters,"dst.ParticleEmitter","ParticleEmitter","Cannot add ParticleEmitter to a removed entity");}
int tostring_particle_emitter(lua_State* L){check_comp_owner(L,"dst.ParticleEmitter");lua_pushfstring(L,"ParticleEmitter (%p)",lua_touserdata(L,1));return 1;}

int add_vfx_effect(lua_State* L){return add_simple_comp(L,vfx_effects,"dst.VFXEffect","VFXEffect","Cannot add VFXEffect to a removed entity");}
int tostring_vfx_effect(lua_State* L){check_comp_owner(L,"dst.VFXEffect");lua_pushfstring(L,"VFXEffect (%p)",lua_touserdata(L,1));return 1;}

int add_image_comp(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add Image to a removed entity");
    image_comp_states.try_emplace(id);
    attach_component_userdata(L,id,"dst.Image","Image");
    return 1;
}
int tostring_image_comp(lua_State* L){check_comp_owner(L,"dst.Image");lua_pushfstring(L,"Image (%p)",lua_touserdata(L,1));return 1;}
int image_comp_set_size(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.Image");
    auto it=image_comp_states.find(id);
    if(it!=image_comp_states.end()){
        it->second.w=static_cast<float>(luaL_optnumber(L,2,0.0));
        it->second.h=static_cast<float>(luaL_optnumber(L,3,0.0));
    }
    return 0;
}
int image_comp_get_size(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.Image");
    auto it=image_comp_states.find(id);
    lua_pushnumber(L,it!=image_comp_states.end()?it->second.w:0.0f);
    lua_pushnumber(L,it!=image_comp_states.end()?it->second.h:0.0f);
    return 2;
}

int add_label_comp(lua_State* L){return add_simple_comp(L,labels,"dst.Label","Label","Cannot add Label to a removed entity");}
int tostring_label_comp(lua_State* L){check_comp_owner(L,"dst.Label");lua_pushfstring(L,"Label (%p)",lua_touserdata(L,1));return 1;}

int add_text_edit_widget(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add TextEditWidget to a removed entity");
    text_edit_states.try_emplace(id);
    attach_component_userdata(L,id,"dst.TextEditWidget","TextEditWidget");
    return 1;
}
int tostring_text_edit_widget(lua_State* L){check_comp_owner(L,"dst.TextEditWidget");lua_pushfstring(L,"TextEditWidget (%p)",lua_touserdata(L,1));return 1;}
int tew_set_string(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.TextEditWidget");
    auto it=text_edit_states.find(id);
    if(it!=text_edit_states.end())it->second.text=luaL_optstring(L,2,"");
    return 0;
}
int tew_get_string(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.TextEditWidget");
    auto it=text_edit_states.find(id);
    lua_pushstring(L,it!=text_edit_states.end()?it->second.text.c_str():"");
    return 1;
}
int tew_set_cursor_pos(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.TextEditWidget");
    auto it=text_edit_states.find(id);
    if(it!=text_edit_states.end())it->second.cursor_pos=static_cast<int>(luaL_optinteger(L,2,0));
    return 0;
}
int tew_get_cursor_pos(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.TextEditWidget");
    auto it=text_edit_states.find(id);
    lua_pushinteger(L,it!=text_edit_states.end()?it->second.cursor_pos:0);
    return 1;
}

int add_video_widget(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add VideoWidget to a removed entity");
    video_states.try_emplace(id);
    attach_component_userdata(L,id,"dst.VideoWidget","VideoWidget");
    return 1;
}
int tostring_video_widget(lua_State* L){check_comp_owner(L,"dst.VideoWidget");lua_pushfstring(L,"VideoWidget (%p)",lua_touserdata(L,1));return 1;}
int vw_set_size(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.VideoWidget");
    auto it=video_states.find(id);
    if(it!=video_states.end()){
        it->second.w=static_cast<float>(luaL_optnumber(L,2,100.0));
        it->second.h=static_cast<float>(luaL_optnumber(L,3,100.0));
    }
    return 0;
}
int vw_get_size(lua_State* L){
    uint32_t id=check_comp_owner(L,"dst.VideoWidget");
    auto it=video_states.find(id);
    lua_pushnumber(L,it!=video_states.end()?it->second.w:100.0f);
    lua_pushnumber(L,it!=video_states.end()?it->second.h:100.0f);
    return 2;
}

int add_physics_waker(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id))return luaL_error(L,"Cannot add PhysicsWaker to a removed entity");
    attach_component_userdata(L,id,"dst.PhysicsWaker","PhysicsWaker");
    return 1;
}
int tostring_physics_waker(lua_State* L){check_comp_owner(L,"dst.PhysicsWaker");lua_pushfstring(L,"PhysicsWaker (%p)",lua_touserdata(L,1));return 1;}

bool is_land_point(const MapComponent& m,float wx,float wz){
    int tx=0,ty=0;
    m.world_to_tile(wx,wz,tx,ty);
    uint16_t t=m.tiles.get(tx,ty,web_tiles::default_impassable_tile());
    return web_tiles::is_land(t);
}

}

bool get_anim_snapshot(uint32_t id,AnimSnapshot& out){
    auto it=anim_states.find(id);
    if(it==anim_states.end())return false;
    const auto& a=it->second;
    out.bank=a.bank.c_str();
    out.build=a.skin_build.empty()?a.build.c_str():a.skin_build.c_str();
    out.anim=a.anim.c_str();
    out.layer=a.layer;
    out.sort_order=a.sort_order;
    out.facing=a.facing;
    if(a.playing&&a.loop&&a.queue.empty()){
        double t=std::fmod(std::max(0.0,global_anim_clock-a.start_clock),std::max(0.033,static_cast<double>(a.anim_length)));
        out.current_frame=std::clamp(static_cast<int>(t*30.0),0,std::max(0,a.num_frames-1));
    }else{
        out.current_frame=a.current_frame;
    }
    out.num_frames=a.num_frames;
    for(int i=0;i<4;++i)out.mult_colour[i]=a.mult_colour[i];
    return true;
}

bool get_light_snapshot(uint32_t id,LightSnapshot& out){
    auto it=light_states.find(id);
    if(it==light_states.end()||!it->second.enabled)return false;
    const auto& l=it->second;
    out.enabled=l.enabled;
    out.radius=l.radius;
    out.falloff=l.falloff;
    out.intensity=l.intensity;
    out.r=l.r;out.g=l.g;out.b=l.b;
    return true;
}

void push_map_window(lua_State* L,float cx,float cz,int tile_radius,int stride){
    lua_newtable(L);
    if(maps.empty())return;
    const auto& m=maps.begin()->second;
    int ctx=0,cty=0;
    m.world_to_tile(cx,cz,ctx,cty);
    int st=std::max(1,stride);
    int x0=ctx-tile_radius*st;
    int y0=cty-tile_radius*st;
    int side=tile_radius*2+1;
    lua_pushinteger(L,m.tiles.width);lua_setfield(L,-2,"mapWidth");
    lua_pushinteger(L,m.tiles.height);lua_setfield(L,-2,"mapHeight");
    lua_pushinteger(L,x0);lua_setfield(L,-2,"x0");
    lua_pushinteger(L,y0);lua_setfield(L,-2,"y0");
    lua_pushinteger(L,side);lua_setfield(L,-2,"cols");
    lua_pushinteger(L,side);lua_setfield(L,-2,"rows");
    lua_pushinteger(L,st);lua_setfield(L,-2,"stride");
    lua_createtable(L,side*side,0);
    int idx=1;
    uint16_t imp=web_tiles::default_impassable_tile();
    for(int ry=0;ry<side;++ry){
        int ty=y0+ry*st;
        for(int rx=0;rx<side;++rx){
            int tx=x0+rx*st;
            uint16_t t=m.tiles.get(tx,ty,imp);
            lua_pushinteger(L,t);
            lua_rawseti(L,-2,idx++);
        }
    }
    lua_setfield(L,-2,"data");
}

void step(lua_State* L,float dt){
    if(dt<=0.0f||!host.get_transform||!host.set_position)return;
    global_anim_clock+=dt;
    const MapComponent* map=maps.empty()?nullptr:&maps.begin()->second;
    std::vector<uint32_t> stopped_phys;
    for(uint32_t id:active_physics_ids){
        auto it=physics_states.find(id);
        if(it==physics_states.end()){stopped_phys.push_back(id);continue;}
        auto& p=it->second;
        if(!p.active){stopped_phys.push_back(id);continue;}
        if(p.use_motor){
            if(p.mx==0.0f&&p.my==0.0f&&p.mz==0.0f){p.vx=0.0f;p.vy=0.0f;p.vz=0.0f;stopped_phys.push_back(id);continue;}
        }else if(p.vx==0.0f&&p.vy==0.0f&&p.vz==0.0f){
            stopped_phys.push_back(id);continue;
        }
        if(host.is_awake?!host.is_awake(id):!host.alive(id))continue;
        float x=0,y=0,z=0,rot=0;
        if(!host.get_transform(id,&x,&y,&z,&rot))continue;
        if(p.use_motor){
            float c=std::cos(rot),s=std::sin(rot);
            p.vx=c*p.mx+s*p.mz;
            p.vy=p.my;
            p.vz=-s*p.mx+c*p.mz;
        }
        if(p.vx==0.0f&&p.vy==0.0f&&p.vz==0.0f){stopped_phys.push_back(id);continue;}
        float nx=x+p.vx*dt;
        float ny=std::max(0.0f,y+p.vy*dt);
        float nz=z+p.vz*dt;
        if(!p.passable&&map&&is_land_point(*map,x,z)){
            if(!is_land_point(*map,nx,nz)){
                if(is_land_point(*map,nx,z))nz=z;
                else if(is_land_point(*map,x,nz))nx=x;
                else{nx=x;nz=z;}
            }
        }
        host.set_position(id,nx,ny,nz);
        if(!p.use_motor&&y>0.0f){
            p.vy-=24.0f*dt;
            if(ny<=0.0f){p.vx*=0.5f;p.vz*=0.5f;p.vy=0.0f;}
        }
    }
    for(uint32_t id:stopped_phys)active_physics_ids.erase(id);

    std::vector<std::pair<uint32_t,bool>> finished_anims;
    std::vector<uint32_t> inactive_anims;
    for(uint32_t id:active_anim_ids){
        auto it=anim_states.find(id);
        if(it==anim_states.end()){inactive_anims.push_back(id);continue;}
        auto& a=it->second;
        if(!a.playing||(a.loop&&a.queue.empty())){inactive_anims.push_back(id);continue;}
        if(host.is_awake?!host.is_awake(id):!host.alive(id)){
            // Sleeping world props playing a one-shot initial idle can settle immediately
            a.done=true;
            a.playing=false;
            inactive_anims.push_back(id);
            continue;
        }
        a.anim_time+=dt;
        int f=static_cast<int>(a.anim_time*30.0f);
        a.current_frame=std::clamp(f,0,std::max(0,a.num_frames-1));
        if(a.anim_time>=a.anim_length){
            if(!a.queue.empty()){
                auto next=a.queue.front();
                a.queue.erase(a.queue.begin());
                start_anim_clip_raw(a,next.first,next.second);
                if(!a.playing||(a.loop&&a.queue.empty()))inactive_anims.push_back(id);
                finished_anims.emplace_back(id,false);
            }else if(a.loop){
                a.anim_time=std::fmod(a.anim_time,std::max(0.033f,a.anim_length));
                a.current_frame=0;
                inactive_anims.push_back(id);
            }else{
                a.done=true;
                a.playing=false;
                inactive_anims.push_back(id);
                finished_anims.emplace_back(id,true);
            }
        }
    }
    for(uint32_t id:inactive_anims)active_anim_ids.erase(id);

    if(!finished_anims.empty()&&L){
        int top=lua_gettop(L);
        lua_getglobal(L,"Ents");
        if(lua_istable(L,-1)){
            int ents_idx=lua_gettop(L);
            for(const auto& item:finished_anims){
                lua_rawgeti(L,ents_idx,item.first);
                if(lua_istable(L,-1)){
                    int ent_idx=lua_gettop(L);
                    lua_getfield(L,ent_idx,"sg");
                    bool has_sg=!lua_isnil(L,-1);
                    lua_pop(L,1);
                    if(!has_sg){
                        lua_getfield(L,ent_idx,"event_listeners");
                        if(lua_istable(L,-1)){
                            lua_getfield(L,-1,"animover");
                            has_sg=!lua_isnil(L,-1);
                            lua_pop(L,1);
                        }
                        lua_pop(L,1);
                    }
                    if(has_sg){
                        lua_getfield(L,ent_idx,"PushEvent");
                        if(lua_isfunction(L,-1)){
                            lua_pushvalue(L,ent_idx);
                            lua_pushliteral(L,"animover");
                            lua_pcall(L,2,0,0);
                        }else lua_pop(L,1);
                        if(item.second){
                            lua_getfield(L,ent_idx,"PushEvent");
                            if(lua_isfunction(L,-1)){
                                lua_pushvalue(L,ent_idx);
                                lua_pushliteral(L,"animqueueover");
                                lua_pcall(L,2,0,0);
                            }else lua_pop(L,1);
                        }
                    }
                }
                lua_pop(L,1);
            }
        }
        lua_settop(L,top);
    }
}

void retire(uint32_t id){
    maps.erase(id);
    pathfinders.erase(id);
    creeps.erase(id);
    minimaps.erase(id);
    waves.erase(id);
    networks.erase(id);
    shard_networks.erase(id);
    shard_clients.erase(id);
    server_non_sleepables.erase(id);
    client_sleepables.erase(id);
    anim_states.erase(id);
    active_anim_ids.erase(id);
    physics_states.erase(id);
    active_physics_ids.erase(id);
    light_states.erase(id);
    image_comp_states.erase(id);
    text_edit_states.erase(id);
    video_states.erase(id);
    followers.erase(id);
    minimap_entities.erase(id);
    dynamic_shadows.erase(id);
    static_shadows.erase(id);
    light_watchers.erase(id);
    ground_creep_entities.erase(id);
    map_explorers.erase(id);
    debug_renders.erase(id);
    particle_emitters.erase(id);
    vfx_effects.erase(id);
    labels.erase(id);
    auto it=entity_net_states.find(id);
    if(it!=entity_net_states.end()){
        for(uint32_t nvid:it->second.netvar_ids)netvars.erase(nvid);
        entity_net_states.erase(it);
    }
}

void clear(){
    maps.clear();
    pathfinders.clear();
    creeps.clear();
    minimaps.clear();
    waves.clear();
    networks.clear();
    shard_networks.clear();
    shard_clients.clear();
    server_non_sleepables.clear();
    client_sleepables.clear();
    anim_states.clear();
    active_anim_ids.clear();
    global_anim_clock=0.0;
    physics_states.clear();
    active_physics_ids.clear();
    light_states.clear();
    image_comp_states.clear();
    text_edit_states.clear();
    video_states.clear();
    followers.clear();
    minimap_entities.clear();
    dynamic_shadows.clear();
    static_shadows.clear();
    light_watchers.clear();
    ground_creep_entities.clear();
    map_explorers.clear();
    debug_renders.clear();
    particle_emitters.clear();
    vfx_effects.clear();
    labels.clear();
    entity_net_states.clear();
    netvars.clear();
    next_netvar_id=1;
}

void register_component_metatable(lua_State* L,const char* mt_name,const char* global_name,const luaL_Reg* methods,lua_CFunction tostring_fn){
    luaL_newmetatable(L,mt_name);
    lua_getglobal(L,global_name);
    if(!lua_istable(L,-1)){
        lua_pop(L,1);
        lua_newtable(L);
        lua_pushvalue(L,-1);
        lua_setglobal(L,global_name);
    }
    if(methods)luaL_register(L,nullptr,methods);
    lua_setfield(L,-2,"__index");
    if(tostring_fn){
        lua_pushcfunction(L,tostring_fn);
        lua_setfield(L,-2,"__tostring");
    }
    lua_pop(L,1);
}

void install(lua_State* L,web_components::EntityHost callbacks){
    clear();host=callbacks;
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
    register_component_metatable(L,"dst.Map","Map",map_methods,tostring_map);

    const luaL_Reg pf_methods[]={
        {"IsClear",pf_is_clear},{"AddWall",pf_add_wall},{"RemoveWall",pf_remove_wall},{"HasWall",pf_has_wall},
        {"AddStaticHoppablePlatform",pf_add_platform},{"RemoveStaticHoppablePlatform",pf_remove_platform},{"HasStaticHoppablePlatform",pf_has_platform},
        {"SubmitSearch",pf_submit_search},{"GetSearchStatus",pf_get_search_status},{"GetSearchResult",pf_get_search_result},{"KillSearch",pf_kill_search},
        {"GetPathTileIndexFromPoint",pf_get_path_tile_index},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Pathfinder","Pathfinder",pf_methods,tostring_pf);

    const luaL_Reg creep_methods[]={
        {"OnCreep",creep_on_creep},{"SetUpdateInterval",creep_set_update_interval},
        {"TriggerCreepSpawners",creep_trigger_spawners},{"GetTriggeredCreepSpawners",creep_get_triggered_spawners},
        {"AddRenderLayer",creep_add_render_layer},{"GetAsString",creep_get_as_string},{"SetFromString",creep_set_from_string},
        {"FastForward",creep_fast_forward},{"SetMaxRadius",creep_set_max_radius},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.GroundCreep","GroundCreep",creep_methods,tostring_creep);

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
    register_component_metatable(L,"dst.MiniMap","MiniMap",mm_methods,tostring_minimap);

    const luaL_Reg wave_methods[]={
        {"SetWaveParams",wave_set_params},{"SetWaveSize",wave_set_size},
        {"SetWaveTexture",wave_set_texture},{"SetWaveEffect",wave_set_effect},
        {"Init",wave_init},{"SetWaveMotion",wave_set_motion},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.WaveComponent","WaveComponent",wave_methods,tostring_wave);

    const luaL_Reg net_methods[]={
        {"GetClientName",net_get_client_name},{"GetUserID",net_get_user_id},
        {"SetClassifiedTarget",net_set_classified_target},
        {"SetPlayerAge",net_set_player_age},{"GetPlayerAge",net_get_player_age},
        {"GetPlayerColour",net_get_player_colour},
        {"AddUserFlag",net_add_user_flag},{"RemoveUserFlag",net_remove_user_flag},{"GetUserFlags",net_get_user_flags},
        {"SetPlayerEquip",net_set_player_equip},{"SetPlayerSkin",net_set_player_skin},{"SetPlayerSkillSelection",net_set_player_skill_selection},
        {"IsServerAdmin",net_is_server_admin},{"IsConsecutiveMatch",net_is_consecutive_match},{"SetConsecutiveMatch",net_set_consecutive_match},
        {"IsPlayingWithFriends",net_is_playing_with_friends},{"IsBorrowed",net_is_borrowed},{"GetNetworkID",net_get_network_id},
        {nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Network","Network",net_methods,tostring_network);
    register_component_metatable(L,"dst.ShardNetwork","ShardNetwork",nullptr,tostring_shard_network);
    register_component_metatable(L,"dst.ShardClient","ShardClient",nullptr,tostring_shard_client);
    register_component_metatable(L,"dst.ServerNonSleepable","ServerNonSleepable",nullptr,tostring_server_non_sleepable);
    register_component_metatable(L,"dst.ClientSleepable","ClientSleepable",nullptr,tostring_client_sleepable);

    const luaL_Reg anim_methods[]={
        {"PlayAnimation",anim_play},{"SetBuild",anim_set_build},{"SetSkin",anim_set_skin},
        {"BuildHasSymbol",comp_true},{"SetBank",anim_set_bank},{"SetBankAndPlayAnimation",anim_set_bank_and_play},
        {"SetLayer",anim_set_layer},{"GetLayer",anim_get_layer},{"SetScale",comp_noop},
        {"SetDepthTestEnabled",comp_noop},{"SetDepthWriteEnabled",comp_noop},{"SetDepthBias",comp_noop},
        {"AnimDone",anim_done},{"PushAnimation",anim_push},{"Hide",comp_noop},{"Show",comp_noop},
        {"HideSymbol",comp_noop},{"ShowSymbol",comp_noop},{"Pause",comp_noop},{"Resume",comp_noop},
        {"SetPercent",comp_noop},{"SetAddColour",anim_set_add_colour},{"SetMultColour",anim_set_mult_colour},
        {"SetHue",anim_set_hue},{"SetSaturation",anim_set_saturation},{"SetBrightness",anim_set_brightness},
        {"SetHighlightColour",comp_noop},{"SetTime",comp_noop},{"SetFrame",comp_noop},
        {"SetDeltaTimeMultiplier",comp_noop},{"SetRayTestOnBB",comp_noop},
        {"GetSymbolOverride",anim_get_symbol_override},{"OverrideSymbol",anim_override_symbol},
        {"OverrideSkinSymbol",anim_override_symbol},{"IsSkinBuild",anim_is_skin_build},
        {"OverrideItemSkinSymbol",anim_override_symbol},{"AssignItemSkins",comp_noop},
        {"ClearAllOverrideSymbols",anim_clear_all_override_symbols},{"ClearOverrideSymbol",anim_clear_override_symbol},
        {"AddOverrideBuild",comp_noop},{"ClearOverrideBuild",comp_noop},
        {"GetSymbolPosition",anim_get_symbol_position},{"SetFinalOffset",comp_noop},
        {"SetSortOrder",anim_set_sort_order},{"GetSortOrder",anim_get_sort_order},
        {"SetSortWorldOffset",comp_noop},{"SetInheritsSortKey",anim_set_inherits_sort_key},{"GetInheritsSortKey",anim_get_inherits_sort_key},
        {"SetOrientation",comp_noop},{"SetManualBB",comp_noop},{"GetVisualBB",anim_get_visual_bb},
        {"GetMultColour",anim_get_mult_colour},{"GetAddColour",anim_get_add_colour},
        {"GetHue",anim_get_hue},{"GetSaturation",anim_get_saturation},{"GetBrightness",anim_get_brightness},
        {"OverrideMultColour",comp_noop},{"OverrideHue",comp_noop},{"OverrideSaturation",comp_noop},
        {"OverrideBrightness",comp_noop},{"OverrideShade",comp_noop},
        {"SetSymbolAddColour",comp_noop},{"SetSymbolMultColour",comp_noop},{"SetSymbolHue",comp_noop},
        {"SetSymbolSaturation",comp_noop},{"SetSymbolBrightness",comp_noop},
        {"GetSymbolAddColour",anim_get_symbol_add_colour},{"GetSymbolMultColour",anim_get_symbol_mult_colour},{"GetSymbolHSB",anim_get_symbol_hsb},
        {"SetSymbolLightOverride",comp_noop},{"SetSymbolBloom",comp_noop},{"ClearSymbolBloom",comp_noop},
        {"ClearBloomEffectHandle",comp_noop},{"SetBloomEffectHandle",comp_noop},
        {"ClearDefaultEffectHandle",comp_noop},{"SetDefaultEffectHandle",comp_noop},
        {"SetHaunted",comp_noop},{"SetLightOverride",comp_noop},
        {"IsCurrentAnimation",anim_is_current_animation},{"GetCurrentAnimationHash",anim_get_current_anim_hash},
        {"GetCurrentAnimationLength",anim_get_current_anim_length},{"GetCurrentAnimationTime",anim_get_current_anim_time},
        {"GetCurrentAnimationNumFrames",anim_get_current_anim_num_frames},{"GetCurrentAnimationFrame",anim_get_current_anim_frame},
        {"GetCurrentBankName",anim_get_current_bank_name},{"GetBankHash",anim_get_bank_hash},
        {"GetSkinBuild",anim_get_skin_build},{"GetBuild",anim_get_build},
        {"SetErosionParams",comp_noop},{"SetErosionParallax",comp_noop},{"SetFloatParams",comp_noop},{"SetOceanBlendParams",comp_noop},
        {"GetCurrentFacing",anim_get_current_facing},{"FastForward",comp_noop},
        {"SetClientSideBuildOverrideFlag",comp_noop},{"SetClientsideBuildOverride",comp_noop},
        {"SetSymbolExchange",comp_noop},{"SetMultiSymbolExchange",comp_noop},{"ClearSymbolExchanges",comp_noop},
        {"UseHeadHatExchange",comp_noop},{"SetHatOffset",comp_noop},
        {"CompareSymbolBuilds",anim_compare_symbol_builds},{"IsSymbolOverridden",anim_is_symbol_overridden},
        {"UsePointFiltering",comp_noop},{"SetForceSinglePass",comp_noop},{"UseColourCube",comp_noop},
        {"SetWorldSpaceAmbientLightPos",comp_noop},{"SetUILightParams",comp_noop},
        {"AnimateWhilePaused",comp_noop},{"GetHistoryData",anim_get_history_data},{"MakeFacingDirty",comp_noop},
        {nullptr,nullptr}
    };
    register_component_metatable(L,"dst.AnimState","AnimState",anim_methods,tostring_anim_state);

    const luaL_Reg phys_methods[]={
        {"SetMotorVel",phys_set_motor_vel},{"GetMotorVel",phys_get_motor_vel},
        {"SetMotorVelOverride",phys_set_motor_vel},{"ClearMotorVelOverride",comp_noop},
        {"SetMotorVelExternal",phys_set_motor_vel},{"GetMotorSpeed",phys_get_motor_speed},
        {"SetVel",phys_set_vel},{"Stop",phys_stop},{"GetVelocity",phys_get_velocity},
        {"SetSphere",phys_set_sphere},{"SetCapsule",phys_set_capsule},{"SetCylinder",phys_set_capsule},
        {"GetRadius",phys_get_radius},{"GetHeight",phys_get_height},
        {"GetMass",phys_get_mass},{"SetMass",phys_set_mass},{"SetTempMass0",comp_noop},
        {"SetCollides",comp_noop},{"GeoProbe",comp_noop},
        {"Teleport",phys_teleport},{"TeleportRespectingInterpolation",phys_teleport},{"TeleportOffset",comp_noop},
        {"SetActive",phys_set_active},{"IsActive",phys_is_active},{"SetDontRemoveOnSleep",comp_noop},
        {"IsPassable",phys_is_passable},{"CheckGridOffset",comp_true},
        {"GetCollisionMask",phys_get_collision_mask},{"SetCollisionMask",phys_set_collision_mask},
        {"SetLocalCollisionMask",comp_noop},{"ClearLocalCollisionMask",comp_noop},
        {"GetCollisionGroup",phys_get_collision_group},{"SetCollisionGroup",phys_set_collision_group},
        {"CollidesWith",phys_collides_with},{"ClearCollidesWith",phys_clear_collides_with},{"ClearCollisionMask",phys_clear_collision_mask},
        {"SetFriction",comp_noop},{"SetRestitution",comp_noop},{"SetDamping",comp_noop},
        {"SetCollisionCallback",comp_noop},{"SetTriangleMesh",comp_noop},{"ClearTransformationHistory",comp_noop},
        {"ConstrainTo",comp_noop},{"P2PConstrainTo",comp_noop},{"SetP2PConstrainPivots",comp_noop},
        {"TEMPHACK_DisableSleepDeactivation",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Physics","Physics",phys_methods,tostring_physics);

    const luaL_Reg light_methods[]={
        {"Enable",light_enable},{"IsEnabled",light_is_enabled},
        {"SetRadius",light_set_radius},{"GetRadius",light_get_radius},{"GetCalculatedRadius",light_get_radius},
        {"SetFalloff",light_set_falloff},{"GetFalloff",light_get_falloff},
        {"SetIntensity",light_set_intensity},{"GetIntensity",light_get_intensity},
        {"SetColour",light_set_colour},{"GetColour",light_get_colour},
        {"SetDisableOnSceneRemoval",light_set_disable_on_removal},{"GetDisableOnSceneRemoval",light_get_disable_on_removal},
        {"EnableClientModulation",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Light","Light",light_methods,tostring_light);

    const luaL_Reg follower_methods[]={
        {"FollowSymbol",comp_noop},{"SetOffset",comp_noop},{"StopFollowing",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Follower","Follower",follower_methods,tostring_follower);

    const luaL_Reg mme_methods[]={
        {"SetDrawOverFogOfWar",comp_noop},{"SetIcon",comp_noop},{"CopyIcon",comp_noop},
        {"SetPriority",comp_noop},{"SetEnabled",comp_noop},{"SetCanUseCache",comp_noop},
        {"SetRestriction",comp_noop},{"EntityHasRestriction",comp_false},
        {"SetIsProxy",comp_noop},{"SetIsFogRevealer",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.MiniMapEntity","MiniMapEntity",mme_methods,tostring_minimap_entity);

    const luaL_Reg dshadow_methods[]={{"SetSize",comp_noop},{"Enable",comp_noop},{nullptr,nullptr}};
    register_component_metatable(L,"dst.DynamicShadow","DynamicShadow",dshadow_methods,tostring_dynamic_shadow);

    const luaL_Reg sshadow_methods[]={{"SetSize",comp_noop},{nullptr,nullptr}};
    register_component_metatable(L,"dst.StaticShadow","StaticShadow",sshadow_methods,tostring_static_shadow);

    const luaL_Reg lw_methods[]={
        {"IsInLight",comp_true},{"GetTimeInLight",comp_one},{"GetTimeInDark",comp_zero},
        {"SetLightThresh",comp_noop},{"SetDarkThresh",comp_noop},
        {"GetLightAngle",comp_zero},{"GetLightValue",comp_one},{"SetMinLightThresh",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.LightWatcher","LightWatcher",lw_methods,tostring_light_watcher);

    const luaL_Reg gce_methods[]={{"SetRadius",comp_noop},{nullptr,nullptr}};
    register_component_metatable(L,"dst.GroundCreepEntity","GroundCreepEntity",gce_methods,tostring_ground_creep_entity);

    const luaL_Reg mex_methods[]={
        {"ActivateLocalMiniMap",comp_noop},{"DeactivateLocalMiniMap",comp_noop},{"EnableUpdate",comp_noop},
        {"RevealArea",comp_noop},{"RevealEntity",comp_noop},
        {"RecordMap",comp_empty_str},{"LearnRecordedMap",comp_true},{"IsTileSeeableInRecordedMap",comp_true},
        {"RecordAllMaps",comp_noop},{"LearnAllMaps",comp_noop},
        {"IsTileVisited",comp_true},{"IsTileSeeable",comp_true},{"GetSeeableTileCount",comp_zero},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.MapExplorer","MapExplorer",mex_methods,tostring_map_explorer);

    const luaL_Reg dbg_methods[]={
        {"Flush",comp_noop},{"SetZ",comp_noop},{"SetRenderLoop",comp_noop},
        {"Line",comp_noop},{"String",comp_noop},{"Circle",comp_noop},
        {"Box",comp_noop},{"Poly",comp_noop},{"Triangle",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.DebugRender","DebugRender",dbg_methods,tostring_debug_render);

    const luaL_Reg pe_methods[]={
        {"SetAcceleration",comp_noop},{"SetDragCoefficient",comp_noop},
        {"AddParticle",comp_noop},{"AddParticleUV",comp_noop},{"AddRotatingParticle",comp_noop},{"AddRotatingParticleUV",comp_noop},
        {"SetRenderResources",comp_noop},{"SetRotationStatus",comp_noop},
        {"SetMaxNumParticles",comp_noop},{"SetMaxLifetime",comp_noop},
        {"SetColourEnvelope",comp_noop},{"SetScaleEnvelope",comp_noop},{"SetSpawnVectors",comp_noop},
        {"SetSortOrder",comp_noop},{"SetBlendMode",comp_noop},{"SetUVFrameSize",comp_noop},
        {"EnableBloomPass",comp_noop},{"EnableDepthTest",comp_noop},
        {"GetNumLiveParticles",comp_zero},{"ClearAllParticles",comp_noop},
        {"SetRadius",comp_noop},{"FastForward",comp_noop},{"SetLayer",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.ParticleEmitter","ParticleEmitter",pe_methods,tostring_particle_emitter);

    const luaL_Reg vfx_methods[]={
        {"InitEmitters",comp_noop},{"SetAcceleration",comp_noop},{"SetDragCoefficient",comp_noop},
        {"SetAngularAcceleration",comp_noop},{"SetAngularDragCoefficient",comp_noop},
        {"SetRenderResources",comp_noop},{"SetFollowEmitter",comp_noop},{"SetWorldSpaceEmitter",comp_noop},
        {"SetRotationStatus",comp_noop},{"SetRotateOnVelocity",comp_noop},{"SetGroundPhysics",comp_noop},
        {"SetMaxNumParticles",comp_noop},{"SetMaxLifetime",comp_noop},
        {"SetColourEnvelope",comp_noop},{"SetScaleEnvelope",comp_noop},{"SetSpawnVectors",comp_noop},
        {"SetSortOrder",comp_noop},{"SetSortOffset",comp_noop},{"SetLayer",comp_noop},
        {"SetBlendMode",comp_noop},{"SetUVFrameSize",comp_noop},{"SetKillOnEntityDeath",comp_noop},{"SetIsTrailEmitter",comp_noop},
        {"EnableBloomPass",comp_noop},{"EnableDepthTest",comp_noop},{"EnableDepthWrite",comp_noop},
        {"GetNumLiveParticles",comp_zero},{"ClearAllParticles",comp_noop},{"SetRadius",comp_noop},
        {"AddParticle",comp_noop},{"AddParticleUV",comp_noop},{"AddRotatingParticle",comp_noop},{"AddRotatingParticleUV",comp_noop},
        {"FastForward",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.VFXEffect","VFXEffect",vfx_methods,tostring_vfx_effect);

    const luaL_Reg img_methods[]={
        {"Enable",comp_noop},{"SetTexture",comp_noop},{"SetTextureHandle",comp_noop},
        {"SetUIOffset",comp_noop},{"SetWorldOffset",comp_noop},{"SetTint",comp_noop},
        {"SetBlendMode",comp_noop},{"SetAlphaRange",comp_noop},{"SetEffect",comp_noop},
        {"SetSize",image_comp_set_size},{"GetSize",image_comp_get_size},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Image","Image",img_methods,tostring_image_comp);

    const luaL_Reg lbl_methods[]={
        {"Enable",comp_noop},{"SetText",comp_noop},{"SetFont",comp_noop},{"SetFontSize",comp_noop},
        {"SetUIOffset",comp_noop},{"SetWorldOffset",comp_noop},{"SetColour",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.Label","Label",lbl_methods,tostring_label_comp);

    const luaL_Reg tew_methods[]={
        {"SetString",tew_set_string},{"GetString",tew_get_string},
        {"SetEditCursorPos",tew_set_cursor_pos},{"GetEditCursorPos",tew_get_cursor_pos},
        {"OnTextInput",comp_false},{"OnKeyDown",comp_false},{"OnKeyUp",comp_false},{"OnControl",comp_false},
        {"SetPassword",comp_noop},{"SetForceUpperCase",comp_noop},{"EnableScrollEditWindow",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.TextEditWidget","TextEditWidget",tew_methods,tostring_text_edit_widget);

    const luaL_Reg vw_methods[]={
        {"SetSize",vw_set_size},{"GetSize",vw_get_size},{"SetTint",comp_noop},
        {"SetAlphaRange",comp_noop},{"SetUVScale",comp_noop},
        {"SetVAnchor",comp_noop},{"SetHAnchor",comp_noop},
        {"Load",comp_true},{"Play",comp_noop},{"IsDone",comp_true},{"Pause",comp_noop},{"Stop",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.VideoWidget","VideoWidget",vw_methods,tostring_video_widget);

    const luaL_Reg pw_methods[]={
        {"SetTimeBetweenWakeTests",comp_noop},{"StartWakeTests",comp_noop},{"StopWakeTests",comp_noop},{nullptr,nullptr}
    };
    register_component_metatable(L,"dst.PhysicsWaker","PhysicsWaker",pw_methods,tostring_physics_waker);

    luaL_newmetatable(L,"dst.NetVar");lua_newtable(L);
    const luaL_Reg nv_methods[]={
        {"set",netvar_set},{"set_local",netvar_set_local},{"value",netvar_value},{nullptr,nullptr}
    };
    luaL_register(L,nullptr,nv_methods);lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_netvar);lua_setfield(L,-2,"__tostring");lua_pop(L,1);

    const struct {const char* name;NetVarType type;} nv_types[]={
        {"net_bool",NetVarType::BOOL},{"net_tinybyte",NetVarType::TINYBYTE},{"net_smallbyte",NetVarType::SMALLBYTE},
        {"net_byte",NetVarType::BYTE},{"net_shortint",NetVarType::SHORTINT},{"net_ushortint",NetVarType::USHORTINT},
        {"net_int",NetVarType::INT},{"net_uint",NetVarType::UINT},{"net_float",NetVarType::FLOAT},
        {"net_hash",NetVarType::HASH},{"net_string",NetVarType::STRING},{"net_entity",NetVarType::ENTITY},
        {"net_bytearray",NetVarType::BYTEARRAY},{"net_smallbytearray",NetVarType::SMALLBYTEARRAY},{"net_ushortarray",NetVarType::USHORTARRAY}
    };
    for(const auto& nvt:nv_types){
        lua_newtable(L);
        luaL_register(L,nullptr,nv_methods);
        lua_newtable(L);
        lua_pushinteger(L,static_cast<int>(nvt.type));
        lua_pushcclosure(L,create_netvar,1);
        lua_setfield(L,-2,"__call");
        lua_setmetatable(L,-2);
        lua_setglobal(L,nvt.name);
    }

    lua_getglobal(L,"Entity");
    lua_pushcfunction(L,add_map);lua_setfield(L,-2,"AddMap");
    lua_pushcfunction(L,add_pathfinder);lua_setfield(L,-2,"AddPathfinder");
    lua_pushcfunction(L,add_ground_creep);lua_setfield(L,-2,"AddGroundCreep");
    lua_pushcfunction(L,add_minimap);lua_setfield(L,-2,"AddMiniMap");
    lua_pushcfunction(L,add_wave);lua_setfield(L,-2,"AddWaveComponent");
    lua_pushcfunction(L,add_network);lua_setfield(L,-2,"AddNetwork");
    lua_pushcfunction(L,add_shard_network);lua_setfield(L,-2,"AddShardNetwork");
    lua_pushcfunction(L,add_shard_client);lua_setfield(L,-2,"AddShardClient");
    lua_pushcfunction(L,add_server_non_sleepable);lua_setfield(L,-2,"AddServerNonSleepable");
    lua_pushcfunction(L,add_client_sleepable);lua_setfield(L,-2,"AddClientSleepable");
    lua_pushcfunction(L,add_anim_state);lua_setfield(L,-2,"AddAnimState");
    lua_pushcfunction(L,add_physics);lua_setfield(L,-2,"AddPhysics");
    lua_pushcfunction(L,add_physics_waker);lua_setfield(L,-2,"AddPhysicsWaker");
    lua_pushcfunction(L,add_light);lua_setfield(L,-2,"AddLight");
    lua_pushcfunction(L,add_follower);lua_setfield(L,-2,"AddFollower");
    lua_pushcfunction(L,add_minimap_entity);lua_setfield(L,-2,"AddMiniMapEntity");
    lua_pushcfunction(L,add_dynamic_shadow);lua_setfield(L,-2,"AddDynamicShadow");
    lua_pushcfunction(L,add_static_shadow);lua_setfield(L,-2,"AddStaticShadow");
    lua_pushcfunction(L,add_light_watcher);lua_setfield(L,-2,"AddLightWatcher");
    lua_pushcfunction(L,add_ground_creep_entity);lua_setfield(L,-2,"AddGroundCreepEntity");
    lua_pushcfunction(L,add_map_explorer);lua_setfield(L,-2,"AddMapExplorer");
    lua_pushcfunction(L,add_debug_render);lua_setfield(L,-2,"AddDebugRender");
    lua_pushcfunction(L,add_particle_emitter);lua_setfield(L,-2,"AddParticleEmitter");
    lua_pushcfunction(L,add_vfx_effect);lua_setfield(L,-2,"AddVFXEffect");
    lua_pushcfunction(L,add_image_comp);lua_setfield(L,-2,"AddImage");
    lua_pushcfunction(L,add_label_comp);lua_setfield(L,-2,"AddLabel");
    lua_pushcfunction(L,add_text_edit_widget);lua_setfield(L,-2,"AddTextEditWidget");
    lua_pushcfunction(L,add_video_widget);lua_setfield(L,-2,"AddVideoWidget");
    lua_pushcfunction(L,entity_set_pristine);lua_setfield(L,-2,"SetPristine");
    lua_pushcfunction(L,entity_flush_local_dirty_netvars);lua_setfield(L,-2,"FlushLocalDirtyNetVars");
    lua_pushcfunction(L,entity_set_aabb);lua_setfield(L,-2,"SetAABB");
    lua_pushcfunction(L,entity_set_selected);lua_setfield(L,-2,"SetSelected");
    lua_pushcfunction(L,entity_set_in_limbo);lua_setfield(L,-2,"SetInLimbo");
    lua_pushcfunction(L,entity_frustum_check);lua_setfield(L,-2,"FrustumCheck");
    lua_pushcfunction(L,entity_frustum_check);lua_setfield(L,-2,"FrustumCheckWithAABB");
    lua_pushcfunction(L,entity_set_platform);lua_setfield(L,-2,"SetPlatform");
    lua_pushcfunction(L,entity_get_platform);lua_setfield(L,-2,"GetPlatform");
    lua_pushcfunction(L,entity_get_debug_string);lua_setfield(L,-2,"GetDebugString");
    lua_pushcfunction(L,entity_enable_movement_prediction);lua_setfield(L,-2,"EnableMovementPrediction");
    lua_pushcfunction(L,entity_can_predict_movement);lua_setfield(L,-2,"CanPredictMovement");
    lua_pushcfunction(L,entity_set_is_predicting_movement);lua_setfield(L,-2,"SetIsPredictingMovement");
    lua_pushcfunction(L,entity_movement_noop);lua_setfield(L,-2,"FlattenMovementPrediction");
    lua_pushcfunction(L,entity_movement_noop);lua_setfield(L,-2,"ClearMovementPrediction");
    lua_pushcfunction(L,entity_get_history_data);lua_setfield(L,-2,"GetHistoryData");
    lua_pushcfunction(L,entity_get_anim_state_data);lua_setfield(L,-2,"GetAnimStateData");
    lua_pushcfunction(L,entity_world_to_local_space);lua_setfield(L,-2,"WorldToLocalSpace");
    lua_pushcfunction(L,entity_local_to_world_space);lua_setfield(L,-2,"LocalToWorldSpace");
    lua_pushcfunction(L,entity_local_to_world_space);lua_setfield(L,-2,"LocalToWorldSpaceIncParent");
    lua_pop(L,1);
}
}

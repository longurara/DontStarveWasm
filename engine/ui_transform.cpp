#include "ui_transform.hpp"
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <string>
extern "C" {
#include "lauxlib.h"
}
namespace web_ui {
namespace {
using Vector=std::array<float,3>;
using Matrix=std::array<float,16>;
using Rect=std::array<int16_t,4>;
struct UI {
    Vector position{},world{},scale{1,1,1};
    float rotation=0,max_upscale=3;
    int32_t h_anchor=3,v_anchor=3,scale_mode=0,facing=8;
    Matrix local{},matrix{};
    bool has_scissor=false,clear_scissor=false;
    Rect scissor{},transformed_scissor{};
};
web_components::EntityHost host{};
std::map<uint32_t,UI> nodes;
int width=0,height=0;
constexpr size_t budget=16384;
constexpr float degree=0.01745329238474369f;
Matrix identity(){return {1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};}
Matrix multiply(const Matrix& a,const Matrix& b){
    Matrix result{};
    for(int row=0;row<4;++row)for(int col=0;col<4;++col){
        float value=a[row*4]*b[col];value+=a[row*4+1]*b[4+col];value+=a[row*4+2]*b[8+col];value+=a[row*4+3]*b[12+col];result[row*4+col]=value;
    }
    return result;
}
Vector point(const Matrix& m,float x,float y,float z){
    std::array<float,4> out{};
    for(int row=0;row<4;++row){float v=m[row*4]*x;v+=m[row*4+1]*y;v+=m[row*4+2]*z;v+=m[row*4+3];out[row]=v;}
    return {out[0]/out[3],out[1]/out[3],out[2]/out[3]};
}
int32_t integer(double value){value=std::trunc(value);return std::isfinite(value)&&value>=-2147483648.0&&value<=2147483647.0?static_cast<int32_t>(value):INT32_MIN;}
int32_t facing_integer(double value){value=std::trunc(value);
    if(!std::isfinite(value)||value<-9223372036854775808.0||value>=9223372036854775808.0)return 0;
    return static_cast<int32_t>(static_cast<uint32_t>(static_cast<int64_t>(value)));
}
int16_t short_integer(double value){return static_cast<int16_t>(static_cast<uint16_t>(integer(value)));}
float normalized(float value){constexpr float tau=6.2831854820251465f,pi=3.1415927410125732f;float cycles=std::floor(value/tau);float wrapped=value+(-cycles*tau);return wrapped>pi?wrapped-tau:wrapped;}
bool resolve(uint32_t id,Matrix& result,std::map<uint32_t,unsigned char>& marks,unsigned depth){
    if(!id){result=identity();return true;}
    if(depth>512||!host.alive(id))return false;
    auto found=nodes.find(id);
    if(found==nodes.end()){
        Matrix local=identity();
        if(!host.local_matrix(id,local.data())){result=identity();return true;}
        Matrix parent;if(!resolve(host.parent(id),parent,marks,depth+1))return false;
        result=multiply(parent,local);return true;
    }
    if(marks[id]==2){result=found->second.matrix;return true;}
    if(marks[id]==1)return false;
    marks[id]=1;auto& value=found->second;
    Matrix parent;if(!resolve(host.parent(id),parent,marks,depth+1))return false;
    bool inherit=value.h_anchor==3&&value.v_anchor==3;
    float anchor_x=0,anchor_y=0;
    if(!inherit){
        if(value.h_anchor==0)anchor_x=static_cast<float>(width)*0.5f;
        if(value.h_anchor==2)anchor_x=static_cast<float>(width);
        if(value.v_anchor==0)anchor_y=static_cast<float>(height)*0.5f;
        if(value.v_anchor==1)anchor_y=static_cast<float>(height);
    }
    if(value.scale_mode>=1&&value.scale_mode<=4){
        inherit=false;
        // No render-bounds component exists yet. Native's empty AABB has
        // negative extents, so FILL falls back to unit scale. Real bounds
        // must be integrated when Image/Text/AnimState renderables are added.
        if(value.scale_mode==1)value.scale={1,1,1};
        if(value.scale_mode==2){
            float x=static_cast<float>(width)/1280.0f,y=static_cast<float>(height)/720.0f;
            float scale=x>y?y:x;if(scale>=1)scale=value.max_upscale>scale?scale:value.max_upscale;
            value.scale={scale,scale,scale};
        }
        if(value.scale_mode==3||value.scale_mode==4)value.scale={static_cast<float>(width)/1280.0f,static_cast<float>(height)/720.0f,1};
    }
    Matrix translation=identity();translation[3]=anchor_x+value.position[0];translation[7]=anchor_y+value.position[1];translation[11]=value.position[2]+0.0f;
    Matrix scaling=identity();scaling[0]=value.scale[0];scaling[5]=value.scale[1];scaling[10]=value.scale[2];
    float angle=value.rotation/degree;angle=angle*3.1415927410125732f;angle=angle/180.0f;
    float cosine=std::cos(angle),sine=std::sin(angle);
    Matrix rotation=identity();rotation[0]=cosine;rotation[1]=sine;rotation[4]=0.0f-sine;rotation[5]=cosine;
    value.local=multiply(multiply(translation,scaling),rotation);
    value.matrix=host.parent(id)&&inherit?multiply(parent,value.local):value.local;
    value.world=host.parent(id)&&inherit?point(value.matrix,0,0,0):value.position;
    if(value.has_scissor){
        const auto& r=value.scissor;
        auto first=point(value.matrix,r[0],r[1],0),last=point(value.matrix,static_cast<int>(r[0])+r[2],static_cast<int>(r[1])+r[3],0);
        value.transformed_scissor={short_integer(first[0]),short_integer(first[1]),short_integer(last[0]-first[0]),short_integer(last[1]-first[1])};
    }
    marks[id]=2;result=value.matrix;return true;
}
uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.UITransform"));}
UI* ui(lua_State* L){auto id=owner(L);auto it=nodes.find(id);return host.alive(id)&&it!=nodes.end()?&it->second:nullptr;}
int updated(lua_State* L){return refresh()?0:luaL_error(L,"UITransform hierarchy is removed, cyclic or too deep");}
int add(lua_State* L){
    uint32_t id=host.id(L,1);if(!host.alive(id)){lua_pushnil(L);return 1;}
    if(!nodes.count(id)){
        Matrix local;if(host.local_matrix(id,local.data()))return luaL_error(L,"UNIMPLEMENTED_NATIVE: mixed Transform/UITransform on one entity");
        if(nodes.size()>=budget)return luaL_error(L,"UITransform count exceeds budget");
        nodes.emplace(id,UI{});
        if(!refresh()){nodes.erase(id);return luaL_error(L,"Invalid UITransform hierarchy");}
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.UITransform");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");if(lua_istable(L,-1)){lua_rawgeti(L,-1,id);if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"UITransform");}lua_pop(L,1);}lua_pop(L,1);return 1;
}
int tostring_ui(lua_State* L){owner(L);lua_pushfstring(L,"UITransform (%p)",lua_touserdata(L,1));return 1;}
int get_vector(lua_State* L){auto* value=ui(L);if(!value)return 0;int kind=lua_tointeger(L,lua_upvalueindex(1));
    if(kind==1&&!refresh())return luaL_error(L,"Invalid UITransform hierarchy");
    const auto& v=kind==0?value->position:kind==1?value->world:value->scale;for(float x:v)lua_pushnumber(L,x);return 3;}
int set_vector(lua_State* L){auto* value=ui(L);if(!value)return 0;
    float x=luaL_checknumber(L,2),y=luaL_checknumber(L,3),z=luaL_checknumber(L,4);
    (lua_toboolean(L,lua_upvalueindex(1))?value->scale:value->position)={x,y,z};return updated(L);}
int get_rotation(lua_State* L){auto* value=ui(L);if(!value)return 0;lua_pushnumber(L,value->rotation/degree);return 1;}
int set_rotation(lua_State* L){auto* value=ui(L);if(!value)return 0;float angle=luaL_checknumber(L,2);value->rotation=normalized(angle*degree);return updated(L);}
int set_integer(lua_State* L){auto* value=ui(L);if(!value)return 0;int kind=lua_tointeger(L,lua_upvalueindex(1));double raw=luaL_checknumber(L,2);int32_t number=kind==3?facing_integer(raw):integer(raw);
    if(kind<2&&(number<0||number>3))return 0;
    (kind==0?value->h_anchor:kind==1?value->v_anchor:kind==2?value->scale_mode:value->facing)=number;return updated(L);}
int set_upscale(lua_State* L){auto* value=ui(L);if(!value)return 0;float number=luaL_checknumber(L,2);value->max_upscale=number;return updated(L);}
int update(lua_State* L){return ui(L)?updated(L):0;}
int set_scissor(lua_State* L){auto* value=ui(L);if(!value)return 0;
    Rect rect{};for(int i=0;i<4;++i)rect[i]=short_integer(luaL_checknumber(L,2+i));value->scissor=rect;value->has_scissor=true;return updated(L);}
int clear_scissor(lua_State* L){auto* value=ui(L);if(!value)return 0;auto id=owner(L);
    // Native ClearScissor latches the suppression bit recursively. It does
    // not free the two rectangles, and SetScissor does not unlatch it.
    for(auto& [candidate,node]:nodes){uint32_t p=candidate;for(int depth=0;p&&depth<=512;++depth){if(p==id){node.clear_scissor=true;break;}p=host.parent(p);}}
    return 0;
}
int screen_size(lua_State* L){lua_pushnumber(L,width);lua_pushnumber(L,height);return 2;}
int viewport(lua_State* L){double x=luaL_checknumber(L,1),y=luaL_checknumber(L,2);
    if(!std::isfinite(x)||!std::isfinite(y)||x<0||y<0||x>32768||y>32768||x!=std::trunc(x)||y!=std::trunc(y))return luaL_error(L,"Invalid UI viewport");
    if(!set_viewport(static_cast<int>(x),static_cast<int>(y)))return luaL_error(L,"Invalid UI viewport hierarchy");return 0;}
void number(lua_State* L,const char* key,double value){lua_pushnumber(L,value);lua_setfield(L,-2,key);}
void vector(lua_State* L,const char* key,const Vector& value){lua_createtable(L,3,0);for(int i=0;i<3;++i){lua_pushnumber(L,value[i]);lua_rawseti(L,-2,i+1);}lua_setfield(L,-2,key);}
void rect(lua_State* L,const char* key,const Rect& value,bool present){if(!present)return;lua_createtable(L,4,0);for(int i=0;i<4;++i){lua_pushnumber(L,value[i]);lua_rawseti(L,-2,i+1);}lua_setfield(L,-2,key);}
void bits(lua_State* L,const char* key,const float* values,size_t count){static const char hex[]="0123456789abcdef";std::string bytes;bytes.reserve(count*8);
    for(size_t i=0;i<count;++i){uint32_t value;std::memcpy(&value,values+i,4);for(unsigned shift=0;shift<32;shift+=8){unsigned char byte=value>>shift;bytes+=hex[byte>>4];bytes+=hex[byte&15];}}
    lua_pushlstring(L,bytes.data(),bytes.size());lua_setfield(L,-2,key);
}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);number(L,"transforms",nodes.size());number(L,"budget",budget);number(L,"width",width);number(L,"height",height);lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");return 1;}
    double id=luaL_checknumber(L,1);if(!std::isfinite(id)||id<0||id>4294967295.0||std::trunc(id)!=id){lua_pushnil(L);return 1;}
    auto it=nodes.find(static_cast<uint32_t>(id));if(it==nodes.end()){lua_pushnil(L);return 1;}const auto& value=it->second;
    lua_newtable(L);number(L,"owner",id);number(L,"typeId",0xd74dae38);number(L,"hAnchor",value.h_anchor);number(L,"vAnchor",value.v_anchor);number(L,"scaleMode",value.scale_mode);number(L,"facing",value.facing);
    vector(L,"localPosition",value.position);vector(L,"worldPosition",value.world);vector(L,"scale",value.scale);
    bits(L,"rotationBits",&value.rotation,1);bits(L,"maxPropUpscaleBits",&value.max_upscale,1);bits(L,"localMatrixBits",value.local.data(),16);bits(L,"worldMatrixBits",value.matrix.data(),16);
    rect(L,"scissor",value.scissor,value.has_scissor);rect(L,"transformedScissor",value.transformed_scissor,value.has_scissor);lua_pushboolean(L,value.clear_scissor);lua_setfield(L,-2,"clearScissor");
    lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");lua_pushboolean(L,false);lua_setfield(L,-2,"inverseVerified");return 1;
}
}
bool contains(uint32_t id){return nodes.count(id)!=0;}
bool refresh(){std::map<uint32_t,unsigned char> marks;for(const auto& [id,value]:nodes){(void)value;Matrix matrix;if(!resolve(id,matrix,marks,0))return false;}return true;}
bool set_viewport(int x,int y){
    if(x<0||y<0||x>32768||y>32768)return false;
    // Validate before changing viewport or automatic scale state. Resolving
    // the already validated graph cannot fail while these synchronous host
    // callbacks are executing; no Lua callbacks run inside the traversal.
    for(const auto& [id,node]:nodes){(void)node;uint32_t current=id;unsigned depth=0;
        while(current){if(depth++>512||!host.alive(current))return false;current=host.parent(current);}
    }
    width=x;height=y;return refresh();
}
void retire(uint32_t id){nodes.erase(id);}
void clear(){nodes.clear();width=height=0;}
void install(lua_State* L,web_components::EntityHost callbacks){clear();host=callbacks;
    luaL_newmetatable(L,"dst.UITransform");lua_newtable(L);
    const luaL_Reg methods[]={{"GetRotation",get_rotation},{"SetRotation",set_rotation},{"SetMaxPropUpscale",set_upscale},{"UpdateTransform",update},{"SetScissor",set_scissor},{"ClearScissor",clear_scissor},{nullptr,nullptr}};luaL_register(L,nullptr,methods);
    const char* getters[]={"GetLocalPosition","GetWorldPosition","GetScale"};for(int i=0;i<3;++i){lua_pushinteger(L,i);lua_pushcclosure(L,get_vector,1);lua_setfield(L,-2,getters[i]);}
    for(int i=0;i<2;++i){lua_pushboolean(L,i);lua_pushcclosure(L,set_vector,1);lua_setfield(L,-2,i?"SetScale":"SetPosition");}
    const char* setters[]={"SetHAnchor","SetVAnchor","SetScaleMode","SetFacing"};for(int i=0;i<4;++i){lua_pushinteger(L,i);lua_pushcclosure(L,set_integer,1);lua_setfield(L,-2,setters[i]);}
    lua_setfield(L,-2,"__index");lua_pushcfunction(L,tostring_ui);lua_setfield(L,-2,"__tostring");lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddUITransform");lua_pop(L,1);
    lua_getglobal(L,"TheSim");lua_pushcfunction(L,screen_size);lua_setfield(L,-2,"GetScreenSize");lua_pushcfunction(L,screen_size);lua_setfield(L,-2,"GetWindowSize");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_pushcfunction(L,viewport);lua_setfield(L,-2,"SetViewport");lua_setglobal(L,"WebUI");
}
}

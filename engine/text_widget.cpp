#include "text_widget.hpp"
#include "font_asset.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <string>
#include <vector>
extern "C" {
#include "lauxlib.h"
}
namespace web_text_widget {
namespace {
constexpr float kFltMax=3.4028234663852886e+38f;
constexpr float kNegFltMax=-3.4028234663852886e+38f;
constexpr float kEpsWidth=0.009999999776482582f;
constexpr float kEpsHeight=0.10000000149011612f;
constexpr size_t kBudget=16384;
constexpr uint32_t kTypeId=0xaa926b71u;

struct TextNode {
    bool dirty=true;
    bool font_resolved=false;
    uint32_t font_resource=0;
    float size=10.0f;
    float squeeze=1.0f;
    std::array<float,2> region{kFltMax,kFltMax};
    bool word_wrap=false;
    bool whitespace_wrap=false;
    uint32_t h_anchor=2;
    uint32_t v_anchor=2;
    std::array<uint8_t,4> colour{0xff,0xff,0xff,0xff};
    bool auto_region_size=true;
    std::string text;
    bool show_edit_cursor=false;
    uint32_t cursor_index=0;
    std::array<uint8_t,4> edit_cursor_colour{0xff,0xff,0xff,0xff};
};

struct LayoutState {
    const std::vector<uint32_t>* codepoints=nullptr;
    size_t idx=0;
    std::array<float,6> bbox{};
    float origin_x=0.0f,origin_y=0.0f,origin_z=0.0f;
    float cursor_x=0.0f,cursor_y=0.0f,cursor_z=0.0f;
    uint32_t prev_char=0;
};

web_components::EntityHost host{};
std::map<uint32_t,TextNode> nodes;

uint32_t signed_byte(uint32_t value){
    uint32_t low=value&0xffu;
    return low<128u?low:static_cast<uint32_t>(static_cast<int32_t>(low)-256);
}

int32_t integer(double value){
    value=std::trunc(value);
    return std::isfinite(value)&&value>=-2147483648.0&&value<=2147483647.0?static_cast<int32_t>(value):INT32_MIN;
}

uint8_t pack_colour_byte(double raw){
    float x=static_cast<float>(raw)*255.0f+0.5f;
    if(!(x>=0.0f))x=0.0f;
    else if(x>255.0f)x=255.0f;
    return static_cast<uint8_t>(static_cast<int32_t>(x));
}

const web_font_asset::Font* resolved_font(const TextNode& node){
    return node.font_resolved?web_font_asset::get_by_id(node.font_resource):nullptr;
}

std::vector<uint32_t> decode_utf8(const std::string& text){
    std::vector<uint32_t> out;
    out.reserve(text.size()+1);
    const auto* bytes=reinterpret_cast<const uint8_t*>(text.data());
    size_t n=text.size(),i=0;
    while(i<n&&bytes[i]!=0){
        uint8_t b0=bytes[i];
        size_t rem=n-i;
        if(b0<0x80u){
            out.push_back(b0);++i;
        }else if((b0&0xe0u)==0xc0u&&rem>=2&&(bytes[i+1]&0xc0u)==0x80u){
            out.push_back(((b0&0x1fu)<<6)|(bytes[i+1]&0x3fu));i+=2;
        }else if((b0&0xf0u)==0xe0u&&rem>=3&&(bytes[i+1]&0xc0u)==0x80u&&(bytes[i+2]&0xc0u)==0x80u){
            out.push_back(((b0&0x0fu)<<12)|((bytes[i+1]&0x3fu)<<6)|(bytes[i+2]&0x3fu));i+=3;
        }else if((b0&0xf8u)==0xf0u&&rem>=4&&(bytes[i+1]&0xc0u)==0x80u&&(bytes[i+2]&0xc0u)==0x80u&&(bytes[i+3]&0xc0u)==0x80u){
            out.push_back(((b0&0x07u)<<18)|((bytes[i+1]&0x3fu)<<12)|((bytes[i+2]&0x3fu)<<6)|(bytes[i+3]&0x3fu));i+=4;
        }else{
            out.push_back(b0);++i;
        }
    }
    out.push_back(0);
    return out;
}

void expand_bbox(std::array<float,6>& bbox,float x,float y,float z=0.0f){
    if(x<=bbox[0])bbox[0]=x;
    if(y<=bbox[1])bbox[1]=y;
    if(z<=bbox[2])bbox[2]=z;
    if(bbox[3]<=x)bbox[3]=x;
    if(bbox[4]<=y)bbox[4]=y;
    if(bbox[5]<=z)bbox[5]=z;
}

bool is_word_break(uint32_t cp){
    return cp==0||cp==0x20||cp==9||cp==10||cp==11||cp==12||cp==13;
}

bool match_escape(const std::vector<uint32_t>& cps,size_t idx,uint32_t& out_cp,size_t& out_step){
    if(cps[idx]!=0x7cu)return false;
    uint32_t next=cps[idx+1];
    bool sep=next!=0&&next<0x100u&&std::strchr("| ,.\r\n\t",static_cast<char>(next))!=nullptr;
    size_t step=sep?1u:2u;
    struct EscapeRule {size_t len;const char* suffix;uint8_t replacement;};
    static constexpr EscapeRule kRules[2]={{8,"COUNTER",0x80u},{2,"N",0x0au}};
    for(const auto& rule:kRules){
        if(step==rule.len){
            size_t j=0;
            while(j+1<rule.len&&cps[idx+1+j]==static_cast<uint8_t>(rule.suffix[j]))++j;
            if(j+1==rule.len){
                out_cp=rule.replacement;
                out_step=step;
                return true;
            }
        }
    }
    return false;
}

bool emit_glyph(const web_font_asset::Font& font,const TextNode& style,float region_w,float region_h,uint32_t cp,LayoutState& state){
    float scale=style.size/static_cast<float>(font.line_height);
    if(cp==0||cp==10||cp==13)return false;
    if(cp==9){
        auto found=font.glyphs.find(0x20u);
        float xa=found!=font.glyphs.end()?found->second.metrics[6]:0.0f;
        state.cursor_x+=(xa+font.outline+font.advance)*scale*4.0f;
        return true;
    }
    const web_font_asset::Font* target_font=&font;
    const web_font_asset::Glyph* glyph=nullptr;
    auto primary=font.glyphs.find(cp);
    if(primary!=font.glyphs.end()){
        glyph=&primary->second;
    }else{
        for(uint32_t fb_id:font.fallbacks){
            const auto* fb=web_font_asset::get_by_id(fb_id);
            if(!fb)continue;
            auto it=fb->glyphs.find(cp);
            if(it!=fb->glyphs.end()){
                target_font=fb;
                glyph=&it->second;
                if(target_font!=&font){
                    scale=scale*(static_cast<float>(font.line_height)/static_cast<float>(target_font->line_height));
                }
                break;
            }
        }
        if(!glyph){
            target_font=&font;
            auto q=target_font->glyphs.find(0x3fu);
            if(q!=target_font->glyphs.end())glyph=&q->second;
        }
    }
    if(!glyph)return true;
    float kern=0.0f;
    auto kit=target_font->kernings.find({signed_byte(state.prev_char),signed_byte(cp)});
    if(kit!=target_font->kernings.end())kern=kit->second;
    float w=glyph->metrics[2],h=glyph->metrics[3],xo=glyph->metrics[4],yo=glyph->metrics[5],xa=glyph->metrics[6];
    float old_cx=state.cursor_x;
    float squeeze=style.squeeze;
    float y_off=(-0.0f-yo)*scale;
    float new_cx=kern*scale+old_cx;
    float neg_cy=-0.0f-state.cursor_y;
    state.cursor_x=new_cx;
    float p1_x=new_cx+state.origin_x+xo*scale;
    float p1_y=neg_cy+state.origin_y+y_off;
    float p2_x=scale*w*squeeze+p1_x;
    float p2_y=(-0.0f-scale*h)+p1_y;
    float w_check=((target_font->advance+xa)*scale*squeeze+p1_x)-region_w;
    float h_check=(((state.cursor_y+p1_y)-p2_y)-y_off)-region_h;
    if(w_check<kEpsWidth&&h_check<style.size*kEpsHeight){
        expand_bbox(state.bbox,p1_x,p1_y);
        expand_bbox(state.bbox,p2_x,p2_y);
        float adv_x=(target_font->advance+xa)*scale*squeeze+p1_x;
        float adv_y=(state.origin_y-state.cursor_y)-(static_cast<float>(font.base)*style.size)/static_cast<float>(font.line_height);
        expand_bbox(state.bbox,adv_x,adv_y);
        state.cursor_x+=(target_font->advance+xa+target_font->outline)*scale*squeeze;
        return true;
    }
    state.cursor_x=old_cx;
    return !style.word_wrap;
}

LayoutState clone_for_trial(const LayoutState& src){
    LayoutState dst=src;
    dst.bbox={kFltMax,kFltMax,kFltMax,kNegFltMax,kNegFltMax,kNegFltMax};
    return dst;
}

bool layout_word(const web_font_asset::Font& font,int& out_emitted,const TextNode& style,float region_w,float region_h,LayoutState& state){
    out_emitted=0;
    float start_cx=state.cursor_x;
    int mode=style.word_wrap?1:0;
    const auto& cps=*state.codepoints;
    if(mode==1){
        LayoutState trial=clone_for_trial(state);
        while(!is_word_break(cps[trial.idx])){
            uint32_t cp=cps[trial.idx];
            size_t step=1;
            bool escaped=match_escape(cps,trial.idx,cp,step);
            if(!emit_glyph(font,style,region_w,region_h,cp,trial)){
                if(start_cx>0.0f)return false;
                mode=2;
            }else{
                trial.prev_char=cps[trial.idx];
            }
            trial.idx+=escaped?step:1u;
        }
    }
    while(!is_word_break(cps[state.idx])){
        uint32_t cp=cps[state.idx];
        size_t step=1;
        bool escaped=match_escape(cps,state.idx,cp,step);
        if(mode==2){
            LayoutState trial=clone_for_trial(state);
            if(!emit_glyph(font,style,region_w,region_h,cp,trial))return false;
        }
        uint32_t emit_cp=escaped?static_cast<uint32_t>(static_cast<int32_t>(static_cast<int8_t>(cp))):cp;
        if(!emit_glyph(font,style,region_w,region_h,emit_cp,state))return false;
        state.prev_char=cps[state.idx];
        state.idx+=escaped?step:1u;
        ++out_emitted;
    }
    return true;
}

bool layout_line(const web_font_asset::Font& font,const TextNode& style,float region_w,float region_h,LayoutState& state){
    int words=0;
    const auto& cps=*state.codepoints;
    while(true){
        uint32_t cp=cps[state.idx];
        if(cp==0)break;
        size_t step=0;
        if(cp==13&&cps[state.idx+1]==10)step=2;
        else if(cp==13||cp==10)step=1;
        else if(style.whitespace_wrap&&state.idx!=0&&(cp==0x20||cp==9||cp==11||cp==12))step=1;
        if(step!=0){
            if(words!=0)break;
            state.prev_char=0;
            state.idx+=step;
        }
        int emitted=0;
        if(!layout_word(font,emitted,style,region_w,region_h,state)){
            if(emitted!=0)++words;
            break;
        }
        ++words;
        while(cps[state.idx]!=0&&(cps[state.idx]==0x20||cps[state.idx]==9||cps[state.idx]==10||cps[state.idx]==11||cps[state.idx]==12||cps[state.idx]==13)){
            uint32_t ws=cps[state.idx];
            if(!emit_glyph(font,style,region_w,region_h,ws,state)){
                ws=cps[state.idx];
                if(ws==13||ws==10||(style.whitespace_wrap&&(ws==0x20||ws==9||ws==11||ws==12)))break;
                ++state.idx;
            }else{
                ++state.idx;
            }
        }
    }
    return words>0;
}

std::array<float,6> measure_text(const web_font_asset::Font& font,const std::string& text,const TextNode& style,float region_w,float region_h){
    auto cps=decode_utf8(text);
    LayoutState state{};
    state.codepoints=&cps;
    if(cps[0]==0){
        if(style.h_anchor==2)state.cursor_x=region_w*0.5f;
        else if(style.h_anchor==1)state.cursor_x=region_w;
        state.cursor_y=-0.0f-(static_cast<float>(font.base)*style.size)/static_cast<float>(font.line_height);
        expand_bbox(state.bbox,state.cursor_x,state.cursor_y);
    }else{
        bool ok=layout_line(font,style,region_w,region_h,state);
        while(ok&&cps[state.idx]!=0){
            state.cursor_y+=style.size;
            state.cursor_x=0.0f;
            ok=layout_line(font,style,region_w,region_h,state);
        }
        if(style.whitespace_wrap){
            float y_val=(state.origin_y-state.cursor_y)-(static_cast<float>(font.base)*style.size)/static_cast<float>(font.line_height);
            expand_bbox(state.bbox,state.origin_x,y_val);
        }
    }
    return state.bbox;
}

uint32_t owner(lua_State* L){return *static_cast<uint32_t*>(luaL_checkudata(L,1,"dst.TextWidget"));}
TextNode* text_node(lua_State* L){
    auto id=owner(L);auto it=nodes.find(id);
    return host.alive(id)&&it!=nodes.end()?&it->second:nullptr;
}

int add(lua_State* L){
    uint32_t id=host.id(L,1);
    if(!host.alive(id)){lua_pushnil(L);return 1;}
    if(!nodes.count(id)){
        if(nodes.size()>=kBudget)return luaL_error(L,"TextWidget count exceeds budget");
        nodes.emplace(id,TextNode{});
    }
    *static_cast<uint32_t*>(lua_newuserdata(L,sizeof(uint32_t)))=id;
    luaL_getmetatable(L,"dst.TextWidget");lua_setmetatable(L,-2);
    lua_getglobal(L,"Ents");
    if(lua_istable(L,-1)){
        lua_rawgeti(L,-1,id);
        if(lua_istable(L,-1)){lua_pushvalue(L,-3);lua_setfield(L,-2,"TextWidget");}
        lua_pop(L,1);
    }
    lua_pop(L,1);
    return 1;
}

int tostring_tw(lua_State* L){owner(L);lua_pushfstring(L,"TextWidget (%p)",lua_touserdata(L,1));return 1;}

int set_font(lua_State* L){
    auto* node=text_node(L);
    const char* alias=luaL_checkstring(L,2);
    if(!node)return 0;
    node->dirty=true;
    uint32_t res=0;
    if(web_font_asset::resolve_alias(alias,res)){
        node->font_resolved=true;
        node->font_resource=res;
    }else{
        node->font_resolved=false;
        node->font_resource=0;
    }
    return 0;
}

int set_size(lua_State* L){
    auto* node=text_node(L);
    float s=static_cast<float>(luaL_checknumber(L,2));
    if(!node)return 0;
    node->size=s;
    node->dirty=true;
    return 0;
}

int set_string(lua_State* L){
    auto* node=text_node(L);
    const char* str=luaL_checklstring(L,2,nullptr);
    if(!node)return 0;
    if(std::strcmp(node->text.c_str(),str)!=0)node->dirty=true;
    node->text.assign(str);
    uint32_t len=static_cast<uint32_t>(node->text.size());
    node->dirty=(node->dirty||node->cursor_index!=len);
    node->cursor_index=len;
    return 0;
}

int get_string(lua_State* L){
    auto* node=text_node(L);
    if(!node)return 0;
    lua_pushlstring(L,node->text.c_str(),node->text.size());
    return 1;
}

int set_region_size(lua_State* L){
    auto* node=text_node(L);
    float w=static_cast<float>(luaL_checknumber(L,2));
    float h=static_cast<float>(luaL_checknumber(L,3));
    if(!node)return 0;
    node->auto_region_size=false;
    node->dirty=true;
    node->region={w,h};
    return 0;
}

int reset_region_size(lua_State* L){
    auto* node=text_node(L);
    if(!node)return 0;
    if(!node->auto_region_size){
        node->dirty=true;
        node->auto_region_size=true;
    }
    return 0;
}

int get_region_size(lua_State* L){
    auto* node=text_node(L);
    if(!node)return 0;
    if(node->auto_region_size&&node->dirty){
        node->region={kFltMax,kFltMax};
        if(const auto* font=resolved_font(*node)){
            auto bbox=measure_text(*font,node->text,*node,kFltMax,kFltMax);
            node->region={bbox[3]-bbox[0],bbox[4]-bbox[1]};
        }
    }
    lua_pushnumber(L,node->region[0]);
    lua_pushnumber(L,node->region[1]);
    return 2;
}

int has_overflow(lua_State* L){
    auto* node=text_node(L);
    if(!node)return 0;
    bool overflow=false;
    if(!node->auto_region_size){
        if(const auto* font=resolved_font(*node)){
            float rw=node->word_wrap?node->region[0]:kFltMax;
            float rh=node->word_wrap?kFltMax:node->region[1];
            auto bbox=measure_text(*font,node->text,*node,rw,rh);
            overflow=node->word_wrap?((bbox[4]-bbox[1])>node->region[1]):((bbox[3]-bbox[0])>node->region[0]);
        }
    }
    lua_pushboolean(L,overflow);
    return 1;
}

int set_wrap(lua_State* L){
    auto* node=text_node(L);
    if(lua_type(L,2)!=LUA_TBOOLEAN)return luaL_typerror(L,2,"boolean");
    bool enable=lua_toboolean(L,2)!=0;
    if(!node)return 0;
    if(lua_toboolean(L,lua_upvalueindex(1)))node->whitespace_wrap=enable;
    else node->word_wrap=enable;
    return 0;
}

int set_squeeze(lua_State* L){
    auto* node=text_node(L);
    float s=static_cast<float>(luaL_checknumber(L,2));
    if(!node)return 0;
    node->squeeze=s;
    return 0;
}

int set_anchor(lua_State* L){
    auto* node=text_node(L);
    int32_t raw=integer(luaL_checknumber(L,2));
    if(!node||raw<0||raw>3)return 0;
    uint32_t mapped=raw==0?2u:(raw==2?1u:0u);
    uint32_t& target=lua_toboolean(L,lua_upvalueindex(1))?node->v_anchor:node->h_anchor;
    if(target!=mapped){
        target=mapped;
        node->dirty=true;
    }
    return 0;
}

int set_colour(lua_State* L){
    auto* node=text_node(L);
    std::array<uint8_t,4> c{};
    for(int i=0;i<4;++i)c[i]=pack_colour_byte(luaL_checknumber(L,2+i));
    if(!node)return 0;
    if(lua_toboolean(L,lua_upvalueindex(1))){
        node->edit_cursor_colour=c;
    }else{
        node->colour=c;
        node->dirty=true;
    }
    return 0;
}

int show_edit_cursor(lua_State* L){
    auto* node=text_node(L);
    if(lua_type(L,2)!=LUA_TBOOLEAN)return luaL_typerror(L,2,"boolean");
    bool show=lua_toboolean(L,2)!=0;
    if(!node)return 0;
    if(node->dirty||node->show_edit_cursor!=show)node->dirty=true;
    node->show_edit_cursor=show;
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
        scalar(L,"textWidgets",nodes.size());
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
    boolean(L,"dirty",v.dirty);
    boolean(L,"fontResolved",resolved_font(v)!=nullptr);
    hex_bytes(L,"sizeBits",&v.size,4);
    hex_bytes(L,"squeezeBits",&v.squeeze,4);
    hex_bytes(L,"regionBits",v.region.data(),8);
    boolean(L,"wordWrap",v.word_wrap);
    boolean(L,"whitespaceWrap",v.whitespace_wrap);
    scalar(L,"hAnchor",v.h_anchor);
    scalar(L,"vAnchor",v.v_anchor);
    hex_bytes(L,"colourBits",v.colour.data(),4);
    boolean(L,"autoRegionSize",v.auto_region_size);
    lua_pushlstring(L,v.text.data(),v.text.size());lua_setfield(L,-2,"text");
    boolean(L,"showEditCursor",v.show_edit_cursor);
    scalar(L,"cursorIndex",v.cursor_index);
    hex_bytes(L,"editCursorColourBits",v.edit_cursor_colour.data(),4);
    boolean(L,"rendererReady",false);
    return 1;
}
}

bool contains(uint32_t id){return nodes.count(id)!=0;}
bool get_snapshot(uint32_t id,TextSnapshot& out){
    auto it=nodes.find(id);
    if(it==nodes.end())return false;
    const auto& v=it->second;
    out.text=v.text;
    out.size=v.size;
    out.region_w=v.region[0]<1e20f?v.region[0]:0.0f;
    out.region_h=v.region[1]<1e20f?v.region[1]:0.0f;
    std::memcpy(out.colour,v.colour.data(),sizeof(out.colour));
    out.h_anchor=v.h_anchor;out.v_anchor=v.v_anchor;
    return true;
}
void retire(uint32_t id){nodes.erase(id);}

void clear(){nodes.clear();}
void install(lua_State* L,web_components::EntityHost callbacks){
    clear();host=callbacks;
    luaL_newmetatable(L,"dst.TextWidget");lua_newtable(L);
    const luaL_Reg methods[]={
        {"SetFont",set_font},
        {"SetSize",set_size},
        {"SetString",set_string},
        {"GetString",get_string},
        {"SetRegionSize",set_region_size},
        {"ResetRegionSize",reset_region_size},
        {"GetRegionSize",get_region_size},
        {"HasOverflow",has_overflow},
        {"SetHorizontalSqueeze",set_squeeze},
        {"ShowEditCursor",show_edit_cursor},
        {nullptr,nullptr}
    };
    luaL_register(L,nullptr,methods);
    for(int i=0;i<2;++i){
        lua_pushboolean(L,i);
        lua_pushcclosure(L,set_wrap,1);
        lua_setfield(L,-2,i?"EnableWhitespaceWrap":"EnableWordWrap");
    }
    for(int i=0;i<2;++i){
        lua_pushboolean(L,i);
        lua_pushcclosure(L,set_anchor,1);
        lua_setfield(L,-2,i?"SetVAnchor":"SetHAnchor");
    }
    for(int i=0;i<2;++i){
        lua_pushboolean(L,i);
        lua_pushcclosure(L,set_colour,1);
        lua_setfield(L,-2,i?"SetEditCursorColour":"SetColour");
    }
    lua_setfield(L,-2,"__index");
    lua_pushcfunction(L,tostring_tw);lua_setfield(L,-2,"__tostring");
    lua_pop(L,1);
    lua_getglobal(L,"Entity");lua_pushcfunction(L,add);lua_setfield(L,-2,"AddTextWidget");lua_pop(L,1);
    lua_newtable(L);lua_pushcfunction(L,inspect);lua_setfield(L,-2,"Inspect");lua_setglobal(L,"WebTextWidgets");
}
}

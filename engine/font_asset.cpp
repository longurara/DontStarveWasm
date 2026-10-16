#include "font_asset.hpp"
#include "asset_zip.hpp"
#include "asset_xml.hpp"
#include "ktex.hpp"
#include "resource_io.hpp"
#include "texture_asset.hpp"
#include "string_hash.hpp"
#include "sha256.hpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>
extern "C" {
#include "lauxlib.h"
}
namespace web_font_asset {
namespace {
struct Record {Font font;std::string path;uint32_t references=0;bool texture_owned=false;};
struct Alias {uint32_t resource=0;bool resolved=false;};
std::map<uint32_t,Alias> aliases;
std::map<uint32_t,Record> cache;size_t retained=0;bool client_role=false;
constexpr size_t budget=128*1024*1024;
bool number(rapidxml::xml_node<>* node,const char* name,float& value,bool optional=false){
    auto* attr=node?node->first_attribute(name):nullptr;if(!attr)return optional;
    char* end=nullptr;value=std::strtof(attr->value(),&end);
    while(end&&(*end==' '||*end=='\t'||*end=='\r'||*end=='\n'))++end;
    return end&&end!=attr->value()&&!*end&&std::isfinite(value);
}
bool integer(rapidxml::xml_node<>* node,const char* name,uint32_t& value,uint32_t max){
    auto* attr=node?node->first_attribute(name):nullptr;if(!attr||!attr->value_size()||attr->value()[0]=='-')return false;
    char* end=nullptr;unsigned long long parsed=std::strtoull(attr->value(),&end,10);
    if(!end||end==attr->value()||*end||parsed>max)return false;value=static_cast<uint32_t>(parsed);return true;
}
uint32_t signed_byte(uint32_t value){return value%256<128?value%256:static_cast<uint32_t>(static_cast<int>(value%256)-256);}
bool decode(const std::string& path,const std::vector<uint8_t>& bytes,Font& out,std::string& error){
    std::map<std::string,std::vector<uint8_t>> files;if(!web_asset_zip::unpack(bytes,files,error))return false;
    auto xml=files.find("font.fnt"),tex=files.find("font.tex");
    if(xml==files.end()||tex==files.end()){error="FONT ZIP requires font.fnt and font.tex";return false;}
    const auto document=std::make_unique<rapidxml::xml_document<>>();
    if(!web_asset_xml::parse(xml->second,*document,64*1024*1024,error))return false;
    auto* root=document->first_node("font");auto* info=root?root->first_node("info"):nullptr;
    auto* common=root?root->first_node("common"):nullptr;auto* chars=root?root->first_node("chars"):nullptr;
    auto* kernings=root?root->first_node("kernings"):nullptr;
    if(!root||!common||!chars){error="Invalid FONT XML nodes";return false;}
    if(info){auto* face=info->first_attribute("face");if(face){if(face->value_size()>4096){error="FONT face exceeds limit";return false;}out.face.assign(face->value(),face->value_size());}}
    uint32_t line=0,base=0,packed=0,red=0,pages=0;
    if(!integer(common,"lineHeight",line,65535)||!line||!integer(common,"base",base,65535)||
       !number(common,"scaleW",out.width)||!number(common,"scaleH",out.height)||out.width<=0||out.height<=0||out.width>8192||out.height>8192||
       !number(info,"outline",out.outline,true)||!integer(common,"packed",packed,1)||!integer(common,"redChnl",red,4)||!integer(common,"pages",pages,256)||pages!=1){error="Invalid or unsupported FONT common metrics/pages";return false;}
    out.line_height=line;out.base=base;out.material=packed?(out.outline>0?3:2):(red==2?1:0);
    uint32_t count=0;if(!integer(chars,"count",count,100000)){error="Invalid FONT char count";return false;}
    size_t observed=0;const char* fields[]={"x","y","width","height","xoffset","yoffset","xadvance"};
    for(auto* item=chars->first_node("char");item;item=item->next_sibling("char")){
        Glyph glyph{};uint32_t channel=0,page=0;
        if(++observed>100000||!integer(item,"id",glyph.id,0xffffffffu)||!integer(item,"chnl",channel,15)||!integer(item,"page",page,255)||page){error="Invalid FONT glyph id/channel/page";return false;}
        for(int i=0;i<7;++i)if(!number(item,fields[i],glyph.metrics[i])){error="Invalid FONT glyph metrics";return false;}
        const auto& m=glyph.metrics;if(m[0]<0||m[1]<0||m[2]<0||m[3]<0||m[0]+m[2]>out.width||m[1]+m[3]>out.height){error="FONT glyph exceeds texture bounds";return false;}
        glyph.channel=channel;out.glyphs[glyph.id]=glyph;
    }
    if(observed!=count){error="FONT char count mismatch";return false;}
    if(kernings){uint32_t count=0;if(!integer(kernings,"count",count,200000)){error="Invalid FONT kerning count";return false;}size_t observed=0;
        for(auto* item=kernings->first_node("kerning");item;item=item->next_sibling("kerning")){
            uint32_t first=0,second=0;float amount=0;
            if(++observed>200000||!integer(item,"first",first,0xffffffffu)||!integer(item,"second",second,0xffffffffu)||!number(item,"amount",amount)||std::trunc(amount)!=amount){error="Invalid FONT kerning";return false;}
            // Build 756039 sign-extends the low byte of both XML codepoints
            // before inserting its lexicographically ordered pair (0x1400dd19b).
            out.kernings[{signed_byte(first),signed_byte(second)}]=amount;
        }
        if(observed!=count){error="FONT kerning count mismatch";return false;}
    }
    web_ktex::Texture texture;if(!web_ktex::parse(tex->second,texture,error))return false;
    if(texture.mips[0].width!=out.width||texture.mips[0].height!=out.height){error="FONT XML/KTEX dimensions differ";return false;}
    out.texture_key=path+"#font.tex";out.texture_hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(tex->second.data()),tex->second.size()));out.texture=std::move(tex->second);
    out.source_hash=web_crypto::sha256(std::string(reinterpret_cast<const char*>(bytes.data()),bytes.size()));
    out.retained_bytes=sizeof(Font)+256+out.face.size()+out.source_hash.size()+out.texture_hash.size()+out.texture_key.size()+out.texture.capacity()+out.glyphs.size()*(sizeof(Glyph)+48)+out.kernings.size()*64;
    return true;
}
void scalar(lua_State* L,const char* name,double value){lua_pushnumber(L,value);lua_setfield(L,-2,name);}
void text(lua_State* L,const char* name,const std::string& value){lua_pushlstring(L,value.data(),value.size());lua_setfield(L,-2,name);}
int inspect(lua_State* L){
    if(lua_isnoneornil(L,1)){lua_newtable(L);scalar(L,"fonts",cache.size());scalar(L,"retainedBytes",retained);scalar(L,"budget",budget);return 1;}
    auto found=cache.find(web_strings::hash(luaL_checkstring(L,1)));if(found==cache.end()){lua_pushnil(L);return 1;}const auto& font=found->second.font;
    lua_newtable(L);text(L,"face",font.face);text(L,"sourceSha256",font.source_hash);text(L,"textureSha256",font.texture_hash);text(L,"textureKey",font.texture_key);
    scalar(L,"lineHeight",font.line_height);scalar(L,"base",font.base);scalar(L,"width",font.width);scalar(L,"height",font.height);scalar(L,"outline",font.outline);scalar(L,"material",font.material);
    scalar(L,"glyphs",font.glyphs.size());scalar(L,"kernings",font.kernings.size());scalar(L,"retainedBytes",font.retained_bytes);scalar(L,"references",found->second.references);
    scalar(L,"advance",font.advance);lua_pushboolean(L,font.colour_enabled);lua_setfield(L,-2,"colourEnabled");
    lua_newtable(L);int fallback_index=0;for(auto id:font.fallbacks){auto value=cache.find(id);if(value!=cache.end()){lua_pushlstring(L,value->second.path.data(),value->second.path.size());lua_rawseti(L,-2,++fallback_index);}}lua_setfield(L,-2,"fallbacks");
    std::string glyphs,kernings;
    for(const auto& pair:font.glyphs){const auto& glyph=pair.second;glyphs.append(reinterpret_cast<const char*>(&glyph.id),4);glyphs.append(reinterpret_cast<const char*>(glyph.metrics.data()),28);glyphs.append(reinterpret_cast<const char*>(&glyph.channel),2);}
    for(const auto& pair:font.kernings){kernings.append(reinterpret_cast<const char*>(&pair.first.first),4);kernings.append(reinterpret_cast<const char*>(&pair.first.second),4);kernings.append(reinterpret_cast<const char*>(&pair.second),4);}
    text(L,"glyphSha256",web_crypto::sha256(glyphs));text(L,"kerningSha256",web_crypto::sha256(kernings));
    lua_pushboolean(L,found->second.texture_owned&&web_texture_asset::ready(font.texture_key));lua_setfield(L,-2,"textureReady");lua_pushboolean(L,false);lua_setfield(L,-2,"rendererReady");return 1;
}
int decode_lua(lua_State* L){auto path=luaL_checkstring(L,1);bool ok;{std::string error;ok=load(path,error);if(!ok)lua_pushlstring(L,error.data(),error.size());}if(!ok)return lua_error(L);return inspect(L);}
int release_lua(lua_State* L){auto path=luaL_checkstring(L,1);auto found=cache.find(web_strings::hash(path));if(found!=cache.end()&&found->second.references)return luaL_error(L,"Font is owned by loaded resources");release(path);return 0;}
int glyph_lua(lua_State* L){const auto* font=get(luaL_checkstring(L,1));double value=luaL_checknumber(L,2);if(!std::isfinite(value)||value<0||value>4294967295.0||std::trunc(value)!=value)return luaL_error(L,"Invalid FONT glyph id");uint32_t id=static_cast<uint32_t>(value);
    if(!font||!font->glyphs.count(id)){lua_pushnil(L);return 1;}const auto& glyph=font->glyphs.at(id);lua_newtable(L);scalar(L,"id",id);const char* fields[]={"x","y","width","height","xoffset","yoffset","xadvance"};for(int i=0;i<7;++i)scalar(L,fields[i],glyph.metrics[i]);scalar(L,"channel",glyph.channel);return 1;
}
Record* alias_record(uint32_t id){auto found=aliases.find(id);if(found==aliases.end()||!found->second.resolved)return nullptr;auto resource=cache.find(found->second.resource);return resource==cache.end()||!resource->second.references?nullptr:&resource->second;}
int load_font(lua_State* L){
    const char* path=luaL_checkstring(L,2);const char* name=luaL_checkstring(L,3);
    if(!lua_isnoneornil(L,4)&&lua_type(L,4)!=LUA_TBOOLEAN)return luaL_typerror(L,4,"boolean");
    const bool disable_colour=lua_toboolean(L,4)!=0;auto id=web_strings::hash(name);
    if(!register_alias(path,name))return luaL_error(L,"FONT alias count exceeds 8192 budget");
    if(auto* resource=alias_record(id))resource->font.colour_enabled=!disable_colour;
    return 0;
}
int unload_font(lua_State* L){auto found=aliases.find(web_strings::hash(luaL_checkstring(L,2)));if(found==aliases.end())return 0;
    {auto value=found->second;aliases.erase(found);if(value.resolved){auto resource=cache.find(value.resource);if(resource!=cache.end()){auto path=resource->second.path;release(path);}}}return 0;
}
int adjust_advance(lua_State* L){const char* alias=luaL_checkstring(L,2);float amount=static_cast<float>(luaL_checknumber(L,3));if(auto* resource=alias_record(web_strings::hash(alias)))resource->font.advance=amount;return 0;}
int setup_fallbacks(lua_State* L){
    if(lua_type(L,3)!=LUA_TTABLE)return 0;uint32_t alias=web_strings::hash(luaL_checkstring(L,2));
    lua_pushnil(L);while(lua_next(L,3)){
        if(lua_isstring(L,-1)){
            auto found=aliases.find(web_strings::hash(lua_tostring(L,-1)));auto* parent=alias_record(alias);
            if(parent&&found!=aliases.end()&&found->second.resolved&&alias_record(found->first)){
                auto& values=parent->font.fallbacks;auto id=found->second.resource;
                if(std::find(values.begin(),values.end(),id)==values.end()){
                    if(values.size()>=4096)return luaL_error(L,"FONT fallback count exceeds 4096 budget");
                    if(values.size()==values.capacity()){
                        size_t capacity=std::min<size_t>(4096,std::max<size_t>(4,values.capacity()*2)),extra=(capacity-values.capacity())*sizeof(uint32_t);
                        if(extra>budget-retained)return luaL_error(L,"FONT fallback memory budget exceeded");
                        values.reserve(capacity);retained+=extra;parent->font.retained_bytes+=extra;
                    }
                    values.push_back(id);
                }
            }
        }
        lua_pop(L,1);
    }
    return 0;
}
int registry(lua_State* L){
    if(!lua_isnoneornil(L,1)){
        auto id=web_strings::hash(luaL_checkstring(L,1));auto found=aliases.find(id);if(found==aliases.end()){lua_pushnil(L);return 1;}
        lua_newtable(L);scalar(L,"id",id);auto* resource=alias_record(id);lua_pushboolean(L,resource!=nullptr);lua_setfield(L,-2,"resolved");if(resource)text(L,"path",resource->path);return 1;
    }
    lua_newtable(L);int i=0;for(const auto& item:aliases){lua_newtable(L);scalar(L,"id",item.first);auto* resource=alias_record(item.first);lua_pushboolean(L,resource!=nullptr);lua_setfield(L,-2,"resolved");if(resource)text(L,"path",resource->path);lua_rawseti(L,-2,++i);}return 1;
}
}
bool register_alias(const char* path,const char* name){
    auto id=web_strings::hash(name);if(aliases.count(id))return true;
    if(aliases.size()>=8192)return false;
    auto resource=cache.find(web_strings::hash(path));Alias value;
    if(resource!=cache.end()&&resource->second.references){value.resource=resource->first;value.resolved=true;}
    aliases.emplace(id,value);return true;
}
bool load(const std::string& path,std::string& error){
    auto id=web_strings::hash(path);if(cache.count(id))return true;std::vector<uint8_t> bytes;if(!web_resource_io::read(path,bytes,error))return false;
    Record record;record.path=path;if(!decode(path,bytes,record.font,error)){error=path+": FONT "+error;return false;}record.font.retained_bytes+=record.path.size();
    if(record.font.retained_bytes>budget-retained){error="FONT cache exceeds 128 MiB budget";return false;}retained+=record.font.retained_bytes;cache.emplace(id,std::move(record));return true;
}
bool acquire(const std::string& path,std::string& error){
    if(!load(path,error))return false;auto& record=cache.at(web_strings::hash(path));
    if(client_role&&!record.texture_owned){if(!web_texture_asset::acquire_encoded(record.font.texture_key,record.font.texture,error)){if(!record.references)release(path);return false;}record.texture_owned=true;}
    ++record.references;return true;
}
void release(const std::string& path){auto found=cache.find(web_strings::hash(path));if(found==cache.end())return;if(found->second.references)--found->second.references;
    if(!found->second.references){
        auto id=found->first;for(auto at=aliases.begin();at!=aliases.end();)if(at->second.resolved&&at->second.resource==id)at=aliases.erase(at);else ++at;
        for(auto& pair:cache){auto& values=pair.second.font.fallbacks;values.erase(std::remove(values.begin(),values.end(),id),values.end());}
        if(found->second.texture_owned)web_texture_asset::release(found->second.font.texture_key);retained-=found->second.font.retained_bytes;cache.erase(found);
    }
}
const Font* get(const std::string& path){auto found=cache.find(web_strings::hash(path));return found==cache.end()?nullptr:&found->second.font;}
const Font* by_alias(const std::string& alias){auto* record=alias_record(web_strings::hash(alias));return record?&record->font:nullptr;}
void clear(){aliases.clear();for(const auto& pair:cache)if(pair.second.texture_owned)web_texture_asset::release(pair.second.font.texture_key);cache.clear();retained=0;}
void install(lua_State* L,bool client){clear();client_role=client;lua_newtable(L);const luaL_Reg methods[]={{"Decode",decode_lua},{"Inspect",inspect},{"Glyph",glyph_lua},{"Release",release_lua},{"Registry",registry},{nullptr,nullptr}};luaL_register(L,nullptr,methods);lua_setglobal(L,"WebFonts");
    lua_getglobal(L,"TheSim");const luaL_Reg native[]={{"LoadFont",load_font},{"UnloadFont",unload_font},{"SetupFontFallbacks",setup_fallbacks},{"AdjustFontAdvance",adjust_advance},{nullptr,nullptr}};luaL_register(L,nullptr,native);lua_pop(L,1);}
}

#pragma once
#include <cmath>
#include <cstdlib>
#include <map>
#include <string>

// The platform session envelope is a flat JSON object of string/bool/number
// fields. Gameplay's json.lua has intentionally different escape semantics;
// do not use it to parse browser JSON.stringify output.
namespace web_session_json {
struct Value {
    enum Kind { String, Boolean, Number } kind=String;
    std::string text;
    bool flag=false;
    double number=0;
};
class Parser {
    const std::string& input;
    size_t pos=0;
    void space(){while(pos<input.size()&&(input[pos]==' '||input[pos]=='\t'||input[pos]=='\r'||input[pos]=='\n'))++pos;}
    bool take(char c){if(pos<input.size()&&input[pos]==c){++pos;return true;}return false;}
    bool word(const char* text){size_t size=std::char_traits<char>::length(text);if(input.compare(pos,size,text)!=0)return false;pos+=size;return true;}
    bool hex(unsigned& code){
        code=0;for(int i=0;i<4;++i){if(pos==input.size())return false;unsigned char c=input[pos++];
            int digit=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;
            if(digit<0)return false;code=code*16+digit;}
        return true;
    }
    static void utf8(std::string& out,unsigned code){
        if(code<128)out+=static_cast<char>(code);
        else if(code<2048){out+=static_cast<char>(0xc0|(code>>6));out+=static_cast<char>(0x80|(code&63));}
        else if(code<65536){out+=static_cast<char>(0xe0|(code>>12));out+=static_cast<char>(0x80|((code>>6)&63));out+=static_cast<char>(0x80|(code&63));}
        else {out+=static_cast<char>(0xf0|(code>>18));out+=static_cast<char>(0x80|((code>>12)&63));out+=static_cast<char>(0x80|((code>>6)&63));out+=static_cast<char>(0x80|(code&63));}
    }
    bool string(std::string& out){
        if(!take('"'))return false;
        while(pos<input.size()){
            unsigned char c=input[pos++];
            if(c=='"')return true;
            if(c<32)return false;
            if(c=='\\'){
                if(pos==input.size())return false;char escape=input[pos++];
                if(escape=='"'||escape=='\\'||escape=='/')out+=escape;
                else if(escape=='b')out+='\b';else if(escape=='f')out+='\f';
                else if(escape=='n')out+='\n';else if(escape=='r')out+='\r';else if(escape=='t')out+='\t';
                else if(escape=='u'){
                    unsigned code;if(!hex(code))return false;
                    if(code>=0xd800&&code<=0xdbff){
                        if(!take('\\')||!take('u'))return false;unsigned low;if(!hex(low)||low<0xdc00||low>0xdfff)return false;
                        code=0x10000+((code-0xd800)<<10)+(low-0xdc00);
                    }else if(code>=0xdc00&&code<=0xdfff)return false;
                    utf8(out,code);
                }else return false;
            }else if(c<128)out+=static_cast<char>(c);
            else {
                unsigned code=0,minimum=0;int count=0;
                if(c>=0xc2&&c<=0xdf){code=c&31;minimum=128;count=1;}
                else if(c>=0xe0&&c<=0xef){code=c&15;minimum=2048;count=2;}
                else if(c>=0xf0&&c<=0xf4){code=c&7;minimum=65536;count=3;}else return false;
                for(int i=0;i<count;++i){if(pos==input.size())return false;unsigned char next=input[pos++];if((next&0xc0)!=0x80)return false;code=(code<<6)|(next&63);}
                if(code<minimum||code>0x10ffff||(code>=0xd800&&code<=0xdfff))return false;
                utf8(out,code);
            }
        }
        return false;
    }
    bool number(double& out){
        size_t start=pos;take('-');
        if(!take('0')){if(pos==input.size()||input[pos]<'1'||input[pos]>'9')return false;do{++pos;}while(pos<input.size()&&input[pos]>='0'&&input[pos]<='9');}
        if(take('.')){size_t digits=pos;while(pos<input.size()&&input[pos]>='0'&&input[pos]<='9')++pos;if(pos==digits)return false;}
        if(take('e')||take('E')){if(!take('+'))take('-');size_t digits=pos;while(pos<input.size()&&input[pos]>='0'&&input[pos]<='9')++pos;if(pos==digits)return false;}
        auto value=input.substr(start,pos-start);out=std::strtod(value.c_str(),nullptr);return std::isfinite(out);
    }
public:
    explicit Parser(const std::string& text):input(text){}
    bool parse(std::map<std::string,Value>& out){
        space();if(!take('{'))return false;space();if(take('}')){space();return pos==input.size();}
        while(pos<input.size()){
            std::string key;if(!string(key))return false;space();if(!take(':'))return false;space();Value value;
            if(pos<input.size()&&input[pos]=='"'){value.kind=Value::String;if(!string(value.text))return false;}
            else if(word("true")){value.kind=Value::Boolean;value.flag=true;}
            else if(word("false")){value.kind=Value::Boolean;value.flag=false;}
            else {value.kind=Value::Number;if(!number(value.number))return false;}
            if(!out.emplace(key,std::move(value)).second)return false;
            space();if(take('}')){space();return pos==input.size();}
            if(!take(','))return false;space();
        }
        return false;
    }
};
}

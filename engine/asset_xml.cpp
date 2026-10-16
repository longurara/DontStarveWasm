#include "asset_xml.hpp"
#include <csetjmp>
#include <cstdlib>
#include <memory>
namespace {
struct XmlContext {std::jmp_buf jump;const char* error=nullptr;size_t remaining=16*1024*1024;};
XmlContext* active_xml=nullptr;
void* xml_allocate(size_t bytes){
    if(bytes>active_xml->remaining)rapidxml::parse_error_handler("XML allocation budget exceeded",nullptr);
    void* pointer=std::malloc(bytes);
    if(!pointer)rapidxml::parse_error_handler("XML allocation failed",nullptr);
    active_xml->remaining-=bytes;return pointer;
}
void xml_free(void* pointer){std::free(pointer);}
}
namespace rapidxml {
void parse_error_handler(const char* what,void*){
    active_xml->error=what;std::longjmp(active_xml->jump,1);
}
}
namespace {
bool bounded_xml(const std::string& source){
    if(source.empty()||source.size()>8*1024*1024||source.find('\0')!=std::string::npos)return false;
    int depth=0;size_t pos=0;
    while((pos=source.find('<',pos))!=std::string::npos){
        if(source.compare(pos,4,"<!--")==0){pos=source.find("-->",pos+4);if(pos==std::string::npos)return false;pos+=3;continue;}
        if(source.compare(pos,9,"<![CDATA[")==0){pos=source.find("]]>",pos+9);if(pos==std::string::npos)return false;pos+=3;continue;}
        if(source.compare(pos,2,"<?")==0){pos=source.find("?>",pos+2);if(pos==std::string::npos)return false;pos+=2;continue;}
        if(source.compare(pos,2,"<!")==0)return false; // No DTD/external entities.
        const bool closing=source.compare(pos,2,"</")==0;char quote=0;size_t end=pos+1;
        for(;end<source.size();++end){char c=source[end];if(quote){if(c==quote)quote=0;}else if(c=='\''||c=='"')quote=c;else if(c=='>')break;}
        if(end==source.size())return false;
        if(closing){if(--depth<0)return false;}else if(end==pos+1||source[end-1]!='/'){if(++depth>32)return false;}
        pos=end+1;
    }
    return depth==0;
}
}

namespace web_asset_xml {
bool parse(std::vector<uint8_t>& bytes,rapidxml::xml_document<>& document,size_t pool_budget,std::string& error){
    std::string source(bytes.begin(),bytes.end());
    if(!bounded_xml(source)){error="Invalid XML envelope/depth/size";return false;}
    bytes.push_back(0);
    const auto context=std::make_unique<XmlContext>();context->remaining=pool_budget;
    document.set_allocator(xml_allocate,xml_free);active_xml=context.get();
    if(setjmp(context->jump)){active_xml=nullptr;error=std::string("Invalid XML: ")+context->error;return false;}
    document.parse<rapidxml::parse_validate_closing_tags>(reinterpret_cast<char*>(bytes.data()));active_xml=nullptr;return true;
}
}

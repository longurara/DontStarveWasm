#include "resource_io.hpp"
#include <cstdio>
#include <emscripten.h>

EM_ASYNC_JS(int,dst_fetch_resource,(const char* path,char* error,int capacity),{
    try {
        if(typeof Module['fetchNativeResource']!=='function')throw new Error('Resource adapter is not installed');
        await Module['fetchNativeResource'](UTF8ToString(path));
        return 0;
    } catch(failure) {
        stringToUTF8(String(failure),error,capacity);return 1;
    }
});
namespace web_resource_io {
namespace {bool asynchronous=false;}
void allow_async(bool value){asynchronous=value;}
bool async_active(){return asynchronous;}
bool read(const std::string& path,std::vector<uint8_t>& bytes,std::string& error){
    if(path.empty()||path[0]=='/'||path.find("..")!=std::string::npos||path.find_first_of(":\\\r\n\t")!=std::string::npos||path.find('\0')!=std::string::npos){error="Unsafe native asset path";return false;}
    const std::string absolute="/"+path;
    FILE* file=std::fopen(absolute.c_str(),"rb");bool downloaded=false;
    if(!file){
        if(!asynchronous){error="ASYNC_RESOURCE_REQUIRED: "+path;return false;}
        char detail[1024]={0};
        if(dst_fetch_resource(path.c_str(),detail,sizeof(detail))){error="Resource load failed: "+path+": "+detail;return false;}
        downloaded=true;file=std::fopen(absolute.c_str(),"rb");
    }
    if(!file){error="Resource not materialized: "+path;return false;}
    std::fseek(file,0,SEEK_END);long size=std::ftell(file);std::rewind(file);
    bool success=size>=0&&size<=128*1024*1024;
    if(success){bytes.resize(size);success=std::fread(bytes.data(),1,bytes.size(),file)==bytes.size();}
    std::fclose(file);
    // Native compressed source bytes are temporary. Parsed resources own the
    // retained state; verified packs remain in the bounded platform cache.
    if(downloaded)std::remove(absolute.c_str());
    if(!success)error="Invalid or truncated resource: "+path;
    return success;
}
}

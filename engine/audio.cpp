#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include <emscripten/emscripten.h>
#define DR_FLAC_NO_STDIO
#define DR_FLAC_NO_OGG
#define DR_FLAC_NO_SIMD
#include "dr_flac.h"

namespace {
std::vector<int16_t> pcm;
std::string audio_result;
constexpr uint64_t max_samples=64*1024*1024; // 128 MiB decoded PCM16 per asset.
int fail(const char* text){std::vector<int16_t>().swap(pcm);audio_result=text;return 1;}
}

extern "C" {
EMSCRIPTEN_KEEPALIVE int dst_audio_decode(const void* bytes,uint32_t length){
    std::vector<int16_t>().swap(pcm);
    if(!bytes||length<42||length>128*1024*1024)return fail("Invalid FLAC buffer size");
    drflac* decoder=drflac_open_memory(bytes,length,nullptr);
    if(!decoder)return fail("Invalid FLAC stream");
    uint64_t frames=decoder->totalPCMFrameCount;
    uint32_t channels=decoder->channels,rate=decoder->sampleRate;
    if(decoder->bitsPerSample!=16||channels<1||channels>8||rate<1||frames<1||frames>max_samples/channels){
        drflac_close(decoder);return fail("FLAC must contain bounded PCM16 with a declared frame count");
    }
    pcm.resize(static_cast<size_t>(frames*channels));
    uint64_t actual=drflac_read_pcm_frames_s16(decoder,frames,pcm.data());
    drflac_close(decoder);
    if(actual!=frames)return fail("Truncated or corrupt FLAC frames");
    char info[192];std::snprintf(info,sizeof(info),"{\"sampleRate\":%u,\"channels\":%u,\"frames\":%llu,\"bitsPerSample\":16,\"pcmBytes\":%zu}",
                              rate,channels,static_cast<unsigned long long>(frames),pcm.size()*2);
    audio_result=info;return 0;
}
EMSCRIPTEN_KEEPALIVE const int16_t* dst_audio_pcm(){return pcm.empty()?nullptr:pcm.data();}
EMSCRIPTEN_KEEPALIVE uint32_t dst_audio_samples(){return static_cast<uint32_t>(pcm.size());}
EMSCRIPTEN_KEEPALIVE const char* dst_audio_result(){return audio_result.c_str();}
EMSCRIPTEN_KEEPALIVE void dst_audio_release(){std::vector<int16_t>().swap(pcm);audio_result.clear();}
}

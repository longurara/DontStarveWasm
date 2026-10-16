cmake_minimum_required(VERSION 3.20)
project(dst_web_port LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Build with the pinned Emscripten toolchain (tools/build.py)")
endif()
file(GLOB LUA_SOURCES CONFIGURE_DEPENDS vendor/lua-5.1.5/src/*.c)
list(FILTER LUA_SOURCES EXCLUDE REGEX "/(lua|luac|print)\\.c$")
add_library(lua51 STATIC ${LUA_SOURCES})
target_sources(lua51 PRIVATE vendor/LuaBitOp-1.0.4/bit.c)
target_include_directories(lua51 PUBLIC vendor/lua-5.1.5/src)
add_library(flac STATIC engine/flac.c)
target_include_directories(flac PUBLIC vendor/dr_libs)
add_executable(engine engine/runtime.cpp engine/persistent.cpp engine/audio.cpp engine/tiles.cpp engine/input.cpp engine/inventory.cpp engine/sha256.cpp engine/system.cpp engine/prefabs.cpp engine/game_service.cpp engine/camera.cpp engine/session.cpp engine/resource_io.cpp engine/animation_asset.cpp engine/file_asset.cpp engine/atlas_asset.cpp engine/shader_asset.cpp)
target_include_directories(engine PRIVATE vendor/rapidxml-1.13)
target_sources(engine PRIVATE engine/ktex.cpp engine/texture_asset.cpp)
target_sources(engine PRIVATE engine/asset_zip.cpp engine/asset_xml.cpp engine/font_asset.cpp)
target_sources(engine PRIVATE engine/components.cpp engine/road_manager.cpp engine/envelope_manager.cpp engine/postprocessor.cpp engine/font_manager.cpp engine/map_layers.cpp engine/physics_waker.cpp engine/ui_transform.cpp)
target_link_libraries(engine PRIVATE lua51 flac)
target_compile_options(engine PRIVATE -Wall -Wextra -Werror -fno-fast-math -sUSE_ZLIB=1)
target_link_options(engine PRIVATE
  "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createEngine"
  "-sENVIRONMENT=web,worker,node" "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=33554432" "-sMAXIMUM_MEMORY=1073741824"
  "-sSTACK_SIZE=2097152" "-sFORCE_FILESYSTEM=1"
  "-sASYNCIFY=1" "-sASYNCIFY_STACK_SIZE=2097152"
  "-sUSE_ZLIB=1" "-lidbfs.js"
  "-sEXPORTED_FUNCTIONS=['_dst_init','_dst_configure_session','_dst_apply_entity_sleep','_dst_eval','_dst_eval_budget','_dst_eval_async','_dst_result','_dst_index_assets','_dst_tick','_dst_tick_count','_dst_entity_count','_dst_restore_clock','_dst_inspect_save','_dst_io_pending','_dst_complete_io','_dst_close','_dst_audio_decode','_dst_audio_pcm','_dst_audio_samples','_dst_audio_result','_dst_audio_release','_dst_input_key','_dst_input_pointer','_dst_input_reset','_dst_input_cursor_visible','_dst_platform_storage','_dst_platform_focus','_dst_ui_viewport','_malloc','_free']"
  "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS','IDBFS','UTF8ToString','HEAPU8']"
  "-sNO_EXIT_RUNTIME=1" "-sASSERTIONS=1")
set_target_properties(engine PROPERTIES SUFFIX ".mjs"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/public/generated/engine")

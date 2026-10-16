# Bàn giao dự án DST 756039 → WebAssembly

Ngày bàn giao: 16/10/2026, múi giờ Asia/Saigon.

Tài liệu này dành cho AI tiếp quản trực tiếp workspace hiện tại. Đây là bản tổng hợp công việc đã thực hiện, bằng chứng có thể kiểm tra, giới hạn đã biết và phần nghiên cứu đang dở. Đọc tài liệu này trước khi sửa engine hoặc chạy lại native capture.

## 1. Kết luận phải giữ đúng khi tiếp quản

**Dự án có engine WASM, công cụ phân tích native, bộ đọc tài nguyên và nhiều thành phần tương thích đã kiểm chứng; chưa có bản DST chơi được.**

Trạng thái gần nhất:

- main.lua nguyên bản của build 756039 đã chạy hết trong probe.
- Probe gọi tiếp callback Start, rồi dừng ở scripts/widgets/text.lua:6 vì Entity.AddTextWidget chưa được triển khai.
- Trong WASM probe, TheWorld chưa tồn tại; fullBootstrapPassed = false.
- UITransform đã có layout CPU và đối chiếu native, nhưng chưa có toàn bộ UI renderer.
- Chưa có WorldSim/Map/physics/worldgen/gameplay loop đầy đủ, chưa spawn được player vào world web để chơi.
- Có asset viewer Wilson bằng WebGL2, nhưng asset viewer không phải engine AnimState hoặc renderer gameplay hoàn chỉnh.
- Có transport WebRTC và checkpoint của cảnh chẩn đoán; chưa phải multiplayer/persistence của world DST.
- Chưa mốc M0–M8 nào vượt đầy đủ điều kiện nghiệm thu full game.

Ưu tiên người dùng đã chốt trong các lượt trước: **làm game chạy đầy đủ trước, multiplayer gameplay làm sau**. Yêu cầu mới nhất là viết bàn giao chi tiết; lượt bàn giao này không tiếp tục triển khai TextWidget, không chạy lại toàn bộ test và không tuyên bố hoàn thành mục tiêu full game.

Không suy ra phần trăm hoàn thành từ số binding hoặc số test. Các test hiện có chứng minh những lát cắt cụ thể, không chứng minh toàn game.

## 2. Mục tiêu sản phẩm và kiến trúc đã chốt

Mục tiêu cuối cùng là engine tương thích C++17/Lua 5.1, build bằng CMake/Emscripten thành WASM32, chạy gameplay Lua và tài nguyên gốc của đúng build 756039.

Kiến trúc:

| Thành phần | Trách nhiệm |
|---|---|
| Client Worker | Một WASM instance riêng; Lua client, input, UI, animation, render WebGL2 qua OffscreenCanvas |
| Master Worker | Một WASM instance riêng; mô phỏng authoritative mặt đất |
| Caves Worker | Một WASM instance riêng; mô phỏng authoritative hang động |
| Worldgen Worker | Worker tạm thời, dự kiến sinh world |
| Trang host | Điều phối Worker, WebAudio, lưu trữ, giao diện vận hành, transport |
| Static hosting | Phục vụ site và pack theo hash, tải chọn lọc |
| Signaling | Phòng và trao đổi thông tin WebRTC; không mô phỏng game |
| STUN/TURN | Cấu hình ngoài; TURN relay kết nối, không chạy gameplay |

Giai đoạn đầu không pthread, không SharedArrayBuffer. Các instance có heap riêng. Host client cũng phải đi qua transport interface; kiến trúc cuối dùng MessageChannel nội bộ cho kết nối của chính host.

Yêu cầu cuối: Chrome/Edge/Firefox desktop, chuột/bàn phím, tối đa sáu người qua Internet, hai shard và chuyển shard; nhập save native cùng build; autosave 60 giây, rollback, backup ZIP, phục hồi checkpoint đã commit.

Manifest/session/save phải mang gameBuild, engineVersion, schemaVersion, contentHash và từ chối dữ liệu không khớp. Không preload khoảng nhiều GB dữ liệu.

Không nằm trong phạm vi đầu: Steam/Klei matchmaking, tài khoản/cửa hàng chính thức, Workshop/mod Lua hoặc native library, tự động cập nhật theo build DST mới, tự động chuyển host, xuất save ngược sang native.

Native executable/FMOD chỉ dùng phân tích/chuyển đổi/đối chiếu khi phát triển. Bản web cuối không phụ thuộc EXE hoặc DLL Windows để chơi. Chưa chọn/khóa Bullet revision vì chưa đối chiếu được solver.

## 3. Workspace, nguyên bản và môi trường

Workspace:

    E:/02_Projects/decr/Don't Starve Together/

Dự án:

    E:/02_Projects/decr/Don't Starve Together/web-port/

Các thư mục gốc data/, bin64/, analysis/ nằm cạnh web-port/. Công cụ hiện tại dựa vào bố cục này. Không di chuyển riêng web-port/ rồi kỳ vọng build/fixture hoạt động mà không chỉnh cấu hình đường dẫn.

Workspace chưa được xác nhận có Git repository; ở các lượt triển khai trước đây không có Git repo cho dự án. Không có commit/PR để dùng thay cho trạng thái file trên đĩa. Không tự reset/xóa file vì tưởng là generated không cần thiết.

Không chỉnh sửa bộ cài gốc. Hash quan trọng:

| Nguồn | SHA-256 |
|---|---|
| dedicated executable được dùng cho phân tích | 95d361bf6e60d498951e00449eedd2f9ac24a21ab5d8ae83e8bb39efce478545 |
| data/databundles/scripts.zip | f8d7cff2e9f86cdab3de08c6e750ecec2986c9bc95b364724f4c77244a798bf1 |

Địa chỉ native trong tài liệu này chủ yếu là virtual address của **dedicated x64 build đang được khóa hash**. Không chuyển nguyên địa chỉ sang client executable, build khác hoặc địa chỉ runtime đã ASLR. Công cụ capture có bước quy đổi/kiểm tra riêng.

Đường dẫn công cụ hiện tại:

    Python:
    C:/Users/Hikari/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe

    Node:
    C:/Program Files/nodejs/node.exe
    C:/Program Files/nodejs/npm.cmd
    C:/Program Files/nodejs/npx.cmd

    Tool cache:
    C:/Users/Hikari/.cache/dst-wasm-tools/

    JDK dùng cho Ghidra:
    C:/Program Files/Java/jdk-25.0.4.1/

Các dependency đã khóa:

| Công cụ/thư viện | Version |
|---|---|
| Emscripten | 4.0.23 |
| Lua | 5.1.5 |
| LuaBitOp | 1.0.4 |
| CMake | 3.31.6 |
| Ninja | 1.11.1.4 |
| RapidXML | 1.13, có SHA archive/header |
| dr_flac | 0.13.3, khóa commit và SHA |
| pefile | 2024.8.26 |
| Capstone | 5.0.7 |
| Ghidra | 12.1.4, dev analysis tool riêng |

Xem toolchain.lock.json, package-lock.json, analysis-tools.lock.json để lấy version/hash đầy đủ. Không dùng bản dependency mới nhất thay cho bản khóa.

Toolchain WASM trong .cache/tools.json; Ghidra trong .cache/analysis-tools.json. Những file này là đường dẫn máy hiện tại, không phải cấu hình portable.

## 4. Bản đồ mã nguồn

| Đường dẫn trong web-port/ | Nội dung |
|---|---|
| engine/runtime.cpp | Lua VM, Entity/GUID/Transform, các ABI, init/eval/tick, kết nối các adapter |
| engine/components.* | Registry, ownership/factory/lifetime của component native đã có |
| engine/ui_transform.* | Layout CPU UITransform, hierarchy, viewport và scissor state |
| engine/font_asset.* | FONT ZIP/XML, glyph/kerning, alias/fallback/advance/colour, ownership |
| engine/font_manager.* | Component FontManager.RegisterFont |
| engine/animation_asset.* | BILD6/ANIM4 và bundle/resource metadata |
| engine/atlas_asset.*, atlas_order.hpp | Atlas XML, UV, thuật toán thứ tự trùng ID giống native |
| engine/ktex.*, texture_asset.* | KTEX CPU decode và resource lease/GPU adapter |
| engine/shader_asset.* | KSH metadata và shader resource |
| engine/asset_zip.*, asset_xml.* | Parser dùng chung có giới hạn và lỗi có kiểm soát |
| engine/prefabs.*, resource_io.* | Prefab metadata, dependencies, tải resource bất đồng bộ, rollback |
| engine/file_asset.* | Backend FILE, byte gốc/NUL terminator/cache |
| engine/persistent.* | Persistent-string envelope và API liên quan |
| engine/session.*, session_json.hpp | Kiểm tra session/version/hash, JSON envelope chuẩn |
| engine/input.*, system.*, camera.*, inventory.*, game_service.* | Adapter platform và một phần trạng thái native |
| engine/road_manager.*, envelope_manager.*, postprocessor.*, map_layers.*, physics_waker.* | Các component/headless state đã khôi phục từng phần |
| engine/audio.cpp, flac.c | FLAC WASM/PCM interface, chưa là FMOD event engine |
| src/main.ts | Workbench/UI host và các hook chẩn đoán |
| src/engine-worker.ts, engine.ts | Worker lifecycle, serialized commands, ABI và adapter engine |
| src/resources.mjs | Fetch/hash/chunk/cache tài nguyên |
| src/shader-programs.mjs, texture-programs.mjs | Backend WebGL2 resource |
| src/asset-preview.ts | Viewer mesh/animation, chưa phải world renderer |
| src/persistence.ts, engine-storage.ts | IndexedDB checkpoint, backup và IDBFS |
| src/native-save.mjs | Đọc/kiểm tra save native ở mức inspector |
| src/rtc.ts, protocol.mjs, session.mjs | Transport, room/session validation |
| src/*-probe.ts | Kiểm chứng từng subsystem trong Worker |
| compat/*.lua | Lớp tương thích riêng; không sửa gameplay Lua trong scripts.zip |
| compat/*.md | Hành vi native, quyết định triển khai và giới hạn theo subsystem |
| tools/prepare.py, resources.py | Chuẩn bị script/resource packs, index, manifest |
| tools/build.py, setup.py | Toolchain và build WASM |
| tools/capture_native.py | Chạy dedicated profile riêng, thu trace/save/memory evidence |
| tools/native_*_trace.lua | Oracle chạy trong game native, không phải gameplay web thay thế |
| tools/native_*_memory.py | Đọc bộ nhớ child native đã xác minh |
| tools/native_function.py, native_globals.py | Phân tích PE/disassembly/binding |
| tools/*_catalog.py | Oracle/metadata độc lập cho asset và component |
| tools/browser-*.js | Probe Playwright CLI |
| tools/signaling.mjs | Static server + signaling |
| tests/ | Node/WASM test và Python asset tests |
| public/generated/ | Pack, engine.mjs/wasm, manifest, resource/audio/preview metadata |
| dist/ | Site Vite đã build để server phục vụ |
| output/ | Log, báo cáo, fixture, disassembly; nhiều file có thể bị ghi đè ở lượt sau |
| ../analysis/ | Kết quả khảo sát binary ban đầu, binding map và semantics native |

Tài liệu nên đọc sau HANDOFF.md:

1. STATUS.md và README.md.
2. compat/README.md, compat/components.md.
3. compat/ui-transform.md, compat/font-loading.md, compat/font-manager.md.
4. compat/asset-loading.md, shader-loading.md.
5. compat/startup.md và các compat/*.md còn lại khi đụng subsystem tương ứng.

## 5. Snapshot xác nhận và ranh giới bằng chứng

### 5.1 Bản engine/site đã được kiểm chứng gần nhất

    gameBuild:       756039
    engineVersion:   0.1.0
    schemaVersion:   1
    contentHash:     51544076a8f202a69aa78f2e36e703fd226707ac76def86f6dd889dfe9c32ab7
    engineSourceHash:64323d38cfe139fc8448ee9de3abc9c5f1b52e535b27025054174d2436057cea
    engine.wasm SHA: 95cbbf3b45571f0a60df2e4052caa596b604a5c2c014a2214fa08520e25c0c4b
    engine.wasm size:8,498,545 byte

Trong lượt bàn giao đã đọc lại manifest, tính lại hash WASM và tính lại engineSourceHash bằng cùng danh sách đầu vào của finalize_engine; cả hai khớp manifest. Không có thay đổi C++/src chưa phản ánh trong bản engine được ghi nhận.

Báo cáo tổng hợp: output/ui-transform-verification.json.

Lượt xác nhận đó:

- 92 test Node/WASM, 92 pass, 0 fail, 0 skip.
- 3 test Python, pass.
- Kiểm tra hash executable/scripts gốc, pass.
- Browser probe UITransform và runtime trên Chrome/Edge/Firefox.
- Native oracle run ID: b2aba40ebf772a292e361e37d8639d20.
- output/check.log được ghi lúc 2026-10-16 02:36:14 UTC.
- output/ui-transform-verification.json được ghi lúc 02:44:20 UTC.

### 5.2 Các thay đổi sau bộ test 92 pass

Sau lượt xác nhận UITransform, tôi nghiên cứu TextWidget:

- Sửa tools/native_entity_trace.lua để thêm oracle TextWidget.
- Giữ mạnh các UI/Text userdata wrapper để không bị GC trước lúc đọc bộ nhớ.
- Escape control characters trong JSON trace.
- Capture native lại thành công.
- Thêm công cụ/setup Ghidra và dump-function script.
- Chưa thêm implementation TextWidget vào engine, chưa build WASM mới cho TextWidget.

Native capture gần nhất:

    oracleRunId: d9c21ab6b775b373e89f3cfc84b95d79
    exitCode: 0
    elapsed: 31.58 giây
    simulationAdvanced: true
    nativeWorldReady: true
    inventoryCaptureError: null
    entityCaptureError: null
    resourceCaptureError: null

attempt.json gần nhất được ghi lúc 2026-10-16 02:53:20 UTC; nguồn native_entity_trace.lua sửa lúc 02:51:49 UTC.

**Không nói rằng bộ test 92 pass đã chạy với fixture TextWidget mới nhất.** Chưa chạy lại toàn bộ suite sau native recapture. Hash evidence của attempt.json/entity-flags.json trong báo cáo UITransform cũ vì thế có thể không còn khớp file hiện tại. Đây là lịch sử hai lần capture, không phải tự động kết luận engine hỏng.

Khi tiếp tục code: dùng một fixture run đồng nhất, regenerate catalog phụ thuộc rồi chạy kiểm tra thích hợp. Không chỉnh báo cáo cũ thành “pass” chỉ để che chênh lệch hash.

Lượt bàn giao này tạo thêm output/handoff-state.json để ghi dấu hash/file hiện tại. File đó là kiểm kê bàn giao, không phải báo cáo chạy lại test.

Kiểm kê thực tế phát hiện đúng hai file evidence đã đổi so với báo cáo UITransform: output/native-reference/attempt.json và output/native-reference/entity-flags.json. Snapshot ghi SHA của 187 file source/tool/test/tài liệu tương thích và 26 file bàn giao/cấu hình/evidence trọng yếu để lần tiếp quản có thể nhận diện thay đổi.

## 6. Những gì đã triển khai: runtime và Lua

### 6.1 WASM và VM

- Build C++17 + Lua 5.1.5 + LuaBitOp thật, xuất ES module engine.mjs và engine.wasm.
- Mỗi instance có heap ban đầu 32 MiB, cho phép tăng tối đa 1 GiB.
- Stack C và Asyncify stack mỗi loại 2 MiB.
- Dùng Asyncify để suspend fetch resource rồi tiếp tục cùng Lua stack; không dựng lại lời gọi bằng callback giả.
- Worker serialize command, chặn reentry trong lúc resource I/O treo.
- Có init/eval/eval-budget/eval-async/tick/inspect-save/input/session/storage/lifecycle ABI.
- Có resource transaction rollback và phục hồi VM sau lỗi parser/fetch/ZIP.
- Đã kiểm tra ba Worker riêng trên Chrome/Edge/Firefox.

Giới hạn: Lua bytecode khác kiến trúc/header chưa được giải quyết đầy đủ. Không được suy ra chỉ cần đọc Lua là đã tương thích mọi C binding hoặc engine callback.

### 6.2 Script loader và registry

- Chuẩn bị 4.030 Lua file nguyên bản thành 16 pack; boot ban đầu chỉ lấy khoảng 17 file.
- Giữ gameplay Lua gốc; phần web nằm trong compat/ và adapter.
- Registry khoảng 1.644 binding là baseline từ phân tích ban đầu.
- API chưa làm phải báo UNIMPLEMENTED_NATIVE rõ ràng.
- Tìm thêm global inline và dynamic Add-component factory bằng C closure/upvalue; tên Add đầy đủ không nhất thiết xuất hiện trong PE string table.
- main.lua đã chạy GlobalInit, LoadPrefabs và LoadFonts rồi trả về trong probe.

Đây chưa là complete startup. Probe gọi Start đang đụng TextWidget. Không thay TextWidget bằng no-op hoặc bỏ qua Start để tuyên bố bootstrap pass.

### 6.3 Entity và trạng thái nền

- Entity/GUID, tags, registry, parent hierarchy, Transform cơ bản.
- Dùng EntityScript, Class, event listener, scheduler, timer và finiteuses Lua gốc trong cảnh kiểm chứng.
- Đối chiếu lifecycle/finalizer, valid/registry trong onremove, construction-complete và sleep flags.
- Kernel nhận batch quyết định sleep/wake authoritative, đổi state rồi gọi callback Lua gốc đúng thứ tự.
- Có kiểm tra tự xóa trong callback, entity sinh thêm, pending state và lỗi callback.
- SetCanSleep đổi cờ, không tự ép wake.

Giới hạn:

- Chưa có WorldSim tính interest/island/vùng ngủ/thức.
- Chưa có update dispatch toàn world.
- AddTransform hiện còn trả chính Entity userdata, là khoảng trống fidelity đã biết so với typed component.
- Component Network và các finalizer phụ thuộc Network chưa hoàn thiện.
- Không dùng cảnh finiteuses để đại diện player/crafting/combat/survival.

### 6.4 RNG và globals

- Khôi phục PCG32, seed/output đối chiếu trace native, giữ RNG state trong snapshot cảnh.
- Multiplier 0x5851f42d4c957f2d; increment 0xb47c73972972b7b7.
- Native random wrapper chia uint32 cho 4294967295.
- Tám giá trị seed 12345 đã khớp; chưa chứng minh mọi RNG/integer-range/worldgen.
- Tick duration float32: 0.03333333507180214.
- UTF8/string ID sorting/SDBM hash, NUL và byte UTF8 có fixture.
- Persistent strings: callback order, plain/compressed/omitted bool argument đối chiếu native.
- requireeventfile giữ đúng nhánh retail thiếu event-server data đã quan sát; không đại diện Forge/Gorge gameplay.

## 7. Những gì đã triển khai: tài nguyên, render và audio

### 7.1 Tải và sở hữu tài nguyên

- Resource index có 15.290 file, 440 pack, 3.539.950.193 byte nguồn.
- Tải chọn lọc, kiểm hash, file chia nhiều chunk, RAM LRU 32 MiB mỗi Worker và CacheStorage.
- Có kiểm pack hỏng, cache hỏng/quota lỗi và không preload toàn bộ dữ liệu.
- Prefab metadata từ Lua gốc: 52 metadata, 5.712 logical asset paths tồn tại trong index.
- Ownership/dependency và rollback giao dịch khi một asset lỗi; không commit prefab giả.
- Phân biệt asset-kind native client/server, coercion/case/NUL và loại metadata bị bỏ theo nhánh native có lý do.

Chưa có chính sách LRU/quota đĩa hoàn chỉnh, chưa spawn toàn bộ prefab hoặc nạp mọi asset trong world thực.

### 7.2 ZIP/BILD/ANIM/FILE

- ZIP/BILD6/ANIM4 decode trong C++ WASM; Wilson, player_basic và dynamic box có hash geometry độc lập.
- Frame count/duration một số clip khớp native AnimState.
- Headless DYNAMIC_ANIM giữ metadata và trì hoãn texture theo native.
- Bundle cache khoảng 192 MiB accounting, LRU chỉ đẩy bundle không có owner.
- FILE giữ byte nguyên bản và terminator NUL; StringID/cache/lease đối chiếu bộ nhớ native.
- FILE retained-data budget 64 MiB.

Chưa có AnimState thực thi playback/override/skin/drawing đầy đủ, chưa .dyn skin decoder, chưa LoadKlumpFile/String động. Mesh/motion trong viewer vẫn có phần chuẩn bị offline bằng JSON; không coi viewer là engine animation.

### 7.3 ATLAS/KTEX/KSH/WebGL2

- ATLAS: 1.412 XML / 11.775 phần tử, UV float32 và native sort cho duplicate ID.
- Khôi phục thuật toán median/partition/insertion/heap sort theo build vì std::sort của toolchain khác thứ tự khi key trùng.
- Lưu source-order permutation riêng để MapLayer dùng đúng thứ tự XML.
- Headless IMAGE native trả -1 mà không đọc file; giữ nhánh đó, không giả upload.
- KTEX decode DXT1/DXT3/DXT5/RGB/RGBA, tất cả mip; upload WebGL2 có resource ownership.
- 34 mip Wilson/global/hud đã đối chiếu GPU readback SHA từng byte trên ba trình duyệt.
- KSH: decode 68 container, metadata/uniform/stage source; adapter GLSL ES 3.00 compile/link/reflection và FBO nhỏ kiểm pixel.
- Viewer dùng ui.ksh và KTEX gốc qua pipeline tài nguyên thật.

Giới hạn: chưa renderer world/UI hoàn chỉnh, gameplay uniform/camera, shader fallback/native sampler state đầy đủ, post-processing graph, light/shadow/particle pipeline hoặc context-loss recovery hoàn chỉnh. FBO 2×2 không phải SSIM scene native.

Accounting hiện có: ATLAS metadata 32 MiB; KSH CPU 16 MiB; texture encoded 128 MiB; decode buffer 64 MiB/mip; GPU RGBA8 accounting 256 MiB. Đây là giới hạn adapter, không phải số đo peak RAM/VRAM full game.

### 7.4 FONT

- Decode đủ 24 font ZIP, 94.886 glyph, giữ metrics float32/channel/material.
- Full packed fallback có 44.201 glyph.
- Native kerning sign-extends low byte codepoint và duplicate cuối thắng; loader giữ đúng hành vi này.
- Texture/font metadata/kerning hash đã đối chiếu native và Python độc lập.
- Ba font texture được upload/readback trên Chrome/Edge/Firefox, kể cả packed channels.
- LoadFont/UnloadFont/SetupFontFallbacks/advance/colour đã triển khai theo alias registry native.
- Alias đã có giữ mapping đầu, kể cả unresolved; alias/fallback không giữ thêm ownership lease.
- Resource release cuối xóa alias và fallback reference trỏ tới resource đó.
- FontManager.RegisterFont dùng registry đó, không tự fetch/acquire/recolour.

**FONT decoder/registry có rồi; TextWidget layout và glyph drawing chưa có.** Phần nghiên cứu TextWidget ở mục 11–13 là việc đang dở.

### 7.5 Audio

- Lập catalog FMOD: 57 project, 6.435 event, 10 reverb preset.
- Quét 153 bank: 92 bank / 4.889 sample chuyển được sang FLAC và kiểm round-trip PCM.
- 61 bank lỗi, trong đó tám timeout; xem public/generated/audio/sample-index.json.
- 125 sample Wilson: decoder FLAC WASM trả PCM khớp hash native từng byte.
- Ba trình duyệt phát được sample Pickup_item qua WebAudio context running.

Chưa khôi phục FEV event graph, SoundEmitter engine, loop/parameter/attenuation/reverb/timing gameplay. Không đánh đồng sample phát được với âm thanh game hoàn chỉnh. Không dùng âm thanh thay thế để nghiệm thu.

## 8. Những component/platform adapter đã có và giới hạn

| Phần | Đã làm | Chưa có |
|---|---|---|
| TileGroupManager | Typed userdata, ID/classification qua tilegroups.lua gốc | Map/render membership đầy đủ |
| InputProxy | Keyboard/mouse, modifier, blur/reset, Lua Input/EventProcessor gốc; headless không device | Gameplay controls/RPC hoàn chỉnh |
| InventoryProxy | Dataset skins gốc, transcript hash native, ownership free offline | Account inventory, xác minh signature/dịch vụ chính thức |
| SystemService | Storage/autosave/focus/stalling và operation tuple, IDBFS status | Client audio DSP/reverb backend |
| Camera | Dedicated float32 pos/direction/up/FOV/listener, FollowCamera gốc | Client world projection/matrix/culling/audio backend |
| ShadowManager | Typed owner/lifetime, headless texture cache lookup -1 | GenerateStaticShadows/client renderer |
| RoadManager | Pending points, road/strip styles, UV float32, headless IsOnRoad chưa quadtree | Smoothing, VB, quadtree, render/effect |
| EnvelopeManager | Vector2/colour registration native; giữ wrapper bug float envelope đã quan sát | Curve consumer/VFX/GPU |
| PostProcessor | Shared headless uniforms/samplers, IDs/replacement/reset, destructor behavior | Graph/FBO/shader/uniform upload/client backend |
| FontManager | RegisterFont và typed lifecycle, global font aliases | Text layout/drawing |
| MapLayerManager | Bảy API CPU, UV groups, colours, uint16 tiles/int32 style, LIFO handles | Map ownership, terrain geometry/client renderer |
| PhysicsWaker | SetMaxPhysicsRadius float32 đúng static state | Bullet, solver, waker/islands |
| Startup state | GetNumLaunches và play-instance stash sống qua Sim reset đúng kiểu số | Startup hoàn chỉnh |
| LocalProfileStats | Chẩn đoán cục bộ có count/bytes/hash/channel và policy | Official telemetry transport |
| Local identity | WEB_ key bền trong IndexedDB, transaction chống đua tab, lỗi corrupt không ghi đè | Peer authentication/save-character mapping |
| Session | Build/version/schema/hash gate, role C++, cấu hình một lần, 1–6 người, JSON strict | Game server/handshake khách/replication |

Chi tiết đáng nhớ:

- Dataset inventory: 4.275 restricted rows, 7 skin-set groups, 379 links, 2.034 keys, 54 DLC mappings, 75 free items, 50 emoji.
- Inventory transcript SHA: 4d43a67d6c59ad494103cabe759ae26055bd760da5841c1407aa0474455799b0.
- PostProcessor có bảy API state đã làm, 12 graph API còn thiếu; client factory phải báo thiếu backend.
- MapLayerManager giới hạn 8.192 slot/manager, 65.536 tổng, accounting 32 MiB; layer copy UV, chưa giữ lease atlas qua Map.
- LocalProfileStats có log WEB_COMPAT, giới hạn payload/channel, không âm thầm gửi dữ liệu ra Klei.
- TheNet.GetUserID dedicated offline là chuỗi rỗng theo fixture; client dùng identity web cấu hình riêng.
- Những nhánh dedicated native thật sự no-op phải có evidence; không dùng điều này để biến nhánh client chưa làm thành no-op.

## 9. UITransform — phần triển khai hoàn tất gần nhất

Files chính: engine/ui_transform.*, engine/components.*, runtime.cpp, CMakeLists.txt, src/engine-worker.ts, src/main.ts, src/ui-transform-probe.ts, tests/ui-transform.test.mjs.

Đã làm:

- Đủ 15 phương thức Lua layout CPU đang được catalog.
- Component có owner GUID và typed userdata; Add lặp trả wrapper khác nhau trên cùng component, field entity trỏ wrapper mới nhất.
- Hierarchy cha–con, local/world forward matrix, position/scale/rotation/facing, anchors, scale mode, max upscale.
- Dữ liệu scissor và suppression, cleanup/stale owner.
- ABI dst_ui_viewport(width,height), init client lấy kích thước OffscreenCanvas.
- GetScreenSize lấy viewport; dedicated 0×0, browser probe client 800×600.
- Catalog provenance từ native: tools/ui_transform_catalog.py.
- Probe hai lượt trên cả ba Worker, trong Chrome/Edge/Firefox; không tăng tick/đổi cảnh và dọn state.
- Test dùng Widget và uianim nguyên bản tạo hierarchy. Teardown entity trực tiếp vì Widget:Kill phụ thuộc FrontEnd hoàn chỉnh, không chèn FrontEnd giả.

Native semantics cần bảo toàn:

- Ma trận UI: T × S × R, clockwise trong XY. Regular Transform callback cấp T × Ry × S.
- Angle float32 normalize giữ +pi; có bước chuyển stored rad → degree → nhân float pi/180 trước sinf/cosf.
- Mặc định anchors 3/3, scaleMode 0, scale 1, rotation 0, facing 8, maxPropUpscale 3.
- Chỉ kế thừa parent transform khi anchors 3/3 và mode ngoài 1–4.
- GetWorldPosition của root/independent child trả local position, dù render matrix có viewport anchor offset.
- Anchor CVTT int32, chỉ nhận 0..3; invalid không đổi.
- Facing CVTT int64 rồi low32; 4294967297 → 1.
- Mode 2 dùng min(width/1280,height/720), cap upscale; mode 3/4 scale xy độc lập, z=1, safe area web hiện 0.
- Mode 1 mới chỉ đúng trường hợp render bounds rỗng/unit scale; chưa có renderables cung cấp AABB.
- Trở về mode 0 giữ scale cuối.
- Scissor int low16 có dấu, biến đổi hai góc, không lấy AABB bốn góc; truncation giữ đúng native.
- Clear scissor latches suppression đệ quy, không xóa rectangle; Set không tự bỏ latch.
- Stale wrapper method trả zero Lua values trước khi parse tham số; stale factory trả nil theo nhánh đã kiểm.

Native offsets/UI addresses:

    factory: 0x14007e720
    lookup:  0x14007e530
    type fn: 0x14008a240
    type ID: 0xd74dae38
    finalize:0x14003d000
    dtor:    0x14008b760
    update:  0x14008a610

    H/V anchor 0x68/0x6c; mode 0x70
    localPos 0x74; worldPos 0x80; scale 0x8c; rotation 0x98; facing 0x9c
    localForward 0xa0; localInverse 0xe0
    worldForward 0x120; worldInverse 0x160
    maxUpscale 0x1a0; scissor pointers 0x1a8/0x1b0; suppress 0x1b8

Chưa có UI render submission, Image/Text/AnimState drawing, render bounds, inverse/hit testing đầy đủ. Cùng owner có cả Transform và UITransform đang bị chặn rõ ràng. Budget 16.384 UI nodes, hierarchy depth 512; refresh hiện O(n), chưa tối ưu/benchmark world.

Một số dump thăm dò bắt đầu ở interior/non-UI address 0x14008a000. Không lấy tên/entry phỏng đoán trong các đoạn đó làm kết luận. 0x14008b760 là destructor, không phải constructor như giả thuyết ban đầu.

## 10. Save, persistence và multiplayer hiện tại

### Save/persistence

- Đọc envelope KLEI v1: header KLEI%6d%c, space = plain; D = Base64 + header bốn uint32 + zlib/Adler32.
- Save inspector giải mã bằng Lua sandbox có giới hạn instruction/memory, không thư viện hệ thống.
- Đã đọc metadata save native map 400×400, hơn 13.000 entity.
- Save fixture có bản sao tên theo SHA trong output/native-reference/saves/ để rollback rotation native không xóa nguồn chứng cứ.
- IndexedDB checkpoint atomically commit Master+Caves của cảnh kiểm chứng, rollback/export/import ZIP.
- IDBFS của cả ba Worker giữ file qua page reload, command đợi flush trước khi trả lời.
- Có autosave/lifecycle checkpoint cho cảnh chẩn đoán.

**Chưa nhập terrain/entities/GUID references/player sessions/followers/boats vào world engine**, chưa mapping nhân vật native → web identity, chưa transactional checkpoint world thật/handoff shard.

### Multiplayer

- RTCDataChannel thật, reliable/unreliable, signaling/phòng giới hạn sáu người, version/hash gate.
- Đã kiểm một host + năm khách bằng sáu trang loopback trên cùng máy.
- Chưa phải sáu người chơi DST.
- Chưa Internet/TURN qua hai mạng, netvars/replicas/classified/RPC/relevancy/prediction/reconciliation/gameplay reconnect/shard transfer.
- Không có credential TURN đã nghiệm thu trong môi trường này.

Đừng dành lượt tiếp quản tiếp theo để mở rộng demo network trong khi TextWidget/bootstrap/world còn chặn; người dùng đã ưu tiên game trước.

## 11. Công việc đang dở: oracle TextWidget

**Chưa có engine/text_widget.cpp hoặc .hpp; chưa có TextWidget native binding implementation; chưa có glyph renderer.**

Phần đã làm cho nghiên cứu:

1. Thêm TextWidget vào dynamic component factory enumeration.
2. Thêm block TEXT_WIDGET_ORACLE_BEGIN/END trong tools/native_entity_trace.lua.
3. Tạo ba entity main/defaults/wrapped, mỗi entity có UITransform + TextWidget, giữ sống, tắt sleep/persist.
4. Gọi đủ 16 API, lưu identity wrapper, trạng thái string/region/overflow và loại lỗi tham số.
5. Đo ASCII/kerning/space/tab/CR/LF/CRLF/VT/FF/Unicode/NUL, font size, fixed region, wrap/squeeze/anchor/cursor và font thiếu.
6. Dùng alias có sẵn web_font_secondary từ native_asset_trace.lua, trỏ fonts/bellefair50.zip; không tạo thêm mutation font để làm hỏng fixture font registry đang có.
7. Native trace ghi frontendType và worldType đều là table. Điều này phản ánh native run; không có nghĩa WASM Start đã thành công.

File trace mới nhất:

    output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_text_widget_trace

    envelope: KLEI     1 [space]
    SHA256: 9636d8372f805e9146a9f768c4aeedc821da2efdef664293999d5d73e34a7200
    3 objects, 118 calls, 70 states

Đã kiểm tra lại trace parse được bằng JSON strict sau khi bỏ 11 byte envelope. Có các keys objects/calls/states/frontendType/worldType.

Hai lỗi công cụ đã sửa trong lượt này:

- **Lifetime wrapper:** UI oracle cũ chỉ giữ pointer string cho wrapper đầu. Khi tạo thêm TextWidget, Lua GC có thể thu wrapper đó; ReadProcessMemory báo WinError 299. Đã thêm ui_wrappers và text_wrappers, giữ cả wrapper đầu/lần Add thứ hai trong WEB_UI_FIXTURE/WEB_TEXT_FIXTURE.
- **JSON control characters:** native json.encode_compliant có thể ghi VT/FF literal, làm JSON decoder chuẩn từ chối. Đã gsub control bytes còn lại thành escape Unicode trước SetPersistentString. Không sửa json.lua gameplay.

tools/native_entity_memory.py hiện **chưa capture private layout TextWidget/renderer**. entity-flags.json có closure factory TextWidget nhưng chưa có section textWidget. Bước tiếp theo phải thêm capture có xác minh owner/type/layout sau khi giải thích chắc các offsets ở mục 12.

Không cần sửa lại alias/font oracle chỉ để thêm TextWidget. Nếu phải đổi, phải cập nhật toàn bộ native font-registry expectation có liên quan và capture cùng run.

## 12. TextWidget: địa chỉ và semantics đã khôi phục

### 12.1 Dynamic factory và kiểu

Capture gần nhất xác nhận:

    Entity.AddTextWidget factory: 0x1400604e0
    component type function:     0x1400a1950
    type ID:                     0xaa926b71
    component owner:             +0x18
    renderer object pointer:     +0x20

Trace: Add lặp trả hai userdata wrapper khác nhau; cả hai attach đúng tại thời điểm được gán, entity.TextWidget cuối cùng là wrapper mới nhất. Cần đối chiếu thêm object identity/shared component trong memory capture mới.

### 12.2 API wrapper → component → renderer

| API | Lua wrapper VA | Component/renderer đáng chú ý |
|---|---|---|
| SetFont | 0x14005fd00 | 0x1400a4df0 → 0x1400efa50 |
| SetVAnchor | 0x14005fd50 | 0x1400a18a0 → 0x1400ee8a0 |
| SetHAnchor | 0x14005fda0 | 0x1400a1890 → 0x1400ee870 |
| SetSize | 0x14005fdf0 | 0x1400a1830 |
| SetRegionSize | 0x14005fe30 | 0x1400a1850 → 0x1400ee8d0 |
| GetRegionSize | 0x14005feb0 | 0x1400a1860 → 0x1400eee80 |
| ResetRegionSize | 0x14005ff20 | 0x1400a1870 → 0x1400ee8f0 |
| HasOverflow | 0x14005ff50 | 0x1400a1880 → 0x1400eef70 |
| SetString | 0x14005ffa0 | 0x1400a1810 → 0x1400eedc0 |
| GetString | 0x14005fff0 | 0x1400a1820 → 0x1400ee940 |
| SetColour | 0x140060040 | Color ctor 0x14001b180 → 0x1400a18b0 |
| EnableWordWrap | 0x140060100 | 0x1400a18d0 → 0x1400ee920 |
| EnableWhitespaceWrap | 0x140060150 | 0x1400a18e0 → 0x1400ee930 |
| SetHorizontalSqueeze | 0x1400601a0 | 0x1400a18f0 → 0x1400ee910 |
| ShowEditCursor | 0x1400601e0 | 0x1400a1900 → 0x1400ee950 |
| SetEditCursorColour | 0x140060230 | 0x1400a1930 |

Wrappers kiểm owner/valid bằng helper 0x14005ce60 trước parse tham số. Stale method có nhánh zero return; stale factory phải disassemble/capture chính factory, không tự đoán theo component khác.

SetString/SetFont dùng luaL_checklstring rồi C-string boundary: số có thể thành string, byte sau NUL không được giữ.

Anchors: CVTT int32, nhận 0..3; external 0 → internal 2; 2 → internal 1; 1/3 → internal 0.

Boolean wrappers gọi luaL_checkboolean ở 0x140485f20. Trace có ca số/string/bool; đọc records calls để phân biệt thành công/lỗi, không suy bool từ tên state.

Color ctor float32 × 255 + 0.5, clamp 0..255 rồi truncate integer/low byte; storage RGBA bytes. Nhánh NaN/non-finite chưa đủ để chốt chỉ từ mô tả này.

### 12.3 Renderer offsets đã suy ra từ assembly

Các offset dưới đây là trên renderer object, không phải component:

| Offset | Trường |
|---|---|
| 0x78 | Context/application pointer |
| 0xd0 | Dirty flag |
| 0xd8 | Font resource handle int32 |
| 0xdc | Font size float |
| 0xe0 | Horizontal squeeze float |
| 0xe4 / 0xe8 | Region width / height float |
| 0xec | Wrap mode int32 |
| 0xf0 | Whitespace-wrap bool |
| 0xf4 / 0xf8 | Internal H/V align |
| 0xfc | Packed colour |
| 0x174 | Autosize bool |
| 0x178 | Klei/MSVC string object, 40 byte |
| 0x190 | String length field trong object trên |
| 0x1a0 | Show cursor |
| 0x1a1 / 0x1a2 | Cờ khác, chưa chốt |
| 0x1a4 | Cursor/string-byte-count-related field, còn phải xác định semantics |
| 0x1ac | Shader handle int32 |
| 0x1e8 | Cursor colour |

Đây là hướng dẫn thêm memory capture, **chưa phải private-layout fixture đã kiểm byte**. Không gắn nhãn mọi offset đã xác nhận động.

Semantics quan sát từ disassembly:

- SetFont lookup FontManager 0x140041cf0, bind resource handle lúc setter; không nên re-resolve alias theo mỗi lần layout rồi đổi font ngoài ý muốn.
- SetSize/SetColour/SetRegionSize/SetString có nhánh dirty.
- SetRegionSize tắt autosize; ResetRegionSize bật lại.
- Wrap/squeeze/whitespace setter không trực tiếp set dirty trong các hàm đã xem.
- GetRegionSize khi autosize và dirty gọi font measure rồi trả AABB width/height; hàm này không clear dirty.
- Fixed region trả nguyên width/height được đặt.
- HasOverflow autosize trả false. Fixed+wrap đo với chiều cao tạm FLTMAX; fixed+nowrap đo với chiều rộng tạm FLTMAX, rồi so với giới hạn tương ứng.
- Missing font cho region FLTMAX/FLTMAX trong trace. Không đóng đinh đường trả overflow thiếu font nếu assembly còn giá trị thanh ghi chưa giải thích.
- SetString cập nhật byte-count/cursor field; cùng string có thể không đổi dirty.
- Draw/render path có thể clear dirty; headless không render nên không được suy hành vi client từ headless riêng.

### 12.4 Hàm đo chữ cần decompile tiếp

    Font_measure:      0x140040210
    line parser:       0x14003ffc0
    word parser:       0x14003f880
    glyph/layout:      0x14003f150
    UTF8 decoder:      0x14003e8c0
    fallback lookup:   0x14003eb20 (cần xác minh call path cụ thể)

Đã thấy UTF8 → UTF32, per-line AABB union, CRLF là một linebreak; CR/LF riêng cũng xuống dòng. Space/tab/VT/FF chịu ảnh hưởng whitespace-wrap.

Đừng triển khai bằng tổng xadvance rồi sửa vài constant cho fixture pass: native có kerning collision, fallback scaling, squeeze, rounding, baseline/AABB và trường hợp chuỗi rỗng.

Static evidence:

    output/text-widget-methods.txt
    output/text-widget-core.txt
    output/text-renderer-core.txt
    output/text-layout-entry.txt
    output/text-measure-entry.txt
    output/text-measure-full.txt
    output/text-layout-line.txt

## 13. TextWidget: số đo thật và lưu ý FONT

Các số dưới đây lấy từ native oracle hiện tại với bellefair50, size 50 trừ khi ghi khác. Đây là expected observation, không phải công thức layout.

| Nội dung / tình huống | Region native |
|---|---|
| Chưa gán font/string mặc định | FLTMAX × FLTMAX |
| Chuỗi rỗng sau gán font | FLTMAX/2 × 38 |
| A | 34 × 39 |
| V | 33 × 40 |
| AV | 62 × 40 |
| AVA | 91 × 40 |
| A V | 73 × 40 |
| AV + space cuối | 71 × 40 |
| Space đầu + AV | 74 × 40 |
| Hai space | 24 × 40 |
| AV + LF/CR/CRLF + AV | 62 × 90 |
| AV + tab + AV | 167 × 40 |
| AV + VT hoặc FF + AV | 126.1428604126 × 42.8571434021 |
| Việt | 80.468086242676 × 47.872337341309 |
| 中 | 35.714282989502 × 42.857139587402 |
| Emoji U+1F600 | 22 × 39 |
| A + NUL + B | String lưu A; 34 × 39 |

AVAV với size 10/25/50/72.5/0/-10/37.125 lần lượt:

    23.800003051758 × 8
    59.5 × 20
    119 × 40
    172.55000305176 × 58
    0 × 0
    23.800003051758 × 8
    88.357498168945 × 29.700000762939

AV với squeeze 1 / 0.5 / 2 / 0 / -1 / 0.75:

    62 × 40
    30 × 40
    126 × 40
    3 × 40
    67 × 40
    46 × 40

Fixed region trả đúng số đã đặt, kể cả 0/âm. Overflow phải tính riêng; ví dụ [-1,100] trong oracle trả false trong khi nhiều region khác true.

SetString(123.5) lưu "123.5", region 69×39. Unknown font trả FLTMAX×FLTMAX. State cuối của main: "AV A", fixed region 120×80, overflow false.

FONT API hiện tại:

- Font có line_height/base, glyph metrics [x,y,w,h,xoffset,yoffset,xadvance], channel, kerning, fallback resource keys, advance, colour flag và texture metadata.
- Chưa lưu font info.size riêng; không đoán scale hoàn toàn từ field này khi chưa kiểm native.
- get(path) có thể trả record cache không còn ownership; by_alias yêu cầu mapping resolved và references > 0.
- Release cuối xóa alias/fallback references và GPU/cache ownership.
- TextWidget cần binding ổn định theo resource handle/key. Có thể phải thêm API resolve_alias_binding/by_resource_key; hiện chưa thêm.
- Không giữ raw Font pointer qua release/eviction.
- Fallback vector là resource hash, không phải alias ID.
- Bellefair50 line height 50/base38; glyph A w34,h35,xoffset-1,yoffset4,xadvance31. Native measured height39 cho thấy không chỉ lấy glyph h35.

## 14. Ghidra — đã cài xong, decompile chưa chạy

Đã thêm:

    analysis-tools.lock.json
    tools/setup_analysis.py
    tools/decompile_native.py
    tools/ghidra/DumpFunctions.java

Ghidra tải từ release chính thức:

[Ghidra 12.1.4 — release chính thức](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build)

    archive: ghidra_12.1.4_PUBLIC_20260921.zip
    size: 569,649,598 byte
    SHA256: ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db
    install: C:/Users/Hikari/.cache/dst-wasm-tools/ghidra_12.1.4_PUBLIC

Lúc bàn giao đã xác nhận .cache/analysis-tools.json tồn tại và log kết thúc bằng "Pinned Ghidra ready". Session cũ 63013 không còn tồn tại. Không còn cần đợi/download lại chỉ vì lịch sử trước đó có session đang chạy.

**Chưa chạy tools/decompile_native.py.** output/native-decomp/ chưa có C output, output/ghidra/import.json chưa có marker. Java dump script và headless wrapper mới viết, chưa được thực thi end-to-end.

Wrapper dự kiến:

- Verify executable SHA bằng analysis metadata.
- Verify Ghidra settings khớp analysis-tools.lock.json.
- Import vào project riêng output/ghidra/dst756039, analysis timeout 180 giây/file, max CPU 4.
- Lần sau dùng marker đúng hash/version để process -noanalysis.
- DumpFunctions.java decompile tối đa 120 giây/function, ghi fn_<address>.c.
- Chỉ ghi import marker sau exit 0 và đủ output.
- JAVA_HOME chọn JDK 25 ở đường dẫn trên nếu có.

Điểm có thể cần sửa khi chạy lần đầu:

- Java API/script compilation với Ghidra 12.1.4.
- Format address có leading zero làm tên C file khác expectation Python.
- Timeout analysis không đảm bảo đã phân tích đủ mọi function.
- Không dùng C pseudocode thay cho assembly/trace; type suy luận có thể sai.
- setup_analysis.py có một chỗ mở file tạm để hash chưa dùng context manager; không ảnh hưởng log cài thành công nhưng có thể dọn khi sửa công cụ.

Không cài lại tool toàn hệ thống. Không overwrite binary game.

## 15. Các lệnh tiếp quản

Mở PowerShell và đặt cwd bằng LiteralPath:

    Set-Location -LiteralPath "E:/02_Projects/decr/Don't Starve Together/web-port"
    $dstPython = "C:/Users/Hikari/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
    $dstNode = "C:/Program Files/nodejs/node.exe"
    $dstNpm = "C:/Program Files/nodejs/npm.cmd"

Không dùng biến $HOME/$home/$CODEX_HOME để chứa giá trị tác vụ. Những ví dụ dưới đây giả định cwd là web-port/.

### Build và serve

    ./dev.ps1 -Action build
    ./dev.ps1 -Action serve

Build đầy đủ thực hiện verify originals, prepare scripts/assets/resources/catalogs, build WASM, TypeScript/Vite. Serve chỉ build nếu dist/index.html chưa có; **dist đã tồn tại không có nghĩa nó mới nhất**.

Chỉ build lại C++ khi dữ liệu đầu vào đã chuẩn bị:

    & $dstPython tools/build.py > output/build.log 2>&1
    & $dstNpm run build > output/site-build.log 2>&1

Nếu chỉ sửa src/ mà không chạy tools/build.py, cần finalize hash rồi build site:

    & $dstPython -c "from tools.prepare import finalize_engine; finalize_engine()"
    & $dstNpm run build

Đừng quên finalize_engine: session/hash gate phụ thuộc cả C++/src/toolchain, và browser probe phải chạy đúng contentHash mới.

### Test

    ./dev.ps1 -Action check

Hoặc tách để xem log:

    & $dstPython tools/verify_originals.py > output/originals-check.log 2>&1
    & $dstPython -m unittest discover -s tests -p "*_test.py" > output/python-check.log 2>&1
    & $dstNpm test > output/check.log 2>&1
    & $dstNode tools/bootstrap-gap.mjs

Action check regenerate catalog liên quan trước test nhưng không tự rebuild WASM/site. Sau đổi engine phải build trước. Bootstrap-gap tool thành công chỉ có nghĩa ghi được báo cáo gap; phải đọc fullBootstrapPassed/firstFailure/worldGlobalPresent, không lấy exit code làm dấu game đã chạy.

### Native capture

    & $dstPython tools/capture_native.py --advance-simulation > output/native-capture.log 2>&1

Sau khi capture hoàn tất, regenerate catalog cần thiết:

    & $dstPython tools/atlas_catalog.py
    & $dstPython tools/ui_transform_catalog.py
    & $dstPython tools/shader_catalog.py
    & $dstPython tools/texture_catalog.py
    & $dstPython tools/animation_catalog.py
    & $dstPython tools/asset_type_catalog.py
    & $dstPython tools/font_catalog.py

Không chạy fixture-dependent test đồng thời lúc capture đang ghi đè. Không sửa oracle/capture Python giữa một native run. Đọc attempt.json, run ID, source/trace hashes và capture errors; exit 0 riêng lẻ chưa chứng minh world/fixture hoàn chỉnh.

### Disassembly và decompile

    & $dstPython tools/native_function.py 0x140040210 --bytes 10000 --limit 1600
    & $dstPython tools/native_function.py 0x140040210 --client

Lệnh --client chuyển executable; địa chỉ phải xác định lại cho client. PE unwind có thể chia một function thành nhiều range; dùng --bytes hợp lý để xem continuation, không mặc định first-ret là hết hàm.

Ghidra đã cài; lệnh cài chỉ cần khi thiếu/corrupt:

    & $dstPython tools/setup_analysis.py

Lệnh decompile đề xuất, chưa chạy trong lịch sử hiện tại:

    & $dstPython tools/decompile_native.py 0x140040210 0x14003ffc0 0x14003f880 0x14003f150 0x14003eb20

Chạy có log và theo dõi process. Tool lâu chạy phải poll session cũ, không khởi động bản thứ hai do một lần chờ hết timeout. Khi công cụ kết thúc mới sửa/retry.

### Browser probes

Server:

    & $dstNode tools/signaling.mjs

URL mặc định: http://127.0.0.1:8787.

Ví dụ Playwright CLI:

    & "C:/Program Files/nodejs/npx.cmd" --yes --package @playwright/cli playwright-cli -s=dst-chrome open http://127.0.0.1:8787 --browser chrome
    & "C:/Program Files/nodejs/npx.cmd" --yes --package @playwright/cli playwright-cli -s=dst-chrome run-code --filename tools/browser-ui-transform-check.js
    & "C:/Program Files/nodejs/npx.cmd" --yes --package @playwright/cli playwright-cli -s=dst-chrome run-code --filename tools/browser-check.js

Đổi browser thành msedge/firefox và session thành dst-edge/dst-firefox khi tạo session. Những session name này từng dùng ở lượt trước; phải kiểm tra lại, không giả định tab còn sống.

CLI exit 0 vẫn có thể chứa "### Error". Đọc Result JSON, contentHash, cleanup counters và lỗi console. Probe cũ/contentHash cũ không nghiệm thu engine vừa sửa.

Không cần chạy lại mọi probe cũ sau mỗi thay đổi nhỏ; chọn probe subsystem và broaden khi có thay đổi/failure/cross-cutting concern thực sự.

## 16. Cách tiếp tục TextWidget mà không làm giả tương thích

Thứ tự khuyến nghị cho AI nhận bàn giao:

1. Đọc snapshot hiện tại, xác nhận native run/manifest/hash và phần thay đổi chưa được full suite kiểm lại.
2. Chạy headless Ghidra lần đầu cho measurement/line/word/glyph helpers; sửa công cụ nếu có lỗi, lưu log, không patch game binary.
3. Đối chiếu pseudocode với assembly, FONT resource layout và 70 state native đã có.
4. Thêm private TextWidget/renderer memory capture có type/owner/run/hash check. Capture constructor/default/final state, font handle, dirty/wrap/anchor/colour, string length và lifetime.
5. Tách TextWidget state/layout thành module riêng, nối component registry/lifecycle/CMake và giữ getter/setter coercion/native return arity.
6. Bổ sung resource binding API an toàn cho font handle; không re-resolve alias mỗi lần layout hoặc giữ con trỏ đã release.
7. Implement UTF8/fallback/kerning/squeeze/rounding/baseline/line wrap từ semantics thực. Trường hợp chưa hiểu phải ghi rõ; không hard-code chuỗi fixture.
8. Kiểm đối chiếu số đo/bytes native, invalid arguments, duplicate wrappers, cleanup/stale owner, unloaded font và client/headless separation.
9. Chạy Widget/Text Lua gốc và bootstrap-gap. Nếu Start tiến tới API khác, báo blocker mới đúng sự thật.
10. Khi có CPU layout, nối render glyph thực vào UI pipeline; pixel/native render cần fixture riêng. CPU getters pass không đủ nghiệm thu Text drawing.
11. Build/finalize/site, chạy kiểm tra thích hợp và cập nhật STATUS/compat/report/hash với fixture run đồng nhất.

Đừng tạo TheFrontEnd/TheWorld giả để qua test; đừng nuốt UNIMPLEMENTED_NATIVE; đừng dùng Canvas measureText/browser font thay cho metrics/tài nguyên native; đừng lấy glyph height đơn thuần hoặc tổng advance làm toàn bộ measurement.

Các bước này là hướng đi tiếp từ bằng chứng hiện có, không phải khẳng định có thể xong toàn full game chỉ bằng TextWidget.

## 17. Sau TextWidget: khoảng trống lớn còn lại

Theo phụ thuộc, còn ít nhất:

1. Bootstrap thật và entity/component/update dispatch đầy đủ; làm rõ startup client vs dedicated.
2. AnimState, Image/Text/UI drawing, camera/render sorting/symbol override/skin, ánh sáng/bóng/particle/post.
3. WorldSim, Map/terrain, worldgen/RNG hoàn chỉnh, navigation/collision/Bullet CPU adapter và chính sách sleep/wake.
4. Spawn player/world, crafting/combat/survival/AI/mùa/thời tiết/cháy/biển/thuyền/hang động từ gameplay Lua nguyên bản.
5. Native save import thành scene thực: terrain, entities, GUID graph, inventory/follower/boat, offline players, Master+Caves linkage.
6. SoundEmitter và FEV event graph, các bank audio còn lỗi, event timing/loop/params/attenuation/reverb.
7. Khi chơi local được: netvars/RPC/replicas/classified, relevancy/prediction/reconciliation/reconnect, shard transfer không mất/nhân đôi.
8. Ma trận toàn nội dung build, native visual/audio/gameplay regression.
9. Performance/streaming/quota/context loss/crash recovery/four-hour soak, đóng gói tự host và TURN Internet.

Không thay thứ tự ưu tiên bằng việc tiếp tục thêm metadata hoặc demo network chỉ vì dễ có thêm test pass.

## 18. Các gate chưa nghiệm thu

Mục tiêu kiểm thử người dùng chốt vẫn còn hiệu lực:

- Health/hunger/damage/inventory/crafting/progress khớp native trong fixture.
- Movement/collision sai lệch tối đa 0,01 unit; animation/audio trigger tối đa một simulation tick.
- Scene cố định SSIM >= 0,99 sau mask vùng biến thiên có giải thích.
- Worldgen/RNG seed cố định, mọi khác biệt có nguyên nhân và giải quyết trước khi đóng hạng mục.
- Nhập save nguyên vẹn/truncated/sai build/thiếu shard/mod không hỗ trợ.
- GUID/inventory lồng/follower/boat/offline player/shard handoff đang dở.
- Sáu client, RTT 150 ms, jitter 30 ms, mất gói 2%, direct và TURN, reconnect, bốn giờ không lỗi chặn chơi.
- Render mục tiêu 60 FPS, p95 frame <= 33,3 ms ở scene 1080p; mỗi shard 30 TPS, p95 tick < 33,3 ms.
- Tối đa 1 GiB WASM/instance, ba instance <= 3 GiB; theo dõi texture/audio riêng.
- Quota thiếu, WebGL context loss, abrupt close, sleep/resume, host mất mạng.

Host profile đã ghi: Intel Core Ultra 7 155H, khoảng 16 GiB RAM, Intel Arc + NVIDIA RTX 4070 Laptop. output/host-profile.json có chi tiết. Chưa chạy benchmark world thật để kết luận đạt các ngưỡng trên.

Tab host phải hoạt động, không sleep; khi hidden/freeze cần checkpoint và pause. Không catch-up simulation thời gian đã bị freeze. Không dựa vào unload event để bảo đảm save.

## 19. Bài học kỹ thuật và lỗi dễ lặp lại

- Python trên Windows: đọc/ghi văn bản encoding='utf8'; stdout cp1252 có thể lỗi với tiếng Việt, dùng sys.stdout.reconfigure(encoding='utf8') khi cần.
- Dùng Python executable thật ở trên, tránh WindowsApps python alias.
- Muốn import pefile/capstone trong ad hoc script, import tools.native_function trước hoặc thêm đúng cache python-deps vào sys.path.
- Dùng rg với thư mục và -g '*.mjs'; đừng đưa Windows wildcard literal vào path rồi tưởng không có file.
- Luôn quote/LiteralPath vì workspace có dấu apostrophe và khoảng trắng.
- Không dùng chuỗi command xây động/JSON.stringify làm shell escaping; tránh command substitution ngoài ý muốn.
- Đọc native component wrapper phải giữ userdata sống; pointer-string không giữ object khỏi GC.
- C closure target có thể là dispatcher chung; method thực nằm trong upvalue descriptor.
- Địa chỉ vtable/type/ctor/dtor cần xác minh, không dựa vào tên phỏng đoán.
- Native float32 rounding/truncation/overflow có thể quan trọng; -fno-fast-math đã được dùng.
- Trả nil và zero Lua return values khác nhau; stale wrapper/invalid args phải giữ đúng thứ tự guard.
- Native type coercion có numeric string/NUL/low32/sign-extend không giống JS Number mặc định.
- Cache lease/alias/resource identity là ba khái niệm khác nhau; đừng để setter font/atlas tự fetch hoặc tự acquire khi native không làm.
- Atomic checkpoint demo không thay thế import/save world đầy đủ.
- Browser 32 MiB heap trong probe nhỏ không chứng minh full world dưới budget.
- Không xóa output/native-reference/storage/saves hoặc cache evidence vì tưởng chỉ là log; nhiều test cần chúng.
- Native AddShadowManager sau entity Remove từng crash 0xc0000409; fixture nguy hiểm đã lưu riêng, không chạy lại vô ý. Web adapter dùng lỗi Lua có kiểm soát và ghi giới hạn.
- Việc thiếu backend phải được ghi ra, không thay bằng success/no-op âm thầm.

## 20. Trạng thái tiến trình lúc bàn giao

Đã kiểm tra trong lượt bàn giao:

- Ghidra download/install hoàn tất; session 63013 đã hết, không có decompile job đã tạo output.
- Không thấy listener ở TCP port 8787 tại lúc kiểm kê; cần chạy server khi muốn browser probe.
- Không thấy Python/Java analysis process đang chạy trong danh sách kiểm tra.
- Không xác nhận lại trạng thái tab/session Playwright; kiểm tra trước khi reuse.
- Không cố ý để native dedicated reference process chạy tiếp.

PID/session trong lịch sử không phải tài sản để kill/restart tùy ý. Kiểm tra command line/port/process owner trước khi thao tác.

## 21. Checklist bàn giao cho lượt đầu của AI kế tiếp

- [ ] Đọc HANDOFF.md, STATUS.md, output/handoff-state.json.
- [ ] Xác nhận cwd/original hashes/tool configs/manifest WASM.
- [ ] Phân biệt báo cáo 92 pass cũ và native capture TextWidget mới.
- [ ] Kiểm tra Ghidra đã cài, không download lại vô cớ.
- [ ] Tiếp tục TextWidget measurement/private capture theo mục 16.
- [ ] Giữ ưu tiên game chạy trước multiplayer.
- [ ] Sau thay đổi: build/finalize/site, test phù hợp, bootstrap gap, report rõ phần đã chứng minh/chưa có.
- [ ] Không đánh dấu full game hoặc milestone hoàn thành khi chỉ thêm binding/probe.

Prompt ngắn có thể gửi cho AI tiếp quản:

> Đọc web-port/HANDOFF.md và output/handoff-state.json trong workspace hiện tại. Tiếp tục dự án DST build 756039 WASM, ưu tiên game local chạy thật trước multiplayer. Engine đã có UITransform CPU; main.lua trả về nhưng Start dừng ở Entity.AddTextWidget. Native TextWidget oracle mới đã capture, Ghidra đã cài nhưng chưa decompile; TextWidget chưa được implement. Tiếp tục từ measurement/layout/private-memory capture, giữ gameplay Lua gốc và lỗi rõ cho backend thiếu. Đừng coi 92 test pass của fixture run trước là xác nhận run TextWidget mới; build/test/report lại sau thay đổi.

Các file bàn giao chính có thể mở trực tiếp:

- [Bản kiểm kê hash lúc bàn giao](</E:/02_Projects/decr/Don't Starve Together/web-port/output/handoff-state.json>)
- [Trạng thái các mốc](</E:/02_Projects/decr/Don't Starve Together/web-port/STATUS.md>)
- [Báo cáo UITransform đã kiểm chứng](</E:/02_Projects/decr/Don't Starve Together/web-port/output/ui-transform-verification.json>)
- [Báo cáo bootstrap còn bị chặn](</E:/02_Projects/decr/Don't Starve Together/web-port/output/bootstrap-gap.json>)

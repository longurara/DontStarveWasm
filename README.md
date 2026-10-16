# DST 756039 → WebAssembly

**Đây là nền tảng port có thể chạy và kiểm chứng, chưa phải bản full game.**

Client, Master và Caves hiện chạy Lua 5.1 trong ba Worker WASM riêng. Cảnh kiểm chứng dùng EntityScript, scheduler, timer và finiteuses nguyên bản. Bộ xem tài nguyên hiển thị mesh/animation Wilson thật bằng WebGL2. Chưa có địa hình, player prefab hoặc vòng chơi sinh tồn hoàn chỉnh.

## Chạy

Mở PowerShell trong thư mục này:

    .\dev.ps1 -Action build
    .\dev.ps1 -Action serve

Mở http://127.0.0.1:8787 và bấm **Khởi động WASM**. Có thể dùng Use(5), lưu/khôi phục checkpoint và mở phòng WebRTC kiểm chứng. Mở trang thứ hai, nhập mã mời và vào phòng.

Lần build đầu tải Emscripten 4.0.23, Lua 5.1.5, CMake và Ninja. Công cụ được cài vào cache người dùng, không cấu hình toolchain toàn hệ thống. Node.js/npm dùng package-lock.json. Không dùng Docker.

Giữ web-port/ cạnh data/, bin64/ và analysis/ hiện có; công cụ đọc dữ liệu từ bộ cài này. File game gốc không bị chỉnh sửa.

## Những phần đã chạy được

- C++17 + Lua 5.1.5 build thành WASM32, heap ban đầu 32 MiB, giới hạn 1 GiB/instance.
- Loader giải nén và kiểm tra SHA-256 trước khi nạp script; 4.030 file Lua được chia thành 16 pack theo nội dung. Cảnh đầu chỉ tải boot pack.
- Entity/GUID/tag/Transform cơ bản; Lua Class, EntityScript, event listener, scheduler, timer và finiteuses gốc.
- PCG32 khôi phục từ native binary, đã đối chiếu chuỗi random seed 12345 với game native đang chạy; giữ RNG state trong checkpoint.
- Đọc KTEX DXT1/DXT3/DXT5/RGB/RGBA, BILD6 và ANIM4; xem Wilson bằng OffscreenCanvas trong client Worker. Đây là asset viewer, chưa phải renderer engine hoàn chỉnh.
- Checkpoint chẩn đoán của hai shard được commit nguyên tử vào IndexedDB; export/import ZIP.
- Signaling giới hạn sáu người, kiểm tra phiên bản/hash, relay giới hạn theo phòng; RTCDataChannel thực giữa trình duyệt host và khách.
- Đọc envelope KLEI v1 dạng plain hoặc Base64/zlib và kiểm tra checksum. Lua decoder riêng có giới hạn bộ nhớ/instruction, không có thư viện hệ thống; đọc được metadata save native thật. **Chưa dựng lại world từ save.**
- Native API chưa triển khai báo UNIMPLEMENTED_NATIVE, không trả kết quả giả.

## Kiểm tra

    .\dev.ps1 -Action check

Có 92 test Node/WASM/network/audio/resource/input/session/entity/component/animation/FILE/ATLAS/KSH/KTEX/FONT và ba test Python đọc tài nguyên. Test so sánh native cần fixture được tạo từ executable gốc:

    python tools/capture_native.py --advance-simulation
    python tools/atlas_catalog.py
    python tools/shader_catalog.py
    python tools/texture_catalog.py
    python tools/animation_catalog.py
    python tools/asset_type_catalog.py
    python tools/font_catalog.py

--advance-simulation tắt auto-pause trong riêng profile đối chiếu để
quan sát entity qua nhiều frame. Công cụ đọc cờ entity của đúng child process,
xác minh GUID và hash executable; không ghi hay patch bộ nhớ native.

Lệnh này chạy dedicated server offline/LAN trong profile riêng tại output/native-reference/, không dùng cluster hiện có. Lần đầu tạo world có thể cần chạy lại để vào world đã sinh. Save đối chiếu có bản sao theo hash trong saves/ để lần native xoay rollback sau không xóa fixture đã ghi nhận. Trace, save và exit code được lưu riêng; có file save không đồng nghĩa mọi fixture trong M0 đã hoàn thiện.

Browser regression dùng Playwright CLI:

    npx --yes --package @playwright/cli playwright-cli -s=dst open http://127.0.0.1:8787 --browser chrome
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-six-peers.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-storage-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-audio-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-resource-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-input-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-platform-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-session-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-identity-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-ui-transform-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-lifecycle-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-animation-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-shader-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-texture-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-font-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-component-check.js
    npx --yes --package @playwright/cli playwright-cli -s=dst run-code --filename tools/browser-map-layer-check.js

Đổi browser sang msedge hoặc firefox để kiểm tra runtime/WebGL/checkpoint. Bài sáu người hiện kiểm tra bằng sáu trang trên cùng máy, không đại diện kiểm thử Internet, TURN hay trận chơi bốn giờ.

    .\tools\host-profile.ps1

Lệnh này ghi CPU/GPU/RAM và browser version vào output/host-profile.json. Đây là
cấu hình máy đối chiếu; chưa có benchmark world để nghiệm thu hiệu năng full game.

## Internet và tự host

tools/signaling.mjs phục vụ dist/ cùng WebSocket signaling; không chạy simulation. Mặc định bind 127.0.0.1:8787.

- Dùng HTTPS/WSS khi cung cấp trang qua Internet; triển khai sau reverse proxy TLS.
- HOST, PORT, DST_ALLOWED_ORIGIN cấu hình listener/origin.
- DST_ICE_SERVERS là JSON mảng RTCIceServer do người vận hành cung cấp; cũng có thể nhập trong giao diện.
- Chưa cấu hình dịch vụ TURN thực tế trong môi trường này, vì vậy Internet/TURN chưa được nghiệm thu.
- Khi host ẩn tab: dừng tiến tick và yêu cầu checkpoint; khi host đóng tab: khách ngắt kết nối. Không chuyển host tự động.

## Phần còn lại

Xem [STATUS.md](STATUS.md) để biết từng mốc. M4 gameplay/world/physics, FEV event graph, player sessions, nhập world native đầy đủ và network replication của DST chưa triển khai.

## Chuẩn bị âm thanh

    python tools/fmod_catalog.py
    python tools/fmod_samples.py --bank wilson.fsb
    python tools/build.py
    npm run build

Bỏ --bank để quét cả 153 bank. Mỗi bank được giải mã trong process có timeout;
bank lỗi ghi rõ vào public/generated/audio/sample-index.json, không tự thay bằng
âm thanh khác. FMOD DLL gốc chỉ chạy ở công cụ offline này. Mỗi sample FLAC được
kiểm tra PCM sau khi giải mã lại. Manifest ràng buộc hash metadata bank, FLAC và
PCM với phiên chơi; sau khi chuyển thêm bank cần build lại manifest/site.

Lượt quét hiện tại: 92/153 bank thành công, 4.889 sample; 61 bank còn lỗi hoặc
timeout. Mã thoát khác 0 phản ánh lỗi này, không phải toàn bộ audio đã hoàn tất.

Nút **Thử sample âm thanh gốc** phát Pickup_item qua decoder FLAC WASM và
WebAudio sau khi kiểm tra hash PCM native. Chưa có SoundEmitter/event graph,
mixing theo gameplay, attenuation, parameter hay reverb; không dùng nút này
để nghiệm thu âm thanh full game.

## Resource filesystem

    python tools/resources.py
    python tools/build.py
    npm run build

Build qua dev.ps1 đã chạy bước này. Công cụ đọc data/ và các databundle, giữ
đường dẫn logic gốc, bỏ FSB đã có pipeline FLAC riêng. Hiện có 15.290 file trong
440 pack theo hash, khoảng 3,54 GB nguồn. Mỗi chunk tối đa 1 MiB, mỗi pack tối
đa 8 MiB dữ liệu. Cache RAM giữ tối đa 32 MiB pack đã giải nén mỗi Worker;
CacheStorage giữ pack qua reload. Quota cache lỗi vẫn cho phép đọc đã xác minh
từ mạng. Cache đĩa chưa có chính sách LRU riêng.

kleifileexists tra resource index đã kiểm tra hash. Bytes chỉ tải khi adapter
yêu cầu; việc lập index không chép cả game vào MEMFS. Raw KTEX/KSH/font/anim
trong pack vẫn cần decoder/renderer tương ứng, chưa coi đóng gói là đã hỗ trợ
toàn bộ định dạng. resourceTest kiểm tra byte transport; animationTest chạy decoder C++ WASM thật.

Decoder C++ đọc ZIP/BILD6/ANIM4, XML ATLAS/FONT, KSH và pixel KTEX. LoadPrefabs
headless có ANIM/DYNAMIC_ANIM; ATLAS/DYNAMIC_ATLAS có vòng đời texture riêng;
cả ba vai trò có FILE giữ byte và NUL terminator theo native,
refcount/dependency và unload. Các format chưa hỗ trợ vẫn báo lỗi.
Asyncify giữ Lua stack khi chờ pack qua mạng, Worker serialize command để
tránh reentry. ZIP nguồn tạm được xóa sau parse. Cache bundle giới hạn 192 MiB
theo ước lượng dữ liệu giữ lại, LRU chỉ đẩy bundle không có owner; FILE có ngân
sách giữ dữ liệu riêng 64 MiB; metadata ATLAS 32 MiB và KSH 16 MiB. Bộ xem Wilson
vẫn dùng mesh/motion JSON offline; chưa nối decoder C++ thành
AnimState/renderer gameplay. Xem [compat/asset-loading.md](compat/asset-loading.md).

68 KSH gốc đã decode trong WASM và compile/link trên WebGL2 của Chrome/Edge/Firefox.
Bộ xem Wilson dùng shader UI gốc qua LoadPrefabs và texture KTEX giải mã trong WASM,
không tải PNG. Backend client ATLAS/IMAGE upload từng mip lên WebGL2; DYNAMIC_ATLAS
giữ UV và chỉ tải texture khi được yêu cầu. 34 mip Wilson/UI đã readback đúng từng
pixel theo oracle Python độc lập trên ba trình duyệt. Mesh viewer vẫn dùng JSON offline.
Đây chưa phải pipeline ánh sáng/post-processing/world; shader fallback và nối
uniform gameplay còn thiếu. Xem [compat/shader-loading.md](compat/shader-loading.md).

FONT loader đọc đủ 24 pack / 94.886 glyph, giữ metrics, channel masks và kerning
theo native. Ba font có snapshot bộ nhớ đối chiếu; texture của ba font mẫu upload
và readback đúng byte trên Chrome/Edge/Firefox. LoadFonts Lua nguyên bản đã chạy,
alias/fallback/advance và lifetime khớp registry native. Chưa layout Text hoặc
vẽ chữ trong UI. Xem [compat/font-loading.md](compat/font-loading.md).

Prefab registration nhận 12 loại asset không phân biệt hoa/thường và ép tham số
float32 theo native. MINIMAP_IMAGE không nằm trong bảng đó; metadata bị native
bỏ qua được ghi rõ qua WebPrefabs.IgnoredAssets. AtlasContains tra StringID trên
atlas đã có lease, không fetch XML/texture hoặc tự nhận minimap renderer đã có.

Click canvas để thử phím/chuột ở adapter; blur sẽ xóa trạng thái giữ phím.
Input đã đi vào Worker và các native state queries, chưa điều khiển nhân vật DST.

Để đo khoảng cách tới bootstrap thật:

    node tools/bootstrap-gap.mjs

Lệnh này thử main.lua nguyên bản trong một instance riêng, ghi điểm dừng vào output/bootstrap-gap.json. Việc cảnh finiteuses chạy được không thay cho nghiệm thu bootstrap toàn bộ game.

Master hiện qua dữ liệu skin, đăng ký prefab, scrapbook, FollowCamera và tạo
TheGlobalInstance; GlobalInit đã nạp tài nguyên/font và tạo ShadowManager/RoadManager/EnvelopeManager/PostProcessor headless từng phần,
main.lua đã trả về; Start dừng ở Entity.AddTextWidget (scripts/widgets/text.lua:6). DYNAMIC_ANIM hiện đọc geometry/clip và hoãn texture theo native;
chưa tải .dyn/skin động. Dataset fingerprint skin khớp native;
ValidateWithSignature mới ghi nhận signature, chưa xác minh ownership tài khoản.
Camera headless đã có state float32; camera client thế giới và backend audio
vẫn cần triển khai. Bảng STATUS.md ghi rõ bằng chứng và giới hạn từng phần.

Component factories động được đọc từ C closure native, có đối chiếu GUID/vtable.
ShadowManager Master/Caves giữ đúng wrapper/owner/lifetime và SetTexture chỉ tra
cache, không tải pixel. Chưa GenerateStaticShadows hoặc renderer client; xem
[compat/components.md](compat/components.md).

RoadManager giữ control point float32 và cấu hình strip đã đối chiếu; chưa có
geometry/quadtree. EnvelopeManager giữ keyframe màu/vector và resource trùng
tên đúng native; chưa sampler/particle. Chi tiết tại
[compat/envelopes.md](compat/envelopes.md).

PostProcessor headless có bảng uniform dùng chung, sampler settings và nhánh
Lua dedicated nguyên bản đã đối chiếu. Chưa shader graph/FBO hoặc hậu kỳ client;
xem [compat/postprocessor.md](compat/postprocessor.md).

FontManager dùng chung alias registry với LoadFont trên cả ba vai trò, giữ màu
và lease của font; chưa Text layout/drawing. Đối chiếu và giới hạn tại
[compat/font-manager.md](compat/font-manager.md).

MapLayerManager headless giữ UV variants theo XML gốc, màu và handle đã đối
chiếu; chưa Map geometry/terrain renderer. Setter bán kính PhysicsWaker có state
float32, chưa solver/waker. Xem [compat/map-layers.md](compat/map-layers.md).

UITransform có userdata riêng, layout float32, cây cha–con, anchor, scale mode
và dữ liệu scissor đã đối chiếu native. Client nhận viewport từ canvas; Widget
và uianim gốc dựng được cây UI trong test. Chưa Text/Image renderer hoặc hit
testing đầy đủ. Xem [compat/ui-transform.md](compat/ui-transform.md).

Session metadata được host truyền vào WASM một lần qua dst_configure_session;
game build, engine/schema version và content hash phải khớp. Cấu hình đã commit
tách khỏi SetDefaultGameMode của Lua; chưa có giao diện cấu hình world hay
handshake chuyển session parameters từ host sang khách gameplay. Internet
WebRTC dùng danh tính offline của engine, không bật Steam/Klei account services.

Client có khóa WEB_ riêng lưu trong IndexedDB; shard giữ GetUserID rỗng như
dedicated/offline native. GetNumLaunches và play-instance stash giữ đúng vòng
đời Sim/application. SendProfileStats chỉ ghi chẩn đoán cục bộ, có log và policy
rõ ràng. Xem [compat/startup.md](compat/startup.md). Ưu tiên hiện tại là chạy
trọn game; multiplayer gameplay làm sau.

Entity có state ngủ/thức và cờ cho phép ngủ; kernel nhận quyết định authoritative
và gọi callback Lua gốc theo thứ tự native. WorldSim chọn vùng ngủ/thức vẫn chưa
có. Probe trên trình duyệt dùng quyết định cấp sẵn để kiểm chứng ABI/callback,
không dùng nó làm chính sách world. Transform đã chuẩn hóa góc float32 theo
fixture native, gồm trường hợp 360° trả 0°.

## Cấu trúc

- engine/: runtime C++/Lua và bộ đọc metadata save.
- compat/: khởi tạo nền tảng web và cảnh kiểm chứng; không sửa Lua gốc.
- src/: Worker coordinator, asset viewer, RTC và IndexedDB.
- tools/: build, chuẩn bị pack, decoder tài nguyên, fixture native và signaling.
- tests/: kiểm thử có thể chạy lại.
- public/generated/, dist/, output/: artifact sinh ra, không phải source.

Lua thuộc giấy phép MIT tại vendor/lua-5.1.5/COPYRIGHT sau setup. LuaBitOp giữ giấy phép trong source; dr_flac 0.13.3 dùng MIT-0/public domain trong vendor/dr_libs/dr_flac.h. RapidXML 1.13 lấy từ [nguồn chính thức](https://sourceforge.net/projects/rapidxml/files/rapidxml/rapidxml%201.13/) và giữ license.txt trong vendor/rapidxml-1.13; archive/header khóa SHA256 trong toolchain.lock.json. Dependencies JavaScript giữ giấy phép theo package-lock. Asset game nằm ngoài source của engine tương thích. Các khác biệt adapter được ghi tại [compat/README.md](compat/README.md).

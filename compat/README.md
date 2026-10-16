# Lớp tương thích web

Không sửa Lua trong scripts.zip. Mọi API chưa có implementation vẫn báo lỗi
UNIMPLEMENTED_NATIVE. Chưa nghiệm thu bootstrap main.lua hay world gameplay.

| Điểm khác nền tảng | Lý do và phạm vi |
|---|---|
| PLATFORM=WEB; release/PRODUCTION, build 756039 | Chọn adapter web; tránh tự nhận là Steam và gọi dịch vụ native. Các nhánh chỉ dành Steam vẫn cần rà soát trước nghiệm thu full game. |
| APP_ARCHITECTURE=WASM32; APP_OS_ARCHITECTURE=BROWSER | Metadata của runtime web, không suy đoán kiến trúc hệ điều hành của máy host. |
| SendProfileStats ghi chẩn đoán cục bộ | Giữ count/byte/hash/channel có giới hạn, không giữ payload hoặc gửi tới telemetry Klei. Lời gọi đầu log WEB_COMPAT; WebProfileStats báo rõ networkEnabled=false. Xem startup.md. |
| GetUserID của client dùng khóa WEB_ riêng; shard trả chuỗi rỗng | Khóa client giữ trong IndexedDB qua reload; giao dịch tạo khóa tuần tự giữa các tab. Shard/offline khớp trace native. Chưa xác thực peer, ownership hoặc ánh xạ nhân vật native. |
| UI viewport lấy từ canvas qua dst_ui_viewport | Client hiện dùng 800×600; headless 0×0 khớp native. UITransform có layout CPU/anchor/scissor riêng, chưa vẽ UI, render bounds hay inverse hit testing. Hai loại Transform trên cùng owner hiện báo lỗi rõ. Xem ui-transform.md. |
| Ngôn ngữ ban đầu english/en | Cấu hình mặc định đã đối chiếu native; chưa nối lựa chọn ngôn ngữ web. SetDefaultServerLanguage có state riêng cho mỗi instance. |
| Cấm io, os.execute/os.exit và dynamic native modules | Trình duyệt dùng filesystem/network/audio adapter. Lua gameplay không có quyền chạy executable hay DLL. |
| Persistent strings nằm trong /persistent/{role} | Mỗi Worker mount một namespace IDBFS riêng để tránh syncfs của shard này ghi đè shard khác. Không tự ánh xạ cluster-slot API chưa triển khai. |
| Callback persistent-string chạy đồng bộ | Giữ thứ tự native đã trace. Callback phản ánh ghi vào filesystem của instance; phản hồi Worker chờ IndexedDB commit. Commit lỗi giữ dirty và trả lỗi cho host. Checkpoint hai shard nguyên tử là hợp đồng riêng ở persistence.ts. |
| Persistent-string Lua API kết thúc tại NUL | Khớp fixture native cả ghi và callback đọc file chứa NUL; codec envelope vẫn giải mã đầy đủ byte. Tham số nén chỉ được dùng nếu là boolean; nếu bỏ nó thì vị trí kế tiếp là callback. Không dùng API Lua này như kênh binary dài tùy ý. |
| Bootstrap có instruction budget hữu hạn | Chặn vòng lặp vô hạn; bài bootstrap đầy đủ cho phép 100 triệu lệnh, bài diagnostic mặc định hai triệu. Budget save-inspector vẫn tách riêng. |
| SetReverbPreset trên shard headless không tạo audio | Đúng nhánh null sound manager trong dedicated server native. Client vẫn báo chưa triển khai thay vì giả lập reverb thành công. |
| Resource path tra index có hash trước khi tải | Giữ logical paths của data/databundles; tra tồn tại không tải byte. Adapter tải pack và kiểm tra cả hash pack/chunk/file trước khi dùng. Đây chưa là decoder của mọi format. |
| Native asset I/O dùng Asyncify | Giữ lời gọi Lua đồng bộ về thứ tự, nhưng adapter có thể tạm dừng cả stack WASM khi tải pack. evaluateAsync phải được await; Worker serialize command và không tiến tick trong lúc chờ. Không dùng pthread/SharedArrayBuffer. File nguồn tạm xóa sau parse; chi tiết và giới hạn tại asset-loading.md. |
| Client web có một Keyboard/Mouse, shard headless có 0 device | Headless đã đối chiếu trace dedicated. Client map KeyboardEvent.code sang key constants build 756039; tọa độ canvas từ góc dưới trái; mất focus nhả toàn bộ key/button. Controller chưa có. |
| Main update chưa được nối | Tick thiếu callback báo UNIMPLEMENTED_NATIVE trước khi tăng đồng hồ. Cảnh diagnostic có callback riêng; không coi nó là update loop native hoàn chỉnh. |
| MODS_ENABLED=false | Đúng phạm vi game gốc trước; filesystem chỉ có canonical paths trong manifest. ClearFileSystemAliases chỉ xóa tập alias rỗng ở cấu hình này; bật mod vẫn báo chưa triển khai alias. |
| json_settings rỗng khi cold bootstrap; RUN_GLOBAL_INIT=true | Instance mới chưa có settings/session/prefab cache của native host. Chưa tự nhận settings nhập từ world; cần truyền qua adapter có version khi load world. |
| SystemService storageAvailable lấy từ IDBFS; focus lấy từ window | Sau mount và populate thành công mới báo available; commit lỗi hạ cờ và giữ dirty để retry. Chỉ client nhận focus, shard có vòng đời riêng. Các getter/flags khác được đối chiếu trace native. |
| Haptics device-disabled | Cấu hình web đầu tiên chỉ bàn phím/chuột. Cả mười method theo nhánh native không có thiết bị: không trả giá trị; không coi đây là hỗ trợ controller rumble/audio haptics. |
| Camera headless giữ state, client world camera chưa có | Position/direction/up/FOV/listener dùng float32 theo setter native. FollowCamera gốc được đối chiếu ba cấu hình. Camera client báo lỗi tới khi nối matrices/projection/world renderer và listener WebAudio. |
| Session parameters do platform adapter cấu hình | Mỗi instance nhận cùng build/version/hash và cấu hình phiên một lần. NetworkProxy đọc cấu hình đang chạy; SetDefaultGameMode chỉ đổi default cho lựa chọn sau, không đổi phiên hiện tại. Chưa persistence của default hay UI world settings. |
| IsOnlineMode=false; offlineCluster=true trong engine | Đây là chế độ danh tính/account của native, độc lập với kết nối Internet WebRTC. Không có Steam/Klei account/friends services; cấu hình yêu cầu những dịch vụ đó báo lỗi. Master/Caves là instance headless riêng nên GetServerIsDedicated=true, GetServerIsClientHosted=false; client vẫn IsDedicated=false. |
| Envelope session dùng JSON chuẩn ở platform boundary | json.lua gameplay có escape semantics riêng. Adapter JSON giới hạn 64 KiB, chỉ nhận object phẳng/string/boolean/number của schema; giữ UTF8/surrogate pair hợp lệ, kiểm tra field/version/hash/1–6 người trước commit. Không thay json.lua gốc. |
| Entity sleep kernel nhận quyết định từ engine world | SetCanSleep giữ cờ; IsAwake đọc state và trả false cho handle đã retire. Batch đổi state trước khi gọi callback Lua gốc, giữ notification ban đầu ngay cả khi entity tiếp tục thức. Thiếu callback báo lỗi trước khi đổi state. Chưa có WorldSim/interest policy sinh quyết định tự động. |
| Construction finalizer hiện chỉ có nhánh Transform chưa Network | Native Transform finalizer cấp history cho networked entity; AddNetwork vẫn báo chưa triển khai. Sleep permission của component khác phải được nối khi có implementation thật, không mặc định chấp nhận finalizer chưa biết. |
| Probe lifecycle chỉ trong cảnh diagnostic | Boot pack giữ nguyên toàn bộ mainfunctions.lua. Probe chạy byte nguyên bản của hai callback OnEntitySleep/OnEntityWake, cấp quyết định sleep/wake cụ thể rồi dọn entity. Không thực thi/bỏ qua các dependency của cả module để nhận là bootstrap game thành công. |

bootstrap.lua và diagnostic.lua chỉ dựng cảnh finiteuses để kiểm chứng nền engine.
prelude.lua là môi trường sạch cho tools/bootstrap-gap.mjs thử main.lua thật.
Cảnh kiểm chứng không thay thế bootstrap hoặc sinh world của game.

API ValidateLineNumber rỗng là hành vi retail được xác nhận bằng assembly,
không phải một chức năng bị bỏ qua để bootstrap đi tiếp. RNG, Unicode, sort ID,
entity removal và callback I/O có test dựa trên fixture native.

requireeventfile tái hiện đúng fallback native khi log Event data unavailable:
bảng không có keys, mỗi field là callable không trả giá trị. Có trace/assembly
cho nhánh này; chưa cung cấp gameplay server của Forge/Gorge. Các API khác chưa
triển khai không được dùng fallback này để che lỗi.

Inventory dataset và achievement/prefab registration chỉ giữ dữ liệu đã nạp.
ValidateWithSignature hash transcript rồi ghi signature như wrapper native;
không báo signatureVerified=true. LoadPrefabs có ANIM/DYNAMIC_ANIM headless,
ATLAS/DYNAMIC_ATLAS, FILE/SHADER/FONT và ownership; SHADER client chỉ commit sau
compile/link, ATLAS/IMAGE/FONT client chỉ commit sau upload KTEX lên backend WebGL2 đã cài.
format khác chưa có backend báo lỗi. SpawnPrefab, ownership tài khoản, award và
event audio vẫn báo chưa triển khai khi được gọi.

Font alias/fallback/advance đi qua implementation trong font_asset.cpp, không
bỏ qua LoadFonts của Lua. Registry và trạng thái shared font được đối chiếu
snapshot native; alias/fallback không giữ lease, unload dọn reference khi resource
hết owner. Chi tiết tại font-loading.md. Text layout và glyph drawing chưa có.

Component registry bắt đầu với ShadowManager headless có userdata riêng, gắn
GUID owner, trả wrapper mới khi Add lại và dọn state khi entity retire. Đã đối
chiếu C closure/vtable/owner native. Client renderer và GenerateStaticShadows
chưa có; chi tiết cùng ngoại lệ về factory sau retire tại components.md.

RoadManager có pending control points/wrap/UV và EnvelopeManager có registration
màu/vector đã đối chiếu bytes native. Geometry/quadtree của đường và sampler/VFX
chưa có; xem components.md và envelopes.md.

PostProcessor headless giữ uniforms/samplers dùng chung và chạy helper Lua gốc
đúng nhánh dedicated. Graph/shader/FBO client còn báo thiếu; xem postprocessor.md.

FontManager.RegisterFont dùng chung registry FONT với LoadFont nhưng không đổi
màu, không fetch hoặc acquire, và không xóa alias khi owner retire. Client và
hai shard đã kiểm tra; Text renderer chưa có, xem font-manager.md.

MapLayerManager headless có handle pool, UV/màu/style khớp native; PhysicsWaker
static radius giữ float32. Terrain/Map renderer và solver còn thiếu; xem map-layers.md.

SendHardwareStats dedicated là stub retail 0x1403dde80 (xor eax,eax; ret), trả
0 giá trị mà không đọc tham số. Master/Caves giữ đúng nhánh này; client vẫn báo
thiếu backend telemetry, không dùng stub dedicated cho client.

Prefab asset kinds theo hai bảng native đã khóa hash: so tên không phân biệt
hoa/thường, chỉ nhận 12 loại; tên khác như MINIMAP_IMAGE bị loại khi đăng ký và
được liệt kê trong WebPrefabs.IgnoredAssets. Đây là hành vi native, không phải
bỏ qua một backend chưa làm. Tham số native được ép float32 qua lua_tonumber,
kể cả numeric string; chuỗi dùng C-string boundary như native. AtlasContains
tra atlas đang nạp bằng StringID string/uint32, không tải asset mới.

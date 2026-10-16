# Native asset loading, build 756039

Decoder C++ ở engine/animation_asset.cpp đọc archive gốc sau khi Resources xác
minh hash pack/chunk/file. ZIP stored/deflate có CRC, giới hạn entries/kích thước
và canonical paths; BILD6 và ANIM4 kiểm tra count/offset/float/version. KTEX
được kiểm tra codec, kích thước và mip payload, giải mã RGBA trong engine/ktex.cpp
và upload từng mip qua engine/texture_asset.cpp → src/texture-programs.mjs.
WebAssets.Inspect luôn trả rendererReady=false ở giai đoạn này.

Tải qua EM_ASYNC_JS/Asyncify: evaluateAsync giữ frame Lua và C++ trong lúc chờ
fetchNativeResource. Cùng một instance chỉ có một evaluation; Worker queue
chặn input/tick/restore khác tới khi lệnh hiện tại kết thúc. Lời gọi đồng bộ
thiếu file trả ASYNC_RESOURCE_REQUIRED. Lỗi I/O không bị đổi thành load thành công.
Nguồn ZIP tải tạm xóa sau read; file caller chủ động materialize được giữ lại.

Pack cache có ngân sách 32 MiB. Bundle cache có ngân sách 192 MiB tính theo
capacity của vectors và ước lượng overhead, chưa phải giới hạn RSS/peak memory.
Bundle không có owner có thể bị LRU eviction; bundle đang được prefab giữ được
bảo vệ. LoadPrefabs preflight loại asset, acquire theo dependency graph, rollback
leases khi lỗi, chỉ commit refcount sau khi thành công. Unload lần cuối giải phóng
bundle và dependencies. Client LoadPrefabs ANIM còn báo thiếu resource upload;
decoder CPU có thể được kiểm tra riêng trên client.

Các nhánh không tải byte đã được đối chiếu native, không dùng để bỏ qua format
chưa hiểu:

| Asset | Dedicated headless | Client |
|---|---|---|
| PKGREF | Không mở package tại LoadPrefabs | Tương tự |
| SOUND | Không tải byte tại LoadPrefabs | Tương tự |
| SOUNDPACKAGE, ATLAS_BUILD | Dispatch trả thẳng | Cần backend, chưa hỗ trợ |
| FILE có substring `.fsb` | Dispatch trả thẳng | Tương tự |
| FILE khác | Giữ byte và terminator NUL | Tương tự |
| ANIM | Parse bundle và giữ lease | Chưa GPU upload |
| ATLAS | Parse XML, giữ StringID/UV và lease; null renderer không tải pixel | Decode KTEX, upload WebGL2, giữ texture lease tới release cuối |
| DYNAMIC_ATLAS | Parse XML và hoãn texture | Parse XML và hoãn texture; adapter BindTexture tải khi dùng |
| DYNAMIC_ANIM | Parse BILD/ANIM và hoãn texture | Chưa client animation resource/skin backend |
| IMAGE | Null renderer trả -1, không mở file | Decode KTEX và upload WebGL2 theo lease |
| SHADER | Đọc/kiểm tra KSH, giữ lease CPU | Compile/link program từ GLSL gốc trên WebGL2; lỗi rollback |
| FONT | Parse font.fnt/font.tex, giữ glyph/kerning/KTEX | Cùng metadata và upload texture WebGL2; chưa Text renderer |
| Loại còn lại | Báo UNIMPLEMENTED_NATIVE | Báo UNIMPLEMENTED_NATIVE |

Bằng chứng dispatch nằm trong executable build 756039 đã kiểm tra SHA256 bằng
tools/native_function.py: server table 0x1400fcbd0, nhánh trả 0x1400fca5d;
client table 0x140108c14, nhánh trả 0x140108aa4. FILE server kiểm tra substring
tại 0x1400fc880. Asset vẫn được lưu trong metadata để lookup khi sử dụng; PKGREF
không có nghĩa eager preload toàn bộ package.

tools/native_asset_trace.lua thực sự LoadPrefabs hai lần với hai archive Wilson
và đường dẫn cố ý không tồn tại cho các nhánh bỏ tải headless, dùng AnimState gốc
để đo năm clip, rồi unload hai lần. Snapshot có hash executable/scripts/oracle
và completion marker theo run ID. Test Node đối chiếu frame count/thời lượng
native và hash geometry từ decoder Python độc lập; test browser chạy C++ decoder
trong ba Worker trên Chrome/Edge/Firefox. Chưa nghiệm thu render hoặc playback
gameplay chỉ từ các bằng chứng này.

FILE dùng engine/file_asset.cpp. Native loader 0x14000f760 cấp source length + 1,
ghi zero ở cuối rồi memcpy nguyên dữ liệu. Manager 0x140389040 dùng StringID hash
và chỉ tăng refcount nếu key đã có; FILE cache web giữ cùng semantics với SDBM
ASCII case folding đã đối chiếu. Lần tải mới vẫn cần đường dẫn canonical trong
manifest. Refcount của WebFileAssets là số lease, không phải giá trị trường nội
bộ native (có bias riêng). File giữ dữ liệu tới lần release cuối; ngân sách
64 MiB tính capacity và ước lượng overhead. Load thất bại rollback cả FILE/ANIM.

tools/native_resource_memory.py đọc vtable của manager từ đúng native child,
kiểm tra vòng tham chiếu Sim/registry/prefab owner, và đọc buffer của FILE mẫu.
SHA256 của byte, NUL terminator và archive nguồn được ghi trong
output/native-reference/resource-managers.json. Không patch executable/bộ nhớ
hay sửa asset gốc. Native fixture cũng kiểm tra alias chữ hoa khi resource đã
được cache. Đây chưa chứng minh klump decoding, FILE cache cho mọi encoding/path
hoặc việc dựng entity/AnimState từ những tài nguyên này.

ATLAS ở engine/atlas_asset.cpp giữ tên texture và phần tử UV float32. Vtable
native load 0x1400391f0 gọi XML/texture loader 0x1400d8450; IMAGE dedicated
0x140385190 trả -1 ngay, nên headless không tải byte pixel. Resource manager
native vẫn giữ bảng UV và texture handle -1; không suy rộng nhánh này sang
client. Client LoadPrefabs ATLAS/IMAGE dùng decoder KTEX và backend WebGL2; khi
backend chưa cài, context bị mất hoặc upload thất bại thì không commit prefab.

RapidXML 1.13 giữ source/license nguyên bản, khóa hash archive/header. Handler
không dùng C++ exceptions; DOM/context nằm trên heap trước setjmp và cleanup
pool sau lỗi. Giới hạn XML 8 MiB, depth 32, pool cấp thêm 16 MiB, metadata cache
32 MiB; không nhận DTD/external entities hoặc texture path thoát namespace.
Các giới hạn này thuộc adapter web, không phải khẳng định native có cùng mức.

tools/atlas_catalog.py dùng ElementTree và phép lượng tử hóa float32 độc lập để
đối chiếu 1.412 XML / 11.775 phần tử từ nguồn đã kiểm tra hash. Năm atlas terrain
có ID trùng nhưng UV khác: std::sort của libc++ khác native. engine/atlas_order.hpp
khôi phục median/partition/insertion/heap sort tại native 0x1400d8300 và helpers;
snapshot bộ nhớ của cả năm atlas kiểm tra thứ tự thực. Catalog độc lập kiểm tra
multiset nội dung và canonical hash, không giả định Python stable sort là native.

Các XML terrain rời có filename chứa thư mục con, thậm chí lặp prefix data/.
Giữ phép ghép directory + filename giống native, không tự sửa reference. Chưa
nghiệm thu texture resolution/render của những path này. XML lỗi, thiếu UV,
NaN, quá sâu hoặc vượt DOM budget không commit cache/prefab và để VM dùng tiếp.

KSH và program shader WebGL2 được mô tả tại shader-loading.md, FONT tại font-loading.md. Bootstrap hiện
main.lua đã trả về; Start dừng ở Entity.AddTextWidget (scripts/widgets/text.lua:6). Uniform gameplay, native sampler state và
renderer client còn phải hoàn thiện trước khi nghiệm thu asset loading cả game.

Hai bảng asset-kind cố định tại server 0x1404c1fa0 và client 0x14052ca00 có cùng
12 loại. RegisterPrefab so tên không phân biệt hoa/thường, bỏ tên ngoài bảng
(MINIMAP_IMAGE, FILE có dấu cách cuối, tên không biết), và chuẩn hóa C-string.
Không biến tên viết thường như anim/font thành unknown. Tham số được ép float32
bằng lua_tonumber; nil/bool/table/non-numeric string thành 0, numeric string được
đọc số. Snapshot vector asset native kiểm tra cả các trường hợp này và NUL.
WebPrefabs.NativeAssets hiển thị record đã chuẩn hóa; IgnoredAssets lưu lý do
loại metadata. Các loại được nhận vẫn phải có loader/backend hoạt động.

AtlasContains tại 0x14011d7a0/0x140039350 chỉ tìm cache atlas và StringID element.
Không mở file, không kích hoạt dynamic texture. String được hash; giá trị số
chuyển qua int64 rồi lấy uint32 như native, bao gồm số âm/phân số/out-of-range.
Nil/bool/table không trở thành tên rỗng mà báo lỗi tham số. 16 trường hợp trace
được chạy lại trong cả ba vai trò WASM; query không fetch hoặc tăng lease.

DYNAMIC_ATLAS đi qua cùng resource manager như ATLAS với cờ skip-texture:
server 0x1400fc9fe, client 0x140108a45, parser 0x1400d8450. Cache hit native chỉ
tăng lease, không áp lại cờ. Fixture nạp fepanels theo thứ tự dynamic → regular
vẫn giữ textureLoaded=false; tám bảng UV được đọc trực tiếp từ native child.
WebAtlases.Decode chỉ parse metadata; lần acquire đầu mới chọn chế độ load.

DYNAMIC_ANIM truyền cờ deferred vào 0x14013b660. Nhánh 0x14013c6f5 đọc BILD/ANIM
nhưng dùng null texture handle thay vì lấy KTEX trong ZIP. Bundle box_shared_spiral
chỉ có build.bin/anim.bin; native giữ ba clip, 132 frame, 450 element, một atlas
và textureLoaded=false. Snapshot bộ nhớ và GetCurrentAnimationLength/NumFrames
đối chiếu nhánh này; ba bundle so geometry bằng tools/animation_catalog.py độc lập.
Cache ANIM dùng StringID giống generic native manager; các alias đã cache không
mở lại file hoặc đổi chế độ. Không dùng placeholder này để nghiệm thu renderer;
chưa đọc .dyn, giải mã skin động hoặc nối ownership tài khoản.

KTEX: codec 0/1/2 là DXT1/3/5; 4/5 là RGBA/RGB. Decoder giữ row order và alpha,
không tự flip, premultiply hoặc chuyển gamma. tools/texture_catalog.py dùng
decoder Python độc lập cho đủ 34 mip của Wilson/global/hud. Node kiểm tra RGBA
SHA256; Chrome/Edge/Firefox đọc lại mip GPU bằng framebuffer và có cùng hash.
Test riêng bao phủ nhánh DXT1 trong suốt, DXT3 explicit alpha, hai bảng alpha
DXT5, block bị cắt, RGB/RGBA và rollback upload lỗi. Đây chưa là native GPU SSIM.
Tham khảo thuật toán S3TC tại [đặc tả Khronos](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_compression_s3tc.txt).

Encoded texture cache có ngân sách 128 MiB, buffer decode tối đa 64 MiB/mip;
WebGL registry có ngân sách 256 MiB theo tổng RGBA8 các mip. CPU chỉ giữ encoded
bytes sau upload; buffer mip tạm được giải phóng. Đây là accounting theo dữ liệu,
không phải phép đo RSS hoặc tổng VRAM. Upload giữ binding/active unit và pixel
unpack state của caller, kể cả PBO/row stride/skip. IMAGE và ATLAS chia sẻ lease;
release cuối xóa CPU/GPU. Chưa eviction texture đang rảnh hoặc phục hồi toàn bộ
renderer khi context loss; giới hạn hiện trả lỗi thay vì tăng bộ nhớ vô hạn.

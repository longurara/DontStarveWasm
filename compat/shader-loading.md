# Shader resources, build 756039

engine/shader_asset.cpp đọc KSH đã kiểm tra hash từ resource packs. Container
quan sát được gồm tên shader, bảng uniform (name, alias, kind, array count,
default values), hai cặp filename/source GLSL và hai vector uniform indices.
68 file hiện dùng kind 0/2/3/4/20/43 (float/vec2/vec3/vec4/mat4/sampler2D).
Kind/format khác báo lỗi; không đoán thành shader rỗng. tools/shader_catalog.py
đọc độc lập từ archive gốc, ghi hash nguồn và fixture từng file để đối chiếu.

Nguồn GLSL chứa một NUL cuối. Cache giữ nguyên source, hash KSH bao gồm toàn bộ
byte. WebShaders.Inspect chỉ bỏ terminator khỏi field source và trả sourceBytes,
terminated riêng: json.lua gốc không escape NUL và dst_result là C-string.
Không sửa encoder gameplay để xuất dữ liệu chẩn đoán này.

Giới hạn adapter: KSH 8 MiB, mỗi stage source 2 MiB, 4.096 uniform/binding/array,
cache CPU 16 MiB theo dữ liệu giữ lại ước lượng. Count, defaults, finite floats,
terminator, binding indices và trailing bytes được kiểm tra trước commit.
LoadPrefabs giữ lease theo dependency; lỗi compile/acquire rollback các resource
đã lấy, unload cuối giải phóng cả cache CPU và program GPU.

Native dedicated manager tại 0x14038b5a0 tạo object shader và đưa vào render queue.
Constructor 0x14038dc40 giữ byte KSH; Load 0x14038e940 mới đọc uniform/source/maps.
Null renderer chưa drain bước này trong fixture: tên/bảng uniform còn trống,
byte gốc vẫn được giữ. tools/native_resource_memory.py chỉ đọc raw pointer khi
object còn deferred, xác minh length/hash của ba shader và không đọc vùng đã free.
Web eager validation là khác biệt adapter; không coi deferred object là bằng chứng
native đã compile GPU hoặc khẳng định native từ chối input lỗi đúng cùng thời điểm.

src/shader-programs.mjs nối backend WebGL2 vào module WASM. GLSL gốc được đổi
spelling attribute/varying, texture2D, gl_FragColor sang GLSL ES 3.00; cả hai stage
dùng highp để giữ tính toán float32 desktop và precision giữa varyings. Các macro
của từng shader (SKINNED, BLOOM, HOLO...) vẫn lấy từ source gốc. Quy tắc GLSL/WebGL2
được đối chiếu với [đặc tả Khronos](https://registry.khronos.org/webgl/specs/latest/2.0/).
Không thay thuật toán màu/ánh sáng bằng source viết lại. Uniform/attribute được
reflect từ program thật; sampler units được khởi tạo, program/lease được thu hồi.

AssetPreview cài backend lên context client và lấy ui.ksh qua LoadPrefabs. Matrix
ortho và attributes POSITION/TEXCOORD0/DIFFUSE thay giao diện shader viết tay cũ.
Viewer vẫn là cảnh mesh độc lập, chưa nối native AnimState, lighting, world camera,
symbol overrides hoặc renderer gameplay. programReady phản ánh program resource;
rendererReady vẫn false.

Chrome/Edge/Firefox đã compile/link đủ 68 file, so type/count uniform với KSH,
và vẽ shader UI vào FBO 2×2 rồi readPixels. Với texture [128,64,192,128] và DIFFUSE
[.5,.75,.25,.5], vertex premultiplies RGB theo alpha; fragment nhân texture,
cho [32,24,24,64] (dung sai một byte). Probe trả lại GL state, redraw viewer,
không tăng tick và không để lại lease/program ngoài shader UI của viewer.

Chưa thực hiện native fallback selection khi shader có param=1 mà primary compile
lỗi; trường hợp đó trả lỗi rõ ràng. Các thiết bị thử hiện compile được primary.
Chưa nghiệm thu context-loss recovery cả renderer, cập nhật global/gameplay uniform,
mọi framebuffer/post-processing path, SSIM native scene hoặc FPS của full game.

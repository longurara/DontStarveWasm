# MapLayerManager CPU data, build 756039

`engine/map_layers.cpp` implements dedicated layer ownership, all seven Lua
methods, UV variants and colour data. It does not implement Map geometry,
terrain rasterization or client rendering. Client factory calls explicitly fail;
rendererReady remains false. Map:AddRenderLayer and its extra reference ownership
still need implementation; current handles belong to their creating manager.

Factory 0x140054720 finds type 0xfe8cd8b8 (type function 0x1400545d0).
Repeated Add returns distinct Lua wrappers over one component, attaching the
newest wrapper. Each component owns a separate 64-byte-slot resource pool at
component+0x20; its layer handles start at zero and released slots are reused
in LIFO order. Construction finalizer is base 0x14003d000, destructor 0x140054870.
Live memory confirms resource managers are bound immediately on attachment,
even for a new component outside the original global world entity.

CreateRenderLayer converts tile ID through Lua integer/int64 and keeps uint16.
Atlas/image/noise arguments accept strings or numeric string conversion and
use C-string boundaries. The constructor copies the current int32 sample style;
SetSampleStyle affects future layers without changing existing ones. Dedicated
image/noise bindings only look up the cache; both handles stay -1 without a
resource fetch or acquire. The atlas must already be owned by its resource cache.

Native 0x1400caa60 copies UV variants from the original atlas XML using
0x1400c76a0. Element names are read with atoi. Name 17 is reserved and skipped;
names above 16 shift down one before converting to a zero-based group index.
There are 48 groups. Variants append in XML source order, not the atlas's sorted
StringID order, and the variant attribute is not used for that ordering.
shapeCount is min(number of Element nodes, 48), including skipped/duplicate names.
Each UV is four float32 values u1/v1/u2/v2. Layer UVs survive atlas unload, without
keeping an extra atlas lease.

The ATLAS decoder now retains a small source-order permutation alongside its
native-sorted elements. This keeps existing lookup/sort behavior intact and
allows MapLayerManager to reconstruct the XML sequence without fetching or
retaining the entire source XML. Added vector/index storage is included in the
ATLAS retained-data budget. No alternative atlas sort is substituted.

SetPrimaryColor/SetSecondaryColor/SetSecondaryColorDusk/SetMinimapColor validate
all four numeric arguments, convert to float32 and store them without clamping.
All four exposed colours default to (1,1,1,1). ReleaseRenderLayer frees its
unshared handle and copies no resources; -1 is the native no-op sentinel.
Entity retirement destroys that owner's layers and free list.

The native oracle checks distinct wrappers, private handles, sample-style
integer conversions, low uint16 tile IDs, four colours, duplicate atlases,
release/reuse and invalid parameter types. Read-only memory capture verifies
owner/type/finalizer/destructor, slot arrays, texture handles, sample style,
colour bytes and all 48 UV vector transcripts. It also records original world
layers as reference data. The independent Python XML parser in atlas_catalog.py
computes forest/grass groups before canonical sorting and checks their hashes
against those native memory records before exporting the browser oracle.

Node/WASM replays the exact Lua oracle on Master/Caves and compares its entire
resulting layer data, not just call success. Chrome/Edge/Firefox run two probe
passes on all three Workers, using original ATLAS packs over the resource
adapter. Both authoritative roles match native UV bytes; the client rejects
creation. Atlas unload, layer cleanup, scene/tick, entity counts and radius
settings return to the pre-probe state. No texture fetch is introduced.

Adapter bounds: 50,000 managers; 8,192 allocated slots per manager; 65,536 total
slots per instance, including freed slots; 32 MiB retained layer-data estimate.
Slot/free-list metadata is separately bounded by the aggregate slot limit.
Missing/unowned atlases, invalid numeric names outside 1..49 and invalid/released
handles produce controlled errors before committing changes. Native can index
invalid slots or UV groups directly; unsafe cases are not replayed. These web
guards do not change the checked valid-data behavior.

PhysicsWaker.SetMaxPhysicsRadius is also implemented in physics_waker.cpp.
Native static registration is at 0x140598f08, wrapper 0x140051890; underlying
0x1400b99a0 stores the float32 value at image RVA 0x5f2d68. It validates one
number (numeric strings accepted), ignores extras and returns zero values.
Native trace and live memory verify the final float bits; every WASM role and
browser Worker checks conversion. WebPhysicsWaker reports simulationReady=false:
the Bullet solver, waker component and spatial wake/island computation are
still absent. The accessor is available for their later integration.

Original main.lua passes these registrations and returns. The native Start
callback stops at Entity.AddTextWidget in widgets/text.lua:6. This does not
prove world startup or gameplay.

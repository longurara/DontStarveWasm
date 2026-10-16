# Native component factories, build 756039

Factories such as Entity.AddShadowManager are generated from native component
registrations. Their full Add-prefixed names do not appear in the PE string
table, so the static method inventory does not identify their implementations.
The oracle retains live Lua C closures, reads their C function pointers and
upvalues, and verifies the targets against the hash-checked native image.
Snapshot provenance is in output/native-reference/entity-flags.json.

Ten discovered factories currently include Transform, ShadowManager, RoadManager,
EnvelopeManager, PostProcessor, FontManager, MapLayerManager, AnimState,
SoundEmitter and MiniMap. Discovery is not an implementation claim for all ten.
Method closures also expose the native registration descriptor through a light
userdata upvalue; component and method dispatch are separate native layers.

`engine/components.cpp` starts a registry keyed by owner GUID, with entity type
validation and lifetime supplied by the engine. The implemented headless
ShadowManager behavior follows:

- Factory 0x14006bfa0 finds/creates one component per entity through 0x14006b9d0.
  Each call allocates a distinct Lua wrapper; == and rawequal are false between
  wrappers, while both target the same component. The entity's ShadowManager
  field receives the newest wrapper.
- Type function 0x140083810 returns 0x4a610c8d. Its construction finalizer is
  the base no-op 0x14003d000; componentsAllowSleep remains true. The wrapper
  itself does not own or retire its entity/component when Lua collects it.
- SetTexture validates a string (including Lua numeric conversion), then uses
  0x140084120 → 0x140083e70 to look up the existing image cache. Dedicated IMAGE
  loading has no pixel cache, leaving handle -1. No image is fetched or acquired.
- Entity retirement removes the component registry entry. Access through a stale
  wrapper reports a Lua error, and cannot mutate a different entity.

Native captures check two wrappers' shared component pointer, owner GUID,
texture/static handles and sleep flags. Calls exercise existing/missing images,
numeric strings, invalid types, NUL boundary and construction completion. The
web-only requestedTexture field is diagnostic history, not a native saved field.
The registry's adapter limit is 50,000 ShadowManagers per instance.

One deliberate web safety difference is documented: calling AddShadowManager
after EntityScript.Remove terminated the isolated native child with exit code
0xc0000409. The failing source, log and hashes are archived as
output/native-reference/retired-shadow-factory-crash.* and are not replayed in
normal capture. WASM rejects that call before mutation with a Lua error. Native
stale-wrapper method behavior is not certified; WASM likewise rejects stale owners.

Chrome/Edge/Firefox exercise creation, distinct wrappers, shared state, removal
and guarded stale access twice in both shard Workers. They confirm zero resource
fetches and no change to the diagnostic scene/tick. Client creation continues
to report an unimplemented renderer instead of adopting the dedicated branch.

RoadManager's partial dedicated backend is in `engine/road_manager.cpp`:

- Factory 0x140058260 and lookup 0x140057480 create/find one component per owner,
  with distinct wrappers attached to the entity, as above. Native type function
  0x140056c20 returns 0xdf2fd08d; its finalizer is also 0x14003d000.
- BeginRoad increments the road index from -1 and appends four independent
  strip configurations. Defaults have zero wrap and UV animation steps.
  Contrary to a typical builder reset, it retains pending control points,
  including points added before the first BeginRoad. GenerateVB consumes the
  points later; that backend is still missing and reports an error.
- AddControlPoint validates z then x and retains their float32 values.
  SetStripWrapMode truncates numeric arguments toward zero, including numeric
  strings. SetStripUVAnimStep keeps two float32 values per strip. BeginRoad
  does not copy the preceding road's settings. The native animated UV offset
  next to these fields changes on simulation ticks; it is neither a step nor
  currently implemented by the web backend.
- IsOnRoad validates all three numeric coordinates and returns false while
  the native quadtree pointer is null. It does not infer roads from the pending
  points. No populated quadtree is supported yet: GenerateVB/GenerateQuadTree
  explicitly fail rather than falsely accepting an unqueryable road.
- Entity removal frees pending points and strip settings and rejects stale
  wrappers. Client creation reports the missing renderer before mutation.

Three live native entities verify wrapper identity, owner, type/finalizer,
construction sleep flags, initial/unbuilt query results, exact float32 point
bytes and wrap/UV step bytes across two roads. Native strip records are 44 bytes;
wrap starts at +16 and UV step at +28. Snapshot extraction excludes animated
offsets at +36 and uninitialized padding. Fixture/source hashes are retained.
Tests replay the same oracle calls on both authoritative roles and compare
the resulting state against native memory, not a second implementation.

Adapter limits are 50,000 managers, 4,096 roads and 1,048,576 pending points per
manager, plus aggregate limits of 65,536 roads and 2,097,152 points per instance.
Invalid strip indices, strip setters before BeginRoad and integer conversions
outside int32 are controlled errors before mutation. Native directly indexes
the array and converts through int64; these unsafe/out-of-supported-range calls
are explicit web differences and are not run in normal native fixtures.

Chrome/Edge/Firefox also check pending points across BeginRoad, independent
strip state, guarded removal and complete cleanup twice on all three Workers.
No asset fetch, diagnostic scene mutation or simulation tick is required.

Not implemented: ShadowManager.GenerateStaticShadows, shadow geometry/GPU
rendering; RoadManager smoothing, cached effect/texture bindings, geometry,
UV animation updates, quadtree and client rendering; the remaining managers.
EnvelopeManager registration is implemented separately; see [envelopes.md](envelopes.md)
for exact native keyframe bytes, duplicate registrations and the retail float
wrapper behavior. Sampling/VFX consumers are not implemented.

PostProcessor shared uniforms/sampler settings and native dedicated Lua helpers
are implemented; see [postprocessor.md](postprocessor.md). Graph rendering is
still unavailable.

FontManager is available in all three roles and forwards RegisterFont into the
shared FONT alias registry without recolouring or loading resources; see
[font-manager.md](font-manager.md). Text layout/drawing is still missing.

MapLayerManager has dedicated UV/colour/handle data and all seven Lua methods;
the radius setter is verified separately. See [map-layers.md](map-layers.md).
Map integration, client terrain rendering and physics wake computation remain.

UITransform now has its own typed userdata and CPU layout, hierarchy, anchor,
scale-mode and scissor data in every role. See [ui-transform.md](ui-transform.md)
for native evidence, viewport mapping and the remaining render/inverse/bounds
paths. It does not reuse the world Transform userdata.

These missing paths keep explicit errors. Original main.lua returns; the next
native callback Start stops at Entity.AddTextWidget in widgets/text.lua:6.
This component registry does not prove a world simulation or playable renderer.

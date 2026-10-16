# UITransform CPU layout

UITransform is a distinct component in all three roles, not an alias for the
world Transform. Its fifteen Lua methods now operate on real float32 layout
data. This is not a UI renderer: Image/Text/AnimState drawing, renderable bounds,
inverse matrices for hit testing and full frontend dispatch are still missing.
The diagnostic rendererReady and inverseVerified flags remain false.

## Native evidence

The dynamic Entity.AddUITransform factory is 0x14007e720. Its owner lookup is
0x14007e530; the type ID is 0xd74dae38 from 0x14008a240. Repeated Add calls return
different typed wrappers for the same component, attach the latest wrapper to
Ents[GUID].UITransform, and do not attach a world Transform. The finalizer is
the base 0x14003d000 and leaves componentsAllowSleep unchanged. The destructor
is 0x14008b760. Removed wrappers return zero Lua values before checking setter
arguments; AddUITransform on a retired entity returns nil.

Wrappers at 0x14007df70–0x14007e522 call the CPU layout update at 0x14008a610.
It stores anchors at +0x68/+0x6c, scale mode at +0x70, local/world position at
+0x74/+0x80, scale at +0x8c, angle at +0x98 and facing at +0x9c. Local/world
forward matrices are at +0xa0/+0x120. MaxPropUpscale is at +0x1a0; two optional
signed-short scissor rectangles are at +0x1a8/+0x1b0, suppression at +0x1b8.

The isolated native oracle verifies hierarchy, basis vectors, float32 values,
numeric strings, rotations and callback shapes. Read-only capture validates
owner GUID and shared component identity, then reads final matrices, rectangles,
flags and defaults. The initial anchors are 3/3, mode 0, scale 1/1/1, facing 8
and maximum proportional upscale 3. Evidence and source hashes are recorded in
output/native-reference/attempt.json; the UI memory section is in entity-flags.
Static disassembly is in output/ui-transform-{methods,core,layout,more}.txt.

## Transform and anchor behavior

UI rotation is clockwise in the XY plane. Native builds T * S * R in that
order, using float32 intermediate operations. Angle normalization uses the
same native remainder convention as world Transform, including +180 degrees.
Its matrix constructor converts the stored angle back through degrees before
calling float sine/cosine; using the stored radians directly loses that rounding.

With both anchors set to 3 and a scale mode outside 1–4, a child inherits its
parent's matrix. Setting either anchor to 0/1/2 makes layout independent of the
parent. Root GetWorldPosition, and an independent child's GetWorldPosition,
return the local position even though their render matrix includes viewport
anchor offsets. This distinction is verified by native child/basis probes.

Anchor values use signed int32 truncation and accept only 0–3; other values
leave the anchor unchanged. Scale mode stores the signed int32 value even if
it is outside the four automatic modes. SetFacing instead uses CVTTSD2SI int64
followed by the low 32 bits; the native wrapping fixture caught this difference.
All vector arguments are checked before mutation, numeric strings are accepted,
and extra arguments are ignored.

Mode 2 uses the smaller of width/1280 and height/720, capped by MaxPropUpscale
when at least one. Modes 3/4 store independent horizontal/vertical factors and
z=1; the web desktop adapter has no console safe-area margins. Changing back to
mode 0 does not restore the previous scale. Mode 1 presently follows native's
empty-render-bounds branch and uses unit scale: no render-bounds component has
been implemented yet. Actual Image/Text/AnimState bounds must be connected
before that branch can handle rendered content; those factories still fail
explicitly instead of silently supplying empty geometry.

The host passes canvas pixel dimensions through dst_ui_viewport. TheSim's
GetScreenSize returns this viewport. Dedicated native reports 0×0, matching
the initial headless Workers. The browser client uses its 800×600 preview canvas;
the dimension check accepts integer 0–32768 values and refuses changes while
Lua is suspended for resource I/O. A malformed viewport does not commit state.

## Scissor and lifetime

SetScissor truncates four values to int32, then retains signed low 16 bits.
Native transforms the two rectangle corners, truncates the first corner and
the resulting width/height, then stores signed-short output. It does not take
the enclosing axis-aligned bounds of all four rotated corners.

ClearScissor latches suppression recursively. It retains allocated rectangles;
SetScissor does not clear the suppression latch. This unusual behavior is
visible in native memory and is preserved. Forwarding effective scissor pointers
to renderables is still part of the missing renderer; CPU rectangles alone do
not prove pixel clipping.

The web map owns at most 16,384 UI components. Removing an owner releases its
component; old wrappers safely return no values. Parent graphs are guarded
against cycles, removed ancestors and more than 512 levels. A world Transform
and UITransform on the same owner currently fail explicitly in either Add order;
their native coexistence/active-interface behavior still needs implementation.
Unparented ordinary ancestors use identity matrices, like the native interface
lookup. A stale parent hierarchy raises an error rather than guessing a pose;
full native detach/retirement behavior still needs broader fixtures.

## Verification and remaining work

Tests replay all oracle calls and compare native final forward-matrix bytes,
scissor data, type, defaults and lifetime in client/Master/Caves. Public float
positions match within 0.0001 units. A separate test creates parent/child Widget
objects through unchanged gameplay Lua and their original uianim component.
Its teardown removes native owners directly because Widget:Kill also requires
the frontend, which cannot finish constructing yet.

Chrome/Edge/Firefox run two UI probes in every Worker: the original native pose,
viewport anchor math, proportional scaling, scissor data and stale wrappers all
pass; scene/tick/component counts return to baseline. The 32 MiB Worker heaps
in this small probe are not a benchmark of a real world or complete UI.

main.lua still returns. Start now stops at widgets/text.lua:6,
Entity.AddTextWidget. No world exists and fullBootstrapPassed remains false.

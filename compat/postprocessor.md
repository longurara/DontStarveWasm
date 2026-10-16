# PostProcessor shared state, build 756039

`engine/postprocessor.cpp` implements the dedicated component, enabled flag,
uniform storage and texture-sampler settings. It does not execute a shader/FBO
graph. Client creation and the unimplemented graph APIs report errors;
WebComponents.PostProcessor always reports rendererReady=false.

Factory 0x1400631d0 uses component lookup 0x140062fe0. Type function 0x1400a46c0
returns 0xf1424772. Construction finalization is base 0x14003d000. Add again
returns a distinct Lua wrapper over the same native component and attaches the
latest wrapper to EntityScript.PostProcessor. Other owners have different
components but share the renderer-owned backend at context+0xe0 → +0x40.
The backend constructor 0x14001f640 initializes its enabled flag to true.

Implemented calls:

- SetPostProcessingEnabled requires a Lua boolean and updates the shared flag.
- AddUniformVariable converts a string/numeric name to StringID, truncates the
  numeric dimension and registers 1..4 float32 values initialized to zero. Its
  return value is the unsigned StringID, not an ordinal. Registering a name or
  case-folded collision again replaces the resource and resets its values,
  including when the dimension changes. Numeric names use string conversion;
  NUL ends the C-string name. No resource fetch or shader binding is implied.
- SetUniformVariable converts its numeric/StringID argument through signed
  int64 and keeps the low uint32 bits. Native CVTTSD2SI's non-finite/out-of-range
  result has low word zero. Unknown IDs return without inspecting value args.
  For existing IDs, numeric values and numeric strings update the corresponding
  float32 slot; nil, booleans, nonnumeric strings and tables leave that slot
  unchanged. Values omitted at the end also retain their previous state.
- AddTextureSampler creates a new ordinal for each call, even for the same
  filename. Native 0x1400a4a10 performs cached IMAGE lookup, not an acquire/load.
  Dedicated IMAGE resource loading omits the pixel cache; all captured handles
  are -1. SetTextureSampler performs the same cached lookup after validating
  ID and path, without fetching bytes or creating a lease.
- SetTextureSamplerState and SetTextureSamplerFilter store wrap and
  min/mag/mipmap filter values. IDs convert through int64; mode values convert
  directly through int32. Non-finite/out-of-range modes therefore become
  INT32_MIN, rather than taking the low word of int64. Unknown IDs are ignored
  only after all parameters pass validation. Defaults are wrap=4, min=4,
  mag=4, mip=3. No WebGL sampler application is claimed by these CPU records.

Native vtable uniform classes have time-independent current values at +12,
then a previous/render buffer of the same length. Captures retain both; tests
compare current bytes. Frame-boundary copying and uploading those values to
GPU are not implemented yet. The sampler record keeps current/previous texture
handles at +16/+20 and wrap/min/mag/mip at +24/+28/+32/+36.

Native component destructor 0x1400a49b0 forwards to global Clear 0x14001c860.
Removing any PostProcessor owner clears shared uniforms and sampler records,
even while another owner survives; the adapter follows that lifetime and resets
sampler numbering. Wrapper garbage collection does not retire an entity.
Stale owner calls are rejected before mutation. The enabled flag is preserved
by resource clearing; a newly initialized engine resets it to true.

The unchanged original postprocesseffects.lua installs its dedicated Lua helper
methods on this metatable, including its no-op visual setters and true-returning
IsBloomEnabled/IsDistortionEnabled. Those are original gameplay role branches,
not engine replacements for client rendering. Tests load this original module
and replay the same calls captured from native.

The native oracle keeps two owners and three wrappers, tests cross-owner
updates, dimensions 1..4, float32 conversion, partial/omitted/invalid values,
StringID replacement/case/numeric/NUL names, strict booleans, sampler defaults,
duplicate paths, fractional/missing IDs and the distinct int32 mode conversion.
Read-only memory capture verifies component/owner/vtables and the shared
backend, then walks the actual uniform/sampler hash tables and checks map sizes.
Executable/source/trace hashes link all evidence. No executable or DLL is used
by the WASM runtime.

Adapter bounds: 50,000 owners; 8,192 uniform records; 8,192 samplers per instance.
The retail uniform-dimension switch leaves a pointer uninitialized outside
1..4, and its value setter has no dimension bound. The adapter rejects unsafe
dimensions and numeric value arguments beyond the declared dimensions before
mutation, and limits a setter to 128 value arguments. These explicit web safety
differences are not exercised on the native reference process. Replacements
also release old storage instead of reproducing native allocation leaks.

Chrome/Edge/Firefox run the component probe twice on all three Workers. Both
authoritative roles match native uniform bytes and sampler defaults/conversions;
client creation fails before state allocation. The probe restores the shared
enabled flag, clears all records, and checks its complete pre/post state, scene,
entity count, resource fetch count and simulation tick.

Remaining APIs: AddSamplerEffect, sampler-effect state/filter, AddPostProcessEffect,
effect uniform/sampler binding, enable/base/before/after graph ordering,
colour-cube sampler and bloom parameters. Shader graph execution, interpolation,
offscreen targets, uniform upload and context recovery still need implementation
and native image comparisons. Original main.lua returns; Start stops at
Entity.AddTextWidget in widgets/text.lua:6. This is not a playable world
or full-bootstrap gate.

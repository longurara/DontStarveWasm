# FontManager registration, build 756039

`engine/font_manager.cpp` implements FontManager ownership and RegisterFont in
client, Master and Caves. It forwards into the existing FONT alias registry;
it does not implement Text layout/drawing. rendererReady remains false.

Native factory 0x14005ebe0 finds/creates type 0xc0ce008f (type function
0x1400a4b70). Each Add returns a distinct wrapper over the same component and
attaches the newest wrapper to EntityScript.FontManager. Other entities have
different components but share the Sim FONT resource manager. Construction
finalizer is base 0x14003d000; destructor 0x1400a4c20 only retires the component
and does not clear aliases or release font resources.

RegisterFont(path, alias) validates two strings, including numeric conversion,
ignores additional arguments, and forwards to the same native alias lookup
0x140041df0 used by LoadFont. Lookup returns the first registered mapping,
including unresolved entries, and checks only the already loaded FONT cache.
No fetch, decode, acquire or colour-state mutation occurs. Names fold ASCII
case through StringID and stop at NUL. Explicit UnloadFont/final resource release
keeps its existing alias and lease semantics; component retirement has no effect
on the shared alias map.

The client wrapper 0x140067e80 → 0x1400ae340 → 0x140047b00 has the same CPU alias
behavior in the hash-verified client image (Sim FONT manager offset +0x910,
versus server +0x918). Client support is checked against this disassembly and
WASM browser behavior; a live native client graphics capture is not claimed.
Static evidence is retained in output/font-manager-disassembly.txt.

The native oracle is inside the existing FONT binding oracle so the full alias
map and colour-state comparison still replays every mutation before checking
native memory. It exercises two owners/three wrappers, cross-owner mappings,
LoadFont/RegisterFont interaction, colour preservation, sticky misses, duplicate
case, numeric/NUL names, invalid types, ignored extra arguments and an alias
registered by a retired entity. Read-only capture verifies owner GUIDs, shared
manager pointer, type/finalizer/destructor and sleep flags. Source, executable,
trace and memory snapshots have capture hashes.

Node/WASM replays that source on both authoritative roles with actual FONT
resources, checks retained aliases/colour/leases against native, and verifies
all roles share the 8,192-alias budget with LoadFont. Owner limit is 50,000 per
instance. Invalid or removed owners are controlled Lua errors rather than an
unsafe native proxy dereference; stale native calls are not replayed.

Chrome/Edge/Firefox exercise the factory in all three Workers, then check
RegisterFont on client textures decoded/uploaded from original font archives.
Registration preserves disabled colour and lease counts; retirement preserves
the mapping; explicit resource release prunes it. Original RGBA readback and
registry/cache/GPU cleanup checks still pass, with no extra resource fetches or
scene/tick/entity-count changes.

This is the component/alias interface, not the missing Text/TextWidget
renderer. Font layout, glyph batches, text materials and complete GPU recovery
still need implementation and native visual comparison. Original main.lua
returns; Start stops at Entity.AddTextWidget in widgets/text.lua:6.

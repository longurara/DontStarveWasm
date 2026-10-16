# FONT resources, build 756039

`engine/font_asset.cpp` reads the original ZIP after pack/chunk/file integrity
checks. The observed 24 fonts contain `font.fnt` XML and `font.tex` KTEX.
Native `0x140041a40` calls `0x1400dc670`; that loader uses these fixed names,
not the page's original PNG filename. Licenses inside source ZIPs stay intact.

The BMFont fields describe the line baseline, glyph rectangles, advance and
kerning. See the [original BMFont format documentation](https://www.angelcode.com/products/bmfont/doc/file_format.html).
The web loader additionally follows the behavior observed in this exact build:

- Native lineHeight/base are uint16; scaleW/scaleH/outline and seven glyph
  metrics are float32. Channel masks stay separate from colour data.
- Font material mode is packed ? (outline > 0 ? 3 : 2) : (redChnl == 2 ? 1 : 0),
  from `0x1400dcde0`. This records the native mode; text drawing is not implemented.
- Glyphs are keyed by uint32 ID; a later duplicate overwrites the earlier entry.
- At `0x1400dd19b`, native sign-extends the low byte of both kerning codepoints
  before inserting a pair sorted by unsigned first/second. Later collisions
  overwrite earlier amounts. Do not replace this behavior with Unicode-wide
  kerning while claiming parity with 756039. Native Bellefair retains 2,681 pairs
  from 2,883 XML rows; full packed fallback retains 1,122 from 1,137.

The independent ElementTree reader `tools/font_catalog.py` checks all 24 packs
and 94,886 glyphs. Its provenance includes archive, generator and pixel-decoder
hashes. `tools/native_resource_memory.py` reads three native FONT objects via
the validated Sim/registry/font-manager path, normalizing only uninitialized
struct padding. Full glyph and kerning transcript hashes match the WASM decoder.
This includes the 44,201-glyph packed fallback font, not just Latin samples.

`LoadPrefabs` acquires FONT metadata on each role. Client also acquires a KTEX
texture keyed by archive path + `#font.tex`; it must finish all mip uploads
before prefab ownership commits. Shared prefab leases keep one font and one
texture resource; final release frees both. A diagnostic CPU decode does not
claim a GPU texture or renderer. Public C++ `get()` exposes the parsed glyphs
for the future native Text implementation.

ZIP and XML parsing share the bounded readers used by animation/atlas loading.
XML is limited to 8 MiB, depth 32 and a 64 MiB DOM pool for fonts. FONT retained
data has a 128 MiB budget, including estimated map overhead and encoded KTEX.
Client texture cache retains its own encoded copy and accounts it separately;
these budgets are not a measurement of total browser memory. All original fonts
have one texture page. Unsupported pages, invalid dimensions, truncated XML,
invalid counts or upload failures report errors and cannot commit a prefab.

Chrome, Edge and Firefox upload three original font textures and read back exact
RGBA hashes, preserving packed channels. They check metadata, return CPU/GPU
caches to baseline, and leave diagnostic scene/tick unchanged. The client heap
in this probe is 83,689,472 bytes; this is not a full-world benchmark.

Sim.LoadFont/UnloadFont, SetupFontFallbacks and AdjustFontAdvance now follow the
native registry at `0x140041df0`, `0x140041b40`, `0x140042700` and `0x140041d60`:

- LoadFont looks up a resource already loaded by its prefab. It does not fetch
  a file or acquire a lease. An existing alias keeps its original mapping;
  even an unresolved alias stays unresolved until explicitly unloaded.
- Alias StringIDs fold ASCII case. Numeric aliases use Lua string conversion.
  The optional disable-colour flag accepts boolean/nil, and changes the shared
  font object, not an alias-local copy. Advance is likewise shared float32.
- SetupFontFallbacks ignores a non-table second argument before checking the
  first. It iterates table values, accepts strings/numbers, appends valid resource
  references, and deduplicates by resource identity. An empty table does not
  reset the existing list. Invalid source/target aliases add nothing.
- UnloadFont removes its alias and releases one resource lease. Final resource
  release removes every remaining alias to that font and its references from
  other fonts' fallback lists. Fallbacks themselves do not keep a font alive.

The original LoadFonts() runs unchanged. A trace tests alias rebinding, sticky
failure, numeric aliases, invalid types, shared colour/advance, fallback ordering,
repeat calls and unload. The entire resulting alias map and selected font state
match a read-only native snapshot. WebFonts.Registry exposes mappings, including
unresolved entries; WebFonts.Inspect exposes shared state and fallback paths.
The adapter limits aliases to 8,192 and each fallback list to 4,096 entries;
fallback-vector capacity is included in the font retained-data budget.

Chrome/Edge/Firefox also exercise these APIs against uploaded textures: aliases
do not change lease counts or fetch bytes, empty fallback calls preserve state,
and explicit unload releases GPU storage and cleans references. The original
RGBA readback checks still pass and caches return to baseline.

Not implemented yet: Text/TextWidget layout, glyph drawing, coloured/outlined
text materials and complete context-loss recovery. `rendererReady` remains false.
After GlobalInit/LoadFonts and the partial headless component registries, original
main.lua returns. Start stops at widgets/text.lua:6, Entity.AddTextWidget.

FontManager.RegisterFont now shares this alias registry in all roles, without
LoadFont colour mutation. See [font-manager.md](font-manager.md) for component
ownership, exact native behavior and client GPU checks.

# Envelope registration, build 756039

`engine/envelope_manager.cpp` implements the dedicated component's registration
layer. It does not yet implement envelope sampling, the global consumer lookup
or VFX emitters. `WebComponents.Envelope` always reports consumerReady=false;
client creation reports the missing consumer. No particle renderer is implied.

The live C closures resolve to wrappers AddColourEnvelope 0x140066060,
AddFloatEnvelope 0x140066070 and AddVector2Envelope 0x140066080. Their underlying
functions are 0x140065b50, 0x140065cc0 and 0x140065e60. Type function 0x1400a9070
returns 0x391ccfb0 and construction finalization is base 0x14003d000.

The factory returns distinct Lua userdata wrappers over the same component,
updating EntityScript.EnvelopeManager to the newest wrapper. Each successful
registration appends a new owned resource. Duplicate names and case-folded
StringID collisions retain separate records; no replacement or deduplication
occurs at registration. Consumer lookup rules between those records remain
unverified. Numeric names convert to strings and embedded NUL ends the name.

Vector2 keyframes retain time/x/y float32 values, 12 bytes each. Colour frames
retain float32 time and four RGBA bytes, 8 bytes each. Each channel converts to
float32, multiplies by 255, adds 0.5, clamps to 0..255 and truncates. Disassembly
also defines the unordered/NaN comparison branch; browser/native fixtures here
exercise finite channels including negative, over-one and rounding boundaries.
Keyframes are kept in Lua iteration order, with no implicit sorting by time.

The ordinary nonempty AddFloatEnvelope API raises a number-expected type error
in this retail build. After fetching row[2], native 0x140065de0 checks stack
index -2, which is the row table, rather than its scalar at -1. The adapter
preserves that behavior for normal table rows. An empty float envelope registers
successfully. None of the 4,030 original Lua files calls AddFloatEnvelope;
49 files each use colour and vector2 registration. Exotic numeric row/table
metamethod behavior has not been certified and is explicitly unsupported.

`tools/native_entity_trace.lua` retains two wrappers over a live owner and calls
the APIs with vector/colour/empty-float/ordinary-float, duplicate/case/NUL/numeric
names, unsorted times and malformed values. `tools/native_entity_memory.py`
verifies owner GUID, component vtable, sleep flags and its owned handle vector,
then reads each resource's StringID, vtable, point count and exact point bytes
from the native global resource store. Capture report hashes bind executable,
source and trace to the memory snapshot. JSON metadata normalizes the diagnostic
name at NUL before persistence; the API itself receives the unmodified string.

Node/WASM tests replay that exact Lua oracle in Master and Caves and compare
all call outcomes and retained bytes. Chrome/Edge/Firefox compare original
native vector/colour byte sequences on both authoritative Workers, confirm
client rejection and guarded stale access, and return all registry counters
to zero without resource fetches or advancing the diagnostic simulation.

Adapter limits: 50,000 managers; 4,096 registrations per owner; 65,536 entries
and 1,048,576 keyframes per instance; 16,384 frames per curve. Dense outer
arrays are required: native allocates by Lua length but iterates with lua_next,
making sparse/hash entries unsafe. Table metamethods are unsupported. Rejected
input is parsed into Lua-owned scratch storage and never commits an entry;
validation errors cannot skip destruction of a C++ staging vector. Entity
retirement frees all owned records. Failed native parsing can abandon a
temporary allocation before registration; the adapter does not preserve leaks.

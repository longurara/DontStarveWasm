# Startup state and the web profile boundary

The current priority is a complete playable game; gameplay multiplayer follows.
Returning from main.lua is an intermediate result. The native Start callback
still fails at widgets/text.lua:6, Entity.AddTextWidget. No world exists and
the real world update dispatch is not connected.

## Sim and application lifetime

GetNumLaunches reads a process-global uint32. The Sim constructor increments
it, including when the application reconstructs Sim/Lua. It is not a persisted
count of browser launches. A fresh WASM module starts at one after dst_init;
closing/reinitializing Lua retains it. Client/Master/Caves modules are isolated.

Dedicated getter 0x14011b310 reads image RVA 0x5f30c4; constructor continuation
0x1400fbdf0 increments it. Client equivalents are 0x140127880 and 0x140107db0.
The native oracle repeats the call with ignored extra arguments; the value
matches read-only memory of the same verified child process.

GetStashedPlayInstance and StashPlayInstance operate on application+0x130.
Dedicated wrappers are 0x14011d570 / 0x14011d5a0; client wrappers are
0x140129f40 / 0x140129f70. The setter checks a Lua number (numeric strings
accepted), truncates to signed int32, and returns zero values. CVTTSD2SI yields
INT32_MIN for nonfinite/out-of-range inputs. Invalid argument types leave the
previous value intact; extra arguments are ignored.

Base constructor 0x140013a20 initializes the stash to -1. The live dedicated
application has vtable 0x1404b1cd0: constructor 0x140005ff0 calls that base
constructor before installing the derived vtable. Sim resets retain this
application value; a new WASM module resets it. PlayerProfile's original Lua
uses the sentinel to increment/save its own play_instance once, including for
crash accounting. This does not supply native world/player-session import.

Native traces, executable fingerprints, memory and source hashes are recorded
in output/native-reference/attempt.json and entity-flags.json. Static evidence
is in output/launch-counter-analysis.txt and play-instance-analysis.txt. Tests
replay the exact oracle and cover every role, resets, coercion and error paths.

## Local profile statistics policy

The web SendProfileStats adapter intentionally has no official telemetry
transport. It records a count, byte total, last channel and SHA256 of the last
payload; it retains no raw payload. The first call logs WEB_COMPAT with this
policy. WebProfileStats.Inspect reports policy=local-diagnostics and
networkEnabled=false. This is a documented platform adaptation, not a claim
that the native telemetry backend was ported.

The valid Lua call accepts a payload string and optional channel string,
coerces numbers to strings like Lua 5.1, ignores extra arguments, and returns zero
values. C strings terminate at NUL. The web boundary guards invalid types,
payloads above 256 KiB, channels above 128 bytes and over one million calls per
Sim. Rejected calls do not commit diagnostic state. Data resets with Sim/Lua.

The unchanged main.lua startup-statistics call reaches this adapter once with
channel is_only_local_users_data. APP_ARCHITECTURE=WASM32 and
APP_OS_ARCHITECTURE=BROWSER are explicit web metadata, not a claim about the
host operating system's architecture.

## Local player key

The dedicated/offline GetUserID wrapper returns an empty string in the native
fixture. Both authoritative shard Workers retain that behavior. A client may
receive a configured WEB_ prefix followed by 32 lowercase hex digits; it is
immutable for the lifetime of its configured session. Build/schema/content
validation still precedes the configuration commit. A shard rejects a player
identity rather than taking ownership of the host's client identity.

The browser creates this random 128-bit key in the existing IndexedDB meta
store under profile:local-identity:v1. A read/write transaction serializes
concurrent first use across tabs. Reload reuses it. A malformed stored record
fails without overwriting it, before creating the client Worker.

This key is local profile groundwork. It is not proof of remote identity,
peer authentication, ownership checks, reconnect or native character mapping.
The current diagnostic ZIP does not export this profile record or playable
character data. Save import/backup identity mapping is still unfinished.

Dedicated GetUserID static evidence is 0x14023b140 -> 0x1401fcab0;
the client wrapper is 0x140289c20 -> 0x140248a10. Both read the selected account
string rather than deriving it from a transient connection ID. The web adapter
does not impersonate Steam/Klei accounts. Browser checks use an isolated
context to test first-use concurrency, reload and preservation of corruption.

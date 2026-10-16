-- Native host-provided globals for the actual, unmodified main.lua.
-- This file does not require modules or build diagnostic entities.
PLATFORM = "WEB"
BRANCH = "release"
CONFIGURATION = "PRODUCTION"
MODS_ROOT = "../mods/"
APP_VERSION = "756039"
APP_ARCHITECTURE = "WASM32"
APP_OS_ARCHITECTURE = "BROWSER"
BUILD_BRANCH = "release"
IS_STEAM_DECK = false
-- Empty native startup settings preserve the fresh Settings table. A loaded
-- world/session must supply its versioned settings through the host adapter.
json_settings = ""
-- Lua/Workshop/native mods are outside the initial web-port scope.
MODS_ENABLED = false
-- A new WASM instance has no native prefab/shader initialization cache yet.
RUN_GLOBAL_INIT = true
package.path = "/compat/?.lua;/scripts/?.lua"
require("native_registry")
Entity.AddNetwork = Entity.AddNetwork or function() error("UNIMPLEMENTED_NATIVE: Entity.AddNetwork", 2) end

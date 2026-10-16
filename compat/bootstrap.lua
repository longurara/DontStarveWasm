-- Web platform initialization. Original Lua files remain byte-for-byte intact.
package.path = "/scripts/?.lua;/compat/?.lua"
PLATFORM = "WEB"
BRANCH = "release"
CONFIGURATION = "WEB_DEVELOPMENT"
CHEATS_ENABLED = false
PI = math.pi
DEGREES = math.pi / 180
FRAMES = GetTickTime()
WEB_DECLARED_GLOBALS = {}
function global(...)
    for i = 1, select('#', ...) do WEB_DECLARED_GLOBALS[select(i, ...)] = true end
end
function IsConsole() return false end
function IsNotConsole() return true end
function IsSteam() return false end
function IsWin32() return false end
function GetTimeForTick(value) return value * GetTickTime() end

-- Install explicit throwing bindings for known, not-yet-implemented native APIs.
-- This also permits original Lua to retain references without hiding a call.
require("native_registry")
Entity.AddNetwork = Entity.AddNetwork or function() error("UNIMPLEMENTED_NATIVE: Entity.AddNetwork", 2) end
require("class")
require("util")
require("vecutil")
require("vector3")
require("scheduler")
Ents = {}
NumEnts = 0
UpdatingEnts = {}
NewUpdatingEnts = {}
StaticUpdatingEnts = {}
NewStaticUpdatingEnts = {}
WallUpdatingEnts = {}
NewWallUpdatingEnts = {}
num_updating_ents = 0
PhysicsCollisionCallbacks = {}
-- No mods are enabled. These methods report the empty enabled-mod set.
ModManager = {}
function ModManager:GetPostInitFns() return {} end
function ModManager:GetServerModsNames() return {} end
require("entityscript")

function CreateEntity(name)
    local native = TheSim:CreateEntity()
    local inst = EntityScript(native)
    inst.name = name
    Ents[inst.GUID] = inst
    NumEnts = NumEnts + 1
    return inst
end

-- The current scene has no BrainManager/SGManager. Reject removing entities
-- that need those managers until their native-compatible lifecycle is present.
function OnRemoveEntity(guid)
    local inst = Ents[guid]
    if not inst then return end
    assert(inst.brain == nil and inst.sg == nil, "UNIMPLEMENTED_NATIVE: brain/stategraph removal lifecycle")
    PhysicsCollisionCallbacks[guid] = nil
    inst:KillTasks()
    NumEnts = NumEnts - 1
    Ents[guid] = nil
end

function RemoveEntity(guid)
    local inst = Ents[guid]
    if inst then
        if inst.delayclientdespawn then inst.delayclientdespawn_attempted = true
        else inst:Remove() end
    end
end

function _WEB_Tick()
    RunScheduler(GetTick())
    RunStaticScheduler(GetStaticTick())
    for guid, inst in pairs(NewUpdatingEnts) do
        UpdatingEnts[guid] = inst
        NewUpdatingEnts[guid] = nil
    end
    for cmp, inst in pairs(StopUpdatingComponents) do
        inst:StopUpdatingComponent_Deferred(cmp)
        StopUpdatingComponents[cmp] = nil
    end
    for _, inst in pairs(UpdatingEnts) do
        if inst.updatecomponents then
            for cmp in pairs(inst.updatecomponents) do
                if cmp.OnUpdate then cmp:OnUpdate(GetTickTime()) end
            end
        end
    end
end

return "Original EntityScript + scheduler loaded"

-- A diagnostic scene using original EntityScript and finiteuses gameplay.
-- Not a player prefab, terrain generator, or a playable DST world.
require("json")
TheWorld = CreateEntity("diagnostic_world")
TheWorld.ismastersim = WEB_ROLE ~= "client"
TheWorld.state = {}
local inst = CreateEntity("finiteuses_probe")
inst.Transform = inst.entity:AddTransform()
inst.Transform:SetPosition(1, 0, 2)
inst:AddComponent("finiteuses")
inst.components.finiteuses:SetMaxUses(100)
inst.components.finiteuses:SetUses(100)
WEB_PROBE = inst
WEB_EVENTS = {}
inst:ListenForEvent("percentusedchange", function(_, data)
    WEB_EVENTS[#WEB_EVENTS + 1] = { tick = GetTick(), percent = data.percent }
end)
function _WEB_Snapshot()
    local x, y, z = inst.Transform:GetWorldPosition()
    return json.encode({
        kind = "engine-diagnostic-v1", role = WEB_ROLE, tick = GetTick(),
        guid = inst.GUID, position = {x, y, z}, rotation = inst.Transform:GetRotation(),
        uses = inst.components.finiteuses.current, tags = { usesdepleted = inst:HasTag("usesdepleted") },
        rngState = WebRNG.GetState(),
        events = WEB_EVENTS,
    })
end
function _WEB_Restore(serialized)
    local data = json.decode(serialized)
    assert(data.kind == "engine-diagnostic-v1" and data.role == WEB_ROLE, "Incompatible diagnostic snapshot")
    inst.Transform:SetPosition(unpack(data.position))
    inst.Transform:SetRotation(data.rotation)
    inst.components.finiteuses:OnLoad({ uses = data.uses })
    WEB_EVENTS = data.events
    WebRNG.SetState(data.rngState)
    return true
end
return _WEB_Snapshot()

-- Runs only in the isolated native reference profile.
local trace = { gameBuild = "756039", ticktime = TheSim:GetTickTime() }
local probe = CreateEntity("wasm_probe")
probe:AddComponent("finiteuses")
probe.components.finiteuses:Use(5)
trace.finiteuses = probe.components.finiteuses.current
trace.randomSeed = 12345
math.randomseed(trace.randomSeed)
trace.randoms = {}
for i = 1, 8 do trace.randoms[i] = math.random() end

local parent = CreateEntity("wasm_parent")
parent.entity:AddTransform()
parent.Transform:SetPosition(10, 0, 20)
parent.Transform:SetRotation(90)
local child = CreateEntity("wasm_child")
child.entity:AddTransform()
parent:AddChild(child)
child.Transform:SetPosition(1, 0, 0)
trace.parentWorldPosition = { child.Transform:GetWorldPosition() }
trace.childLocalPosition = { child.Transform:GetLocalPosition() }
child:Remove()
parent:Remove()

trace.onremove = {}
probe:ListenForEvent("onremove", function(inst)
    trace.onremove.validDuringCallback = inst:IsValid()
    trace.onremove.inRegistryDuringCallback = Ents[inst.GUID] ~= nil
end)
probe:Remove()
trace.onremove.validAfterRemove = probe:IsValid()
trace.onremove.inRegistryAfterRemove = Ents[probe.GUID] ~= nil
TheSim:SetPersistentString("wasm_native_trace", json.encode(trace), false)
TheSim:SetPersistentString("wasm_encoded_probe", 'return {meta={build_version="756039"},mods={},map={width=1,height=1},ents={}}', true)
local text = { cases = {} }
local function sample(name, ...)
    local values = { pcall(_G[name], ...) }
    text.cases[#text.cases + 1] = { name = name, values = values }
end
sample("utf8char", 65)
sample("utf8char", 128512)
sample("utf8char", "abc", 2)
sample("utf8strlen", "a\195\169\240\159\152\128")
sample("utf8substr", "a\195\169\240\159\152\128", 2, -1)
sample("utf8substr", "abcd", 2, 2)
sample("utf8substr", "abcd", -2)
sample("utf8substr", "abcd", 0, 2)
sample("utf8strtoupper", "Stra\195\159e \196\177 \207\131\207\130")
sample("utf8strtolower", "ABC \196\176 \206\163")
TheSim:SetPersistentString("wasm_unicode_trace", json.encode(text), false)
local io_trace = { order = {}, returns = {}, language = {} }
local function mark(value) io_trace.order[#io_trace.order + 1] = value end
local function flush_trace() TheSim:SetPersistentString("wasm_io_trace", json.encode(io_trace), false) end
for _, method in ipairs({"GetDefaultServerLanguage", "GetLanguageCode"}) do
    io_trace.language[method] = { pcall(TheNet[method], TheNet) }
end
mark("before-set")
io_trace.returns.set = { TheSim:SetPersistentString("wasm_io_source", "native payload", true, function(...)
    io_trace.returns.setCallback = {...}; mark("set-callback"); flush_trace()
end) }
mark("after-set")
for _, mode in ipairs({"default", "false", "true"}) do
    mark("before-get-" .. mode)
    local function done(...) io_trace.returns[mode] = {...}; mark("get-callback-" .. mode); flush_trace() end
    if mode == "default" then TheSim:GetPersistentString("wasm_io_source", done)
    else TheSim:GetPersistentString("wasm_io_source", done, mode == "true") end
    mark("after-get-" .. mode)
end
io_trace.returns.exists = { TheSim:CheckPersistentStringExists("wasm_io_source", function(...)
    io_trace.returns.existsCallback = {...}; mark("exists-callback"); flush_trace()
end) }
mark("after-exists")
flush_trace()
local sort_trace = {}
for _, pair in ipairs({{"a","b"},{"A","a"},{"a","A"},{"10","2"},{"2","10"},{"a10","a2"},{9,10},{"9",10},{"\195\169","z"}}) do
    sort_trace[#sort_trace+1] = {arguments=pair,values={pcall(stringidsorter,unpack(pair))}}
end
TheSim:SetPersistentString("wasm_sort_trace",json.encode(sort_trace),false)
local tiles = {managerType=type(TileGroupManager),indexType=type(getmetatable(TileGroupManager).__index),groups={}}
for name,id in pairs(TileGroups) do if type(id)=="number" then tiles.groups[name]=id end end
local first=TileGroupManager:AddTileGroup()
local inherited=TileGroupManager:AddTileGroup(first)
tiles.allocatedDelta=inherited-first
tiles.rangeReturn={TileGroupManager:SetValidTileRange(first,100,120)}
tiles.addReturn={TileGroupManager:AddValidTile(first,42)}
tiles.removeReturn={TileGroupManager:RemoveValidTile(first,42)}
tiles.invalidReturn={TileGroupManager:AddInvalidTile(inherited,110)}
tiles.removeInvalidReturn={TileGroupManager:RemoveInvalidTile(inherited,110)}
tiles.classification={}
for _,id in ipairs({0,1,2,6,200,201,255,300,500,1000,65535}) do
    tiles.classification[#tiles.classification+1]={tile=id,land=TileGroupManager:IsLandTile(id),ocean=TileGroupManager:IsOceanTile(id),impassable=TileGroupManager:IsImpassableTile(id),noise=TileGroupManager:IsNoiseTile(id)}
end
TheSim:SetPersistentString("wasm_tile_trace",json.encode(tiles),false)
local input = {proxyType=type(TheInputProxy),count=TheInputProxy:GetInputDeviceCount(),devices={}}
input.controllerActive=TheInputProxy:IsAnyControllerActive()
input.controllerConnected=TheInputProxy:IsAnyControllerConnected()
input.anyConnected=TheInputProxy:IsAnyInputDeviceConnected()
for i=0,input.count-1 do
    input.devices[#input.devices+1]={id=i,name=TheInputProxy:GetInputDeviceName(i),type=TheInputProxy:GetInputDeviceType(i),enabled=TheInputProxy:IsInputDeviceEnabled(i),connected=TheInputProxy:IsInputDeviceConnected(i)}
end
TheSim:SetPersistentString("wasm_input_trace",json.encode(input),false)
local system = {proxyType=type(TheSystemService)}
local function system_state()
    return {storage=TheSystemService:IsStorageEnabled(),autosave=TheSystemService:IsAutosaveEnabled(),
            available=TheSystemService:IsStorageAvailable(),focus=TheSystemService:HasFocus(),operation={TheSystemService:GetLastOperation()}}
end
system.before=system_state()
system.disableStorage={TheSystemService:EnableStorage(false)}
system.disableAutosave={TheSystemService:EnableAutosave(false)}
system.disabled=system_state()
TheSystemService:EnableStorage(system.before.storage)
TheSystemService:EnableAutosave(system.before.autosave)
system.restored=system_state()
system.hardwareStats={{TheSim:SendHardwareStats()},{TheSim:SendHardwareStats(false,{},"ignored")}}
TheSim:SetPersistentString("wasm_system_trace",json.encode(system),false)
local inventory = {proxyType=type(TheInventory),ownership={},lookups={}}
for _,name in ipairs({"wilson","wilson_none","beefalo_horn_war","amulet_red_heart","web_port_missing_item"}) do
    inventory.ownership[name]={pcall(TheInventory.CheckOwnership,TheInventory,name)}
end
for _,id in ipairs({0,1,12345,4294967295}) do inventory.lookups[#inventory.lookups+1]={id=id,values={pcall(TheInventory.LookupSkinname,TheInventory,id)}} end
TheSim:SetPersistentString("wasm_inventory_trace",json.encode(inventory),false)
local boot = {globals={}}
for _,name in ipairs({"json_settings","RUN_GLOBAL_INIT","MODS_ENABLED"}) do
    local value=rawget(_G,name)
    boot.globals[name]={type=type(value),value=value}
end
local mixer = {before=TheSim:GetSoundVolume("set_sfx/HUD")}
mixer.set={TheSim:SetSoundVolume("set_sfx/HUD",0.125)}
mixer.after=TheSim:GetSoundVolume("set_sfx/HUD")
mixer.lowpass={TheSim:SetLowPassFilter("set_sfx/HUD",1000)}
mixer.highpass={TheSim:SetHighPassFilter("set_sfx/HUD",100)}
mixer.clear={TheSim:ClearDSP("set_sfx/HUD")}
TheSim:SetPersistentString("wasm_boot_trace",json.encode(boot),false)
TheSim:SetPersistentString("wasm_mixer_trace",json.encode(mixer),false)
local haptics = {proxyType=type(TheHaptics),effects={}}
for _,name in ipairs({"dontstarve/wilson/hit","dontstarve/wilson/hungry","web-port/missing-effect"}) do
    haptics.effects[name]={TheHaptics:GetEffect(name)}
end
TheSim:SetPersistentString("wasm_haptics_trace",json.encode(haptics),false)
local eventproxy=requireeventfile("lavaarena_event_server/lavaarena_achievement_quest_defs")
local eventdata={proxyType=type(eventproxy),indexType=type(getmetatable(eventproxy).__index),
    fieldType=type(eventproxy.web_port_probe),callResults={eventproxy.web_port_probe()},keys={}}
for key in pairs(eventproxy)do eventdata.keys[#eventdata.keys+1]=key end
TheSim:SetPersistentString("wasm_event_proxy_trace",json.encode(eventdata),false)
local hashes={cases={},lookups={}}
for _,value in ipairs({"","a","A","abigail","asparagussoup","ABC\195\137","\195\169", "\240\159\152\128", "a\000b"})do
    -- Persistent-string native binding takes a C string; keep the JSON itself
    -- free of embedded NUL while still exercising NUL inside the hash input.
    hashes.cases[#hashes.cases+1]={text=value:gsub("%z","[NUL]"),hash=hash(value),smallhash=smallhash(value)}
end
for _,value in ipairs({"asparagussoup","abigail","web_port_unknown"})do
    hashes.lookups[#hashes.lookups+1]={text=value,value=TheInventory:LookupSkinname(hash(value))}
end
TheSim:SetPersistentString("wasm_hash_trace",json.encode(hashes),false)
local camera={}
for _,method in ipairs({"SetCameraPos","SetCameraDir","SetCameraUp","SetCameraFOV","SetListener"})do
    camera[method]={noargs={pcall(TheSim[method],TheSim)},
        numbers={pcall(TheSim[method],TheSim,0,1,0,0,0,-1,0,1,0)},
        invalid={pcall(TheSim[method],TheSim,"invalid")}}
end
TheSim:SetPersistentString("wasm_camera_trace",json.encode(camera),false)
local follow={}
for _,config in ipairs({{45,42.85714285714286,30},{130,15,80},{-45,60,15}})do
    TheCamera.heading=config[1];TheCamera.pitch=config[2];TheCamera.distance=config[3]
    TheCamera.currentpos=Vector3(1.25,1.5,-10.75);TheCamera.currentscreenxoffset=0
    TheCamera:Apply()
    follow[#follow+1]={config=config,position={TheCamera.camera_pos:Get()},direction={TheCamera.camera_dir:Get()},up={TheCamera.camera_up:Get()},fov=TheCamera.fov}
end
TheSim:SetPersistentString("wasm_followcamera_trace",json.encode(follow),false)
local binary={}
local function bytes(value)
    local out={};for i=1,#value do out[#out+1]=value:byte(i)end;return out
end
for _,entry in ipairs({{"plain",false},{"compressed",true},{"callback"},{"notbool",123}})do
    local name="wasm_io_binary_"..entry[1];local row={order={"before"}}
    local function done(...)row.callback={...};row.order[#row.order+1]="callback"end
    if entry[1]=="callback" then row.returns={TheSim:SetPersistentString(name,"a\000b\255",done)}
    else row.returns={TheSim:SetPersistentString(name,"a\000b\255",entry[2],done)}end
    row.order[#row.order+1]="after"
    TheSim:GetPersistentString(name,function(ok,value)row.read={ok=ok,bytes=bytes(value)}end)
    binary[entry[1]]=row
end
TheSim:GetPersistentString("wasm_io_binary_source",function(ok,value)binary.source={ok=ok,bytes=bytes(value)}end)
TheSim:SetPersistentString("wasm_binary_trace",json.encode(binary),false)
local session={active={},defaults={},changes={},proxyType=type(TheNet),indexType=type(getmetatable(TheNet).__index)}
for _,name in ipairs({"GetServerGameMode","GetServerName","GetServerDescription","GetServerIntention","GetServerMaxPlayers","GetServerFriendsOnly","GetServerLANOnly","GetServerPVP","GetPVPEnabled","GetServerIsDedicated","GetServerIsClientHosted","IsDedicated","IsDedicatedOfflineCluster","IsOnlineMode"})do
    session.active[name]={pcall(TheNet[name],TheNet)}
end
for _,suffix in ipairs({"GameMode","ServerName","ServerDescription","ServerPassword","MaxPlayers","FriendsOnlyServer","LANOnlyServer"})do
    local getter,setter="GetDefault"..suffix,"SetDefault"..suffix
    local initial=TheNet[getter](TheNet)
    session.defaults[getter]=initial
    local values=suffix=="MaxPlayers" and {-1,0,1,6,7,64,65536,6.75,4294967295}
        or (suffix=="FriendsOnlyServer" or suffix=="LANOnlyServer") and {false,true,0,"false"}
        or {"endless","  WiLDERneSS  "," abc \t\nxyz ","a\000b","\195\169 Foo",""," SURVIVAL ","LAVAArena","quAgmiRe"}
    local rows={}
    for index,value in ipairs(values)do
        local row={index=index,returns={pcall(TheNet[setter],TheNet,value)}}
        row.value=TheNet[getter](TheNet)
        row.activeMode=TheNet:GetServerGameMode()
        rows[#rows+1]=row
    end
    TheNet[setter](TheNet,initial)
    session.changes[suffix]=rows
end
TheSim:SetPersistentString("wasm_session_trace",json.encode_compliant(session),false)
c_save()

-- PHYSICS_RADIUS_ORACLE_BEGIN
local physics_radius_trace={}
local function physics_radius_call(label,...)
    local values={pcall(PhysicsWaker.SetMaxPhysicsRadius,...)};local ok=table.remove(values,1)
    physics_radius_trace[#physics_radius_trace+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
physics_radius_call("integer",4)
physics_radius_call("numeric-string","2.3456789")
physics_radius_call("negative",-3)
physics_radius_call("nil",nil)
physics_radius_call("boolean",false)
physics_radius_call("table",{})
physics_radius_call("final",1.23456789,"ignored")
TheSim:SetPersistentString("wasm_physics_radius_trace",json.encode_compliant(physics_radius_trace),false)
-- PHYSICS_RADIUS_ORACLE_END

-- SIM_LAUNCHES_ORACLE_BEGIN
local sim_launches_trace={calls={}}
for i=1,3 do
    sim_launches_trace.calls[#sim_launches_trace.calls+1]={TheSim:GetNumLaunches(nil,false,{},"ignored")}
end
TheSim:SetPersistentString("wasm_sim_launches_trace",json.encode_compliant(sim_launches_trace),false)
-- SIM_LAUNCHES_ORACLE_END

-- NET_IDENTITY_ORACLE_BEGIN
local net_identity_trace={calls={}}
for i=1,3 do
    net_identity_trace.calls[#net_identity_trace.calls+1]={TheNet:GetUserID(nil,false,{},"ignored")}
end
TheSim:SetPersistentString("wasm_net_identity_trace",json.encode_compliant(net_identity_trace),false)
-- NET_IDENTITY_ORACLE_END

-- PLAY_INSTANCE_ORACLE_BEGIN
local play_instance_trace={initial=TheSim:GetStashedPlayInstance(),calls={}}
local function play_instance_call(name,...)
    local values={pcall(TheSim.StashPlayInstance,TheSim,...)};local ok=table.remove(values,1)
    play_instance_trace.calls[#play_instance_trace.calls+1]={name=name,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil,stashed=TheSim:GetStashedPlayInstance()}
end
play_instance_call("integer",3)
play_instance_call("fraction",7.9)
play_instance_call("negative-fraction",-4.9)
play_instance_call("numeric-string","17.4")
play_instance_call("max-fraction",2147483647.9)
play_instance_call("min-fraction",-2147483648.9)
play_instance_call("overflow",2147483648)
play_instance_call("underflow",-2147483649)
play_instance_call("large",4294967297)
play_instance_call("nan",0/0)
play_instance_call("infinity",math.huge)
play_instance_call("negative-infinity",-math.huge)
play_instance_call("nil",nil)
play_instance_call("boolean",false)
play_instance_call("table",{})
play_instance_call("nonnumeric-string","bad")
play_instance_call("sentinel",-1)
play_instance_call("extra",42,"ignored")
TheSim:StashPlayInstance(play_instance_trace.initial)
TheSim:SetPersistentString("wasm_play_instance_trace",json.encode_compliant(play_instance_trace),false)
-- PLAY_INSTANCE_ORACLE_END

-- Objects remain alive only in the isolated reference child for read-only
-- flag/layout capture after this command returns. They are never persisted.
global("WEB_ENTITY_FIXTURE")
WEB_ENTITY_FIXTURE={}
local entities={cases={}}
local function flush() TheSim:SetPersistentString("wasm_entity_trace",json.encode_compliant(entities),false)end
local rotation_probe=CreateEntity("web_rotation_probe");rotation_probe.persists=false;rotation_probe.entity:AddTransform()
local rotations={}
for _,angle in ipairs({0,90,-180,180,360,-360,540,-540,720,360.125,123456.75,-123456.75})do
    rotation_probe.Transform:SetRotation(angle)
    rotations[#rotations+1]={input=angle,output=rotation_probe.Transform:GetRotation()}
end
TheSim:SetPersistentString("wasm_rotation_trace",json.encode_compliant(rotations),false)
rotation_probe:Remove()
for _,config in ipairs({{"fresh"},{"false",false},{"true",true},{"complete","complete"},
    {"false_complete",false,"complete"},{"true_complete",true,"complete"},
    {"complete_false","complete",false},{"complete_true","complete",true},
    {"false_true",false,true},{"true_false",true,false},{"number",123},{"string","invalid"},
    {"toggle_in_callbacks"},{"remove_in_sleep"}})do
    local inst=CreateEntity("web_lifecycle_"..config[1]);inst.persists=false
    inst.entity:AddTransform()
    WEB_ENTITY_FIXTURE[#WEB_ENTITY_FIXTURE+1]=inst
    local row={name=config[1],pointer=tostring(inst.entity),guid=inst.GUID,
        before={awake=inst.entity:IsAwake(),pending=inst.sleepstatepending==true},calls={},events={}}
    entities.cases[#entities.cases+1]=row
    local function event(name)
        row.events[#row.events+1]={name=name,awake=inst.entity:IsAwake(),pending=inst.sleepstatepending==true}
        flush()
    end
    inst:ListenForEvent("entitysleep",function()event("event_sleep")end)
    inst:ListenForEvent("entitywake",function()event("event_wake")end)
    inst.OnEntitySleep=function()
        event("instance_sleep")
        if row.name=="remove_in_sleep" then inst:Remove();row.retired=true;flush()end
    end
    inst.OnEntityWake=function()event("instance_wake")end
    local toggles=0
    local function toggle(value)
        if row.name=="toggle_in_callbacks" and toggles<2 then
            toggles=toggles+1
            local before=inst.entity:IsAwake()
            inst.entity:SetCanSleep(value)
            -- Move to another spatial bucket so the native interest manager
            -- reevaluates an already sleeping entity, even with no players.
            inst.Transform:SetPosition(toggles*256,0,0)
            row.transitions=row.transitions or {}
            row.transitions[#row.transitions+1]={before=before,after=inst.entity:IsAwake(),allow=value}
            flush()
        end
    end
    inst.components.web_lifecycle_probe={
        OnEntitySleep=function()event("component_sleep");toggle(false)end,
        OnEntityWake=function()event("component_wake");toggle(true)end}
    for index=2,#config do
        if config[index]=="complete" then row.calls[#row.calls+1]={pcall(inst.entity.CallPrefabConstructionComplete,inst.entity)}
        else row.calls[#row.calls+1]={pcall(inst.entity.SetCanSleep,inst.entity,config[index])}end
    end
    row.after={awake=inst.entity:IsAwake(),pending=inst.sleepstatepending==true}
end
flush()

-- Discover dynamic component factory closures that are absent from the static
-- method-name inventory. Keep each function alive until read-only capture.
global("WEB_COMPONENT_FIXTURE")
WEB_COMPONENT_FIXTURE={}
entities.managers={entity=tostring(TheGlobalInstance.entity),guid=TheGlobalInstance.GUID,closures={},objects={}}
local function component_closure(label,fn)
    local row={name=label,kind=type(fn),pointer=tostring(fn),upvalues={}}
    entities.managers.closures[#entities.managers.closures+1]=row
    WEB_COMPONENT_FIXTURE[#WEB_COMPONENT_FIXTURE+1]=fn
    if type(fn)=="function" then
        for i=1,32 do
            local name,value=debug.getupvalue(fn,i)
            if name==nil then break end
            row.upvalues[#row.upvalues+1]={name=name,kind=type(value),value=tostring(value)}
            WEB_COMPONENT_FIXTURE[#WEB_COMPONENT_FIXTURE+1]=value
        end
    end
end
for _,name in ipairs({"Transform","UITransform","TextWidget","ShadowManager","RoadManager","EnvelopeManager","PostProcessor","FontManager","MapLayerManager","AnimState","SoundEmitter","MiniMap"})do
    component_closure("Entity.Add"..name,TheGlobalInstance.entity["Add"..name])
end
for _,entry in ipairs({
    {"ShadowManager",ShadowManager,{"SetTexture","GenerateStaticShadows"}},
    {"RoadManager",RoadManager,{"IsOnRoad","BeginRoad","AddControlPoint","AddSmoothedControlPoint"}},
    {"EnvelopeManager",EnvelopeManager,{"AddColourEnvelope","AddFloatEnvelope","AddVector2Envelope"}},
    {"FontManager",FontManager,{"RegisterFont"}},
    {"PostProcessor",PostProcessor,{"SetEffectUniformVariables","AddSamplerEffect"}},
    {"MapLayerManager",MapLayerManager,{"CreateRenderLayer"}},
})do
    local name,object,methods=unpack(entry)
    local row={name=name,kind=type(object),pointer=tostring(object),metatable={}}
    entities.managers.objects[#entities.managers.objects+1]=row
    local mt=debug.getmetatable(object)
    if type(mt)=="table" then
        for key,value in pairs(mt)do row.metatable[#row.metatable+1]={key=tostring(key),kind=type(value),value=tostring(value)} end
    end
    for _,method in ipairs(methods)do
        local ok,value=pcall(function()return object[method]end)
        if ok then component_closure(name.."."..method,value)end
    end
end
flush()

-- SHADOW_COMPONENT_ORACLE_BEGIN
global("WEB_SHADOW_FIXTURE")
local shadow_probe=CreateEntity("web_shadow_manager_probe");shadow_probe.persists=false
shadow_probe.entity:AddTransform();shadow_probe.entity:SetCanSleep(false)
local first_shadow=shadow_probe.entity:AddShadowManager()
local first_attached=shadow_probe.ShadowManager==first_shadow
local second_shadow=shadow_probe.entity:AddShadowManager()
local shadow_trace={guid=shadow_probe.GUID,entity=tostring(shadow_probe.entity),first=tostring(first_shadow),second=tostring(second_shadow),
    kind=type(first_shadow),sameWrapper=rawequal(first_shadow,second_shadow),equal=first_shadow==second_shadow,
    firstAttached=first_attached,secondAttached=shadow_probe.ShadowManager==second_shadow,methods={},calls={}}
local shadow_mt=debug.getmetatable(first_shadow)
for key,value in pairs(shadow_mt.__index)do if type(value)=="function" then shadow_trace.methods[#shadow_trace.methods+1]=key end end
table.sort(shadow_trace.methods)
local function shadow_call(name,fn,...)
    local values={pcall(fn,...)};local ok=table.remove(values,1)
    shadow_trace.calls[#shadow_trace.calls+1]={name=name,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
shadow_call("set-valid",first_shadow.SetTexture,first_shadow,"images/shadow.tex")
shadow_call("set-absent",second_shadow.SetTexture,second_shadow,"web_port/missing_shadow.tex")
shadow_call("set-number",first_shadow.SetTexture,first_shadow,123)
shadow_call("set-nil",first_shadow.SetTexture,first_shadow,nil)
shadow_call("set-bool",first_shadow.SetTexture,first_shadow,false)
shadow_call("set-table",first_shadow.SetTexture,first_shadow,{})
shadow_call("set-nul",second_shadow.SetTexture,second_shadow,"images/shadow.tex\0ignored")
shadow_call("construction-complete",shadow_probe.entity.CallPrefabConstructionComplete,shadow_probe.entity)
local retired_shadow_entity=CreateEntity("web_shadow_retired");retired_shadow_entity.persists=false
retired_shadow_entity.entity:AddTransform();retired_shadow_entity.entity:AddShadowManager()
retired_shadow_entity:Remove()
-- This native factory crashes after retirement instead of returning a Lua
-- error. Keep the unsafe case archived; do not execute it in normal capture.
shadow_trace.retiredFactory="native-unsafe-not-repeated"
WEB_SHADOW_FIXTURE={entity=shadow_probe,first=first_shadow,second=second_shadow}
TheSim:SetPersistentString("wasm_shadow_component_trace",json.encode_compliant(shadow_trace),false)
-- SHADOW_COMPONENT_ORACLE_END

-- ROAD_COMPONENT_ORACLE_BEGIN
global("WEB_ROAD_FIXTURE")
local road_trace={cases={}}
WEB_ROAD_FIXTURE={}
for _,name in ipairs({"initial","points","two-roads"})do
    local inst=CreateEntity("web_road_"..name);inst.persists=false
    inst.entity:AddTransform();inst.entity:SetCanSleep(false)
    local first=inst.entity:AddRoadManager();local first_attached=inst.RoadManager==first
    local second=inst.entity:AddRoadManager()
    local row={name=name,guid=inst.GUID,first=tostring(first),second=tostring(second),kind=type(first),
        sameWrapper=rawequal(first,second),equal=first==second,firstAttached=first_attached,secondAttached=inst.RoadManager==second,
        methods={},calls={}}
    road_trace.cases[#road_trace.cases+1]=row
    local function call(label,fn,...)
        local values={pcall(fn,...)};local ok=table.remove(values,1)
        row.calls[#row.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
    end
    for key,value in pairs(debug.getmetatable(first).__index)do
        if type(value)=="function" then row.methods[#row.methods+1]=key end
    end
    table.sort(row.methods)
    call("empty-query",first.IsOnRoad,first,0,0,0)
    call("query-number-strings",first.IsOnRoad,first,"4","2","-3")
    call("query-nil",first.IsOnRoad,first,0,0,nil)
    call("query-bool",first.IsOnRoad,first,false,0,0)
    call("query-table",first.IsOnRoad,first,0,{},0)
    call("query-nan",first.IsOnRoad,first,0/0,0,0)
    if name~="initial" then
        -- Native accepts points before the first BeginRoad. BeginRoad retains
        -- this pending vector; GenerateVB consumes/clears it later.
        call("point-before-begin",first.AddControlPoint,first,999,888)
        call("begin",second.BeginRoad,second,"ignored")
        call("point-f32",first.AddControlPoint,first,0.1,-0.333333333333)
        call("point-number-strings",second.AddControlPoint,second,"16777217","-42.25")
        call("point-nil",first.AddControlPoint,first,0,nil)
        call("point-bool",first.AddControlPoint,first,false,0)
        call("point-table",first.AddControlPoint,first,0,{})
        call("unbuilt-query",first.IsOnRoad,first,0.1,500,-0.333333333333)
        for strip=0,3 do
            call("wrap-"..strip,first.SetStripWrapMode,first,strip,strip+2.75,-strip-0.75)
            call("uv-"..strip,second.SetStripUVAnimStep,second,strip,strip+0.1,-strip-0.333333333333)
        end
        call("wrap-invalid",first.SetStripWrapMode,first,0,false,0)
        call("uv-invalid",first.SetStripUVAnimStep,first,0,{},0)
        if name=="two-roads" then
            call("begin-again",first.BeginRoad,first)
            call("second-road-point",second.AddControlPoint,second,-123.456789,7.654321)
            call("wrap-number-strings",first.SetStripWrapMode,first,"2.75","9.8","-4.9")
            call("uv-number-strings",first.SetStripUVAnimStep,first,"2.75","1.23456789","-6.54321987")
        end
    end
    call("construction-complete",inst.entity.CallPrefabConstructionComplete,inst.entity)
    WEB_ROAD_FIXTURE[#WEB_ROAD_FIXTURE+1]={entity=inst,first=first,second=second}
end
TheSim:SetPersistentString("wasm_road_component_trace",json.encode_compliant(road_trace),false)
-- ROAD_COMPONENT_ORACLE_END

-- ENVELOPE_COMPONENT_ORACLE_BEGIN
global("WEB_ENVELOPE_FIXTURE")
local envelope_probe=CreateEntity("web_envelope_probe");envelope_probe.persists=false
envelope_probe.entity:AddTransform();envelope_probe.entity:SetCanSleep(false)
local envelope_first=envelope_probe.entity:AddEnvelopeManager()
local envelope_attached=envelope_probe.EnvelopeManager==envelope_first
local envelope_second=envelope_probe.entity:AddEnvelopeManager()
local envelope_trace={guid=envelope_probe.GUID,first=tostring(envelope_first),second=tostring(envelope_second),
    kind=type(envelope_first),equal=envelope_first==envelope_second,sameWrapper=rawequal(envelope_first,envelope_second),
    firstAttached=envelope_attached,secondAttached=envelope_probe.EnvelopeManager==envelope_second,calls={},resources={},methods={}}
for key,value in pairs(debug.getmetatable(envelope_first).__index)do if type(value)=="function" then envelope_trace.methods[#envelope_trace.methods+1]=key end end
table.sort(envelope_trace.methods)
local function envelope_call(label,method,name,points)
    local values={pcall(envelope_first[method],envelope_first,name,points)};local ok=table.remove(values,1)
    envelope_trace.calls[#envelope_trace.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
    if ok then envelope_trace.resources[#envelope_trace.resources+1]={name=tostring(name):match("^[^%z]*"),kind=method,count=#points} end
end
envelope_call("float","AddFloatEnvelope","web_float",{{0,0.1},{0.333333333333,"16777217"},{1,-42.25}})
envelope_call("vector","AddVector2Envelope","web_vector",{{0,{0.1,-0.333333333333}},{1,{123.456789,-7.654321}}})
envelope_call("colour","AddColourEnvelope","web_colour",{{0,{1,0.5,0.1,0}},{1,{-1,2,1/255,127.5/255}}})
envelope_call("duplicate","AddVector2Envelope","web_vector",{{0,{5,6}},{1,{7,8}}})
envelope_call("case","AddVector2Envelope","WEB_VECTOR",{{0,{9,10}},{1,{11,12}}})
envelope_call("nul","AddVector2Envelope","web_nul\0tail",{{0,{1,2}},{1,{3,4}}})
envelope_call("number","AddVector2Envelope",123,{{0,{9,10}},{1,{11,12}}})
envelope_call("empty","AddFloatEnvelope","web_empty",{})
envelope_call("unsorted","AddVector2Envelope","web_unsorted",{{1,{10,11}},{0,{20,21}},{0.5,{30,31}}})
envelope_call("bad-vector","AddVector2Envelope","web_bad_vector",{{0,{1,false}}})
envelope_call("bad-colour","AddColourEnvelope","web_bad_colour",{{0,{1,2,3}}})
local ok,error=pcall(envelope_probe.entity.CallPrefabConstructionComplete,envelope_probe.entity)
envelope_trace.construction={ok=ok,errorType=not ok and type(error) or nil}
WEB_ENVELOPE_FIXTURE={entity=envelope_probe,first=envelope_first,second=envelope_second}
TheSim:SetPersistentString("wasm_envelope_component_trace",json.encode_compliant(envelope_trace),false)
-- ENVELOPE_COMPONENT_ORACLE_END

-- POSTPROCESSOR_COMPONENT_ORACLE_BEGIN
global("WEB_POSTPROCESSOR_FIXTURE")
local post_entities={}
for i=1,2 do
    local inst=CreateEntity("web_postprocessor_"..i);inst.persists=false
    inst.entity:AddTransform();inst.entity:SetCanSleep(false)
    post_entities[i]=inst
end
local post_first=post_entities[1].entity:AddPostProcessor()
local post_attached=post_entities[1].PostProcessor==post_first
local post_second=post_entities[1].entity:AddPostProcessor()
local post_other=post_entities[2].entity:AddPostProcessor()
local post_trace={guid=post_entities[1].GUID,otherGuid=post_entities[2].GUID,first=tostring(post_first),second=tostring(post_second),other=tostring(post_other),
    kind=type(post_first),equal=post_first==post_second,sameWrapper=rawequal(post_first,post_second),firstAttached=post_attached,
    secondAttached=post_entities[1].PostProcessor==post_second,methods={},calls={}}
for key,value in pairs(debug.getmetatable(post_first).__index)do if type(value)=="function" then post_trace.methods[#post_trace.methods+1]=key end end
table.sort(post_trace.methods)
local function post_call(label,object,method,...)
    local values={pcall(object[method],object,...)};local ok=table.remove(values,1)
    post_trace.calls[#post_trace.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
    return ok and values[1] or nil
end
local u1=post_call("add-1",post_first,"AddUniformVariable","web_post_one",1)
local u2=post_call("add-2",post_second,"AddUniformVariable","web_post_two",2)
local u3=post_call("add-3",post_other,"AddUniformVariable","web_post_three",3)
local u4=post_call("add-4",post_first,"AddUniformVariable","web_post_four",4)
post_call("set-1",post_other,"SetUniformVariable",u1,0.1)
post_call("set-2",post_first,"SetUniformVariable",u2,"16777217",-0.333333333333)
post_call("set-3",post_other,"SetUniformVariable",u3,1,2,3)
post_call("set-4",post_second,"SetUniformVariable",u4,4,5,6,7)
post_call("skip-and-partial",post_first,"SetUniformVariable",u4,nil,0.1,{},"-123.456789")
post_call("skip-invalid",post_other,"SetUniformVariable",u3,false,"not a number",{})
post_call("missing-id",post_first,"SetUniformVariable",123456789,{},false)
post_call("bad-id",post_first,"SetUniformVariable",{},1)
post_call("no-values",post_first,"SetUniformVariable",u4)
post_call("fraction-id",post_other,"SetUniformVariable",u2+0.75,nil,"7.654321")
post_call("number-id",post_first,"SetUniformVariable",tostring(u3),nil,-42.25)
local replace=post_call("replace",post_other,"AddUniformVariable","WEB_POST_ONE",2.9)
post_call("set-replaced",post_first,"SetUniformVariable",replace,3.1,-2.2)
post_call("nul-name",post_second,"AddUniformVariable","web_post_nul\0tail",1)
post_call("numeric-name",post_first,"AddUniformVariable",123,1)
post_call("bad-name",post_first,"AddUniformVariable",false,1)
post_call("bad-dimension",post_first,"AddUniformVariable","web_invalid",{})
post_call("enable",post_first,"SetPostProcessingEnabled",true)
post_call("disable-other",post_other,"SetPostProcessingEnabled",false)
post_call("enable-invalid",post_first,"SetPostProcessingEnabled",1)
post_call("enable-nil",post_first,"SetPostProcessingEnabled",nil)
post_call("lua-bloom-disable",post_first,"SetBloomEnabled",false)
post_call("lua-bloom-query",post_second,"IsBloomEnabled")
post_call("lua-distortion-disable",post_other,"SetDistortionEnabled",false)
post_call("lua-distortion-query",post_first,"IsDistortionEnabled")
local s0=post_call("sampler-add",post_first,"AddTextureSampler","images/shadow.tex")
local s1=post_call("sampler-absent",post_other,"AddTextureSampler","web_port/absent_sampler.tex")
post_call("sampler-number",post_second,"AddTextureSampler",123)
post_call("sampler-nul",post_first,"AddTextureSampler","images/shadow.tex\0tail")
post_call("sampler-duplicate",post_other,"AddTextureSampler","images/shadow.tex")
post_call("sampler-set",post_other,"SetTextureSampler",s0,"images/roadnoise.tex")
post_call("sampler-wrap",post_first,"SetTextureSamplerState",s0+0.75,"2.9")
post_call("sampler-filter",post_second,"SetTextureSamplerFilter",s0,1.9,2.1,3.9)
post_call("sampler-wrap-i32",post_other,"SetTextureSamplerState",s1,4294967297)
post_call("sampler-filter-i32",post_first,"SetTextureSamplerFilter",s1,0/0,2147483647,math.huge)
post_call("sampler-missing",post_second,"SetTextureSampler",-1,"images/shadow.tex")
post_call("sampler-wrap-missing",post_second,"SetTextureSamplerState",999,4)
post_call("sampler-filter-missing",post_other,"SetTextureSamplerFilter",999,1,2,3)
post_call("sampler-bad-path",post_first,"SetTextureSampler",s0,{})
post_call("sampler-bad-wrap",post_first,"SetTextureSamplerState",999,false)
post_call("sampler-bad-filter",post_first,"SetTextureSamplerFilter",s0,1,nil,3)
post_call("construction",post_entities[1].entity,"CallPrefabConstructionComplete")
post_call("construction-other",post_entities[2].entity,"CallPrefabConstructionComplete")
WEB_POSTPROCESSOR_FIXTURE={entities=post_entities,first=post_first,second=post_second,other=post_other}
TheSim:SetPersistentString("wasm_postprocessor_component_trace",json.encode_compliant(post_trace),false)
-- POSTPROCESSOR_COMPONENT_ORACLE_END

-- MAP_LAYER_COMPONENT_ORACLE_BEGIN
global("WEB_MAP_LAYER_FIXTURE")
local map_layer_probe=CreateEntity("web_map_layer_probe");map_layer_probe.persists=false
map_layer_probe.entity:AddTransform();map_layer_probe.entity:SetCanSleep(false)
local ml_first=map_layer_probe.entity:AddMapLayerManager()
local ml_attached=map_layer_probe.MapLayerManager==ml_first
local ml_second=map_layer_probe.entity:AddMapLayerManager()
local map_layer_trace={guid=map_layer_probe.GUID,first=tostring(ml_first),second=tostring(ml_second),kind=type(ml_first),
    sameWrapper=rawequal(ml_first,ml_second),equal=ml_first==ml_second,firstAttached=ml_attached,
    secondAttached=map_layer_probe.MapLayerManager==ml_second,globalManager=tostring(MapLayerManager),globalGuid=TheGlobalInstance.GUID,methods={},calls={}}
for key,value in pairs(debug.getmetatable(ml_first).__index)do if type(value)=="function" then map_layer_trace.methods[#map_layer_trace.methods+1]=key end end
table.sort(map_layer_trace.methods)
local function ml_call(label,method,...)
    local values={pcall(ml_first[method],ml_first,...)};local ok=table.remove(values,1)
    map_layer_trace.calls[#map_layer_trace.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
ml_call("sample-integer","SetSampleStyle",3)
ml_call("sample-fraction","SetSampleStyle","7.9")
ml_call("sample-negative","SetSampleStyle",-2.9)
ml_call("sample-wrap","SetSampleStyle",4294967297)
ml_call("sample-nil","SetSampleStyle",nil)
ml_call("sample-bool","SetSampleStyle",false)
ml_call("sample-table","SetSampleStyle",{})
ml_call("sample-final","SetSampleStyle",2)
local h0=ml_first:CreateRenderLayer(65538.9,"levels/tiles/forest.xml","levels/tiles/forest.tex","levels/textures/ground_noise.tex")
local function ml_handle(label,handle)map_layer_trace.calls[#map_layer_trace.calls+1]={name=label,ok=true,values={handle}}end
ml_handle("forest",h0)
ml_call("style-zero","SetSampleStyle",0)
local h1=ml_second:CreateRenderLayer(-1,"levels/tiles/grass.xml","levels/tiles/grass.tex","levels/textures/ground_noise.tex")
ml_handle("grass",h1)
ml_call("style-one","SetSampleStyle",1)
local h2=ml_first:CreateRenderLayer("42.9","levels/tiles/forest.xml","levels/tiles/forest.tex","levels/textures/ground_noise.tex")
ml_handle("duplicate",h2)
ml_call("release-first","ReleaseRenderLayer",h1)
ml_call("release-second","ReleaseRenderLayer",h2)
ml_handle("reuse-last",ml_second:CreateRenderLayer(3,"levels/tiles/grass.xml","levels/tiles/grass.tex","levels/textures/ground_noise.tex"))
ml_handle("reuse-first",ml_first:CreateRenderLayer(4,"levels/tiles/forest.xml","levels/tiles/forest.tex","levels/textures/ground_noise.tex"))
ml_call("primary","SetPrimaryColor",h0,0.1,-0.333333333333,16777217,2)
ml_call("secondary","SetSecondaryColor",h0,"1.23456789",0.5,-42.25,1)
ml_call("dusk","SetSecondaryColorDusk",h0,0,1,2,3)
ml_call("minimap","SetMinimapColor",h0,4,5,6,7)
ml_call("colour-invalid","SetPrimaryColor",h0,1,{},3,4)
ml_call("create-bool","CreateRenderLayer",1,false,"x","y")
ml_call("create-missing-arg","CreateRenderLayer",1,"levels/tiles/forest.xml","x")
ml_call("release-sentinel","ReleaseRenderLayer",-1)
local ok,error=pcall(map_layer_probe.entity.CallPrefabConstructionComplete,map_layer_probe.entity)
map_layer_trace.construction={ok=ok,errorType=not ok and type(error) or nil}
WEB_MAP_LAYER_FIXTURE={entity=map_layer_probe,first=ml_first,second=ml_second}
TheSim:SetPersistentString("wasm_map_layer_component_trace",json.encode_compliant(map_layer_trace),false)
-- MAP_LAYER_COMPONENT_ORACLE_END

-- UI_TRANSFORM_ORACLE_BEGIN
global("WEB_UI_FIXTURE")
local ui_trace={calls={},states={},objects={}}
local ui_wrappers={}
local function ui_owner(name)
    local inst=CreateEntity("web_ui_"..name);inst.persists=false;inst.entity:SetCanSleep(false)
    local first=inst.entity:AddUITransform();local attached=inst.UITransform==first
    local second=inst.entity:AddUITransform()
    ui_wrappers[#ui_wrappers+1]=first;ui_wrappers[#ui_wrappers+1]=second
    local methods={};for k,v in pairs(debug.getmetatable(first).__index)do if type(v)=="function" then methods[#methods+1]=k end end;table.sort(methods)
    ui_trace.objects[#ui_trace.objects+1]={name=name,guid=inst.GUID,first=tostring(first),second=tostring(second),kind=type(first),sameWrapper=rawequal(first,second),equal=first==second,firstAttached=attached,secondAttached=inst.UITransform==second,methods=methods,transformAttached=inst.Transform~=nil}
    return inst
end
local ui_parent=ui_owner("parent")
local ui_child=ui_owner("child");ui_child.entity:SetParent(ui_parent.entity)
local ui_grandchild=ui_owner("grandchild");ui_grandchild.entity:SetParent(ui_child.entity)
local ui_basis={}
for i=1,4 do
    local inst=ui_owner("basis"..i);inst.entity:SetParent(ui_parent.entity)
    inst.UITransform:SetPosition(i==2 and 1 or 0,i==3 and 1 or 0,i==4 and 1 or 0)
    ui_basis[#ui_basis+1]=inst
end
local function ui_state(label)
    local row={name=label,parent={localPosition={ui_parent.UITransform:GetLocalPosition()},worldPosition={ui_parent.UITransform:GetWorldPosition()},scale={ui_parent.UITransform:GetScale()},rotation=ui_parent.UITransform:GetRotation()},child={localPosition={ui_child.UITransform:GetLocalPosition()},worldPosition={ui_child.UITransform:GetWorldPosition()},scale={ui_child.UITransform:GetScale()},rotation=ui_child.UITransform:GetRotation()},grandchild={worldPosition={ui_grandchild.UITransform:GetWorldPosition()}},basis={}}
    for _,inst in ipairs(ui_basis)do row.basis[#row.basis+1]={inst.UITransform:GetWorldPosition()}end
    ui_trace.states[#ui_trace.states+1]=row
end
local function ui_call(label,inst,method,...)
    local values={pcall(inst.UITransform[method],inst.UITransform,...)};local ok=table.remove(values,1)
    ui_trace.calls[#ui_trace.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
ui_trace.screen={TheSim:GetScreenSize()}
ui_state("initial")
ui_call("parent-position",ui_parent,"SetPosition",10.25,-20.5,3)
ui_call("child-position",ui_child,"SetPosition",2.5,4.25,-5)
ui_call("grandchild-position",ui_grandchild,"SetPosition",-3.75,7.125,2)
ui_state("translations")
ui_call("parent-scale",ui_parent,"SetScale",1.5,-2,0.75)
ui_call("child-scale",ui_child,"SetScale",2,3,4)
ui_state("scales")
ui_call("parent-rotation",ui_parent,"SetRotation",90)
ui_call("child-rotation",ui_child,"SetRotation",-45)
ui_state("rotations")
for _,angle in ipairs({-180,180,360,-360,540,360.125,123456.75})do
    ui_call("rotation-"..angle,ui_parent,"SetRotation",angle);ui_state("rotation-"..angle)
end
ui_parent.UITransform:SetRotation(0);ui_child.UITransform:SetRotation(0)
for _,anchor in ipairs({0,1,2,3,3.9,4,-1,4294967296,"2.9"})do
    ui_call("hanchor-"..anchor,ui_child,"SetHAnchor",anchor);ui_call("vanchor-"..anchor,ui_child,"SetVAnchor",anchor);ui_state("anchor-"..anchor)
end
ui_child.UITransform:SetHAnchor(3);ui_child.UITransform:SetVAnchor(3)
for _,mode in ipairs({0,1,2,3,4,5,-1,"2.9"})do
    ui_call("scale-mode-"..mode,ui_child,"SetScaleMode",mode);ui_state("scale-mode-"..mode)
end
ui_child.UITransform:SetScaleMode(0)
ui_call("max-upscale",ui_child,"SetMaxPropUpscale","1.23456789");ui_state("upscale")
ui_call("facing",ui_child,"SetFacing",7.9)
ui_call("facing-wrap",ui_parent,"SetFacing",4294967297)
for _,method in ipairs({"SetPosition","SetScale","SetRotation","SetFacing","SetVAnchor","SetHAnchor","SetScaleMode","SetMaxPropUpscale","SetScissor"})do
    ui_call(method.."-nil",ui_child,method,nil)
    ui_call(method.."-bool",ui_child,method,false)
    ui_call(method.."-table",ui_child,method,{})
end
ui_call("partial-position",ui_child,"SetPosition",1,2,nil)
ui_call("partial-scale",ui_child,"SetScale",1,false,3)
ui_state("after-invalid")
ui_call("scissor",ui_parent,"SetScissor",-1.9,65538,32768,12.75)
ui_call("child-scissor",ui_child,"SetScissor",5,6,20,30)
ui_call("clear-child-scissor",ui_child,"ClearScissor")
ui_call("set-after-clear",ui_child,"SetScissor",-4,8,10,20)
ui_call("update",ui_parent,"UpdateTransform","ignored")
ui_state("final")
local ui_defaults=ui_owner("defaults");ui_defaults.UITransform:UpdateTransform()
for _,inst in ipairs({ui_parent,ui_child,ui_grandchild})do
    local values={pcall(inst.entity.CallPrefabConstructionComplete,inst.entity)};ui_trace.calls[#ui_trace.calls+1]={name="construction",ok=values[1],values={}}
end
WEB_UI_FIXTURE={parent=ui_parent,child=ui_child,grandchild=ui_grandchild,basis=ui_basis,defaults=ui_defaults,wrappers=ui_wrappers}
TheSim:SetPersistentString("wasm_ui_transform_trace",json.encode_compliant(ui_trace),false)
-- UI_TRANSFORM_ORACLE_END

-- TEXT_WIDGET_ORACLE_BEGIN
global("WEB_TEXT_FIXTURE")
local text_trace={calls={},states={},objects={},frontendType=type(rawget(_G,"TheFrontEnd")),worldType=type(rawget(_G,"TheWorld"))}
local text_wrappers={}
local function text_owner(name)
    local inst=CreateEntity("web_text_"..name);inst.persists=false;inst.entity:SetCanSleep(false);inst.entity:AddUITransform()
    local first=inst.entity:AddTextWidget();local attached=inst.TextWidget==first;local second=inst.entity:AddTextWidget()
    text_wrappers[#text_wrappers+1]=first;text_wrappers[#text_wrappers+1]=second
    local methods={};for k,v in pairs(debug.getmetatable(first).__index)do if type(v)=="function" then methods[#methods+1]=k end end;table.sort(methods)
    text_trace.objects[#text_trace.objects+1]={name=name,guid=inst.GUID,first=tostring(first),second=tostring(second),kind=type(first),sameWrapper=rawequal(first,second),equal=first==second,firstAttached=attached,secondAttached=inst.TextWidget==second,methods=methods}
    return inst
end
local text_main=text_owner("main");local tw=text_main.TextWidget
local function text_state(label)
    text_trace.states[#text_trace.states+1]={name=label,string={tw:GetString()},region={tw:GetRegionSize()},overflow={tw:HasOverflow()}}
end
local function text_call(label,method,...)
    local values={pcall(tw[method],tw,...)};local ok=table.remove(values,1)
    text_trace.calls[#text_trace.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
text_state("defaults")
text_call("font","SetFont","web_font_secondary")
text_call("size","SetSize",50)
for _,str in ipairs({"","A","V","AV","AVA","A V","AV "," AV","  ","AV\nAV","AV\rAV","AV\r\nAV","AV\tAV","AV\vAV","AV\fAV","Vi"..utf8char(0x1ec7).."t",utf8char(0x4e2d),utf8char(0x1f600),"A\000B"})do
    text_call("string-"..#text_trace.states,"SetString",str);text_state("string-"..#text_trace.states)
end
tw:SetString("AVAV")
for _,size in ipairs({10,25,50,72.5,0,-10,"37.125"})do text_call("size-"..size,"SetSize",size);text_state("size-"..size)end
tw:SetSize(50);tw:SetString("AV AV AV AV")
text_call("region","SetRegionSize",60,70);text_state("fixed-region")
for _,value in ipairs({false,true,0,1,"false"})do
    text_call("word-"..tostring(value),"EnableWordWrap",value);text_state("word-"..tostring(value))
    text_call("white-"..tostring(value),"EnableWhitespaceWrap",value);text_state("white-"..tostring(value))
end
text_call("word-enable","EnableWordWrap",true);text_call("whitespace-enable","EnableWhitespaceWrap",true)
tw:SetString("AV AV AV AV ");text_state("wrap-dirty")
for _,region in ipairs({{20,20},{60,40},{60,100},{100,-1},{-1,100},{0,0},{-10,-20}})do
    text_call("region-"..region[1].."-"..region[2],"SetRegionSize",unpack(region));text_state("region-"..region[1].."-"..region[2])
end
text_call("reset-region","ResetRegionSize");text_state("reset-region")
tw:SetString("AV")
for _,squeeze in ipairs({1,.5,2,0,-1,".75"})do text_call("squeeze-"..squeeze,"SetHorizontalSqueeze",squeeze);text_state("squeeze-"..squeeze)end
for _,anchor in ipairs({0,1,2,3,3.9,4,-1,4294967296,"2.9"})do
    text_call("ha-"..anchor,"SetHAnchor",anchor);text_call("va-"..anchor,"SetVAnchor",anchor);text_state("anchor-"..anchor)
end
text_call("colour","SetColour",1.25,-.5,.1234567,.75)
text_call("cursor-colour","SetEditCursorColour",.25,.5,.75,1)
for _,value in ipairs({false,true,0,1,"false"})do text_call("cursor-"..tostring(value),"ShowEditCursor",value);text_state("cursor-"..tostring(value))end
for _,method in ipairs({"SetFont","SetSize","SetString","SetRegionSize","SetVAnchor","SetHAnchor","SetColour","EnableWordWrap","EnableWhitespaceWrap","SetHorizontalSqueeze","ShowEditCursor","SetEditCursorColour"})do
    text_call(method.."-nil",method,nil);text_call(method.."-bool",method,false);text_call(method.."-table",method,{})
end
text_call("numeric-string","SetString",123.5);text_state("numeric-string")
text_call("unknown-font","SetFont","web_font_intentionally_absent");text_state("unknown-font")
tw:SetFont("web_font_secondary");tw:SetSize(50);tw:EnableWordWrap(true);tw:EnableWhitespaceWrap(false);tw:SetHorizontalSqueeze(1)
tw:ResetRegionSize();tw:SetRegionSize(120,80);tw:SetHAnchor(0);tw:SetVAnchor(1);tw:SetString("AV A");tw:ShowEditCursor(false);text_state("final")
local text_defaults=text_owner("defaults")
local text_wrap=text_owner("wrapped");text_wrap.TextWidget:SetFont("web_font_secondary");text_wrap.TextWidget:SetSize(25);text_wrap.TextWidget:SetRegionSize(40,40);text_wrap.TextWidget:EnableWordWrap(true);text_wrap.TextWidget:SetString("AV AV AV\nVi"..utf8char(0x1ec7).."t");text_wrap.TextWidget:GetRegionSize()
WEB_TEXT_FIXTURE={main=text_main,defaults=text_defaults,wrapped=text_wrap,wrappers=text_wrappers}
local text_json=json.encode_compliant(text_trace):gsub("[%z\1-\8\11\12\14-\31]",function(c)return string.format("\\u%04x",c:byte())end)
TheSim:SetPersistentString("wasm_text_widget_trace",text_json,false)
-- TEXT_WIDGET_ORACLE_END

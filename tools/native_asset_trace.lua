-- Isolated native loader/animation oracle, independent of the web decoders.
local asset_trace={order={},returns={},clips={},simPointer=tostring(TheSim)}
local name="web_native_animation_assets"
asset_trace.returns.register={TheSim:RegisterPrefab(name,{
    {type="ANIM",file="anim/wilson.zip"},{type="ANIM",file="anim/player_basic.zip"},
    {type="DYNAMIC_ANIM",file="anim/dynamic/box_shared_spiral.zip"},
    {type="FILE",file="klump/strings/unused.txt"},
    {type="ATLAS",file="images/global.xml"},
    {type="DYNAMIC_ATLAS",file="images/fepanels.xml"},
    {type="ATLAS",file="images/fepanels.xml"},
    {type="SHADER",file="shaders/anim_bloom.ksh"},
    {type="IMAGE",file="web_port/intentionally_absent.tex"},
    {type="PKGREF",file="web_port/intentionally_absent.zip"},
    {type="SOUNDPACKAGE",file="web_port/intentionally_absent.fev"},
    {type="ATLAS_BUILD",file="web_port/intentionally_absent.xml"},
    {type="SOUND",file="web_port/intentionally_absent/event"},
    {type="FILE",file="web_port/intentionally_absent.fsb"}}, {})}
asset_trace.order[#asset_trace.order+1]="before-load"
asset_trace.returns.first={TheSim:LoadPrefabs({name})}
asset_trace.returns.second={TheSim:LoadPrefabs({name})}
asset_trace.returns.caseRegister={TheSim:RegisterPrefab("web_native_file_case_alias",{{type="FILE",file="KLUMP/STRINGS/UNUSED.TXT"}},{})}
asset_trace.returns.caseLoad={TheSim:LoadPrefabs({"web_native_file_case_alias"})}
asset_trace.returns.caseUnload={TheSim:UnloadPrefabs({"web_native_file_case_alias"})}
asset_trace.returns.dynamicCaseRegister={TheSim:RegisterPrefab("web_native_dynamic_case_alias",{{type="DYNAMIC_ANIM",file="ANIM/DYNAMIC/BOX_SHARED_SPIRAL.ZIP"}},{})}
asset_trace.returns.dynamicCaseLoad={TheSim:LoadPrefabs({"web_native_dynamic_case_alias"})}
asset_trace.returns.dynamicCaseUnload={TheSim:UnloadPrefabs({"web_native_dynamic_case_alias"})}
asset_trace.order[#asset_trace.order+1]="after-load"
local actor=CreateEntity("web_native_animation_probe");actor.persists=false
actor.entity:AddTransform();actor.entity:AddAnimState()
actor.AnimState:SetBank("wilson");actor.AnimState:SetBuild("wilson")
for _,clip in ipairs({"run_pre","run_loop","run_pst","corpse","corpse_hit"})do
    actor.AnimState:PlayAnimation(clip,true)
    asset_trace.clips[#asset_trace.clips+1]={name=clip,
        length=actor.AnimState:GetCurrentAnimationLength(),frames=actor.AnimState:GetCurrentAnimationNumFrames(),
        frame=actor.AnimState:GetCurrentAnimationFrame(),time=actor.AnimState:GetCurrentAnimationTime()}
end
asset_trace.dynamicClips={}
actor.AnimState:SetBank("box_shared_spiral");actor.AnimState:SetBuild("box_shared_spiral")
for _,clip in ipairs({"activate","idle_loop","skin_out"})do
    actor.AnimState:PlayAnimation(clip,true)
    asset_trace.dynamicClips[#asset_trace.dynamicClips+1]={name=clip,
        length=actor.AnimState:GetCurrentAnimationLength(),frames=actor.AnimState:GetCurrentAnimationNumFrames()}
end
actor:Remove()
asset_trace.returns.terrainRegister={TheSim:RegisterPrefab("web_native_duplicate_atlases",{
    {type="ATLAS",file="levels/tiles/forest.xml"},
    {type="ATLAS",file="levels/tiles/grass.xml"},
    {type="ATLAS",file="levels/tiles/grass2.xml"},
    {type="ATLAS",file="levels/tiles/grass3.xml"},
    {type="ATLAS",file="levels/tiles/meteor.xml"}}, {})}
asset_trace.returns.terrainLoad={TheSim:LoadPrefabs({"web_native_duplicate_atlases"})}
asset_trace.returns.unloadFirst={TheSim:UnloadPrefabs({name})}
asset_trace.returns.unloadSecond={TheSim:UnloadPrefabs({name})}
TheSim:SetPersistentString("wasm_asset_trace",json.encode_compliant(asset_trace),false)

-- ASSET_KIND_ORACLE_BEGIN
local kind_inputs={
    {type="IMAGE",file="web_port/kind_image",param="2.75"},
    {type="ANIM",file="web_port/kind_anim",param=4.5},
    {type="DYNAMIC_ANIM",file="web_port/kind_dynamic_anim",param=true},
    {type="ATLAS_BUILD",file="web_port/kind_atlas_build",param={}},
    {type="SOUND",file="web_port/kind_sound"},
    {type="SOUNDPACKAGE",file="web_port/kind_soundpackage",param=false},
    {type="FILE",file="web_port/kind_file",param="not-a-number"},
    {type="SHADER",file="web_port/kind_shader",param="1"},
    {type="FONT",file="web_port/kind_font",param=12.123456789},
    {type="PKGREF",file="web_port/kind_pkgref",param=-42},
    {type="ATLAS",file="web_port/kind_atlas",param=0},
    {type="DYNAMIC_ATLAS",file="web_port/kind_dynamic_atlas",param=1},
    {type="MINIMAP_IMAGE",file="web_port/intentionally_absent_minimap"},
    {type="anim",file="web_port/intentionally_absent_lowercase"},
    {type="FILE ",file="web_port/intentionally_absent_trailing"},
    {type="WEB_UNRECOGNIZED_ASSET",file="web_port/intentionally_absent_unknown",param={}},
    {type="FiLe\0ignored",file="web_port/kind_nul\0ignored",param=2},
}
TheSim:RegisterPrefab("web_native_asset_kinds",kind_inputs,{})
local ignored_inputs={}
for _,i in ipairs({13,15,16})do ignored_inputs[#ignored_inputs+1]=kind_inputs[i] end
TheSim:RegisterPrefab("web_native_ignored_asset_kinds",ignored_inputs,{})
local kind_trace={register={},load={TheSim:LoadPrefabs({"web_native_ignored_asset_kinds"})},unload={TheSim:UnloadPrefabs({"web_native_ignored_asset_kinds"})}}
TheSim:SetPersistentString("wasm_asset_kind_trace",json.encode_compliant(kind_trace),false)
-- ASSET_KIND_ORACLE_END

-- ATLAS_QUERY_ORACLE_BEGIN
local atlas_query={}
local function query(name,...)
    local values={pcall(TheSim.AtlasContains,TheSim,...)}
    local ok=table.remove(values,1)
    atlas_query[#atlas_query+1]={name=name,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
query("square","images/global.xml","square.tex")
query("noise","images/global.xml","noise.tex")
query("absent-element","images/global.xml","web_port_missing.tex")
query("absent-atlas","web_port/intentionally_absent.xml","square.tex")
query("case","IMAGES/GLOBAL.XML","SQUARE.TEX")
query("numeric",hash("images/global.xml"),hash("square.tex"))
query("negative",hash("images/global.xml")-4294967296,hash("square.tex"))
query("fractional",hash("images/global.xml")+.75,hash("square.tex")+.75)
query("numeric-string",tostring(hash("images/global.xml")),hash("square.tex"))
query("nul","images/global.xml\0ignored","square.tex\0ignored")
query("empty","","")
query("nil",nil,"square.tex")
query("boolean",true,"square.tex")
query("table","images/global.xml",{})
query("infinity",math.huge,"square.tex")
query("nan",0/0,"square.tex")
TheSim:SetPersistentString("wasm_atlas_query_trace",json.encode_compliant(atlas_query),false)
-- ATLAS_QUERY_ORACLE_END

-- FONT_BINDING_ORACLE_BEGIN
local font_binding_trace={}
local function font_call(name,method,...)
    local values={pcall(TheSim[method],TheSim,...)}
    local ok=table.remove(values,1)
    font_binding_trace[#font_binding_trace+1]={name=name,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
font_call("missing-first","LoadFont","web_port/missing_font.zip","web_font_missing")
font_call("missing-sticky","LoadFont","fonts/talkingfont.zip","WEB_FONT_MISSING",false)
font_call("recover-missing","LoadFont","web_port/missing_font.zip","web_font_recovered")
font_call("recover-unload","UnloadFont","web_font_recovered")
font_call("recover-valid","LoadFont","fonts/bellefair50.zip","web_font_recovered",true)
font_call("primary","LoadFont","fonts/talkingfont.zip","web_font_primary",false)
font_call("primary-rebind","LoadFont","fonts/bellefair50.zip","WEB_FONT_PRIMARY",true)
font_call("shared","LoadFont","fonts/talkingfont.zip","web_font_shared")
font_call("secondary","LoadFont","fonts/bellefair50.zip","web_font_secondary",true)
font_call("third","LoadFont","fonts/opensans50.zip","web_font_third",false)
font_call("numeric-alias","LoadFont","fonts/ptmono32.zip",43,false)
font_call("bad-bool-number","LoadFont","fonts/talkingfont.zip","web_font_bad_bool",1)
font_call("bad-bool-string","LoadFont","fonts/talkingfont.zip","web_font_bad_string","false")
font_call("bad-path","LoadFont",false,"web_font_bad_path")
font_call("nil-alias","LoadFont","fonts/talkingfont.zip",nil)
font_call("adjust","AdjustFontAdvance","WEB_FONT_PRIMARY","1.23456789")
font_call("adjust-unknown","AdjustFontAdvance","web_font_unknown",-2)
font_call("adjust-invalid","AdjustFontAdvance","web_font_primary",{})
font_call("fallbacks","SetupFontFallbacks","web_font_primary",{false,"web_font_secondary",{},43,"web_font_third","web_font_secondary","web_font_missing"})
font_call("fallbacks-repeat","SetupFontFallbacks","web_font_primary",{"WEB_FONT_SECONDARY","web_font_third"})
font_call("fallbacks-empty","SetupFontFallbacks","web_font_primary",{})
font_call("fallbacks-non-table","SetupFontFallbacks",nil,false)
font_call("fallbacks-nil","SetupFontFallbacks",nil,nil)
font_call("fallbacks-invalid-alias","SetupFontFallbacks",nil,{})
font_call("fallbacks-unknown","SetupFontFallbacks","web_font_unknown",{"web_font_secondary"})
font_call("disposable","LoadFont","fonts/stint-ucr20.zip","web_font_disposable",false)
font_call("disposable-shared","LoadFont","fonts/stint-ucr20.zip","web_font_disposable_shared",false)
font_call("disposable-fallback","SetupFontFallbacks","web_font_primary",{"web_font_disposable"})
font_call("disposable-unload","UnloadFont","web_font_disposable")
font_call("unknown-unload","UnloadFont","web_font_unknown")
TheSim:SetPersistentString("wasm_font_binding_trace",json.encode_compliant(font_binding_trace),false)

-- FONT_MANAGER_ORACLE_BEGIN
global("WEB_FONT_MANAGER_FIXTURE")
local font_manager_entities={}
for i=1,2 do
    local inst=CreateEntity("web_font_manager_"..i);inst.persists=false
    inst.entity:AddTransform();inst.entity:SetCanSleep(false)
    font_manager_entities[i]=inst
end
local fm_first=font_manager_entities[1].entity:AddFontManager()
local fm_attached=font_manager_entities[1].FontManager==fm_first
local fm_second=font_manager_entities[1].entity:AddFontManager()
local fm_other=font_manager_entities[2].entity:AddFontManager()
local font_manager_trace={guid=font_manager_entities[1].GUID,otherGuid=font_manager_entities[2].GUID,
    first=tostring(fm_first),second=tostring(fm_second),other=tostring(fm_other),kind=type(fm_first),equal=fm_first==fm_second,
    sameWrapper=rawequal(fm_first,fm_second),firstAttached=fm_attached,secondAttached=font_manager_entities[1].FontManager==fm_second,methods={},calls={}}
for key,value in pairs(debug.getmetatable(fm_first).__index)do if type(value)=="function" then font_manager_trace.methods[#font_manager_trace.methods+1]=key end end
table.sort(font_manager_trace.methods)
local function fm_call(label,object,method,...)
    local values={pcall(object[method],object,...)};local ok=table.remove(values,1)
    font_manager_trace.calls[#font_manager_trace.calls+1]={name=label,ok=ok,values=ok and values or {},errorType=not ok and type(values[1]) or nil}
end
fm_call("register",fm_first,"RegisterFont","fonts/talkingfont.zip","web_manager_valid")
fm_call("rebind",fm_other,"RegisterFont","fonts/bellefair50.zip","WEB_MANAGER_VALID",true)
fm_call("load-font-existing",TheSim,"LoadFont","fonts/bellefair50.zip","web_manager_valid",true)
fm_call("register-preserves-colour",fm_second,"RegisterFont","fonts/talkingfont.zip","web_manager_colour",false)
fm_call("missing",fm_first,"RegisterFont","web_port/missing_manager_font.zip","web_manager_missing")
fm_call("sticky",fm_other,"RegisterFont","fonts/talkingfont.zip","WEB_MANAGER_MISSING")
fm_call("numeric-alias",fm_second,"RegisterFont","fonts/talkingfont.zip",77)
fm_call("numeric-path",fm_first,"RegisterFont",123,"web_manager_numeric_path")
fm_call("nul",fm_other,"RegisterFont","fonts/bellefair50.zip\0ignored","web_manager_nul\0tail",{})
fm_call("bad-path",fm_first,"RegisterFont",false,"web_manager_bad")
fm_call("bad-alias",fm_first,"RegisterFont","fonts/talkingfont.zip",{})
fm_call("nil-alias",fm_first,"RegisterFont","fonts/talkingfont.zip",nil)
local retired_fm_entity=CreateEntity("web_font_manager_retired");retired_fm_entity.persists=false
retired_fm_entity.entity:AddFontManager()
fm_call("retired-alias",retired_fm_entity.FontManager,"RegisterFont","fonts/bellefair50.zip","web_manager_removed")
retired_fm_entity:Remove()
fm_call("construction",font_manager_entities[1].entity,"CallPrefabConstructionComplete")
fm_call("construction-other",font_manager_entities[2].entity,"CallPrefabConstructionComplete")
WEB_FONT_MANAGER_FIXTURE={entities=font_manager_entities,first=fm_first,second=fm_second,other=fm_other}
TheSim:SetPersistentString("wasm_font_manager_trace",json.encode_compliant(font_manager_trace),false)
-- FONT_MANAGER_ORACLE_END
-- FONT_BINDING_ORACLE_END

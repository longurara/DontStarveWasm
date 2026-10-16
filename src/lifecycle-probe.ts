import {applyEntitySleep} from './entity-lifecycle.mjs';

export function lifecycleProbe(engine:any,evaluate:(code:string)=>string) {
  const main=engine.FS.readFile('/scripts/mainfunctions.lua',{encoding:'utf8'});
  const begin=main.indexOf('function OnEntitySleep(guid)'),end=main.indexOf('function OnPhysicsWake(guid)');
  if(begin<0||end<=begin)throw new Error('Original entity lifecycle callbacks unavailable');
  if(JSON.parse(evaluate('return _WEB_Snapshot()')).kind!=='engine-diagnostic-v1')throw new Error('Lifecycle probe requires the isolated diagnostic scene');
  const before=engine._dst_entity_count(),tick=engine._dst_tick_count();
  evaluate('_WEB_LIFECYCLE_OLD={sleep=rawget(_G,"OnEntitySleep"),wake=rawget(_G,"OnEntityWake")}');
  try{
    // Execute the byte-for-byte original function definitions. The diagnostic
    // probe supplies explicit sleep decisions, independently of world policy.
    evaluate(main.slice(begin,end));
    const guid=Number(evaluate(`
      _WEB_LIFECYCLE_PROBE=CreateEntity("browser_lifecycle_probe")
      local inst=_WEB_LIFECYCLE_PROBE
      inst.persists=false;inst.entity:AddTransform();inst.Transform:SetRotation(360)
      inst.data={events={}}
      local function record(name) inst.data.events[#inst.data.events+1]={name=name,awake=inst.entity:IsAwake(),pending=inst.sleepstatepending==true} end
      inst:ListenForEvent("entitysleep",function() record("event_sleep") end)
      inst:ListenForEvent("entitywake",function() record("event_wake") end)
      inst.OnEntitySleep=function() record("instance_sleep") end
      inst.OnEntityWake=function() record("instance_wake") end
      inst.components.web_lifecycle_probe={OnEntitySleep=function() record("component_sleep") end,OnEntityWake=function() record("component_wake") end}
      inst.entity:SetCanSleep(false)
      return inst.GUID`));
    applyEntitySleep(engine,[[guid,false]]);
    evaluate('_WEB_LIFECYCLE_PROBE.entity:SetCanSleep(true)');applyEntitySleep(engine,[[guid,true]]);
    const deferredAwake=evaluate('_WEB_LIFECYCLE_PROBE.entity:SetCanSleep(false);return tostring(_WEB_LIFECYCLE_PROBE.entity:IsAwake())')==='true';
    applyEntitySleep(engine,[[guid,false]]);
    const state=JSON.parse(evaluate('local inst=_WEB_LIFECYCLE_PROBE;return json.encode_compliant({events=inst.data.events,awake=inst.entity:IsAwake(),pending=inst.sleepstatepending==true,rotation=inst.Transform:GetRotation()})'));
    return {...state,deferredAwake,tickAdvanced:engine._dst_tick_count()!==tick,spatialPolicyImplemented:false};
  } finally {
    evaluate('local inst=rawget(_G,"_WEB_LIFECYCLE_PROBE");if inst and inst:IsValid() then inst:Remove() end;OnEntitySleep=_WEB_LIFECYCLE_OLD.sleep;OnEntityWake=_WEB_LIFECYCLE_OLD.wake;_WEB_LIFECYCLE_PROBE=nil;_WEB_LIFECYCLE_OLD=nil');
    if(engine._dst_entity_count()!==before)throw new Error('Lifecycle probe leaked entities');
  }
}

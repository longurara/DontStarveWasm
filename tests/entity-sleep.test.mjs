import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';

async function fixture(path){
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true,'all current oracle commands must finish before comparison');
  assert.equal(report.entityCaptureError,null);assert.equal(report.nativeWorldReady,true);
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),report.fixtureSha256[key]);
  return path.endsWith('.json')?JSON.parse(bytes):JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
}
function installOriginalCallbacks(engine,evaluate){
  const source=engine.FS.readFile('/scripts/mainfunctions.lua',{encoding:'utf8'});
  evaluate('json=require("json");'+source.slice(source.indexOf('function OnEntitySleep(guid)'),source.indexOf('function OnPhysicsWake(guid)')));
}
function apply(engine,entries){
  const bytes=new Uint8Array(new Uint32Array(entries.flatMap(([id,sleeping])=>[id,sleeping?1:0])).buffer);
  const pointer=engine._malloc(bytes.length||4);
  try{
    engine.HEAPU8.set(bytes,pointer);const status=engine._dst_apply_entity_sleep(pointer,entries.length);
    if(status)throw new Error(engine.ccall('dst_result','string',[],[]));
  }finally{engine._free(pointer);}
}
const normalize=row=>{
  const {guid,pointer,...value}=row;
  value.calls=value.calls.map(call=>call[0]?[true]:[false,call[1].match(/boolean expected, got \w+/)?.[0]]);
  return value;
};

test('entity sleep flags, initial notifications, callback order and removal match native trace and memory',async t=>{
  const native=await fixture('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_entity_trace');
  const flags=await fixture('output/native-reference/entity-flags.json');
  const traceBytes=await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_entity_trace',import.meta.url));
  assert.equal(flags.traceSha256,createHash('sha256').update(traceBytes).digest('hex'),'memory flags must refer to the exact callback trace');
  const rotations=await fixture('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_rotation_trace');
  const {engine,evaluate}=await loadEngine(1,{fullScripts:true,resources:false});t.after(()=>engine._dst_close());
  installOriginalCallbacks(engine,evaluate);
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  const discovery=source.indexOf('-- Discover dynamic component factory closures');assert.ok(discovery>0);
  // Manager discovery requires a bootstrapped native global entity. Its
  // component cases have a separate conformance test; replay all lifecycle
  // decisions here without introducing that unrelated world dependency.
  evaluate(source.slice(0,discovery));
  const initial=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(engine.FS.readFile('/persistent/master/wasm_entity_trace'))));
  assert.equal(initial.cases.length,native.cases.length);
  const decisions=initial.cases.map((row,i)=>{
    assert.deepEqual(row.before,native.cases[i].before);assert.deepEqual(row.after,native.cases[i].after);
    // Replay the native spatial manager's observed decisions. The WASM
    // WorldSim policy itself has not been implemented or certified here.
    return [row.guid,native.cases[i].events[0].name==='event_sleep'];
  });
  const tick=engine._dst_tick_count();apply(engine,decisions);assert.equal(engine._dst_tick_count(),tick);
  const actual=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(engine.FS.readFile('/persistent/master/wasm_entity_trace'))));
  assert.deepEqual(actual.cases.map(normalize),native.cases.map(normalize));
  for(const row of actual.cases){
    const expected=flags.cases.find(value=>value.name===row.name);
    const state=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${row.guid}))`));
    assert.equal(state.valid,!expected.retired,row.name);
    if(state.valid){
      assert.equal(state.awake,!expected.sleeping,row.name);assert.equal(state.canSleep,expected.canSleep,row.name);
      assert.equal(state.componentsAllowSleep,expected.componentsAllowSleep,row.name);assert.equal(state.pending,false);
    }
  }
  const angleResult=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(engine.FS.readFile('/persistent/master/wasm_rotation_trace'))));
  assert.deepEqual(angleResult,rotations);
});

test('sleep decision batches reject invalid input, tolerate callback removal and defer new entities',async t=>{
  const {engine,evaluate}=await loadEngine(1,{fullScripts:true,resources:false});t.after(()=>engine._dst_close());
  evaluate('UNREADY=CreateEntity("unready")');const unready=Number(evaluate('return UNREADY.GUID'));
  assert.throws(()=>apply(engine,[[unready,true]]),/UNIMPLEMENTED_NATIVE: lifecycle callback/);
  assert.equal(evaluate('return tostring(UNREADY.entity:IsAwake())'),'true');
  assert.equal(engine._dst_apply_entity_sleep(0,1),1);
  assert.equal(engine._dst_apply_entity_sleep(engine.HEAPU8.length-4,1),1);
  assert.equal(engine._dst_apply_entity_sleep(0,100001),1);
  installOriginalCallbacks(engine,evaluate);
  evaluate('A=CreateEntity("a");B=CreateEntity("b");EVENTS={};A:ListenForEvent("entitysleep",function() EVENTS[#EVENTS+1]="sleep";B:Remove();NEW=CreateEntity("new");NEW:ListenForEvent("entitywake",function() EVENTS[#EVENTS+1]="new-wake" end)end)');
  const a=Number(evaluate('return A.GUID')),b=Number(evaluate('return B.GUID'));
  assert.throws(()=>apply(engine,[[a,true],[a,false]]),/duplicate/);
  assert.equal(evaluate('return tostring(A.entity:IsAwake())'),'true');assert.equal(evaluate('return #EVENTS'),'0');
  apply(engine,[[a,true],[b,true]]);
  assert.equal(evaluate('return tostring(B:IsValid())'),'false');assert.equal(evaluate('return #EVENTS'),'1');
  assert.equal(evaluate('return tostring(NEW.sleepstatepending)'),'true');
  assert.throws(()=>apply(engine,[[a,false],[b,false]]),/retired/);
  assert.equal(evaluate('return tostring(A.entity:IsAwake())'),'false');
  const newborn=Number(evaluate('return NEW.GUID'));apply(engine,[[newborn,false]]);apply(engine,[[newborn,false]]);
  assert.equal(evaluate('return #EVENTS'),'2','unchanged decisions after initial notification do not repeat callbacks');
  evaluate('A.OnEntityWake=function() error("fixture wake failure")end');
  assert.throws(()=>apply(engine,[[a,false]]),/fixture wake failure/);
  assert.equal(evaluate('return tostring(A.entity:IsAwake())'),'true','native state changes before Lua notification');
  assert.equal(evaluate('return 6*7'),'42','callback failure leaves a usable Lua VM');
  assert.equal(evaluate('return tostring(B.entity:IsAwake())'),'false');
  assert.equal(evaluate('return select("#",B.entity:SetCanSleep("ignored after retirement"))'),'0');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../tools/load-engine.mjs';

async function runtime(t) {
  const loaded=await loadEngine();t.after(()=>loaded.engine._dst_close());
  loaded.evaluate('return dofile("/compat/diagnostic.lua")');return loaded;
}

test('WASM executes original Class, EntityScript and Vector3',async t=>{
  const {evaluate}=await runtime(t);
  assert.equal(evaluate('assert(WEB_PROBE:is_a(EntityScript)); local v=Vector3(3,0,4);return v:Length()'),'5');
});
test('original finiteuses emits events, depletes once, and persists component state',async t=>{
  const {evaluate}=await runtime(t);
  evaluate('WEB_PROBE.components.finiteuses:Use(5)');
  let value=JSON.parse(evaluate('return _WEB_Snapshot()'));
  assert.equal(value.uses,95);assert.deepEqual(value.events,[{percent:.95,tick:0}]);
  evaluate('WEB_PROBE.components.finiteuses:Use(95)');
  value=JSON.parse(evaluate('return _WEB_Snapshot()'));assert.equal(value.uses,0);assert.equal(value.tags.usesdepleted,true);
  assert.equal(evaluate('return WEB_PROBE.components.finiteuses:OnSave().uses'),'0');
  evaluate('WEB_PROBE.components.finiteuses:OnLoad({uses=40})');
  value=JSON.parse(evaluate('return _WEB_Snapshot()'));assert.equal(value.uses,40);assert.equal(value.tags.usesdepleted,false);
});
test('original scheduler executes and cancels entity tasks at simulation ticks',async t=>{
  const {engine,evaluate}=await runtime(t);
  evaluate('WEB_COUNTER=0;WEB_PROBE:DoTaskInTime(1,function() WEB_COUNTER=WEB_COUNTER+1 end);local task=WEB_PROBE:DoTaskInTime(.5,function() WEB_COUNTER=100 end);task:Cancel()');
  assert.equal(engine._dst_tick(29),0);assert.equal(evaluate('return WEB_COUNTER'),'0');
  assert.equal(engine._dst_tick(2),0);assert.equal(evaluate('return WEB_COUNTER'),'1');
});
test('original timer component dispatches timerdone',async t=>{
  const {engine,evaluate}=await runtime(t);
  evaluate('WEB_DONE="pending";WEB_PROBE:AddComponent("timer");WEB_PROBE:ListenForEvent("timerdone",function(_,data) WEB_DONE=data.name end);WEB_PROBE.components.timer:StartTimer("native-timer",1)');
  assert.equal(engine._dst_tick(31),0);assert.equal(evaluate('return WEB_DONE'),'native-timer');
});
test('recovered clock constant and tick counter retain native widths',async t=>{
  const {engine,evaluate}=await runtime(t);
  assert.equal(Number(evaluate('return GetTickTime()')),0.033333335071802);
  engine._dst_restore_clock(0xffffffff);assert.equal(Number(evaluate('return GetTick()')),0xffffffff);
});
test('unimplemented native methods fail explicitly and Lua errors do not destroy runtime',async t=>{
  const {engine,evaluate}=await runtime(t);
  assert.throws(()=>evaluate('TheSim:FindEntities(0,0,0,10)'),/UNIMPLEMENTED_NATIVE: Sim.FindEntities/);
  assert.equal(evaluate('return 6*7'),'42');
  assert.throws(()=>evaluate('while true do end'),/Instruction budget exceeded/);
  assert.equal(evaluate('return 7*7'),'49');
  evaluate('_WEB_Tick=nil');
  const tick=engine._dst_tick_count();assert.equal(engine._dst_tick(1),1);
  assert.match(engine.ccall('dst_result','string',[],[]),/main simulation update dispatch/);
  assert.equal(engine._dst_tick_count(),tick,'missing main loop must not silently advance simulation');
});

function inspect(engine,bytes){
  const pointer=engine._malloc(bytes.length);assert.ok(pointer);
  try{
    engine.HEAPU8.set(bytes,pointer);
    const status=engine._dst_inspect_save(pointer,bytes.length);
    const result=engine.ccall('dst_result','string',[],[]);
    if(status)throw new Error(result);return JSON.parse(result);
  }finally{engine._free(pointer);}
}
test('native save inspector refuses bytecode, wrong builds and executable access',async t=>{
  const {engine,evaluate}=await runtime(t);
  for(const [input,pattern] of [
    ['\x1bLua','Bytecode'],['return {meta={build_version="1"}}','build'],
    ['os.execute("anything")','nil'],['while true do end','Instruction budget'],
  ])assert.throws(()=>inspect(engine,Buffer.from(input)),new RegExp(pattern));
  assert.equal(evaluate('return WEB_PROBE.components.finiteuses.current'),'100');
});
test('native world fixture from original engine decodes inside WASM',async t=>{
  const reportUrl=new URL('../output/native-reference/attempt.json',import.meta.url);
  try{await access(reportUrl);}catch{t.skip('Generate native-reference fixture with tools/capture_native.py');return;}
  const report=JSON.parse(await readFile(reportUrl));
  if(!report.nativeSaveFiles?.length){t.skip('Native engine did not produce a world save');return;}
  const {engine}=await runtime(t);
  const path=resolve(fileURLToPath(new URL('..',import.meta.url)),report.nativeSaveFiles[0]);
  const value=inspect(engine,await readFile(path));
  assert.equal(value.gameBuild,'756039');assert.ok(value.prefabTypes>50);assert.ok(value.entityInstances>1000);
  assert.ok(value.mapWidth>0&&value.mapHeight>0);assert.equal(value.playableImport,false);
  console.log('Native save summary:',JSON.stringify(value));
});

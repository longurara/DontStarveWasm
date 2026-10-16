import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';

test('Sim launch count is per instance, survives Lua resets, and matches the live native process counter',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.entityCaptureError,null);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  async function checked(path){
    const bytes=await readFile(new URL('../'+path,import.meta.url));
    const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
    assert.ok(key,path);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;
  }
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_sim_launches_trace');
  const native=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(memory.simLaunches.traceSha256,hash(bytes));
  assert.ok(memory.simLaunches.count>=1&&memory.simLaunches.count<=16);
  assert.deepEqual(native.calls,Array.from({length:3},()=>[memory.simLaunches.count]));
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- SIM_LAUNCHES_ORACLE_BEGIN')[1].split('-- SIM_LAUNCHES_ORACLE_END')[0];
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());
    assert.equal(evaluate('return TheSim:GetNumLaunches()'),'1');
    for(let count=2;count<=memory.simLaunches.count;++count){
      // Closing and reconstructing Lua is a Sim reset, not a new WASM process.
      engine._dst_close();assert.equal(engine._dst_init(role),0);
      assert.equal(evaluate('return TheSim:GetNumLaunches()'),String(count));
    }
    evaluate('package.path="/scripts/?.lua";json=require("json")');
    assert.deepEqual(JSON.parse(evaluate(block+'\nreturn json.encode_compliant(sim_launches_trace)')),native);
    engine._dst_close();assert.equal(engine._dst_init(role),0);
    assert.equal(evaluate('return TheSim:GetNumLaunches()'),String(memory.simLaunches.count+1));
  }
  const fresh=await loadEngine();t.after(()=>fresh.engine._dst_close());
  assert.equal(fresh.evaluate('return TheSim:GetNumLaunches()'),'1','a new module must not inherit another process counter');
});

test('play instance stash matches native signed conversion and application lifetime across Sim resets',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.entityCaptureError,null);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  async function checked(path){const bytes=await readFile(new URL('../'+path,import.meta.url));
    const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
    assert.ok(key,path);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;}
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_play_instance_trace');
  const native=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(memory.playInstance.traceSha256,hash(bytes));assert.equal(memory.playInstance.value,native.initial);
  // Derived application constructor 0x140005ff0 calls the -1-initializing
  // base constructor 0x140013a20 before installing this live vtable.
  assert.equal(memory.playInstance.applicationVtable,'0x1404b1cd0');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- PLAY_INSTANCE_ORACLE_BEGIN')[1].split('-- PLAY_INSTANCE_ORACLE_END')[0];
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());
    assert.equal(evaluate('return TheSim:GetStashedPlayInstance()'),'-1');
    evaluate(`json=require("json");TheSim:StashPlayInstance(${native.initial})`);
    assert.deepEqual(JSON.parse(evaluate(block+'\nreturn json.encode_compliant(play_instance_trace)')),native);
    evaluate('TheSim:StashPlayInstance(73)');
    engine._dst_close();assert.equal(engine._dst_init(role),0);
    assert.equal(evaluate('return TheSim:GetStashedPlayInstance(nil,{})'),'73');
  }
  const fresh=await loadEngine();t.after(()=>fresh.engine._dst_close());
  assert.equal(fresh.evaluate('return TheSim:GetStashedPlayInstance()'),'-1');
});

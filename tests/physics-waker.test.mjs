import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('PhysicsWaker static radius setter matches native float32 storage and call validation in every role',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.entityCaptureError,null);
  async function checked(path){const bytes=await readFile(new URL('../'+path,import.meta.url));
    const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;}
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_physics_radius_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));assert.equal(hash(bytes),memory.physicsWaker.traceSha256);
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- PHYSICS_RADIUS_ORACLE_BEGIN')[1].split('-- PHYSICS_RADIUS_ORACLE_END')[0];
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());evaluate('json=require("json")');
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(physics_radius_trace)'));assert.deepEqual(actual,original);
    const state=JSON.parse(evaluate('return json.encode_compliant(WebPhysicsWaker.Inspect())'));
    assert.equal(Math.fround(state.maxPhysicsRadius),memory.physicsWaker.maxPhysicsRadius);assert.equal(state.simulationReady,false);
    const bits=Buffer.alloc(4);bits.writeFloatLE(state.maxPhysicsRadius);assert.equal(bits.toString('hex'),memory.physicsWaker.bits);
    assert.throws(()=>evaluate('PhysicsWaker:SetMaxPhysicsRadius(3)'),/number/);
    assert.equal(evaluate('return WebPhysicsWaker.Inspect().maxPhysicsRadius'),String(state.maxPhysicsRadius));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function checked(path){
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.entityCaptureError,null);
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
  assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;
}
test('EnvelopeManager retains native vector/colour bytes, duplicates, ordering and retail float-wrapper errors',async t=>{
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_envelope_component_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(hash(bytes),memory.envelope.traceSha256);const native=memory.envelope.component;
  assert.equal(native.sameComponent,true);assert.equal(native.typeFunction,'0x1400a9070');assert.equal(native.finalizeFunction,'0x14003d000');
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- ENVELOPE_COMPONENT_ORACLE_BEGIN')[1].split('-- ENVELOPE_COMPONENT_ORACLE_END')[0];
  const normalized=({guid,first,second,...row})=>row;
  for(const role of [1,2]){
    const {engine,evaluate,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(envelope_trace)'));
    assert.deepEqual(normalized(actual),normalized(original));
    const state=JSON.parse(evaluate(`return json.encode_compliant(WebComponents.Envelope(${actual.guid}))`));
    assert.equal(state.typeId,0x391ccfb0);assert.equal(state.consumerReady,false);
    assert.deepEqual(state.entries,native.resources.map(({name,vtable,...row})=>row));
    const lifecycle=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${actual.guid}))`));
    for(const field of ['awake','canSleep','componentsAllowSleep'])assert.equal(lifecycle[field],native[field]);
    assert.equal(assets.stats.fetches,0);
    evaluate('WEB_ENVELOPE_FIXTURE.entity:Remove()');
    assert.equal(evaluate('return WebComponents.Envelope().totalEntries'),'0');assert.equal(evaluate('return WebComponents.Envelope().totalPoints'),'0');
    assert.throws(()=>evaluate('WEB_ENVELOPE_FIXTURE.first:AddColourEnvelope("stale",{})'),/owner is removed/);
    assert.throws(()=>evaluate('WEB_ENVELOPE_FIXTURE.entity.entity:AddEnvelopeManager()'),/removed entity/);
  }
});
test('EnvelopeManager parsing errors do not commit records and cannot bypass array/entry budgets',async t=>{
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());
  evaluate('WEB_ENV_SAFE=CreateEntity("env_safe");WEB_ENV_SAFE.entity:AddEnvelopeManager()');
  for(const script of [
    'WEB_ENV_SAFE.EnvelopeManager:AddVector2Envelope("sparse",{[1]={0,{1,2}},[3]={1,{3,4}}})',
    'WEB_ENV_SAFE.EnvelopeManager:AddVector2Envelope("hash",{["metadata"]={0,{1,2}}})',
    'WEB_ENV_SAFE.EnvelopeManager:AddColourEnvelope("bad",{{0,{1,2,3}}})',
    'WEB_ENV_SAFE.EnvelopeManager:AddVector2Envelope("bad",{{0,{1,false}}})',
    'WEB_ENV_SAFE.EnvelopeManager:AddFloatEnvelope("retail_bug",{{0,1}})',
    'WEB_ENV_SAFE.EnvelopeManager:AddVector2Envelope("meta",setmetatable({},{}))',
    'local points={};for i=1,16385 do points[i]={0,{1,2}}end;WEB_ENV_SAFE.EnvelopeManager:AddVector2Envelope("large",points)',
  ])assert.throws(()=>evaluate(script));
  assert.equal(evaluate('return WebComponents.Envelope().totalEntries'),'0');
  assert.equal(evaluate('return WebComponents.Envelope().totalPoints'),'0');
  assert.equal(evaluate('return WebComponents.Envelope(0/0)'),'nil');assert.equal(evaluate('return WebComponents.Envelope(math.huge)'),'nil');
  evaluate('for i=1,4096 do WEB_ENV_SAFE.EnvelopeManager:AddFloatEnvelope("empty",{})end');
  assert.throws(()=>evaluate('WEB_ENV_SAFE.EnvelopeManager:AddFloatEnvelope("over",{})'),/envelope count exceeds budget/);
  assert.equal(evaluate('return WebComponents.Envelope().totalEntries'),'4096');
  evaluate('WEB_ENV_SAFE:Remove()');assert.equal(evaluate('return WebComponents.Envelope().managers'),'0');
  assert.equal(evaluate('return WebComponents.Envelope().totalEntries'),'0');
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('WEB_ENV_CLIENT=CreateEntity("env_client");WEB_ENV_CLIENT.entity:AddEnvelopeManager()'),/client EnvelopeManager consumer/);
  assert.equal(client.evaluate('return WebComponents.Envelope().managers'),'0');
});

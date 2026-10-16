import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function checked(path){
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));assert.equal(report.oracleComplete,true);assert.equal(report.entityCaptureError,null);
  const bytes=await readFile(new URL('../'+path,import.meta.url));const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;
}
test('dynamic native factories are captured from live C closures, including ShadowManager component identity',async()=>{
  const bytes=await checked('output/native-reference/entity-flags.json'),native=JSON.parse(bytes);
  const trace=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_entity_trace');assert.equal(hash(trace),native.traceSha256);
  const expected={'Entity.AddTransform':'0x140081ab0','Entity.AddShadowManager':'0x14006bfa0','Entity.AddRoadManager':'0x140058260','Entity.AddEnvelopeManager':'0x140066280','Entity.AddPostProcessor':'0x1400631d0','Entity.AddFontManager':'0x14005ebe0','Entity.AddMapLayerManager':'0x140054720','Entity.AddAnimState':'0x14007c340','Entity.AddSoundEmitter':'0x14007d650','Entity.AddMiniMap':'0x14006a8d0'};
  for(const [name,target] of Object.entries(expected))assert.equal(native.componentClosures.find(row=>row.name===name)?.target,target);
  assert.ok(native.shadow.components.every(row=>row.sameComponent&&row.typeFunction==='0x140083810'&&row.finalizeFunction==='0x14003d000'));
});
test('dedicated ShadowManager wrappers, method validation and finalizer match native without resource fetches',async t=>{
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_shadow_component_trace'),original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const native=JSON.parse(await checked('output/native-reference/entity-flags.json'));assert.equal(hash(bytes),native.shadow.traceSha256);
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8'),block=source.split('-- SHADOW_COMPONENT_ORACLE_BEGIN')[1].split('-- SHADOW_COMPONENT_ORACLE_END')[0];
  for(const role of [1,2]){
    const {engine,evaluate,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(shadow_trace)'));
    const normalize=({guid,entity,first,second,...row})=>row;assert.deepEqual(normalize(actual),normalize(original));
    const component=JSON.parse(evaluate(`return json.encode_compliant(WebComponents.Inspect(${actual.guid}))`));
    assert.equal(component.typeId,0x4a610c8d);assert.equal(component.textureHandle,native.shadow.components[0].textureHandle);assert.equal(component.staticHandle,native.shadow.components[0].staticHandle);assert.equal(component.requestedTexture,'images/shadow.tex');assert.equal(component.rendererReady,false);
    const lifecycle=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${actual.guid}))`));
    for(const key of ['awake','canSleep','componentsAllowSleep'])assert.equal(lifecycle[key],native.shadow.components[0][key]);
    assert.equal(assets.stats.fetches,0);assert.equal(evaluate('return WebComponents.Inspect().shadowManagers'),'1');
    assert.throws(()=>evaluate('WEB_SHADOW_FIXTURE.first:GenerateStaticShadows()'),/UNIMPLEMENTED_NATIVE: ShadowManager.GenerateStaticShadows/);
    evaluate('WEB_SHADOW_FIXTURE.entity:Remove()');assert.equal(evaluate('return WebComponents.Inspect().shadowManagers'),'0');
    assert.throws(()=>evaluate('WEB_SHADOW_FIXTURE.entity.entity:AddShadowManager()'),/removed entity/);
    assert.throws(()=>evaluate('WEB_SHADOW_FIXTURE.first:SetTexture("images/shadow.tex")'),/owner is removed/);assert.equal(evaluate('return 6*7'),'42');
    assert.equal(evaluate('return WebComponents.Inspect(0/0)'),'nil');assert.equal(evaluate('return WebComponents.Inspect(math.huge)'),'nil');
  }
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('WEB_CLIENT_COMPONENT=CreateEntity("client_shadow");WEB_CLIENT_COMPONENT.entity:AddShadowManager()'),/client ShadowManager renderer/);
  assert.equal(client.evaluate('return WebComponents.Inspect().shadowManagers'),'0');
});

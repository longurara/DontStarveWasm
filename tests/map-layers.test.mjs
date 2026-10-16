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
test('MapLayerManager copies native UV variants in XML order and matches per-owner handles, styles, colours and LIFO reuse',async t=>{
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_map_layer_component_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(hash(bytes),memory.mapLayerManager.traceSha256);const native=memory.mapLayerManager.state;
  assert.equal(native.sharedComponent,true);assert.ok(native.components.every(row=>row.typeFunction==='0x1400545d0'&&row.destroyFunction==='0x140054870'&&row.finalizeFunction==='0x14003d000'&&row.resourcesBound));
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- MAP_LAYER_COMPONENT_ORACLE_BEGIN')[1].split('-- MAP_LAYER_COMPONENT_ORACLE_END')[0];
  const normalized=({guid,first,second,globalGuid,globalManager,...row})=>row;
  for(const role of [1,2]){
    const {engine,evaluate,evaluateAsync,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());
    evaluate('json=require("json");TheGlobalInstance=CreateEntity("layer_global");MapLayerManager=TheGlobalInstance.entity:AddMapLayerManager();TheSim:RegisterPrefab("layer_atlases",{{type="ATLAS",file="levels/tiles/forest.xml"},{type="ATLAS",file="levels/tiles/grass.xml"}}, {})');
    await evaluateAsync('TheSim:LoadPrefabs({"layer_atlases"})');const fetches=assets.stats.fetches;
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(map_layer_trace)'));
    assert.deepEqual(normalized(actual),normalized(original));
    const state=JSON.parse(evaluate(`return json.encode_compliant(WebComponents.MapLayerManager(${actual.guid}))`));
    assert.equal(state.typeId,0xfe8cd8b8);assert.equal(state.rendererReady,false);
    assert.equal(state.sampleStyle,native.components[0].sampleStyle);assert.deepEqual(state.layers,native.components[0].layers);
    assert.equal(assets.stats.fetches,fetches);
    const lifecycle=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${actual.guid}))`));
    for(const key of ['awake','canSleep','componentsAllowSleep'])assert.equal(lifecycle[key],native.components[0][key]);
    // Layer UVs are copied, not references or extra leases on the atlas.
    evaluate('TheSim:UnloadPrefabs({"layer_atlases"})');
    assert.equal(evaluate('return WebAtlases.Inspect().atlases'),'0');
    assert.deepEqual(JSON.parse(evaluate(`return json.encode_compliant(WebComponents.MapLayerManager(${actual.guid}).layers)`)),state.layers);
    evaluate('WEB_MAP_LAYER_FIXTURE.entity:Remove();TheGlobalInstance:Remove()');
    for(const field of ['managers','layers','slots','retainedBytes'])assert.equal(evaluate(`return WebComponents.MapLayerManager().${field}`),'0');
    assert.throws(()=>evaluate('WEB_MAP_LAYER_FIXTURE.first:SetSampleStyle(0)'),/owner is removed/);
    assert.throws(()=>evaluate('WEB_MAP_LAYER_FIXTURE.entity.entity:AddMapLayerManager()'),/removed entity/);
  }
});
test('MapLayerManager guards missing atlases, unsafe names/handles and slot growth without committing failed records',async t=>{
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());
  engine.FS.mkdirTree('/layers');
  engine.FS.writeFile('/layers/valid.xml','<Atlas><Texture filename="unused.tex"/><Elements><Element name="18" u1=".1" v1=".2" u2=".3" v2=".4"/><Element name="17" u1="0" v1="0" u2="1" v2="1"/></Elements></Atlas>');
  engine.FS.writeFile('/layers/invalid.xml','<Atlas><Texture filename="unused.tex"/><Elements><Element name="0" u1="0" v1="0" u2="1" v2="1"/></Elements></Atlas>');
  evaluate('json=require("json");WEB_LAYER_SAFE=CreateEntity("layer_safe");WEB_LAYER_SAFE.entity:AddMapLayerManager()');
  assert.throws(()=>evaluate('WEB_LAYER_SAFE.MapLayerManager:CreateRenderLayer(1,"layers/valid.xml","x","y")'),/ATLAS must be loaded/);
  evaluate('TheSim:RegisterPrefab("test_layers",{{type="ATLAS",file="layers/valid.xml"},{type="ATLAS",file="layers/invalid.xml"}},{});TheSim:LoadPrefabs({"test_layers"})');
  assert.throws(()=>evaluate('WEB_LAYER_SAFE.MapLayerManager:CreateRenderLayer(1,"layers/invalid.xml","x","y")'),/element name outside/);
  assert.equal(evaluate('return WebComponents.MapLayerManager().slots'),'0');
  assert.equal(evaluate('return WebComponents.MapLayerManager().retainedBytes'),'0');
  assert.equal(evaluate('return WEB_LAYER_SAFE.MapLayerManager:CreateRenderLayer(1,"layers/valid.xml","x","y")'),'0');
  assert.equal(evaluate('return WebComponents.MapLayerManager(WEB_LAYER_SAFE.GUID).layers[1].uvCounts[17]'),'1');
  assert.equal(evaluate('return WebComponents.MapLayerManager(WEB_LAYER_SAFE.GUID).layers[1].shapeCount'),'2');
  for(const id of ['-2','1'])assert.throws(()=>evaluate(`WEB_LAYER_SAFE.MapLayerManager:ReleaseRenderLayer(${id})`),/invalid or released/);
  evaluate('WEB_LAYER_SAFE.MapLayerManager:ReleaseRenderLayer(0)');
  assert.throws(()=>evaluate('WEB_LAYER_SAFE.MapLayerManager:SetPrimaryColor(0,1,1,1,1)'),/invalid or released/);
  assert.throws(()=>evaluate('WEB_LAYER_SAFE.MapLayerManager:ReleaseRenderLayer(0)'),/invalid or released/);
  evaluate('for i=1,8192 do WEB_LAYER_SAFE.MapLayerManager:CreateRenderLayer(1,"layers/valid.xml","x","y")end');
  assert.throws(()=>evaluate('WEB_LAYER_SAFE.MapLayerManager:CreateRenderLayer(1,"layers/valid.xml","x","y")'),/slot count exceeds/);
  assert.equal(evaluate('return WebComponents.MapLayerManager(0/0)'),'nil');
  evaluate('WEB_LAYER_SAFE:Remove()');assert.equal(evaluate('return WebComponents.MapLayerManager().retainedBytes'),'0');
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('WEB_LAYER_CLIENT=CreateEntity("layer_client");WEB_LAYER_CLIENT.entity:AddMapLayerManager()'),/client MapLayerManager renderer/);
  assert.equal(client.evaluate('return WebComponents.MapLayerManager().managers'),'0');
});

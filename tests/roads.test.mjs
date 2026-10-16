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
const packed=points=>{const flat=points.flat(),bytes=Buffer.alloc(flat.length*4);flat.forEach((v,i)=>bytes.writeFloatLE(v,i*4));return bytes.toString('hex');};
test('RoadManager pending points, independent strip configurations and callbacks match native memory',async t=>{
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_road_component_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const native=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(hash(bytes),native.road.traceSha256);
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- ROAD_COMPONENT_ORACLE_BEGIN')[1].split('-- ROAD_COMPONENT_ORACLE_END')[0];
  const normalized=trace=>trace.cases.map(({guid,first,second,...row})=>row);
  for(const role of [1,2]){
    const {engine,evaluate,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(road_trace)'));
    assert.deepEqual(normalized(actual),normalized(original));
    assert.equal(evaluate('return WebComponents.Road().roadManagers'),'3');assert.equal(assets.stats.fetches,0);
    for(let i=0;i<actual.cases.length;++i){
      const row=native.road.components[i];assert.equal(row.sameComponent,true);
      assert.equal(row.typeFunction,'0x140056c20');assert.equal(row.finalizeFunction,'0x14003d000');
      const state=JSON.parse(evaluate(`return json.encode_compliant(WebComponents.Road(${actual.cases[i].guid}))`));
      assert.equal(state.typeId,0xdf2fd08d);assert.equal(state.roadIndex,row.roadIndex);
      assert.equal(state.hasQuadTree,row.hasQuadTree);assert.equal(state.rendererReady,false);
      assert.equal(packed(state.points),row.pointBits);
      assert.deepEqual(state.strips.map(r=>r.map(s=>s.wrap)),row.strips.map(r=>r.map(s=>s.wrap)));
      assert.deepEqual(state.strips.map(r=>r.map(s=>packed([s.uv]))),row.strips.map(r=>r.map(s=>s.uvBits)));
      const lifecycle=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${actual.cases[i].guid}))`));
      for(const field of ['awake','canSleep','componentsAllowSleep'])assert.equal(lifecycle[field],row[field]);
    }
    const before=evaluate('return json.encode_compliant(WebComponents.Road(WEB_ROAD_FIXTURE[3].entity.GUID))');
    for(const method of ['GenerateVB','GenerateQuadTree','AddSmoothedControlPoint','SetStripEffect','SetStripTextures'])
      assert.throws(()=>evaluate(`WEB_ROAD_FIXTURE[3].first:${method}()`),new RegExp('UNIMPLEMENTED_NATIVE: RoadManager.'+method));
    assert.equal(evaluate('return json.encode_compliant(WebComponents.Road(WEB_ROAD_FIXTURE[3].entity.GUID))'),before);
    assert.equal(evaluate('return tostring(WEB_ROAD_FIXTURE[3].second:IsOnRoad(0,0,0))'),'false');
    evaluate('for _,fixture in ipairs(WEB_ROAD_FIXTURE)do fixture.entity:Remove()end');
    assert.equal(evaluate('return WebComponents.Road().roadManagers'),'0');
    assert.equal(evaluate('return WebComponents.Road().totalPoints'),'0');
    assert.equal(evaluate('return WebComponents.Road().totalRoads'),'0');
    assert.throws(()=>evaluate('WEB_ROAD_FIXTURE[1].entity.entity:AddRoadManager()'),/removed entity/);
    assert.throws(()=>evaluate('WEB_ROAD_FIXTURE[1].first:BeginRoad()'),/owner is removed/);
  }
});
test('RoadManager adapter rejects unsafe indices, over-budget growth and unsupported client creation before mutation',async t=>{
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());
  evaluate('WEB_ROAD_SAFE=CreateEntity("safe_road");WEB_ROAD_SAFE.entity:AddRoadManager()');
  assert.throws(()=>evaluate('WEB_ROAD_SAFE.RoadManager:SetStripUVAnimStep(0,1,2)'),/requires BeginRoad/);
  evaluate('WEB_ROAD_SAFE.RoadManager:BeginRoad()');
  for(const index of ['-1','4','0/0','math.huge','2147483648'])
    assert.throws(()=>evaluate(`WEB_ROAD_SAFE.RoadManager:SetStripWrapMode(${index},1,2)`),/RoadManager/);
  assert.equal(evaluate('return WebComponents.Road(0/0)'),'nil');
  assert.equal(evaluate('return WebComponents.Road(math.huge)'),'nil');
  assert.equal(evaluate('return WebComponents.Road(WEB_ROAD_SAFE.GUID).strips[1][1].wrap[1]'),'0');
  evaluate('for i=2,4096 do WEB_ROAD_SAFE.RoadManager:BeginRoad()end;WEB_ROAD_SAFE.RoadManager:AddControlPoint(3,4)');
  assert.throws(()=>evaluate('WEB_ROAD_SAFE.RoadManager:BeginRoad()'),/road count exceeds budget/);
  assert.equal(evaluate('return WebComponents.Road(WEB_ROAD_SAFE.GUID).roadIndex'),'4095');
  assert.equal(evaluate('return WebComponents.Road(WEB_ROAD_SAFE.GUID).points[1][2]'),'4');
  evaluate('WEB_ROAD_SAFE:Remove()');assert.equal(evaluate('return WebComponents.Road().roadManagers'),'0');
  assert.equal(evaluate('return WebComponents.Road().totalPoints'),'0');
  assert.equal(evaluate('return WebComponents.Road().totalRoads'),'0');
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('WEB_ROAD_CLIENT=CreateEntity("road_client");WEB_ROAD_CLIENT.entity:AddRoadManager()'),/client RoadManager renderer/);
  assert.equal(client.evaluate('return WebComponents.Road().roadManagers'),'0');
});

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
test('PostProcessor shared uniform registration and partial float32 updates match native memory and original dedicated Lua helpers',async t=>{
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_postprocessor_component_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(hash(bytes),memory.postprocessor.traceSha256);const native=memory.postprocessor.state;
  assert.equal(native.sharedComponent,true);assert.equal(native.otherComponent,true);assert.equal(native.sharedBackend,true);
  assert.ok(native.components.every(row=>row.typeFunction==='0x1400a46c0'&&row.finalizeFunction==='0x14003d000'&&row.destroyFunction==='0x1400a49b0'));
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- POSTPROCESSOR_COMPONENT_ORACLE_BEGIN')[1].split('-- POSTPROCESSOR_COMPONENT_ORACLE_END')[0];
  const normalized=({guid,otherGuid,first,second,other,...row})=>row;
  for(const role of [1,2]){
    const {engine,evaluate,assets}=await loadEngine(role,{fullScripts:true});t.after(()=>engine._dst_close());
    evaluate('json=require("json");WEB_POST_GLOBAL=CreateEntity("post_global");PostProcessor=WEB_POST_GLOBAL.entity:AddPostProcessor();require("postprocesseffects")');
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(post_trace)'));
    assert.deepEqual(normalized(actual),normalized(original));
    for(const guid of [actual.guid,actual.otherGuid]){
      const state=JSON.parse(evaluate(`return json.encode_compliant(WebComponents.PostProcessor(${guid}))`));
      assert.equal(state.typeId,0xf1424772);assert.equal(state.enabled,native.enabled);assert.equal(state.rendererReady,false);
      assert.deepEqual(state.uniforms.map(({values,...row})=>row),native.uniforms.map(({vtable,previousBits,...row})=>row));
      assert.deepEqual(state.samplers,native.samplers.map(({vtable,...row})=>row));
      const lifecycle=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${guid}))`));
      for(const key of ['awake','canSleep','componentsAllowSleep'])assert.equal(lifecycle[key],native.components[0][key]);
    }
    assert.equal(assets.stats.fetches,0);
    const before=evaluate('return json.encode_compliant(WebComponents.PostProcessor())');
    for(const method of ['AddSamplerEffect','AddPostProcessEffect','SetEffectUniformVariables'])
      assert.throws(()=>evaluate(`WEB_POSTPROCESSOR_FIXTURE.first:${method}()`),new RegExp('UNIMPLEMENTED_NATIVE: PostProcessor.'+method));
    assert.equal(evaluate('return json.encode_compliant(WebComponents.PostProcessor())'),before);
    evaluate('WEB_POSTPROCESSOR_FIXTURE.entities[1]:Remove()');
    // Native component destructor forwards to global Clear (0x14001c860).
    // Retiring any owner clears shared state, including for live peers.
    assert.equal(evaluate('return WebComponents.PostProcessor().uniformCount'),'0');
    assert.equal(evaluate('return WebComponents.PostProcessor().samplerCount'),'0');
    evaluate('WEB_POSTPROCESSOR_FIXTURE.other:AddUniformVariable("after_clear",4)');
    assert.equal(evaluate('return WEB_POSTPROCESSOR_FIXTURE.other:AddTextureSampler("after_clear")'),'0');
    assert.equal(evaluate('return WebComponents.PostProcessor().uniformCount'),'1');
    assert.throws(()=>evaluate('WEB_POSTPROCESSOR_FIXTURE.first:SetPostProcessingEnabled(true)'),/owner is removed/);
    assert.throws(()=>evaluate('WEB_POSTPROCESSOR_FIXTURE.entities[1].entity:AddPostProcessor()'),/removed entity/);
    evaluate('WEB_POSTPROCESSOR_FIXTURE.entities[2]:Remove();WEB_POST_GLOBAL:Remove()');
    assert.equal(evaluate('return WebComponents.PostProcessor().managers'),'0');
    assert.equal(evaluate('return WebComponents.PostProcessor().uniformCount'),'0');
    assert.equal(evaluate('return WebComponents.PostProcessor().samplerCount'),'0');
  }
});
test('PostProcessor validates unsafe dimensions/value counts, bounds shared storage and rejects client renderer creation',async t=>{
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());
  evaluate('WEB_POST_SAFE=CreateEntity("post_safe");WEB_POST_SAFE.entity:AddPostProcessor()');
  assert.equal(evaluate('return tostring(WebComponents.PostProcessor().enabled)'),'true');
  for(const dimension of ['0','5','-1','0/0','math.huge','{}'])
    assert.throws(()=>evaluate(`WEB_POST_SAFE.PostProcessor:AddUniformVariable("unsafe",${dimension})`));
  assert.equal(evaluate('return WebComponents.PostProcessor().uniformCount'),'0');
  evaluate('WEB_POST_ID=WEB_POST_SAFE.PostProcessor:AddUniformVariable("safe",1)');
  assert.throws(()=>evaluate('WEB_POST_SAFE.PostProcessor:SetUniformVariable(WEB_POST_ID,1,2)'),/exceeds declared dimensions/);
  assert.equal(evaluate('return WebComponents.PostProcessor().uniforms[1].values[1]'),'0');
  evaluate('WEB_POST_SAFE.PostProcessor:SetUniformVariable(WEB_POST_ID,1,false,{},nil)');
  assert.equal(evaluate('return WebComponents.PostProcessor().uniforms[1].values[1]'),'1');
  assert.equal(evaluate('return WebComponents.PostProcessor(0/0)'),'nil');assert.equal(evaluate('return WebComponents.PostProcessor(math.huge)'),'nil');
  evaluate('for i=1,8191 do WEB_POST_SAFE.PostProcessor:AddUniformVariable("budget_"..i,1)end');
  assert.throws(()=>evaluate('WEB_POST_SAFE.PostProcessor:AddUniformVariable("overflow",1)'),/count exceeds budget/);
  evaluate('WEB_POST_SAFE.PostProcessor:AddUniformVariable("SAFE",4)');
  assert.equal(evaluate('return WebComponents.PostProcessor().uniformCount'),'8192');
  evaluate('WEB_POST_SAFE:Remove()');assert.equal(evaluate('return WebComponents.PostProcessor().uniformCount'),'0');
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('WEB_POST_CLIENT=CreateEntity("post_client");WEB_POST_CLIENT.entity:AddPostProcessor()'),/client PostProcessor render graph/);
  assert.equal(client.evaluate('return WebComponents.PostProcessor().managers'),'0');
});
test('PostProcessor sampler defaults, missing-ID validation and budget keep shared state consistent',async t=>{
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());
  evaluate('json=require("json");WEB_POST_SAMPLER=CreateEntity("sampler_safe");WEB_POST_SAMPLER.entity:AddPostProcessor()');
  assert.equal(evaluate('return WEB_POST_SAMPLER.PostProcessor:AddTextureSampler("absent")'),'0');
  const before=evaluate('return json.encode_compliant(WebComponents.PostProcessor())');
  assert.throws(()=>evaluate('WEB_POST_SAMPLER.PostProcessor:SetTextureSamplerFilter(0,1,nil,2)'),/number/);
  assert.throws(()=>evaluate('WEB_POST_SAMPLER.PostProcessor:SetTextureSamplerState(999,false)'),/number/);
  assert.throws(()=>evaluate('WEB_POST_SAMPLER.PostProcessor:SetTextureSampler(999,false)'),/string/);
  assert.equal(evaluate('return json.encode_compliant(WebComponents.PostProcessor())'),before);
  evaluate('WEB_POST_SAMPLER.PostProcessor:SetTextureSamplerState(999,1);WEB_POST_SAMPLER.PostProcessor:SetTextureSamplerFilter(999,1,2,3)');
  assert.equal(evaluate('return json.encode_compliant(WebComponents.PostProcessor())'),before);
  evaluate('for i=2,8192 do WEB_POST_SAMPLER.PostProcessor:AddTextureSampler("same")end');
  assert.throws(()=>evaluate('WEB_POST_SAMPLER.PostProcessor:AddTextureSampler("over")'),/sampler count exceeds budget/);
  assert.equal(evaluate('return WebComponents.PostProcessor().samplerCount'),'8192');
  evaluate('WEB_POST_SAMPLER:Remove()');assert.equal(evaluate('return WebComponents.PostProcessor().samplerCount'),'0');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('DYNAMIC_ANIM metadata/geometry and deferred textures agree with native and independent parser',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.resourceCaptureError,null);
  const checked=async path=>{const bytes=await readFile(new URL('../'+path,import.meta.url));const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;};
  const native=JSON.parse(await checked('output/native-reference/resource-managers.json'));
  const trace=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_asset_trace');assert.equal(hash(trace),native.traceSha256);
  const clips=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(trace))).dynamicClips;
  const catalog=JSON.parse(await readFile(new URL('../output/animation-catalog.json',import.meta.url)));
  assert.equal(catalog.generatorSha256,hash(await readFile(new URL('../tools/animation_catalog.py',import.meta.url))));
  assert.equal(catalog.decoderSha256,hash(await readFile(new URL('../tools/assets.py',import.meta.url))));
  assert.equal(catalog.archiveSha256,hash(await readFile(new URL('../../'+catalog.source,import.meta.url))));
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());evaluate('json=require("json")');
  for(const [i,row] of catalog.cases.entries()){
    const bytes=await readFile(new URL('../output/'+row.fixture,import.meta.url));assert.equal(hash(bytes),row.sha256);
    const path='/'+row.path;engine.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));engine.FS.writeFile(path,bytes);
    evaluate(`TheSim:RegisterPrefab("dynamic_${i}",{{type="DYNAMIC_ANIM",file=${JSON.stringify(row.path)}}},{});TheSim:LoadPrefabs({"dynamic_${i}"})`);
    const value=JSON.parse(evaluate(`return json.encode_compliant(WebAssets.Inspect(${JSON.stringify(row.path)}))`));
    for(const key of ['build','declaredTextures','symbols','vertices','frames','elements','clips','vertexSha256','symbolFrameSha256','elementSha256','eventSha256'])assert.deepEqual(value[key],row[key],row.path+': '+key);
    assert.equal(value.sourceSha256,row.sha256);assert.equal(value.texturesDeferred,true);assert.equal(value.textures,0);assert.equal(value.rendererReady,false);
    if(i===0){
      assert.equal(native.dynamicAnimations.length,1);const original=native.dynamicAnimations[0];
      for(const key of ['build','frames','elements'])assert.equal(value[key],original[key]);assert.equal(value.clips.length,original.clips);
      assert.equal(original.sha256,row.sha256);assert.equal(original.archiveSha256,catalog.archiveSha256);assert.equal(original.textureLoaded,false);assert.deepEqual(original.textureHandles,[-1]);assert.deepEqual(original.atlases,['atlas-0.tex']);
      for(const clip of clips){const actual=value.clips.find(value=>value.name===clip.name);assert.equal(actual.frames,clip.frames);assert.ok(Math.abs(Math.fround(actual.frames/actual.rate)-clip.length)<1e-12,'original JSON encoder rounds decimal trace text');}
      // Generic cache hits preserve the first load mode, even an ANIM alias.
      evaluate(`TheSim:RegisterPrefab("alias",{{type="ANIM",file=${JSON.stringify(row.path.toUpperCase())}}},{});TheSim:LoadPrefabs({"alias"})`);
      assert.equal(evaluate(`return tostring(WebAssets.Inspect(${JSON.stringify(row.path)}).texturesDeferred)`),'true');evaluate('TheSim:UnloadPrefabs({"alias"})');
    }
    evaluate(`TheSim:UnloadPrefabs({"dynamic_${i}"})`);engine.FS.unlink(path);assert.equal(evaluate('return WebAssets.Inspect().retainedBytes'),'0');
    // An ordinary bundle cannot silently accept its missing KTEX payload.
    engine.FS.writeFile(path,bytes);assert.throws(()=>evaluate(`WebAssets.Decode(${JSON.stringify(row.path)})`),/missing KTEX/);engine.FS.unlink(path);
  }
});

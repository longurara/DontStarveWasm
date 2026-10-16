import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(path){
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));assert.equal(report.oracleComplete,true);assert.equal(report.resourceCaptureError,null);
  const bytes=await readFile(new URL('../'+path,import.meta.url));const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;
}
test('fixed native asset kinds filter unknown metadata and normalize numeric parameters on all roles',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/asset-type-catalog.json',import.meta.url)));
  assert.equal(catalog.generatorSha256,hash(await readFile(new URL('../tools/asset_type_catalog.py',import.meta.url))));assert.equal(catalog.cases.length,2);
  for(const row of catalog.cases){assert.equal(hash(await readFile(new URL('../../'+row.executable,import.meta.url))),row.sha256);assert.deepEqual(row.rows,catalog.cases[0].rows);}
  const native=JSON.parse(await fixture('output/native-reference/resource-managers.json'));
  const source=await readFile(new URL('../tools/native_asset_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- ASSET_KIND_ORACLE_BEGIN')[1].split('-- ASSET_KIND_ORACLE_END')[0];
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await fixture('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_asset_kind_trace'))));
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());evaluate('json=require("json")');
    assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebPrefabs.Kinds())')),catalog.cases[0].rows);
    assert.deepEqual(JSON.parse(evaluate(block+'\nreturn json.encode_compliant(kind_trace)')),original);
    for(const row of native.prefabAssets){
      const actual=JSON.parse(evaluate(`return json.encode_compliant(WebPrefabs.NativeAssets(${JSON.stringify(row.name)}))`));
      assert.deepEqual(actual.map(row=>({...row,param:Math.fround(row.param)})),row.assets);
    }
    assert.equal(native.prefabAssets.find(row=>row.name==='web_native_asset_kinds').assets.length,14);
    assert.deepEqual(native.prefabAssets.find(row=>row.name==='web_native_ignored_asset_kinds').assets,[]);
    const ignored=JSON.parse(evaluate('return json.encode_compliant(WebPrefabs.IgnoredAssets("web_native_ignored_asset_kinds"))'));
    assert.deepEqual(ignored.map(row=>row.type),['MINIMAP_IMAGE','FILE ','WEB_UNRECOGNIZED_ASSET']);assert.ok(ignored.every(row=>row.reason==='unrecognized native asset kind'));
    assert.equal(evaluate('return WebAssets.Inspect().bundles'),'0');assert.equal(evaluate('return WebAtlases.Inspect().atlases'),'0');
    evaluate('TheSim:RegisterPrefab("known_unsupported",{{type="font",file="web_port/missing_font"}}, {})');
    assert.throws(()=>evaluate('TheSim:LoadPrefabs({"known_unsupported"})'),/ASYNC_RESOURCE_REQUIRED|client font texture backend/,'recognized kinds must attempt their backend rather than being dropped');
  }
});
test('AtlasContains matches native StringID and loaded-only lookup without fetching textures',async t=>{
  const bytes=await fixture('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_atlas_query_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const source=await readFile(new URL('../tools/native_asset_trace.lua',import.meta.url),'utf8');const block=source.split('-- ATLAS_QUERY_ORACLE_BEGIN')[1].split('-- ATLAS_QUERY_ORACLE_END')[0];
  for(const role of [0,1,2]){
    const {engine,evaluate,evaluateAsync,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
    assert.equal(evaluate('return tostring(TheSim:AtlasContains("images/global.xml","square.tex"))'),'false');assert.equal(assets.stats.fetches,0);
    evaluate('TheSim:RegisterPrefab("atlas_query",{{type="DYNAMIC_ATLAS",file="images/global.xml"}}, {})');await evaluateAsync('TheSim:LoadPrefabs({"atlas_query"})');
    const fetches=assets.stats.fetches;const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(atlas_query)'));assert.deepEqual(actual,original);
    assert.equal(assets.stats.fetches,fetches);assert.equal(evaluate('return tostring(WebAtlases.Inspect("images/global.xml").textureLoaded)'),'false');assert.equal(evaluate('return WebTextures.Inspect().textures'),'0');
    evaluate('TheSim:UnloadPrefabs({"atlas_query"})');assert.equal(evaluate('return tostring(TheSim:AtlasContains("images/global.xml","square.tex"))'),'false');
  }
});

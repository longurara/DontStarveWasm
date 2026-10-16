import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const inspect=(evaluate,path)=>JSON.parse(evaluate(`return json.encode_compliant(WebShaders.Inspect(${path?JSON.stringify(path):''}))`));

test('all 68 KSH containers preserve uniforms, defaults, GLSL and stage bindings against independent parser',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/shader-catalog.json',import.meta.url)));
  assert.equal(catalog.cases.length,68);assert.equal(catalog.gameBuild,'756039');
  assert.equal(digest(await readFile(new URL('../../data/databundles/shaders.zip',import.meta.url))),catalog.archiveSha256);
  assert.equal(digest(await readFile(new URL('../tools/shader_catalog.py',import.meta.url))),catalog.generatorSha256);
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/shaders');
  for(const row of catalog.cases){
    const bytes=await readFile(new URL('../output/'+row.input,import.meta.url));assert.equal(digest(bytes),row.sha256);engine.FS.writeFile('/'+row.path,bytes);
    evaluate(`WebShaders.Decode(${JSON.stringify(row.path)})`);const value=inspect(evaluate,row.path);
    assert.equal(value.name,row.name,row.path);assert.equal(value.sourceSha256,row.sha256);assert.deepEqual(value.uniforms,row.uniforms,row.path);
    assert.deepEqual(value.stages,row.stages.map(stage=>({...stage,source:stage.source.slice(0,-1),sourceBytes:Buffer.byteLength(stage.source),terminated:true})),row.path);
    assert.equal(value.programReady,false);assert.equal(value.rendererReady,false);
    evaluate(`WebShaders.Release(${JSON.stringify(row.path)})`);engine.FS.unlink('/'+row.path);
  }
  assert.equal(inspect(evaluate).retainedBytes,0);
});

test('headless shader leases match native deferred source bytes and unload without GPU calls',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.resourceCaptureError,null);
  const path='output/native-reference/resource-managers.json',bytes=await readFile(new URL('../'+path,import.meta.url));
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.equal(digest(bytes),report.fixtureSha256[key]);
  const native=JSON.parse(bytes);assert.ok(native.shaders.length>=3);
  assert.equal(digest(await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_asset_trace',import.meta.url))),native.traceSha256);
  const {engine,evaluate,evaluateAsync,assets}=await loadEngine(1,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
  engine.compileNativeShader=()=>{throw new Error('headless must not invoke GPU backend');};
  for(const [i,row] of native.shaders.entries()){
    assert.equal(row.deferred,true);assert.equal(row.name,'');assert.equal(row.uniforms.length,0);assert.equal(row.sourceSha256,assets.index.files[row.path].sha256);assert.equal(row.sourceBytes,assets.index.files[row.path].bytes);
    evaluate(`TheSim:RegisterPrefab("shader_native_${i}",{{type="SHADER",file=${JSON.stringify(row.path)}}},{})`);
    await evaluateAsync(`TheSim:LoadPrefabs({"shader_native_${i}"});TheSim:LoadPrefabs({"shader_native_${i}"})`);
    const value=inspect(evaluate,row.path);assert.equal(value.sourceSha256,row.sourceSha256);assert.equal(value.references,1);assert.equal(value.programReady,false);
    assert.throws(()=>engine.FS.stat('/'+row.path));assert.throws(()=>evaluate(`WebShaders.Release(${JSON.stringify(row.path)})`),/owned by loaded prefabs/);
    evaluate(`TheSim:UnloadPrefabs({"shader_native_${i}"})`);assert.equal(inspect(evaluate,row.path).references,1);
    evaluate(`TheSim:UnloadPrefabs({"shader_native_${i}"})`);assert.equal(inspect(evaluate).shaders,0);
  }
});

test('malformed KSH and GPU compile errors rollback mixed resources and preserve a usable VM',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/shader-catalog.json',import.meta.url))),row=catalog.cases.find(row=>row.name==='ui');
  const original=Buffer.from(await readFile(new URL('../output/'+row.input,import.meta.url)));
  const {engine,evaluate,evaluateAsync}=await loadEngine(0);t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/fixture');
  const namePosition=original.indexOf('MatrixPVW'),kindPosition=namePosition+'MatrixPVW'.length+4;
  const mutate=(position,value)=>{const bytes=Buffer.from(original);bytes.writeUInt32LE(value,position);return bytes;};
  const sourcePosition=original.indexOf('uniform mat4 MatrixPVW;');const brokenSource=Buffer.from(original);brokenSource[sourcePosition+10]=0;
  const invalid=[Buffer.alloc(0),original.subarray(0,40),Buffer.concat([original,Buffer.of(1)]),mutate(4+row.name.length,0xffffffff),mutate(kindPosition,999),mutate(kindPosition+4,0),mutate(kindPosition+8,0xffffffff),mutate(kindPosition+12,0x7f800000),mutate(original.length-4,0xffffffff),brokenSource];
  for(const [i,bytes] of invalid.entries()){
    engine.FS.writeFile(`/fixture/bad_${i}`,bytes);assert.throws(()=>evaluate(`WebShaders.Decode("fixture/bad_${i}")`),/KSH/);
    assert.equal(inspect(evaluate).shaders,0);assert.equal(evaluate('return 6*7'),'42');
  }
  engine.FS.writeFile('/fixture/ui.ksh',original);engine.FS.writeFile('/fixture/data',Uint8Array.of(1,2,3));
  evaluate('TheSim:RegisterPrefab("missing_backend",{{type="SHADER",file="fixture/ui.ksh"}},{})');
  assert.throws(()=>evaluate('TheSim:LoadPrefabs({"missing_backend"})'),/client shader backend/);
  const programs=new Set(),flags=[];engine.nativeShaderBackendReady=()=>true;
  engine.compileNativeShader=(id,vertex,fragment,path,fallback)=>{flags.push(fallback);if(path.includes('fail'))throw new Error('injected GPU compile failure');programs.add(id);};engine.releaseNativeShader=id=>programs.delete(id);
  engine.FS.writeFile('/fixture/fail.ksh',original);
  evaluate('TheSim:RegisterPrefab("mixed",{{type="FILE",file="fixture/data"},{type="SHADER",file="fixture/ui.ksh"},{type="SHADER",file="fixture/fail.ksh",param=1}},{})');
  await assert.rejects(evaluateAsync('TheSim:LoadPrefabs({"mixed"})'),/injected GPU compile failure/);
  assert.deepEqual(flags,[false,true]);assert.equal(programs.size,0);assert.equal(inspect(evaluate).retainedBytes,0);assert.equal(evaluate('return WebFileAssets.Inspect().files'),'0');
  evaluate('TheSim:LoadPrefabs({"missing_backend"})');assert.equal(inspect(evaluate,'fixture/ui.ksh').programReady,true);
  evaluate('TheSim:UnloadPrefabs({"missing_backend"})');assert.equal(programs.size,0);assert.equal(inspect(evaluate).retainedBytes,0);
});

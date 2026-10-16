import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inspect=(evaluate,path)=>JSON.parse(evaluate(`return json.encode_compliant(WebAtlases.Inspect(${path?JSON.stringify(path):''}))`));

test('C++ ATLAS UV/StringID records match read-only native memory and preserve prefab ownership',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.resourceCaptureError,null);
  const path='output/native-reference/resource-managers.json',bytes=await readFile(new URL('../'+path,import.meta.url));
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);
  const native=JSON.parse(bytes);
  const trace=await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_asset_trace',import.meta.url));assert.equal(hash(trace),native.traceSha256);
  assert.ok(native.atlases.length>=7,'capture must include all five original atlases with duplicate IDs');
  const {engine,evaluate,evaluateAsync,assets}=await loadEngine(1,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
  for(const [i,atlas] of native.atlases.entries()){
    assert.equal(atlas.textureHandle,-1,'dedicated texture manager returns -1 without loading pixels');assert.equal(atlas.textureLoaded,atlas.path!=='images/fepanels.xml');
    const type=atlas.textureLoaded?'ATLAS':'DYNAMIC_ATLAS';
    const name='atlas_native_'+i;evaluate(`TheSim:RegisterPrefab("${name}",{{type="${type}",file=${JSON.stringify(atlas.path)}},{type="IMAGE",file="web_port/intentionally_absent.tex"}},{})`);
    await evaluateAsync(`TheSim:LoadPrefabs({"${name}"});TheSim:LoadPrefabs({"${name}"})`);
    const value=inspect(evaluate,atlas.path);assert.equal(value.rendererReady,false);assert.equal(value.references,1);
    assert.equal(value.textureLoaded,atlas.textureLoaded);assert.equal(value.deferred,!atlas.textureLoaded);
    assert.deepEqual(value.elements.map(({name,...row})=>row),atlas.entries);
    assert.throws(()=>engine.FS.stat('/'+atlas.path));
    assert.throws(()=>evaluate(`WebAtlases.Release(${JSON.stringify(atlas.path)})`),/owned by loaded prefabs/);
    evaluate(`TheSim:UnloadPrefabs({"${name}"})`);assert.equal(inspect(evaluate,atlas.path).references,1);
    evaluate(`TheSim:UnloadPrefabs({"${name}"})`);assert.equal(inspect(evaluate).atlases,0);
  }
  assert.ok(assets.stats.cacheBytes<=32*1024*1024);
});

test('all original Atlas XMLs match independent ElementTree/float32 catalog',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/atlas-catalog.json',import.meta.url)));
  const {engine,evaluate,manifest}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  assert.equal(catalog.gameBuild,'756039');assert.equal(catalog.resourceIndexSha256,manifest.resources.sha256);
  assert.equal(catalog.generatorSha256,hash(await readFile(new URL('../tools/atlas_catalog.py',import.meta.url))));
  assert.equal(catalog.cases.length,1412);
  for(const row of catalog.cases){
    const bytes=await readFile(new URL('../output/'+row.xml,import.meta.url));assert.equal(hash(bytes),row.sha256);
    const path='/'+row.path;engine.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));engine.FS.writeFile(path,bytes);
    evaluate(`WebAtlases.Decode(${JSON.stringify(row.path)})`);
    const value=inspect(evaluate,row.path);
    const keys=['id','u1','v1','u2','v2'];
    const canonical=[...value.elements].sort((a,b)=>{for(const key of keys){if(a[key]!==b[key])return a[key]-b[key];}return 0;});
    assert.deepEqual(canonical,row.elements,row.path);assert.equal(value.texture,row.texture,row.path);
    const transcript=Buffer.concat(canonical.map(value=>{const bytes=Buffer.alloc(20);bytes.writeUInt32LE(value.id);keys.slice(1).forEach((key,i)=>bytes.writeFloatLE(value[key],4+i*4));return bytes;}));
    assert.equal(hash(transcript),row.canonicalUvSha256,row.path);
    evaluate(`WebAtlases.Release(${JSON.stringify(row.path)})`);engine.FS.unlink(path);
  }
  assert.equal(inspect(evaluate).retainedBytes,0);
});

test('malformed XML and mixed atlas transactions fail without leaking resources or corrupting Lua',async t=>{
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/fixture');
  const good='<Atlas><Texture filename="ok.tex"/><Elements><Element name="a&amp;b.tex" u1="0" v1="0" u2="1" v2="1"/></Elements></Atlas>';
  const invalid=['',good.slice(0,-8),good.replace('</Elements>','</Wrong>'),good.replace('u1="0"','u1="nan"'),good.replace(' v1="0"',''),good.replace('ok.tex','../outside.tex'),'<!DOCTYPE Atlas>'+good,'<a>'.repeat(40)+good+'</a>'.repeat(40),'<Atlas>\0</Atlas>'];
  for(const [i,xml] of invalid.entries()){
    const path=`fixture/bad_${i}.xml`;engine.FS.writeFile('/'+path,new TextEncoder().encode(xml));
    assert.throws(()=>evaluate(`WebAtlases.Decode("${path}")`),/ATLAS/);assert.equal(inspect(evaluate).atlases,0);assert.equal(evaluate('return 6*7'),'42');
  }
  const oversizedDom='<Atlas><Texture filename="ok.tex"/><Elements>'+('<Element name="a" u1="0" v1="0" u2="1" v2="1"/>'.repeat(130000))+'</Elements></Atlas>';
  assert.ok(oversizedDom.length<8*1024*1024,'exercise the DOM allocation budget independently of the byte limit');
  engine.FS.writeFile('/fixture/large.xml',new TextEncoder().encode(oversizedDom));
  assert.throws(()=>evaluate('WebAtlases.Decode("fixture/large.xml")'),/XML allocation budget exceeded/);
  assert.equal(inspect(evaluate).retainedBytes,0);assert.equal(evaluate('return 6*7'),'42');engine.FS.unlink('/fixture/large.xml');
  engine.FS.writeFile('/fixture/good.xml',new TextEncoder().encode(good));
  evaluate('TheSim:RegisterPrefab("mixed",{{type="ATLAS",file="fixture/good.xml"},{type="FILE",file="fixture/missing"}},{})');
  assert.throws(()=>evaluate('TheSim:LoadPrefabs({"mixed"})'),/ASYNC_RESOURCE_REQUIRED/);assert.equal(inspect(evaluate).atlases,0);
  evaluate('TheSim:RegisterPrefab("valid",{{type="ATLAS",file="fixture/good.xml"}},{})');evaluate('TheSim:LoadPrefabs({"valid"})');
  assert.equal(inspect(evaluate,'fixture/good.xml').elements[0].name,'a&b.tex');evaluate('TheSim:UnloadPrefabs({"valid"})');assert.equal(inspect(evaluate).retainedBytes,0);
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  client.evaluate('TheSim:RegisterPrefab("client_atlas",{{type="ATLAS",file="fixture/missing.xml"}},{})');
  assert.throws(()=>client.evaluate('TheSim:LoadPrefabs({"client_atlas"})'),/client atlas texture upload/);
  client.evaluate('TheSim:RegisterPrefab("client_image",{{type="IMAGE",file="fixture/missing.tex"}},{})');
  assert.throws(()=>client.evaluate('TheSim:LoadPrefabs({"client_image"})'),/UNIMPLEMENTED_NATIVE/);
});

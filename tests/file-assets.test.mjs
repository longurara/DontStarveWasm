import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const info=(evaluate,path)=>JSON.parse(evaluate(`return json.encode_compliant(WebFileAssets.Inspect(${path?JSON.stringify(path):''}))`));
function register(evaluate,name,assets,deps=[]){
  const rows=assets.map(([type,file])=>`{type=${JSON.stringify(type)},file=${JSON.stringify(file)}}`);
  evaluate(`TheSim:RegisterPrefab(${JSON.stringify(name)},{${rows.join(',')}},{${deps.map(name=>JSON.stringify(name)).join(',')}})`);
}

test('FILE preserves bytes and native NUL terminator through verified packs in client and server',async t=>{
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.resourceCaptureError,null);
  const path='output/native-reference/resource-managers.json',bytes=await readFile(new URL('../'+path,import.meta.url));
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
  assert.equal(hash(bytes),report.fixtureSha256[key]);
  const memory=JSON.parse(bytes);
  const trace=await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_asset_trace',import.meta.url));
  assert.equal(hash(trace),memory.traceSha256);assert.equal(memory.executableSha256,report.sourceSha256['bin64\\dontstarve_dedicated_server_nullrenderer_x64.exe']);
  assert.equal(memory.managers.file.methods['1'],'0x14000f760');
  assert.equal(memory.file.matchesSource,true);assert.equal(memory.file.terminated,true);
  assert.equal(hash(await readFile(new URL('../../data/databundles/klump.zip',import.meta.url))),memory.file.sourceArchiveSha256);
  for(const role of [0,1,2]){
    const {engine,evaluate,evaluateAsync,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());
    evaluate('json=require("json")');const file=memory.file.path;
    assert.equal(assets.index.files[file].sha256,memory.file.sha256);
    assert.equal(assets.index.files[file].bytes,memory.file.bytes);
    register(evaluate,'raw_source',[['FILE',file],['FILE','sound/intentionally_missing.fsb']]);
    assert.throws(()=>evaluate('TheSim:LoadPrefabs({"raw_source"})'),/ASYNC_RESOURCE_REQUIRED/);
    assert.equal(info(evaluate).files,0);
    await evaluateAsync('TheSim:LoadPrefabs({"raw_source"});TheSim:LoadPrefabs({"raw_source"})');
    const actual=info(evaluate,file);
    assert.equal(actual.bytes,memory.file.bytes);assert.equal(actual.sha256,memory.file.sha256);assert.equal(actual.terminated,memory.file.terminated);assert.equal(actual.references,1);
    assert.equal(evaluate('return WebPrefabs.Loaded().raw_source'),'2');
    assert.throws(()=>engine.FS.stat('/'+file),'downloaded source must not accumulate in MEMFS');
    evaluate('TheSim:UnloadPrefabs({"raw_source"})');assert.deepEqual(info(evaluate,file),actual);
    evaluate('TheSim:UnloadPrefabs({"raw_source"})');assert.equal(info(evaluate).files,0);assert.equal(info(evaluate).retainedBytes,0);
  }
});

test('shared FILE dependencies, binary/empty content and mixed ANIM rollback keep ownership consistent',async t=>{
  const {engine,evaluate,evaluateAsync}=await loadEngine(1);t.after(()=>engine._dst_close());evaluate('json=require("json")');
  engine.FS.mkdirTree('/fixture');
  const binary=Uint8Array.of(0,1,0,255,128,65);engine.FS.writeFile('/fixture/binary',binary);engine.FS.writeFile('/fixture/empty',new Uint8Array());
  register(evaluate,'shared',[['FILE','fixture/binary'],['FILE','fixture/empty']]);
  register(evaluate,'root_a',[],['shared']);register(evaluate,'root_b',[],['shared']);
  evaluate('TheSim:LoadPrefabs({"root_a","root_b"})');
  assert.equal(evaluate('return WebPrefabs.Loaded().shared'),'2');
  assert.equal(info(evaluate,'fixture/binary').references,1);assert.equal(info(evaluate,'fixture/binary').sha256,hash(binary));
  register(evaluate,'case_alias',[['FILE','FIXTURE/BINARY']]);
  evaluate('TheSim:LoadPrefabs({"case_alias"})');
  assert.equal(info(evaluate).files,2,'native StringID cache reuses a loaded path without new I/O');
  assert.equal(info(evaluate,'fixture/binary').references,2);assert.equal(info(evaluate,'FIXTURE/BINARY').sha256,hash(binary));
  evaluate('TheSim:UnloadPrefabs({"case_alias"})');
  assert.equal(info(evaluate,'fixture/empty').bytes,0);assert.equal(info(evaluate,'fixture/empty').sha256,hash(new Uint8Array()));
  evaluate('TheSim:UnloadPrefabs({"root_b"})');assert.equal(info(evaluate).files,2);
  register(evaluate,'mixed_failure',[['FILE','fixture/binary'],['FILE','fixture/empty'],['ANIM','fixture/invalid.zip']]);
  engine.FS.writeFile('/fixture/invalid.zip',Uint8Array.of(1,2,3));
  const before=info(evaluate);
  await assert.rejects(evaluateAsync('TheSim:LoadPrefabs({"mixed_failure"})'),/Truncated asset ZIP/);
  assert.deepEqual(info(evaluate),before);assert.equal(info(evaluate,'fixture/binary').references,1);
  assert.equal(evaluate('return tostring(WebPrefabs.Loaded().mixed_failure)'),'nil');
  register(evaluate,'raw_failure',[['ANIM','anim/wilson.zip'],['FILE','fixture/absent']]);
  engine.FS.mkdirTree('/anim');engine.FS.writeFile('/anim/wilson.zip',await readFile(new URL('../../data/anim/wilson.zip',import.meta.url)));
  await assert.rejects(evaluateAsync('TheSim:LoadPrefabs({"raw_failure"})'),/Resource adapter is not installed/);
  assert.equal(evaluate('return WebAssets.Inspect().bundles'),'0');
  evaluate('TheSim:UnloadPrefabs({"root_a"})');assert.equal(info(evaluate).files,0);
  assert.deepEqual(engine.FS.readFile('/fixture/binary'),binary,'caller-owned files remain available');
});

test('FILE ownership budget rejects a transaction and frees all earlier leases for retry',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/fixture');
  const block=new Uint8Array(1024*1024).fill(37),assets=[];
  for(let i=0;i<34;++i){const path=`fixture/budget_${i}`;engine.FS.writeFile('/'+path,block);assets.push(['FILE',path]);}
  register(evaluate,'oversize',assets);
  assert.throws(()=>evaluate('TheSim:LoadPrefabs({"oversize"})',20000000),/FILE asset memory budget exceeded/);
  assert.equal(info(evaluate).files,0);assert.equal(info(evaluate).retainedBytes,0);assert.equal(evaluate('return tostring(WebPrefabs.Loaded().oversize)'),'nil');
  register(evaluate,'retry',assets.slice(0,1));evaluate('TheSim:LoadPrefabs({"retry"})');
  assert.equal(info(evaluate).files,1);assert.ok(info(evaluate).retainedBytes<=info(evaluate).budget);
  evaluate('TheSim:UnloadPrefabs({"retry"})');assert.equal(info(evaluate).retainedBytes,0);
});

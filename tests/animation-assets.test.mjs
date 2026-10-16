import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const scalar=(number,kind='float')=>{const bytes=Buffer.alloc(4);kind==='float'?bytes.writeFloatLE(number):bytes.writeUInt32LE(number);return bytes;};
const stats=evaluate=>JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect())'));
async function oracle(){
  const path='output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_asset_trace';
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true,'capture_native.py must finish all current oracle scripts');
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);
  assert.equal(digest(bytes),report.fixtureSha256[key]);
  return JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
}

test('WASM ZIP/BILD/ANIM parsing matches independent geometry and native animation lengths; prefab leases release',async t=>{
  const native=await oracle();
  const model=JSON.parse(await readFile(new URL('../public/generated/preview/wilson.json',import.meta.url)));
  const motion=JSON.parse(await readFile(new URL('../public/generated/preview/player_basic.json',import.meta.url)));
  const provenance=JSON.parse(await readFile(new URL('../public/generated/preview/provenance.json',import.meta.url)));
  const {engine,evaluate,evaluateAsync,assets}=await loadEngine(1,{resources:true});t.after(()=>engine._dst_close());
  evaluate('json=require("json")');
  for(const file of ['wilson.zip','player_basic.zip']){
    const key=Object.keys(provenance).find(key=>key.replaceAll('\\','/').endsWith('/'+file));
    assert.equal(assets.index.files['anim/'+file].sha256,provenance[key]);
  }
  const source=await readFile(new URL('../tools/native_asset_trace.lua',import.meta.url),'utf8');
  const prefix=source.slice(0,source.indexOf('local actor=CreateEntity'));
  assert.throws(()=>evaluate(prefix),/ASYNC_RESOURCE_REQUIRED/);
  const returns=JSON.parse(await evaluateAsync(prefix+';WEB_NATIVE_ASSET_NAME=name;return json.encode_compliant(asset_trace)',20000000));
  assert.deepEqual(returns.order,native.order);
  for(const key of ['register','first','second','caseRegister','caseLoad','caseUnload','dynamicCaseRegister','dynamicCaseLoad','dynamicCaseUnload'])assert.deepEqual(returns.returns[key],native.returns[key]);
  const build=JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect("anim/wilson.zip"))'));
  const animation=JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect("anim/player_basic.zip"))'));
  assert.equal(build.build,model.name);assert.equal(build.symbols,Object.keys(model.symbols).length);assert.equal(build.vertices,model.vertices.length);
  assert.equal(build.textures,model.atlases.length);assert.equal(build.rendererReady,false);
  assert.equal(build.vertexSha256,digest(Buffer.concat(model.vertices.flatMap(vertex=>vertex.map(value=>scalar(value))))));
  const symbolBytes=[];
  for(const id of Object.keys(model.symbols).sort((a,b)=>Number(a)-Number(b))){
    const symbol=model.symbols[id];symbolBytes.push(scalar(Number(id),'uint'),scalar(symbol.frames.length,'uint'));
    for(const frame of symbol.frames)symbolBytes.push(scalar(frame.frame,'uint'),scalar(frame.duration,'uint'),...frame.bbox.map(value=>scalar(value)),scalar(frame.offset,'uint'),scalar(frame.count,'uint'));
  }
  assert.equal(build.symbolFrameSha256,digest(Buffer.concat(symbolBytes)));
  const elements=[],events=[];
  for(const clip of motion.animations)for(const frame of clip.frames){
    events.push(...frame.events.map(value=>scalar(value,'uint')));
    for(const item of frame.elements)elements.push(scalar(Number(item.symbol),'uint'),scalar(item.frame,'uint'),scalar(Number(item.layer),'uint'),...item.matrix.map(value=>scalar(value)),scalar(item.depth));
  }
  assert.equal(animation.elementSha256,digest(Buffer.concat(elements)));assert.equal(animation.eventSha256,digest(Buffer.concat(events)));
  assert.deepEqual(animation.clips,motion.animations.map(clip=>({name:clip.name,bank:Number(clip.bank),facing:clip.facing,frames:clip.frames.length,rate:clip.rate})));
  for(const clip of native.clips){
    const facings=animation.clips.filter(value=>value.name===clip.name);assert.ok(facings.length);
    for(const facing of facings){assert.equal(facing.frames,clip.frames);assert.ok(Math.abs(Math.fround(facing.frames/facing.rate)-clip.length)<1e-12);}
  }
  assert.equal(build.references,1);assert.equal(animation.references,1);assert.equal(evaluate('return WebPrefabs.Loaded()[WEB_NATIVE_ASSET_NAME]'),'2');
  assert.throws(()=>evaluate('WebAssets:Release("anim/wilson.zip")'));
  assert.throws(()=>evaluate('WebAssets.Release("anim/wilson.zip")'),/owned by loaded prefabs/);
  assert.equal(evaluate('return select("#",TheSim:UnloadPrefabs({WEB_NATIVE_ASSET_NAME}))'),String(native.returns.unloadFirst.length));
  assert.equal(stats(evaluate).bundles,3,'the first unload retains all three bundles for the second owner');
  evaluate('TheSim:UnloadPrefabs({WEB_NATIVE_ASSET_NAME})');assert.equal(stats(evaluate).retainedBytes,0);
  for(const file of ['wilson.zip','player_basic.zip'])assert.throws(()=>engine.FS.stat('/anim/'+file),'source archives must not stay in MEMFS after decoding');
  const packs=new Set(['anim/wilson.zip','anim/player_basic.zip','anim/dynamic/box_shared_spiral.zip','klump/strings/unused.txt','images/global.xml','images/fepanels.xml','shaders/anim_bloom.ksh'].flatMap(path=>assets.index.files[path].chunks.map(key=>assets.index.chunks[key].pack)));
  assert.ok(assets.stats.fetches<=packs.size);assert.ok(assets.stats.cacheBytes<=32*1024*1024);
  assert.equal(evaluate('return WebFileAssets.Inspect().files'),'0');
  assert.equal(evaluate('return WebAtlases.Inspect().atlases'),'0');
  assert.equal(evaluate('return WebShaders.Inspect().shaders'),'0');
});

test('malformed animation ZIP, binary versions, counts and KTEX fail without poisoning the VM/cache',async t=>{
  const {engine,evaluate,evaluateAsync}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/anim');
  const original=unzipSync(await readFile(new URL('../../data/anim/wilson.zip',import.meta.url)));
  const motion=unzipSync(await readFile(new URL('../../data/anim/player_basic.zip',import.meta.url)));
  const cases=[[new Uint8Array(),/Truncated asset ZIP/]];
  const version=original['build.bin'].slice();new DataView(version.buffer).setUint32(4,7,true);cases.push([zipSync({...original,'build.bin':version}),/BILD/]);
  const count=original['build.bin'].slice();new DataView(count.buffer).setUint32(8,0xffffffff,true);cases.push([zipSync({...original,'build.bin':count}),/BILD/]);
  cases.push([zipSync({...original,'build.bin':original['build.bin'].slice(0,-10)}),/BILD/]);
  const badAnim=motion['anim.bin'].slice();new DataView(badAnim.buffer).setUint32(4,5,true);cases.push([zipSync({'anim.bin':badAnim}),/ANIM/]);
  const atlas=Object.keys(original).find(name=>name.endsWith('.tex'));const image=original[atlas].slice();const view=new DataView(image.buffer);view.setUint32(4,(view.getUint32(4,true)&~(31<<4))|(3<<4),true);
  cases.push([zipSync({...original,[atlas]:image}),/KTEX/]);
  const crc=zipSync({'build.bin':original['build.bin']},{level:0});const header=new DataView(crc.buffer,crc.byteOffset,crc.byteLength);crc[30+header.getUint16(26,true)+header.getUint16(28,true)+12]^=1;cases.push([crc,/CRC/]);
  cases.push([zipSync({'../build.bin':original['build.bin']}),/ZIP path/]);
  cases.push([zipSync(original).slice(0,-4),/ZIP end/]);
  for(let i=0;i<cases.length;++i){
    engine.FS.writeFile('/anim/invalid'+i+'.zip',cases[i][0]);
    await assert.rejects(evaluateAsync(`WebAssets.Decode("anim/invalid${i}.zip")`),cases[i][1]);
    assert.equal(stats(evaluate).bundles,0);assert.equal(evaluate('return 6*7'),'42');
  }
  engine.FS.writeFile('/anim/valid.zip',zipSync(original));await evaluateAsync('WebAssets.Decode("anim/valid.zip")');
  evaluate('WebAssets.Release("anim/valid.zip")');assert.equal(stats(evaluate).retainedBytes,0);
});

test('Lua stack survives verified asynchronous resource I/O, rejects reentry and recovers from failed downloads',async t=>{
  const {engine,evaluate,evaluateAsync,assets}=await loadEngine(1,{resources:true});t.after(()=>engine._dst_close());
  let release,started;const gate=new Promise(resolve=>release=resolve),request=new Promise(resolve=>started=resolve);const fetch=engine.fetchNativeResource;
  engine.fetchNativeResource=async path=>{started();await gate;return fetch(path);};
  const pending=evaluateAsync('WEB_LOAD_COUNT=(WEB_LOAD_COUNT or 0)+1;local marker=41;WebAssets.Decode("anim/wilson.zip");return marker+1');
  await request;
  try{
    assert.throws(()=>evaluate('return 9'),/waiting for resource/);
    await assert.rejects(evaluateAsync('return 9'),/waiting for resource/);
    assert.equal(engine._dst_tick(1),1);assert.equal(engine._dst_init(1),1);engine._dst_close();
  }finally{release();}
  assert.equal(await pending,'42');assert.equal(evaluate('return WEB_LOAD_COUNT'),'1');
  evaluate('json=require("json");WebAssets.Release("anim/wilson.zip")');
  engine.fetchNativeResource=async()=>{throw new Error('injected download failure');};
  await assert.rejects(evaluateAsync('WebAssets.Decode("anim/player_basic.zip")'),/injected download failure/);
  assert.equal(stats(evaluate).bundles,0);
  engine.fetchNativeResource=fetch;
  const write=engine.FS.writeFile.bind(engine.FS);
  engine.FS.writeFile=(path,bytes)=>{write(path,bytes.slice(0,8));throw new Error('injected MEMFS write failure');};
  try{await assert.rejects(assets.materialize(engine,'anim/player_basic.zip'),/MEMFS write failure/);}
  finally{engine.FS.writeFile=write;}
  assert.throws(()=>engine.FS.stat('/anim/player_basic.zip'));assert.throws(()=>engine.FS.stat('/anim/player_basic.zip.download.pending'));
  await evaluateAsync('WebAssets.Decode("anim/player_basic.zip")');assert.equal(stats(evaluate).bundles,1);
});

test('unowned animation bundles evict under budget while active prefab ownership is protected and rollback frees it',async t=>{
  const {engine,evaluate,evaluateAsync}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/budget');
  const bytes=await readFile(new URL('../../data/anim/wilson.zip',import.meta.url));
  engine.FS.writeFile('/budget/wilson0.zip',bytes);await evaluateAsync('WebAssets.Decode("budget/wilson0.zip")');
  const first=JSON.parse(evaluate('return json.encode(WebAssets.Inspect("budget/wilson0.zip"))'));
  const count=Math.ceil(stats(evaluate).budget/first.retainedBytes)+2;assert.ok(count<100);
  for(let i=1;i<count;++i){engine.FS.writeFile('/budget/wilson'+i+'.zip',bytes);await evaluateAsync(`WebAssets.Decode("budget/wilson${i}.zip")`);}
  assert.ok(stats(evaluate).evictions>0);assert.ok(stats(evaluate).retainedBytes<=stats(evaluate).budget);
  for(let i=0;i<count;++i)evaluate(`WebAssets.Release("budget/wilson${i}.zip")`);
  assert.equal(stats(evaluate).retainedBytes,0);
  evaluate(`local assets={};for i=0,${count-1} do assets[#assets+1]={type="ANIM",file="budget/wilson"..i..".zip"}end;TheSim:RegisterPrefab("budget-probe",assets,{})`);
  await assert.rejects(evaluateAsync('TheSim:LoadPrefabs({"budget-probe"})'),/memory budget/);
  assert.equal(stats(evaluate).retainedBytes,0);assert.equal(evaluate('return tostring(WebPrefabs.Loaded()["budget-probe"])'),'nil');
  assert.ok(engine.HEAPU8.byteLength<=1024*1024*1024);
});

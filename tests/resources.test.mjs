import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Resources, sha256 } from '../src/resources.mjs';
import { loadEngine } from '../tools/load-engine.mjs';

const base=new URL('../public/generated/',import.meta.url);
const read=path=>readFile(new URL(path,base));
async function open(options){
  const reference=JSON.parse(await read('resources/index.json'));
  return Resources.open(reference,read,options);
}
test('logical native paths stream real bytes from loose data and databundles',async t=>{
  const {engine,evaluate,assets}=await loadEngine(1,{resources:true});t.after(()=>engine._dst_close());
  assert.equal(evaluate('return tostring(kleifileexists("levels\\\\tiles\\\\cave.tex"))'),'true');
  assert.equal(evaluate('return tostring(kleifileexists("levels/tiles/not-real.tex"))'),'false');
  assert.throws(()=>engine.FS.stat('/levels/tiles/cave.tex'),'indexing must not preload data into MEMFS');
  const bytes=await assets.materialize(engine,'levels/tiles/cave.tex');
  assert.deepEqual(bytes,new Uint8Array(await readFile(new URL('../../data/levels/tiles/cave.tex',import.meta.url))));
  assert.equal(engine.FS.stat('/levels/tiles/cave.tex').size,bytes.length);
  const shader=await assets.read('shaders/moonstorm.ksh');
  assert.equal(await sha256(shader),assets.index.files['shaders/moonstorm.ksh'].sha256);
  assert.ok(assets.stats.fetches<10,'read a few packs, not the whole content set');
  const before=assets.stats.fetches;await assets.read('levels/tiles/cave.tex');assert.equal(assets.stats.fetches,before);
});

test('bounded resource cache evicts packs and reconstructs chunked files without changing bytes',async()=>{
  const assets=await open({budget:8*1024*1024});
  const seen=new Set(),paths=[];
  for(const [path,file] of Object.entries(assets.index.files)){
    if(!path.startsWith('levels/tiles/')||!path.endsWith('.tex'))continue;
    const pack=assets.index.chunks[file.chunks[0]].pack;
    if(!seen.has(pack)){seen.add(pack);paths.push(path);}
    if(paths.length===3)break;
  }
  assert.equal(paths.length,3);
  const expected=[];
  for(const path of paths){expected.push(await assets.read(path));assert.ok(assets.stats.cacheBytes<=8*1024*1024);}
  assert.ok(assets.stats.evictions>0);
  assert.deepEqual(await assets.read(paths[0]),expected[0]);
  // Exercise a file split over many packs, without retaining all of them.
  const large=Object.entries(assets.index.files).find(([,file])=>file.bytes>16*1024*1024&&file.bytes<32*1024*1024);
  assert.ok(large);const bytes=await assets.read(large[0]);
  assert.equal(bytes.length,large[1].bytes);assert.equal(await sha256(bytes),large[1].sha256);
  assert.ok(assets.stats.cacheBytes<=8*1024*1024);
});

test('resource integrity failures and unsafe paths are explicit',async()=>{
  const reference=JSON.parse(await read('resources/index.json'));
  await assert.rejects(()=>Resources.open({...reference,sha256:'0'.repeat(64)},read),/index hash/);
  const bytes=await read(reference.url),index=JSON.parse(bytes);
  const assets=new Resources(index,async path=>{const value=new Uint8Array(await read(path));value[value.length-8]^=1;return value;});
  await assert.rejects(()=>assets.read('levels/tiles/cave.tex'),/pack hash/);
  for(const path of ['../outside','/absolute','C:/outside','levels//cave.tex','levels/./cave.tex'])assert.throws(()=>assets.exists(path));
  await assert.rejects(()=>assets.read('not/in/index'),/does not exist/);
  assert.equal(assets.stats.cacheBytes,0);
});

test('corrupt disk cache is replaced and quota failure does not corrupt verified reads',async()=>{
  const reference=JSON.parse(await read('resources/index.json')),index=JSON.parse(await read(reference.url));
  let deleted=0;
  const cache={
    match:async()=>new Response(new Uint8Array([1,2,3])),
    delete:async()=>{++deleted;return true;},
    put:async()=>{throw new Error('QuotaExceededError');},
  };
  const assets=new Resources(index,read,{cache});
  const [first,second]=await Promise.all([assets.read('levels/tiles/cave.tex'),assets.read('levels/tiles/cave.tex')]);
  assert.deepEqual(first,second);assert.equal(assets.stats.fetches,1,'concurrent readers share one in-flight download');
  assert.equal(assets.stats.diskHits,0);assert.equal(assets.stats.cacheWriteFailures,1);assert.equal(deleted,1);
});

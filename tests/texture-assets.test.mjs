import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inspect=(evaluate,path)=>JSON.parse(evaluate(`return json.encode_compliant(WebTextures.Inspect(${path?JSON.stringify(path):''}))`));
const ktex=(codec,width,height,payload)=>{
  const header=Buffer.alloc(18);header.write('KTEX');header.writeUInt32LE((1<<13)|(codec<<4),4);header.writeUInt16LE(width,8);header.writeUInt16LE(height,10);header.writeUInt16LE(payload.length,12);header.writeUInt32LE(payload.length,14);return Buffer.concat([header,payload]);
};
function backend(engine,{failLevel=-1}={}){
  const textures=new Map(),uploads=[];engine.nativeTextureBackendReady=()=>true;engine.hasNativeTexture=id=>textures.get(id>>>0)?.complete;
  engine.beginNativeTexture=(id,width,height,levels)=>textures.set(id>>>0,{width,height,levels,complete:false});
  engine.uploadNativeTexture=(id,level,width,height,pixels)=>{if(level===failLevel)throw new Error('fixture GPU failure');uploads.push({id:id>>>0,level,width,height,sha256:hash(pixels)});};
  engine.finishNativeTexture=id=>{textures.get(id>>>0).complete=true;};engine.releaseNativeTexture=id=>textures.delete(id>>>0);return {textures,uploads};
}
test('WASM KTEX decodes every original Wilson/UI mip to independent Python RGBA hashes',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/texture-catalog.json',import.meta.url)));
  assert.equal(catalog.generatorSha256,hash(await readFile(new URL('../tools/texture_catalog.py',import.meta.url))));
  assert.equal(catalog.decoderSha256,hash(await readFile(new URL('../tools/assets.py',import.meta.url))));
  const {engine,evaluate}=await loadEngine(0);t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/fixture');const gpu=backend(engine);
  for(const [i,row] of catalog.cases.entries()){
    const bytes=await readFile(new URL('../output/'+row.fixture,import.meta.url));assert.equal(hash(bytes),row.sha256);
    assert.equal(hash(await readFile(new URL('../../'+row.source,import.meta.url))),row.archiveSha256);
    const path=`fixture/native_${i}.tex`;engine.FS.writeFile('/'+path,bytes);evaluate(`WebTextures.Decode("${path}")`);
    const value=inspect(evaluate,path);assert.equal(value.sourceSha256,row.sha256);assert.equal(value.codec,row.codec);
    assert.deepEqual(value.mips,row.mips.map(({rgbaSha256,...value})=>value));
    for(const [level,mip] of row.mips.entries())assert.equal(evaluate(`return WebTextures.MipSha256("${path}",${level})`),mip.rgbaSha256);
    evaluate(`WebTextures.Upload("${path}")`);assert.equal(inspect(evaluate,path).textureReady,true);
    assert.deepEqual(gpu.uploads.splice(0).map(value=>value.sha256),row.mips.map(value=>value.rgbaSha256));
    evaluate(`WebTextures.Release("${path}")`);assert.equal(gpu.textures.size,0);
  }
  assert.equal(inspect(evaluate).retainedBytes,0);
});
test('S3TC transparency, alpha tables, cropped blocks and RGB/RGBA retain exact bytes',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());engine.FS.mkdirTree('/fixture');
  const check=(codec,w,h,payload,expected)=>{const bytes=ktex(codec,w,h,payload);engine.FS.writeFile('/fixture/test.tex',bytes);evaluate('WebTextures.Decode("fixture/test.tex")');assert.equal(evaluate('return WebTextures.MipSha256("fixture/test.tex",0)'),hash(Buffer.from(expected)));evaluate('WebTextures.Release("fixture/test.tex")');};
  // DXT1 c0<=c1: black, white, midpoint, transparent; cropped 3x1 block.
  const colour=Buffer.alloc(8);colour.writeUInt16LE(0,0);colour.writeUInt16LE(65535,2);colour.writeUInt32LE(0b11100100,4);
  check(0,4,1,colour,[0,0,0,255,255,255,255,255,127,127,127,255,0,0,0,0]);
  check(0,3,1,colour,[0,0,0,255,255,255,255,255,127,127,127,255]);
  // DXT3 uses four-colour mode regardless of c0/c1 order; all 16 alpha nibbles.
  const dxt3=Buffer.alloc(16);for(let i=0;i<8;++i)dxt3[i]=2*i|((2*i+1)<<4);colour.copy(dxt3,8);dxt3.writeUInt32LE(0xffffffff,12);
  check(1,4,4,dxt3,Array.from({length:16},(_,i)=>[170,170,170,i*17]).flat());
  for(const [a,b,table] of [[250,5,[250,5,215,180,145,110,75,40]],[10,210,[10,210,50,90,130,170,0,255]]]){
    const block=Buffer.alloc(16);block[0]=a;block[1]=b;let bits=0n;for(let i=0;i<16;++i)bits|=BigInt(i%8)<<BigInt(i*3);for(let i=0;i<6;++i)block[2+i]=Number((bits>>BigInt(i*8))&255n);colour.copy(block,8);
    check(2,4,4,block,Array.from({length:16},(_,i)=>[...[[0,0,0],[255,255,255],[85,85,85],[170,170,170]][i<4?i:0],table[i%8]]).flat());
  }
  check(5,2,1,Buffer.from([1,2,3,4,5,6]),[1,2,3,255,4,5,6,255]);check(4,2,1,Buffer.from([1,2,3,4,5,6,7,8]),[1,2,3,4,5,6,7,8]);
});
test('deferred atlas, shared IMAGE leases and failed GPU upload roll back ownership',async t=>{
  const {engine,evaluate}=await loadEngine(0);t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/fixture');
  const xml='<Atlas><Texture filename="ok.tex"/><Elements><Element name="a.tex" u1="0" v1="0" u2="1" v2="1"/></Elements></Atlas>';
  engine.FS.writeFile('/fixture/a.xml',new TextEncoder().encode(xml));engine.FS.writeFile('/fixture/ok.tex',ktex(4,1,1,Buffer.from([1,2,3,4])));
  evaluate('TheSim:RegisterPrefab("dynamic",{{type="DYNAMIC_ATLAS",file="fixture/a.xml"}},{});TheSim:RegisterPrefab("regular",{{type="ATLAS",file="fixture/a.xml"}},{});TheSim:RegisterPrefab("image",{{type="IMAGE",file="fixture/ok.tex"}},{});TheSim:LoadPrefabs({"dynamic"});TheSim:LoadPrefabs({"regular"})');
  assert.equal(inspect(evaluate).textures,0);assert.equal(evaluate('return tostring(WebAtlases.Inspect("fixture/a.xml").textureLoaded)'),'false');
  const gpu=backend(engine);
  evaluate('WebAtlases.BindTexture("fixture/a.xml");TheSim:LoadPrefabs({"image"})');assert.equal(gpu.textures.size,1);assert.equal(inspect(evaluate,'fixture/ok.tex').references,2);
  assert.throws(()=>evaluate('WebTextures.Release("fixture/ok.tex")'),/owned/);
  evaluate('TheSim:UnloadPrefabs({"regular","dynamic"})');assert.equal(inspect(evaluate,'fixture/ok.tex').references,1);
  evaluate('TheSim:UnloadPrefabs({"image"})');assert.equal(gpu.textures.size,0);assert.equal(inspect(evaluate).retainedBytes,0);
  const failing=backend(engine,{failLevel:0});evaluate('TheSim:RegisterPrefab("fail",{{type="DYNAMIC_ATLAS",file="fixture/a.xml"},{type="IMAGE",file="fixture/ok.tex"}},{})');
  assert.throws(()=>evaluate('TheSim:LoadPrefabs({"fail"})'),/fixture GPU failure/);assert.equal(failing.textures.size,0);assert.equal(inspect(evaluate).textures,0);assert.equal(evaluate('return WebAtlases.Inspect().atlases'),'0');assert.equal(evaluate('return WebPrefabs.Loaded().fail'),'nil');assert.equal(evaluate('return 6*7'),'42');
  for(const bytes of [Buffer.alloc(0),ktex(3,1,1,Buffer.alloc(4)),ktex(4,1,1,Buffer.alloc(3)),ktex(4,0,1,Buffer.alloc(0)),ktex(4,1,1,Buffer.alloc(4)).subarray(0,-1),Buffer.concat([ktex(4,1,1,Buffer.alloc(4)),Buffer.from([0])])]){
    engine.FS.writeFile('/fixture/bad.tex',bytes);assert.throws(()=>evaluate('WebTextures.Decode("fixture/bad.tex")'),/KTEX/);assert.equal(inspect(evaluate).textures,0);
  }
});

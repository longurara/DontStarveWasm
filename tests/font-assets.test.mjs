import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import {loadEngine} from '../tools/load-engine.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inspect=(evaluate,path)=>JSON.parse(evaluate(`return json.encode_compliant(WebFonts.Inspect(${path?JSON.stringify(path):''}))`));
test('all 24 FONT archives retain original glyphs, signed-byte native kerning and packed channels',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/font-catalog.json',import.meta.url)));
  assert.equal(catalog.cases.length,24);assert.equal(catalog.generatorSha256,hash(await readFile(new URL('../tools/font_catalog.py',import.meta.url))));assert.equal(catalog.archiveSha256,hash(await readFile(new URL('../../'+catalog.source,import.meta.url))));
  assert.equal(catalog.decoderSha256,hash(await readFile(new URL('../tools/assets.py',import.meta.url))));
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));assert.equal(report.resourceCaptureError,null);assert.equal(report.oracleComplete,true);
  const path='output/native-reference/resource-managers.json',nativeBytes=await readFile(new URL('../'+path,import.meta.url));const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(nativeBytes),report.fixtureSha256[key]);const native=JSON.parse(nativeBytes);assert.equal(native.fonts.length,3);
  const {engine,evaluate}=await loadEngine(1);t.after(()=>engine._dst_close());evaluate('json=require("json")');
  for(const [i,row] of catalog.cases.entries()){
    const data=await readFile(new URL('../output/'+row.fixture,import.meta.url));assert.equal(hash(data),row.sourceSha256);engine.FS.mkdirTree('/fonts');engine.FS.writeFile('/'+row.path,data);
    evaluate(`TheSim:RegisterPrefab("font_${i}",{{type="FONT",file=${JSON.stringify(row.path)}}},{});TheSim:LoadPrefabs({"font_${i}"})`);
    const actual=inspect(evaluate,row.path);
    for(const field of ['face','sourceSha256','textureSha256','lineHeight','base','width','height','outline','material','glyphs','kernings','glyphSha256','kerningSha256'])assert.deepEqual(actual[field],row[field],row.path+': '+field);
    assert.equal(actual.rendererReady,false);assert.equal(actual.textureReady,false);assert.equal(actual.references,1);
    assert.deepEqual(JSON.parse(evaluate(`return json.encode_compliant(WebFonts.Glyph(${JSON.stringify(row.path)},${row.sample.id}))`)),row.sample);
    const original=native.fonts.find(value=>value.path===row.path);
    if(original){for(const field of ['lineHeight','base','width','height','outline','material','glyphs','kernings','glyphSha256','kerningSha256'])assert.deepEqual(actual[field],original[field],row.path+': native '+field);assert.equal(original.textureHandle,-1);}
    assert.throws(()=>evaluate(`WebFonts.Release(${JSON.stringify(row.path)})`),/owned/);evaluate(`TheSim:UnloadPrefabs({"font_${i}"})`);engine.FS.unlink('/'+row.path);assert.equal(inspect(evaluate).retainedBytes,0);
  }
});
test('client FONT texture is shared by prefab leases; malformed font and GPU failure roll back',async t=>{
  const catalog=JSON.parse(await readFile(new URL('../output/font-catalog.json',import.meta.url)));const row=catalog.cases.find(row=>row.path==='fonts/talkingfont.zip');
  const original=unzipSync(await readFile(new URL('../output/'+row.fixture,import.meta.url)));
  const {engine,evaluate}=await loadEngine(0);t.after(()=>engine._dst_close());evaluate('json=require("json")');engine.FS.mkdirTree('/fonts');engine.FS.writeFile('/'+row.path,zipSync(original));
  const textures=new Map();engine.nativeTextureBackendReady=()=>true;engine.hasNativeTexture=id=>!!textures.get(id>>>0)?.ready;
  engine.beginNativeTexture=(id,w,h,levels)=>textures.set(id>>>0,{levels,received:0,ready:false});engine.uploadNativeTexture=id=>++textures.get(id>>>0).received;engine.finishNativeTexture=id=>{const value=textures.get(id>>>0);assert.equal(value.received,value.levels);value.ready=true;};engine.releaseNativeTexture=id=>textures.delete(id>>>0);
  evaluate('TheSim:RegisterPrefab("font_a",{{type="FONT",file="fonts/talkingfont.zip"}},{});TheSim:RegisterPrefab("font_b",{{type="FONT",file="FONTS/TALKINGFONT.ZIP"}},{});TheSim:LoadPrefabs({"font_a","font_b"})');
  assert.equal(textures.size,1);assert.equal(inspect(evaluate,row.path).references,2);assert.equal(inspect(evaluate,row.path).textureReady,true);
  evaluate('TheSim:UnloadPrefabs({"font_a"})');assert.equal(textures.size,1);evaluate('TheSim:UnloadPrefabs({"font_b"})');assert.equal(textures.size,0);assert.equal(inspect(evaluate).retainedBytes,0);assert.equal(evaluate('return WebTextures.Inspect().retainedBytes'),'0');
  const xml=new TextDecoder().decode(original['font.fnt']);const invalid=[{...original,'font.fnt':new TextEncoder().encode(xml.slice(0,-20))},{'font.fnt':original['font.fnt']},{...original,'font.fnt':new TextEncoder().encode('<!DOCTYPE font>'+xml)},{...original,'font.fnt':new TextEncoder().encode(xml.replace('scaleW="1024"','scaleW="10"'))},{...original,'font.fnt':new TextEncoder().encode(xml.replace('count="326"','count="327"'))}];
  for(const [i,files] of invalid.entries()){
    const path=`fonts/bad_${i}.zip`;engine.FS.writeFile('/'+path,zipSync(files));assert.throws(()=>evaluate(`WebFonts.Decode("${path}")`),/FONT/);assert.equal(inspect(evaluate).fonts,0);assert.equal(evaluate('return 6*7'),'42');
  }
  engine.uploadNativeTexture=()=>{throw new Error('font GPU fixture failure');};evaluate('TheSim:RegisterPrefab("font_fail",{{type="FILE",file="fonts/raw.bin"},{type="FONT",file="fonts/talkingfont.zip"}}, {})');engine.FS.writeFile('/fonts/raw.bin',new Uint8Array([1,2,3]));
  assert.throws(()=>evaluate('TheSim:LoadPrefabs({"font_fail"})'),/font GPU fixture failure/);assert.equal(inspect(evaluate).fonts,0);assert.equal(textures.size,0);assert.equal(evaluate('return WebTextures.Inspect().textures'),'0');assert.equal(evaluate('return WebFileAssets.Inspect().files'),'0');assert.equal(evaluate('return WebPrefabs.Loaded().font_fail'),'nil');
});

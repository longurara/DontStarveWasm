import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEngine } from '../tools/load-engine.mjs';

test('dataset SHA256 agrees with independent standard vectors and block boundaries',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  for(const size of [0,1,3,55,56,63,64,65,127,128,1024,65536]){
    const code=`return WebInventory.SHA256(string.rep("abc",${size}))`;
    assert.equal(evaluate(code),createHash('sha256').update('abc'.repeat(size)).digest('hex'));
  }
  assert.equal(evaluate('return WebInventory.SHA256("a\\000b\\255")'),createHash('sha256').update(Buffer.from([97,0,98,255])).digest('hex'));
});

test('unchanged skin data produces the exact running native dataset fingerprint and table sizes',async t=>{
  const referenceBytes=await readFile(new URL('../output/native-reference/inventory-dataset.json',import.meta.url));
  const reference=JSON.parse(referenceBytes);
  const capture=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(capture.inventoryCaptureError,null,'inventory memory capture must have succeeded for this run');
  const key=Object.keys(capture.fixtureSha256).find(k=>k.replaceAll('\\','/').endsWith('/inventory-dataset.json'));
  assert.ok(key);assert.equal(createHash('sha256').update(referenceBytes).digest('hex'),capture.fixtureSha256[key]);
  const {engine,evaluate}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  evaluate('json=require("json");dofile("/scripts/skins_defs_data.lua")',100000000);
  const state=JSON.parse(evaluate('return json.encode(WebInventory.Inspect())'));
  assert.equal(state.datasetSha256,reference.datasetSha256);assert.equal(state.signature,reference.signature);
  for(const [key,value] of Object.entries(reference.counts))assert.equal(state.counts[key],value,key);
  assert.equal(state.counts.restricted,4275);assert.equal(state.counts.emojis,50);assert.equal(state.signatureVerified,false);
  const textures=JSON.parse(evaluate('return json.encode(WebTextureGroups.Inspect())'));
  assert.equal(textures.textures,137);assert.ok(textures.groups>0);
  const fixture=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_inventory_trace',import.meta.url);
  const {decodeNativeEnvelope}=await import('../src/native-save.mjs');
  const ownership=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(fixture))));
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local inventory ='),source.indexOf('TheSim:SetPersistentString("wasm_inventory_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(inventory)')),ownership);
  evaluate('TheInventory:ClearSkinsDataset()');
  const empty=JSON.parse(evaluate('return json.encode(WebInventory.Inspect())'));assert.equal(empty.transcript,'');
  assert.ok(Object.values(empty.counts).every(value=>value===0));
  assert.throws(()=>evaluate('TheInventory:StartGetAllItems()'),/UNIMPLEMENTED_NATIVE/);
});

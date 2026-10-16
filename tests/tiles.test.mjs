import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../tools/load-engine.mjs';
import { decodeNativeEnvelope } from '../src/native-save.mjs';

test('original tile definitions and TileGroupManager userdata match native reinitialization fixture',async t=>{
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_tile_trace',import.meta.url);
  let reference;try{reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));}
  catch{t.skip('Capture native tile fixture first');return;}
  const {engine,evaluate}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  const main=engine.FS.readFile('/scripts/main.lua',{encoding:'utf8'});
  const marker='require("tilegroups")',end=main.indexOf(marker);
  assert.ok(end>0);
  // Native reference logs prove two main.lua loads while the native manager
  // survives Lua teardown. Execute its original initialization prefix, then
  // reload the same original tilegroup definitions to reproduce that lifetime.
  evaluate(main.slice(0,end+marker.length),100000000);
  evaluate('dofile("/scripts/tilegroups.lua")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local tiles ='),source.indexOf('TheSim:SetPersistentString("wasm_tile_trace"'));
  const actual=JSON.parse(evaluate(snippet+';return json.encode(tiles)'));
  assert.deepEqual(actual,reference);
  assert.throws(()=>evaluate('TileGroupManager:UnknownTileApi()'),/UNIMPLEMENTED_NATIVE/);
});

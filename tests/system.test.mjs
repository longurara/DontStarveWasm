import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../tools/load-engine.mjs';
import { decodeNativeEnvelope } from '../src/native-save.mjs';

test('SystemService storage/autosave flags and last-operation tuple match native fixture',async t=>{
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_system_trace',import.meta.url);
  const reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local system ='),source.indexOf('TheSim:SetPersistentString("wasm_system_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(system)')),reference);
  engine._dst_platform_storage(1);engine._dst_platform_focus(0);
  assert.equal(evaluate('return tostring(TheSystemService:IsStorageAvailable())'),'true');
  assert.equal(evaluate('return tostring(TheSystemService:HasFocus())'),'false');
  evaluate('TheSystemService:SetStalling(true)');assert.equal(evaluate('return tostring(WebSystem.Inspect().stalling)'),'true');
  assert.throws(()=>evaluate('TheSystemService:PrepareStorage()'),/UNIMPLEMENTED_NATIVE/);
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());assert.throws(()=>client.evaluate('TheSim:SendHardwareStats()'),/client hardware telemetry/);
});

test('null-renderer mixer behavior matches native and client DSP remains explicit',async t=>{
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_mixer_trace',import.meta.url);
  const reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local mixer ='),source.indexOf('TheSim:SetPersistentString("wasm_boot_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(mixer)')),reference);
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('TheSim:SetSoundVolume("set_sfx/HUD",0.5)'),/UNIMPLEMENTED_NATIVE: client audio/);
});

test('unsupported controller haptics follow the native platform-disabled branch',async t=>{
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_haptics_trace',import.meta.url);
  const reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local haptics ='),source.indexOf('TheSim:SetPersistentString("wasm_haptics_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(haptics)')),reference);
  assert.equal(evaluate('return tostring(WebHaptics.Supported)'),'false');
});

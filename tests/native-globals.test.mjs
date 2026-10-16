import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEngine } from '../tools/load-engine.mjs';
import { decodeNativeEnvelope } from '../src/native-save.mjs';

async function fixture(name){
  const path=`output/native-reference/storage/fixtures/Cluster_1/Master/save/${name}`;
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const capture=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  const key=Object.keys(capture.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
  assert.ok(key,'fixture must belong to the recorded native capture');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),capture.fixtureSha256[key]);
  return JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
}

test('hash/smallhash reproduce native unsigned SDBM including signed UTF8 bytes and NUL termination',async t=>{
  const reference=await fixture('wasm_hash_trace');
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local hashes='),source.indexOf('for _,value in ipairs({"asparagussoup"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(hashes.cases)')),reference.cases);
  assert.equal(evaluate('return hash(12345)'),evaluate('return hash("12345")'));
  assert.throws(()=>evaluate('return hash({})'),/string expected/);
  // Hashing itself must not add a skin name to the native interned-name table.
  assert.equal(evaluate('return TheInventory:LookupSkinname(hash("web_port_unknown"))'),'FROMNUM');
});

test('unavailable event-server module reproduces the native empty callable proxy',async t=>{
  const reference=await fixture('wasm_event_proxy_trace');
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local eventproxy='),source.indexOf('TheSim:SetPersistentString("wasm_event_proxy_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(eventdata)')),reference);
  assert.throws(()=>evaluate('return requireeventfile({})'),/string expected/);
});

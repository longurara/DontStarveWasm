import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../tools/load-engine.mjs';
import { decodeNativeEnvelope } from '../src/native-save.mjs';
import {readFile} from 'node:fs/promises';

test('persistent strings retain native C-string termination, envelope and callback order',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  evaluate('json=require("json")');
  for(const encoded of [false,true]){
    const order=JSON.parse(evaluate(`local order={"before"};local result={TheSim:SetPersistentString("session/test","a\\000b\\255",${encoded},function(ok)assert(ok);order[#order+1]="callback" end)};assert(#result==0);order[#order+1]="after";return json.encode(order)`));
    assert.deepEqual(order,['before','callback','after']);
    assert.deepEqual(decodeNativeEnvelope(engine.FS.readFile('/persistent/master/session/test')),new Uint8Array([97]));
    assert.equal(evaluate('local value;TheSim:GetPersistentString("session/test",function(ok,text)assert(ok);value=text end);return #value'),'1');
    evaluate(`TheSim:SetPersistentString("session/bytes","a\\255b",${encoded})`);
    assert.deepEqual(decodeNativeEnvelope(engine.FS.readFile('/persistent/master/session/bytes')),new Uint8Array([97,255,98]));
  }
  assert.equal(engine._dst_io_pending(),2);
  engine._dst_complete_io(0);assert.equal(engine._dst_io_pending(),2,'failed browser commit remains retryable');
  engine._dst_complete_io(1);assert.equal(engine._dst_io_pending(),0);
});

test('native binary fixture covers omitted compression flag and non-boolean callback slot',async t=>{
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_binary_trace',import.meta.url);
  const reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  engine.FS.writeFile('/persistent/master/wasm_io_binary_source',Buffer.from('KLEI     1 a\x00b\xff','latin1'));
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local binary={}'),source.indexOf('TheSim:SetPersistentString("wasm_binary_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(binary)')),reference);
});

test('persistent reads reject truncated encoded files and cannot leave their shard',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  engine.FS.writeFile('/persistent/master/broken','KLEI     1DAAAAAA==');
  for(const name of ['broken','missing','../client/secret','/absolute','C:/outside','nested//empty']){
    assert.equal(evaluate(`local value;TheSim:GetPersistentString(${JSON.stringify(name)},function(ok,text)assert(not ok);assert(text=="");value="failed" end);return value`),'failed');
  }
  for(const name of ['../client/secret','/absolute','C:/outside','nested//empty']){
    assert.throws(()=>evaluate(`TheSim:SetPersistentString(${JSON.stringify(name)},"bad",false)`),/Invalid persistent path/);
  }
  evaluate('TheSim:SetPersistentString("exists","test",true);local called=false;TheSim:CheckPersistentStringExists("exists",function(ok)assert(ok);called=true end);assert(called);TheSim:ErasePersistentString("exists",function(ok)assert(ok)end);TheSim:CheckPersistentStringExists("exists",function(ok)assert(not ok)end)');
  assert.throws(()=>engine.FS.stat('/persistent/master/exists'));
});

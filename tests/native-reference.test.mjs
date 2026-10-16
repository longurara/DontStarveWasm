import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadEngine } from '../tools/load-engine.mjs';
import { decodeNativeEnvelope } from '../src/native-save.mjs';

async function find(directory,name) {
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,item.name);
    if(item.isFile()&&item.name===name)return path;
    if(item.isDirectory()){const value=await find(path,name);if(value)return value;}
  }
}
const root=fileURLToPath(new URL('../output/native-reference/storage',import.meta.url));
test('PCG32 RNG, clock and finiteuses match the running native engine fixture',async t=>{
  let path;try{path=await find(root,'wasm_native_trace');}catch{}
  if(!path){t.skip('Capture native reference trace first');return;}
  const trace=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));
  assert.ok(trace.randoms?.length===8,'Capture updated native RNG fixture');
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  evaluate('return dofile("/compat/diagnostic.lua")');
  evaluate('WEB_PROBE.components.finiteuses:Use(5)');
  assert.equal(Number(evaluate('return WEB_PROBE.components.finiteuses.current')),trace.finiteuses);
  assert.ok(Math.abs(Number(evaluate('return GetTickTime()'))-trace.ticktime)<1e-15);
  const actual=JSON.parse(evaluate('math.randomseed(12345);local a={};for i=1,8 do a[i]=math.random() end;return json.encode(a)'));
  assert.deepEqual(actual,trace.randoms);
  const saved=evaluate('return WebRNG.GetState()');
  const next=evaluate('return math.random()');
  evaluate('WebRNG.SetState("'+saved+'")');
  assert.equal(evaluate('return math.random()'),next);
  evaluate('RP=CreateEntity();RP.entity:AddTransform();RP.Transform:SetPosition(10,0,20);RP.Transform:SetRotation(90);RC=CreateEntity();RC.entity:AddTransform();RP:AddChild(RC);RC.Transform:SetPosition(1,0,0)');
  assert.deepEqual(JSON.parse(evaluate('return json.encode({RC.Transform:GetWorldPosition()})')),trace.parentWorldPosition);
  assert.deepEqual(JSON.parse(evaluate('return json.encode({RC.Transform:GetLocalPosition()})')),trace.childLocalPosition);
  evaluate('RC:Remove();RP:Remove();RM=CreateEntity();WEB_NATIVE_REMOVAL={};RM:ListenForEvent("onremove",function(inst)WEB_NATIVE_REMOVAL.validDuringCallback=inst:IsValid();WEB_NATIVE_REMOVAL.inRegistryDuringCallback=Ents[inst.GUID]~=nil end);RM:Remove();WEB_NATIVE_REMOVAL.validAfterRemove=RM:IsValid();WEB_NATIVE_REMOVAL.inRegistryAfterRemove=Ents[RM.GUID]~=nil');
  assert.deepEqual(JSON.parse(evaluate('return json.encode(WEB_NATIVE_REMOVAL)')),trace.onremove);
});
test('native compressed persistent-string envelope matches actual native bytes',async t=>{
  let path;try{path=await find(root,'wasm_encoded_probe');}catch{}
  if(!path){t.skip('Capture encoded native fixture first');return;}
  const source=await readFile(path);
  const decoded=decodeNativeEnvelope(source);
  assert.equal(new TextDecoder().decode(decoded),'return {meta={build_version="756039"},mods={},map={width=1,height=1},ents={}}');
  const {engine}=await loadEngine();t.after(()=>engine._dst_close());
  const pointer=engine._malloc(decoded.length);engine.HEAPU8.set(decoded,pointer);
  try{
    assert.equal(engine._dst_inspect_save(pointer,decoded.length),0);
    const metadata=JSON.parse(engine.ccall('dst_result','string',[],[]));
    assert.equal(metadata.mapWidth,1);assert.equal(metadata.gameBuild,'756039');
  }finally{engine._free(pointer);}
  const corrupt=new Uint8Array(source);corrupt[corrupt.length-8]=65;
  assert.throws(()=>decodeNativeEnvelope(corrupt));
});

test('UTF8 helpers and persistent callback sequence match captured native calls',async t=>{
  let path;try{path=await find(root,'wasm_io_trace');}catch{}
  if(!path){t.skip('Capture updated native I/O and Unicode fixtures');return;}
  const decode = async name => {
    const text=new TextDecoder().decode(decodeNativeEnvelope(await readFile(await find(root,name))));
    // Native json.lua escapes apostrophes even inside double quoted strings.
    return JSON.parse(text.replace(/\\'/g,"'"));
  };
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  evaluate('json=require("json")');
  const ioSource=source.slice(source.indexOf('local io_trace ='),source.indexOf('local sort_trace ='));
  const actual=JSON.parse(evaluate(ioSource+';return json.encode(io_trace)'));
  assert.deepEqual(actual,await decode('wasm_io_trace'));
  const unicode=await decode('wasm_unicode_trace');
  const textSource=source.slice(source.indexOf('local text ='),source.indexOf('TheSim:SetPersistentString("wasm_unicode_trace"'));
  const values=JSON.parse(evaluate(textSource+';return json.encode(text)').replace(/\\'/g,"'"));
  for(let i=0;i<unicode.cases.length;i++){
    assert.equal(values.cases[i].name,unicode.cases[i].name);
    const expected=unicode.cases[i].values,got=values.cases[i].values;
    assert.equal(got[0],expected[0]);
    if(expected[0])assert.deepEqual(got,expected,'native '+unicode.cases[i].name+' case '+i);
  }
  for(const entry of await decode('wasm_sort_trace')){
    // Fixture inputs contain only ASCII/UTF8 strings and numeric values.
    const args=entry.arguments.map(value=>typeof value==='number'?String(value):JSON.stringify(value)).join(',');
    assert.equal(evaluate('return tostring(stringidsorter('+args+'))'),String(entry.values[1]));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../tools/load-engine.mjs';
import { decodeNativeEnvelope } from '../src/native-save.mjs';
import { nativeKeyCode,nativeMouseButton } from '../src/input.mjs';

test('headless InputProxy matches native zero-device fixture',async t=>{
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_input_trace',import.meta.url);
  let reference;try{reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))));}
  catch{t.skip('Capture native input fixture first');return;}
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());evaluate('json=require("json")');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const snippet=source.slice(source.indexOf('local input ='),source.indexOf('TheSim:SetPersistentString("wasm_input_trace"'));
  assert.deepEqual(JSON.parse(evaluate(snippet+';return json.encode(input)')),reference);
  assert.equal(engine._dst_input_key(119,1),1);
});

test('client keyboard/mouse state supports native modifier aggregation and reset',async t=>{
  const {engine,evaluate}=await loadEngine(0);t.after(()=>engine._dst_close());
  assert.equal(evaluate('return TheInputProxy:GetInputDeviceCount()'),'1');
  assert.equal(evaluate('return tostring(TheInputProxy:IsInputDeviceConnected(0))'),'true');
  for(const code of [119,303,304])assert.equal(engine._dst_input_key(code,1),0);
  assert.equal(evaluate('return tostring(TheSim:IsKeyDown(119) and TheSim:IsKeyDown(402))'),'true');
  engine._dst_input_key(303,0);assert.equal(evaluate('return tostring(TheSim:IsKeyDown(402))'),'true');
  engine._dst_input_key(304,0);assert.equal(evaluate('return tostring(TheSim:IsKeyDown(402))'),'false');
  assert.equal(engine._dst_input_pointer(123.5,456.25,1000,1),0);
  assert.equal(evaluate('local x,y=TheSim:GetPosition();return x..","..y'),'123.5,456.25');
  assert.equal(evaluate('return tostring(TheSim:GetMouseButtonState(1000))'),'true');
  engine._dst_input_reset();assert.equal(evaluate('return tostring(TheSim:IsKeyDown(119) or TheSim:GetMouseButtonState(1000))'),'false');
  assert.equal(engine._dst_input_pointer(NaN,1,1000,1),1);assert.equal(engine._dst_input_key(10000,1),1);
  evaluate('TheInputProxy:SetCursorVisible(false)');assert.equal(engine._dst_input_cursor_visible(),0);
  evaluate('TheInputProxy:SetCursorVisible(true)');assert.equal(engine._dst_input_cursor_visible(),1);
});

test('unmodified Lua Input/EventProcessor receives key transitions and sees current native state',async t=>{
  const {engine,evaluate}=await loadEngine(0,{fullScripts:true});t.after(()=>engine._dst_close());
  // Test the original input module independently of full client bootstrap,
  // whose audio reverb backend remains explicitly unimplemented.
  evaluate('function ValidateLineNumber(num)TheSim:ValidateLineNumber(num)end;require("constants");require("input");json=require("json")');
  evaluate('WEB_KEYS={};TheInput:AddKeyDownHandler(KEY_W,function()WEB_KEYS[#WEB_KEYS+1]={"down",TheInput:IsKeyDown(KEY_W)}end);TheInput:AddKeyUpHandler(KEY_W,function()WEB_KEYS[#WEB_KEYS+1]={"up",TheInput:IsKeyDown(KEY_W)}end)');
  engine._dst_input_key(119,1);evaluate('TheInput:OnRawKey(KEY_W,true)');
  engine._dst_input_key(119,0);evaluate('TheInput:OnRawKey(KEY_W,false)');
  assert.deepEqual(JSON.parse(evaluate('return json.encode(WEB_KEYS)')),[['down',true],['up',false]]);
});

test('browser physical keys and mouse buttons map to original constants',()=>{
  for(const [name,expected] of Object.entries({KeyW:119,Digit1:49,ShiftLeft:304,ArrowUp:273,Numpad0:256,NumpadEnter:271,F12:293}))assert.equal(nativeKeyCode(name),expected);
  assert.equal(nativeKeyCode('Unidentified'),null);assert.equal(nativeMouseButton(0),1000);assert.equal(nativeMouseButton(1),1002);assert.equal(nativeMouseButton(2),1001);
});

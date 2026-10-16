import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';

async function fixture(name){
  const path=new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/'+name,import.meta.url);
  // Native json.lua escapes apostrophes, which standard JSON does not accept.
  return JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await readFile(path))).replaceAll("\\'","'"));
}
test('headless camera validates native call shapes and original FollowCamera submits native-equivalent vectors',async t=>{
  const native=await fixture('wasm_camera_trace');
  const follow=await fixture('wasm_followcamera_trace');
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const {engine,evaluate,evaluateAsync}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  // The real configured game mode now permits FollowCamera construction.
  try{await evaluateAsync('dofile("/scripts/main.lua")',100000000);}
  catch(error){assert.match(error.message,/UNIMPLEMENTED_NATIVE:/);}
  assert.equal(evaluate('return tostring(TheCamera~=nil)'),'true');
  const snippet=source.slice(source.indexOf('local camera={}'),source.indexOf('TheSim:SetPersistentString("wasm_camera_trace"'));
  const actual=JSON.parse(evaluate(snippet+';return json.encode(camera)').replaceAll("\\'","'"));
  for(const [method,calls] of Object.entries(native))for(const [kind,values] of Object.entries(calls)){
    assert.equal(actual[method][kind][0],values[0],`${method}/${kind}`);
    assert.equal(actual[method][kind].length,values.length);
  }
  const result=JSON.parse(evaluate('return json.encode(WebCamera.Inspect())'));
  assert.deepEqual(result.position,[0,1,0]);assert.equal(result.fov,0);assert.equal(result.worldRendererReady,false);
  evaluate('assert(GetGameModeProperty("cameraoverridefn")==nil);TheCamera=require("cameras/followcamera")()');
  for(const expected of follow){
    evaluate(`TheCamera.heading=${expected.config[0]};TheCamera.pitch=${expected.config[1]};TheCamera.distance=${expected.config[2]};TheCamera.currentpos=Vector3(1.25,1.5,-10.75);TheCamera.currentscreenxoffset=0;TheCamera:Apply()`);
    const state=JSON.parse(evaluate('return json.encode(WebCamera.Inspect())'));
    for(const field of ['position','direction','up'])state[field].forEach((value,i)=>assert.equal(Math.fround(value),Math.fround(expected[field][i]),field));
    assert.equal(state.fov,expected.fov);
    const radians=Math.atan2(state.direction[2],state.direction[0]);
    assert.ok(Math.abs(state.yaw-(radians*180/Math.PI+180))<0.0001);
    assert.deepEqual(state.listener.slice(3,6),state.direction);assert.deepEqual(state.listener.slice(6),state.up);
  }
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.throws(()=>client.evaluate('TheSim:SetCameraPos(1,2,3)'),/UNIMPLEMENTED_NATIVE: client world camera/);
});

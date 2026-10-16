import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function fixture(){
  const attempt=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(attempt.oracleComplete,true);assert.equal(attempt.entityCaptureError,null);
  async function checked(path){const bytes=await readFile(new URL('../'+path,import.meta.url));
    const key=Object.keys(attempt.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key,path);assert.equal(hash(bytes),attempt.fixtureSha256[key]);return bytes;}
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_ui_transform_trace');
  const native=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(memory.uiTransform.traceSha256,hash(bytes));
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  assert.equal(hash(Buffer.from(source)),attempt.sourceSha256['web-port\\tools\\native_entity_trace.lua']);
  const block=source.split('-- UI_TRANSFORM_ORACLE_BEGIN')[1].split('-- UI_TRANSFORM_ORACLE_END')[0];
  return {native,memory:memory.uiTransform,block};
}
function near(actual,expected,path='state'){
  if(typeof expected==='number'){
    assert.equal(typeof actual,'number',path);
    assert.ok(Math.abs(actual-expected)<=0.0001,`${path}: ${actual} != ${expected}`);return;
  }
  if(expected&&typeof expected==='object'){
    assert.deepEqual(Object.keys(actual),Object.keys(expected),path);
    for(const key of Object.keys(expected))near(actual[key],expected[key],path+'.'+key);return;
  }
  assert.equal(actual,expected,path);
}
test('all UITransform calls, hierarchy and scissor storage match native in every WASM role',async t=>{
  const {native,memory,block}=await fixture();
  const clean=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['guid','first','second'].includes(key)));
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());
    evaluate('json=require("json")');
    const initial=JSON.parse(evaluate('return json.encode_compliant(WebUI.Inspect())'));
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(ui_trace)'));
    assert.deepEqual(actual.screen,native.screen);
    assert.deepEqual(actual.objects.map(clean),native.objects.map(clean));
    assert.deepEqual(actual.calls,native.calls);
    near(actual.states,native.states);
    for(const reference of memory.components){
      const guid=actual.objects.find(row=>row.name===reference.name).guid;
      const state=JSON.parse(evaluate(`return json.encode_compliant(WebUI.Inspect(${guid}))`));
      assert.equal(state.typeId,0xd74dae38);assert.equal(state.rendererReady,false);
      assert.equal(state.inverseVerified,false);
      for(const key of ['hAnchor','vAnchor','scaleMode','localPosition','worldPosition','scale','rotationBits','facing','maxPropUpscaleBits','localMatrixBits','worldMatrixBits','clearScissor'])assert.deepEqual(state[key],reference[key],reference.name+'/'+key);
      for(const key of ['scissor','transformedScissor'])assert.deepEqual(state[key]??null,reference[key],reference.name+'/'+key);
      assert.equal(reference.finalizeFunction,'0x14003d000');
      assert.equal(reference.typeFunction,'0x14008a240');
    }
    // Remove deepest children before their parent, as Widget:Kill does.
    evaluate('WEB_UI_FIXTURE.grandchild:Remove();WEB_UI_FIXTURE.child:Remove();for _,inst in ipairs(WEB_UI_FIXTURE.basis)do inst:Remove()end;WEB_UI_FIXTURE.parent:Remove();WEB_UI_FIXTURE.defaults:Remove()');
    assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebUI.Inspect())')),initial);
    assert.equal(evaluate('return select("#",WEB_UI_FIXTURE.child.UITransform:SetPosition(nil))'),'0');
    assert.equal(evaluate('return select("#",WEB_UI_FIXTURE.child.UITransform:GetScale())'),'0');
    assert.equal(evaluate('return tostring(WEB_UI_FIXTURE.child.entity:AddUITransform())'),'nil');
  }
});

test('UI viewport drives anchors and scale modes while preserving explicit incomplete paths',async t=>{
  const {engine,evaluate}=await loadEngine(0);t.after(()=>engine._dst_close());evaluate('json=require("json");UI_PARENT=CreateEntity();UI_PARENT.entity:AddUITransform();UI_CHILD=CreateEntity();UI_CHILD.entity:AddUITransform();UI_CHILD.entity:SetParent(UI_PARENT.entity)');
  assert.equal(engine._dst_ui_viewport(1920,1080),0);
  assert.equal(evaluate('local x,y=TheSim:GetScreenSize();return x..","..y'),'1920,1080');
  evaluate('UI_PARENT.UITransform:SetPosition(10,20,0);UI_CHILD.UITransform:SetHAnchor(0);UI_CHILD.UITransform:SetVAnchor(0);UI_CHILD.UITransform:SetPosition(5,6,0)');
  let state=JSON.parse(evaluate('return json.encode_compliant(WebUI.Inspect(UI_CHILD.GUID))'));
  assert.deepEqual(state.worldPosition,[5,6,0]);
  const matrix=Buffer.from(state.worldMatrixBits,'hex');assert.equal(matrix.readFloatLE(12),965);assert.equal(matrix.readFloatLE(28),546);
  evaluate('UI_CHILD.UITransform:SetHAnchor(3);UI_CHILD.UITransform:SetVAnchor(3);UI_CHILD.UITransform:SetScaleMode(2)');
  assert.equal(evaluate('return UI_CHILD.UITransform:GetScale()'),'1.5');
  evaluate('UI_CHILD.UITransform:SetMaxPropUpscale(1.25)');
  assert.equal(evaluate('return UI_CHILD.UITransform:GetScale()'),'1.25');
  const before=JSON.parse(evaluate('return json.encode_compliant(WebUI.Inspect())'));
  for(const code of ['WebUI.SetViewport(-1,5)','WebUI.SetViewport(1.5,5)','WebUI.SetViewport(0/0,5)','WebUI.SetViewport(5,math.huge)','UI_CHILD.entity:AddTransform()'])assert.throws(()=>evaluate(code));
  assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebUI.Inspect())')),before);
  assert.notEqual(engine._dst_ui_viewport(32769,1),0);
  assert.throws(()=>evaluate('UI_PARENT.entity:SetParent(UI_CHILD.entity)'),/cycle/);
  evaluate('WORLD_PARENT=CreateEntity();WORLD_PARENT.entity:AddTransform()');
  assert.throws(()=>evaluate('WORLD_PARENT.entity:AddUITransform()'),/UNIMPLEMENTED_NATIVE: mixed/);
});

test('original Widget constructs and transforms a family with its original uianim component',async t=>{
  const {engine,evaluate,evaluateAsync}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  await evaluateAsync('dofile("/scripts/main.lua")',100000000);
  const before=engine._dst_entity_count();
  const result=JSON.parse(evaluate(`
    local Widget=require("widgets/widget")
    local parent=Widget("original_parent")
    local child=parent:AddChild(Widget("original_child"))
    parent:SetPosition(10.25,-20.5,3);child:SetPosition(2.5,4.25,-5)
    parent:SetScale(1.5,-2,0.75);parent:SetRotation(90)
    local result=json.encode_compliant({position={child.inst.UITransform:GetWorldPosition()},hasUIAnim=child.inst.components.uianim~=nil,widgetBacklink=child.inst.widget==child})
    -- FrontEnd cannot finish constructing until TextWidget exists. Destroy
    -- native owners directly here; Widget:Kill also requires that FrontEnd.
    child.inst:Remove();parent.inst:Remove();return result
  `));
  assert.deepEqual(result,{position:[16.625,-15.5,-0.75],hasUIAnim:true,widgetBacklink:true});
  assert.equal(engine._dst_entity_count(),before);
  assert.equal(evaluate('return WebUI.Inspect().transforms'),'0');
  assert.equal(evaluate('return tostring(rawget(_G,"TheFrontEnd")==nil)'),'true','this is not a completed frontend');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function checked(path){
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);assert.equal(report.entityCaptureError,null);assert.equal(report.resourceCaptureError,null);
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
  assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;
}
test('FontManager shares native font aliases without recolouring or acquiring resources, and aliases survive owner retirement',async t=>{
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_font_manager_trace');
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  const resources=JSON.parse(await checked('output/native-reference/resource-managers.json'));
  assert.equal(hash(bytes),memory.fontManager.traceSha256);const native=memory.fontManager.state;
  assert.equal(native.sharedComponent,true);assert.equal(native.otherComponent,true);assert.equal(native.sharedRegistry,true);
  assert.ok(native.components.every(row=>row.typeFunction==='0x1400a4b70'&&row.destroyFunction==='0x1400a4c20'&&row.finalizeFunction==='0x14003d000'));
  const source=await readFile(new URL('../tools/native_asset_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- FONT_MANAGER_ORACLE_BEGIN')[1].split('-- FONT_MANAGER_ORACLE_END')[0];
  const normalized=({guid,otherGuid,first,second,other,...row})=>row;
  for(const role of [1,2]){
    const {engine,evaluate,evaluateAsync,assets}=await loadEngine(role,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
    evaluate('TheSim:RegisterPrefab("fm_fonts",{{type="FONT",file="fonts/talkingfont.zip"},{type="FONT",file="fonts/bellefair50.zip"}}, {})');
    await evaluateAsync('TheSim:LoadPrefabs({"fm_fonts"})');const fetches=assets.stats.fetches;
    const actual=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(font_manager_trace)'));
    assert.deepEqual(normalized(actual),normalized(original));
    const aliases=JSON.parse(evaluate('return json.encode_compliant(WebFonts.Registry())'));assert.equal(aliases.length,7);
    const ids=new Set(aliases.map(row=>row.id));
    assert.deepEqual(aliases,resources.fontAliases.filter(row=>ids.has(row.id)).map(row=>row.path?row:{id:row.id,resolved:row.resolved}));
    assert.equal(evaluate('return tostring(WebFonts.Inspect("fonts/talkingfont.zip").colourEnabled)'),'false');
    assert.equal(evaluate('return tostring(WebFonts.Inspect("fonts/bellefair50.zip").colourEnabled)'),'true');
    assert.equal(evaluate('return WebFonts.Inspect("fonts/talkingfont.zip").references'),'1');
    assert.equal(evaluate('return WebFonts.Inspect("fonts/bellefair50.zip").references'),'1');assert.equal(assets.stats.fetches,fetches);
    assert.equal(evaluate('return WebComponents.FontManager().fontManagers'),'2');
    for(const guid of [actual.guid,actual.otherGuid]){
      const state=JSON.parse(evaluate(`return json.encode_compliant(WebComponents.FontManager(${guid}))`));
      assert.equal(state.typeId,0xc0ce008f);assert.equal(state.sharedRegistry,true);assert.equal(state.rendererReady,false);
      const lifecycle=JSON.parse(evaluate(`return json.encode_compliant(WebEntity.Inspect(${guid}))`));
      for(const key of ['awake','canSleep','componentsAllowSleep'])assert.equal(lifecycle[key],native.components[0][key]);
    }
    const registry=evaluate('return json.encode_compliant(WebFonts.Registry())');
    evaluate('for _,inst in ipairs(WEB_FONT_MANAGER_FIXTURE.entities)do inst:Remove()end');
    assert.equal(evaluate('return WebComponents.FontManager().fontManagers'),'0');
    assert.equal(evaluate('return json.encode_compliant(WebFonts.Registry())'),registry);
    assert.throws(()=>evaluate('WEB_FONT_MANAGER_FIXTURE.first:RegisterFont("x","y")'),/owner is removed/);
    assert.throws(()=>evaluate('WEB_FONT_MANAGER_FIXTURE.entities[1].entity:AddFontManager()'),/removed entity/);
    evaluate('TheSim:UnloadPrefabs({"fm_fonts"})');assert.equal(evaluate('return WebFonts.Registry("web_manager_valid")'),'nil');
    assert.equal(evaluate('return WebFonts.Registry("web_manager_removed")'),'nil');
  }
});
test('FontManager is available in all roles and shares the alias budget with TheSim without silent allocation',async t=>{
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());
    evaluate('WEB_FM_SAFE=CreateEntity("fm_safe");WEB_FM_SAFE.entity:AddFontManager()');
    for(const args of ['false,"alias"','"path",nil','"path",{}'])assert.throws(()=>evaluate(`WEB_FM_SAFE.FontManager:RegisterFont(${args})`));
    evaluate('for i=1,8192 do WEB_FM_SAFE.FontManager:RegisterFont("missing","fm_budget_"..i)end');
    assert.throws(()=>evaluate('WEB_FM_SAFE.FontManager:RegisterFont("missing","over")'),/alias count exceeds/);
    assert.throws(()=>evaluate('TheSim:LoadFont("missing","also_over")'),/alias count exceeds/);
    evaluate('WEB_FM_SAFE.FontManager:RegisterFont("other","FM_BUDGET_1",{});WEB_FM_SAFE:Remove()');
    assert.equal(evaluate('return WebComponents.FontManager().fontManagers'),'0');
    assert.equal(evaluate('return tostring(WebFonts.Registry("fm_budget_1").resolved)'),'false');
    assert.equal(evaluate('return WebComponents.FontManager(0/0)'),'nil');assert.equal(evaluate('return WebComponents.FontManager(math.huge)'),'nil');
    evaluate('TheSim:UnloadFont("fm_budget_1");TheSim:LoadFont("missing","new_alias")');
    assert.equal(evaluate('return tostring(WebFonts.Registry("new_alias").resolved)'),'false');
  }
});

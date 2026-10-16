import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(path){
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));assert.equal(report.oracleComplete,true);assert.equal(report.resourceCaptureError,null);
  const bytes=await readFile(new URL('../'+path,import.meta.url));const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);assert.ok(key);assert.equal(hash(bytes),report.fixtureSha256[key]);return bytes;
}
test('original LoadFonts and native alias/fallback mutations match the read-only native registry',async t=>{
  const native=JSON.parse(await fixture('output/native-reference/resource-managers.json'));
  const original=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(await fixture('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_font_binding_trace'))));
  const source=await readFile(new URL('../tools/native_asset_trace.lua',import.meta.url),'utf8');const block=source.split('-- FONT_BINDING_ORACLE_BEGIN')[1].split('-- FONT_BINDING_ORACLE_END')[0];
  const {engine,evaluate,evaluateAsync,assets}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  const main=engine.FS.readFile('/scripts/main.lua',{encoding:'utf8'}),end=main.indexOf('SetInstanceParameters(json_settings)');assert.ok(end>0);
  evaluate(main.slice(0,end)+'\nLoadPrefabFile("prefabs/global",true)',100000000);
  await evaluateAsync('TheSim:LoadPrefabs({"global"});LoadFonts()',100000000);
  const before=assets.stats.fetches;const result=JSON.parse(evaluate(block+'\nreturn json.encode_compliant(font_binding_trace)'));assert.deepEqual(result,original);
  assert.equal(assets.stats.fetches,before,'LoadFont must never fetch or decode an uncached path');
  const registry=JSON.parse(evaluate('return json.encode_compliant(WebFonts.Registry())'));
  assert.deepEqual(registry,native.fontAliases.map(row=>row.path?row:{id:row.id,resolved:row.resolved}));
  for(const row of native.fonts){
    const actual=JSON.parse(evaluate(`return json.encode_compliant(WebFonts.Inspect(${JSON.stringify(row.path)}))`));
    assert.equal(Math.fround(actual.advance),row.advance);assert.equal(actual.colourEnabled,row.colourEnabled);assert.deepEqual(actual.fallbacks,row.fallbacks);
  }
  assert.equal(evaluate('return WebFonts.Inspect("fonts/stint-ucr20.zip")'),'nil','explicit UnloadFont releases the resource and removes its aliases/fallback references');
  assert.equal(evaluate('return WebFonts.Registry("stint-small")'),'nil');
});
test('aliases do not own resources; failed and shared bindings retain native lifetime rules',async t=>{
  const {engine,evaluate,evaluateAsync,assets}=await loadEngine(2,{resources:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
  evaluate('TheSim:LoadFont("fonts/talkingfont.zip","not_loaded");assert(not WebFonts.Registry("not_loaded").resolved)');assert.equal(assets.stats.fetches,0);
  evaluate('TheSim:RegisterPrefab("font_parent",{{type="FONT",file="fonts/talkingfont.zip"}},{});TheSim:RegisterPrefab("font_fallback",{{type="FONT",file="fonts/bellefair50.zip"}}, {})');
  await evaluateAsync('TheSim:LoadPrefabs({"font_parent","font_fallback"})');
  evaluate('TheSim:LoadFont("fonts/talkingfont.zip","not_loaded");assert(not WebFonts.Registry("not_loaded").resolved);TheSim:UnloadFont("not_loaded");TheSim:LoadFont("fonts/talkingfont.zip","primary");TheSim:LoadFont("fonts/talkingfont.zip","shared",true);TheSim:LoadFont("fonts/bellefair50.zip","secondary");TheSim:SetupFontFallbacks("primary",{"secondary","secondary"})');
  assert.equal(evaluate('return WebFonts.Inspect("fonts/talkingfont.zip").references'),'1');assert.equal(evaluate('return tostring(WebFonts.Inspect("fonts/talkingfont.zip").colourEnabled)'),'false');
  assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebFonts.Inspect("fonts/talkingfont.zip").fallbacks)')),['fonts/bellefair50.zip']);
  evaluate('TheSim:SetupFontFallbacks("primary",{});TheSim:UnloadPrefabs({"font_fallback"})');assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebFonts.Inspect("fonts/talkingfont.zip").fallbacks)')),[]);
  assert.equal(evaluate('return WebFonts.Registry("secondary")'),'nil');
  evaluate('TheSim:UnloadFont("shared")');assert.equal(evaluate('return WebFonts.Registry("primary")'),'nil');assert.equal(evaluate('return WebFonts.Inspect().fonts'),'0');
  evaluate('TheSim:UnloadPrefabs({"font_parent"})');assert.equal(evaluate('return WebFonts.Inspect().retainedBytes'),'0');
});

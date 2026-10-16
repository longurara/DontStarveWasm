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
  async function checked(path){
    const bytes=await readFile(new URL('../'+path,import.meta.url));
    const key=Object.keys(attempt.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
    assert.ok(key,path);assert.equal(hash(bytes),attempt.fixtureSha256[key]);return bytes;
  }
  const bytes=await checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_text_widget_trace');
  const native=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const memory=JSON.parse(await checked('output/native-reference/entity-flags.json'));
  assert.equal(memory.textWidget.traceSha256,hash(bytes));
  const source=await readFile(new URL('../tools/native_entity_trace.lua',import.meta.url),'utf8');
  assert.equal(hash(Buffer.from(source)),attempt.sourceSha256['web-port\\tools\\native_entity_trace.lua']);
  const block=source.split('-- TEXT_WIDGET_ORACLE_BEGIN')[1].split('-- TEXT_WIDGET_ORACLE_END')[0];
  const catalog=JSON.parse(await readFile(new URL('../output/font-catalog.json',import.meta.url)));
  const fontFiles=new Map();
  for(const path of ['fonts/bellefair50.zip','fonts/controllers.zip','fonts/emoji.zip','fonts/fallback.zip','fonts/fallback_full_packed.zip']){
    const row=catalog.cases.find(item=>item.path===path);assert.ok(row,path);
    const data=await readFile(new URL('../output/'+row.fixture,import.meta.url));
    assert.equal(hash(data),row.sourceSha256);
    fontFiles.set(path,data);
  }
  return {native,memory:memory.textWidget,block,fontFiles};
}

test('all TextWidget calls, UTF-8 glyph layout, fallbacks, wrapping and overflow match native in every WASM role',async t=>{
  const {native,memory,block,fontFiles}=await fixture();
  const clean=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['guid','first','second'].includes(key)));
  for(const role of [0,1,2]){
    const {engine,evaluate,evaluateAsync}=await loadEngine(role);t.after(()=>engine._dst_close());
    if(role===0){
      const textures=new Set();
      engine.nativeTextureBackendReady=()=>true;
      engine.hasNativeTexture=id=>textures.has(id>>>0);
      engine.beginNativeTexture=id=>textures.add(id>>>0);
      engine.uploadNativeTexture=()=>{};
      engine.finishNativeTexture=()=>{};
      engine.releaseNativeTexture=id=>textures.delete(id>>>0);
    }
    evaluate('json=require("json")');
    engine.FS.mkdirTree('/fonts');
    for(const [path,data] of fontFiles)engine.FS.writeFile('/'+path,data);
    evaluate(`
      TheSim:RegisterPrefab("web_text_fonts",{
        {type="FONT",file="fonts/bellefair50.zip"},
        {type="FONT",file="fonts/controllers.zip"},
        {type="FONT",file="fonts/emoji.zip"},
        {type="FONT",file="fonts/fallback.zip"},
        {type="FONT",file="fonts/fallback_full_packed.zip"},
      },{})
    `);
    await evaluateAsync('TheSim:LoadPrefabs({"web_text_fonts"})');
    evaluate(`
      TheSim:LoadFont("fonts/controllers.zip","controllers",false)
      TheSim:LoadFont("fonts/emoji.zip","emoji",false)
      TheSim:LoadFont("fonts/fallback.zip","fallback_font",false)
      TheSim:LoadFont("fonts/fallback_full_packed.zip","fallback_font_full",false)
      TheSim:LoadFont("fonts/bellefair50.zip","web_font_secondary",true)
      TheSim:SetupFontFallbacks("web_font_secondary",{"controllers","emoji","fallback_font","fallback_font_full"})
    `);
    const initial=JSON.parse(evaluate('return json.encode_compliant(WebTextWidgets.Inspect())'));
    const actual=JSON.parse(evaluate(block+'\nreturn text_json'));
    assert.deepEqual(actual.objects.map(clean),native.objects.map(clean));
    assert.deepEqual(actual.calls,native.calls);
    assert.equal(actual.states.length,native.states.length);
    for(let i=0;i<native.states.length;++i){
      const exp=native.states[i],act=actual.states[i];
      assert.equal(act.name,exp.name);
      assert.deepEqual(act.string,exp.string,exp.name+': string');
      assert.deepEqual(act.overflow,exp.overflow,exp.name+': overflow');
      assert.equal(Math.fround(act.region[0]),Math.fround(exp.region[0]),exp.name+': region[0]');
      assert.equal(Math.fround(act.region[1]),Math.fround(exp.region[1]),exp.name+': region[1]');
    }
    for(const reference of memory.components){
      const guid=actual.objects.find(row=>row.name===reference.name).guid;
      const state=JSON.parse(evaluate(`return json.encode_compliant(WebTextWidgets.Inspect(${guid}))`));
      assert.equal(state.typeId,0xaa926b71);assert.equal(state.rendererReady,false);
      assert.equal(state.fontResolved,reference.fontHandle!==-1,reference.name+'/fontResolved');
      for(const key of ['dirty','sizeBits','squeezeBits','regionBits','wordWrap','whitespaceWrap','hAnchor','vAnchor','colourBits','autoRegionSize','text','showEditCursor','cursorIndex','editCursorColourBits']){
        assert.deepEqual(state[key],reference[key],reference.name+'/'+key);
      }
      assert.equal(reference.typeFunction,'0x1400a1950');
      assert.equal(reference.finalizeFunction,'0x14003d000');
      assert.equal(reference.destroyFunction,'0x1400a1960');
    }
    evaluate('WEB_TEXT_FIXTURE.main:Remove();WEB_TEXT_FIXTURE.defaults:Remove();WEB_TEXT_FIXTURE.wrapped:Remove()');
    assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebTextWidgets.Inspect())')),initial);
    assert.equal(evaluate('return select("#",WEB_TEXT_FIXTURE.main.TextWidget:GetRegionSize())'),'0');
    assert.equal(evaluate('return select("#",WEB_TEXT_FIXTURE.main.TextWidget:GetString())'),'0');
    assert.equal(evaluate('return tostring(WEB_TEXT_FIXTURE.main.entity:AddTextWidget())'),'nil');
    evaluate('TheSim:UnloadPrefabs({"web_text_fonts"})');
  }
});

test('original widgets/text constructs and measures strings with original fonts',async t=>{
  const {engine,evaluate,evaluateAsync}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  await evaluateAsync('dofile("/scripts/main.lua")',100000000);
  evaluate('LoadPrefabFile("prefabs/global",true)');
  await evaluateAsync('TheSim:LoadPrefabs({"global"});LoadFonts()',100000000);
  const before=engine._dst_entity_count();
  const result=JSON.parse(evaluate(`
    local Text=require("widgets/text")
    local label=Text(HEADERFONT,50,"AV")
    local w,h=label:GetRegionSize()
    local ok_fit=label:SetMultilineTruncatedString("AV AV AV AV",2,60,10,true)
    local out=json.encode_compliant({width=w,height=h,string=label:GetString(),truncated=ok_fit~=nil})
    label.inst:Remove()
    return out
  `));
  assert.equal(result.width,60);
  assert.equal(result.height,40);
  assert.equal(result.truncated,true);
  assert.equal(engine._dst_entity_count(),before);
  assert.equal(evaluate('return WebTextWidgets.Inspect().textWidgets'),'0');
});

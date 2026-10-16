import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../tools/load-engine.mjs';

test('original prefab global/event definitions marshal into the native registry and queue real resource paths',async t=>{
  const {engine,evaluate}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});t.after(()=>engine._dst_close());
  const main=engine.FS.readFile('/scripts/main.lua',{encoding:'utf8'}),marker='SetInstanceParameters(json_settings)',end=main.indexOf(marker);assert.ok(end>0);
  evaluate(main.slice(0,end)+'\nLoadPrefabFile("prefabs/global",true);LoadPrefabFile("prefabs/event_deps",true)',100000000);
  const names=JSON.parse(evaluate('local names={};for name in pairs(Prefabs)do names[#names+1]=name end;return json.encode(names)'));
  const kinds=new Set(JSON.parse(evaluate('return json.encode(WebPrefabs.Kinds())')).map(row=>row.name));
  assert.ok(names.length>2);
  for(const name of names){
    const key=JSON.stringify(name);
    const lua=JSON.parse(evaluate(`return json.encode({assets=Prefabs[${key}].assets,deps=Prefabs[${key}].deps})`,20000000));
    lua.assets=lua.assets.filter(asset=>kinds.has(asset.type));
    const native=JSON.parse(evaluate(`return json.encode(WebPrefabs.Inspect(${key}))`,20000000));
    assert.deepEqual(native,lua,name);
  }
  const verification=JSON.parse(evaluate('return json.encode(WebPrefabs.VerifyBatch())'));
  assert.ok(verification.checkedFiles>5000);assert.deepEqual(verification.missing,[]);
  const before=evaluate('return WebPrefabs.Inspect("global").assets[1].file');
  evaluate('Prefabs.global.assets[1].file="changed-after-registration"');
  assert.equal(evaluate('return WebPrefabs.Inspect("global").assets[1].file'),before);
  evaluate('TheSim:AddBatchVerifyFileExists("web-port/definitely-missing")');
  assert.deepEqual(JSON.parse(evaluate('return json.encode(WebPrefabs.VerifyBatch().missing)')),['web-port/definitely-missing']);
  assert.throws(()=>evaluate('TheSim:LoadPrefabs({"global"})'),/ASYNC_RESOURCE_REQUIRED/,'metadata registration does not eagerly materialize native resource bytes');
  evaluate('TheSim:StartFileExistsAsync();TheSim:UnregisterAllPrefabs()');
  assert.equal(evaluate('return tostring(WebPrefabs.Inspect("global")~=nil and WebPrefabs.Inspect("event_deps")==nil)'),'true');
});

test('original achievements register metadata without platform account calls',async t=>{
  const {engine,evaluate}=await loadEngine(1,{fullScripts:true});t.after(()=>engine._dst_close());evaluate('json=require("json")');
  evaluate('for _,value in ipairs(dofile("/scripts/achievements.lua"))do TheGameService:RegisterAchievement(value.name,value.id.steam,value.id.psn)end');
  const actual=JSON.parse(evaluate('return json.encode(WebAchievements.Inspect())'));
  const reference=JSON.parse(evaluate('local out={};for _,value in ipairs(Achievements)do out[value.name]=value.id.steam end;return json.encode(out)'));
  assert.deepEqual(actual,reference);assert.ok(Object.keys(actual).length>20);
  assert.throws(()=>evaluate('TheGameService:AwardAchievement("survive_20")'),/UNIMPLEMENTED_NATIVE/);
});

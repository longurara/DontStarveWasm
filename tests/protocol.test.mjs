import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCompatibility, validateCheckpoint, validateCommand, safeAssetPath } from '../src/protocol.mjs';

const compatibility={gameBuild:'756039',engineVersion:'0.1.0',schemaVersion:1,contentHash:'test-content'};
const snapshot=role=>({kind:'engine-diagnostic-v1',role,tick:30,uses:95,position:[1,0,2],rotation:0,events:[],rngState:'0000000000000000'});
const checkpoint=()=>({...compatibility,kind:'diagnostic-checkpoint-v1',tick:30,shards:{master:snapshot('master'),caves:snapshot('caves')}});
test('manifest/session compatibility rejects mixed content and builds',()=>{
  assert.doesNotThrow(()=>assertCompatibility(compatibility,compatibility));
  for(const field of Object.keys(compatibility))assert.throws(()=>assertCompatibility({...compatibility,[field]:'wrong'},compatibility),new RegExp(field));
});
test('checkpoint rejects incomplete or inconsistent shard barriers and native formats',()=>{
  assert.equal(validateCheckpoint(checkpoint(),compatibility).tick,30);
  const bad=checkpoint();bad.shards.caves.tick=29;assert.throws(()=>validateCheckpoint(bad,compatibility),/caves/);
  const missing=checkpoint();delete missing.shards.master;assert.throws(()=>validateCheckpoint(missing,compatibility),/master/);
  assert.throws(()=>validateCheckpoint({...checkpoint(),kind:'native'},compatibility),/native DST import/);
});
test('diagnostic commands cannot inject Lua or modify unsupported state',()=>{
  assert.equal(validateCommand({type:'consume',amount:5,sequence:1}).amount,5);
  for(const amount of [-1,0,11,'5);error("injected")'])assert.throws(()=>validateCommand({type:'consume',amount,sequence:1}));
  assert.throws(()=>validateCommand({type:'teleport',amount:5,sequence:1}));
});
test('asset paths cannot escape the generated pack root',()=>{
  for(const value of ['../save','/absolute','a/../b','a\\b','a/./b',''])assert.throws(()=>safeAssetPath(value));
  assert.equal(safeAssetPath('scripts/components/finiteuses.lua'),'scripts/components/finiteuses.lua');
});

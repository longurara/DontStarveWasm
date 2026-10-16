import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../tools/load-engine.mjs';

test('original EntityScript removal cancels tasks, retires userdata and cleans event ownership',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  evaluate('GONE=CreateEntity("lifecycle");GONE.entity:AddTransform();GONE:ListenForEvent("onremove",function(inst) REMOVAL_VALID=inst:IsValid();REMOVAL_REGISTERED=Ents[inst.GUID]~=nil end);GONE:DoTaskInTime(1,function() error("Removed task ran") end);GONE:Remove()');
  assert.equal(evaluate('return tostring(REMOVAL_VALID)..":"..tostring(REMOVAL_REGISTERED)..":"..tostring(GONE:IsValid())'),'true:false:false');
  assert.equal(engine._dst_entity_count(),0);
  assert.equal(engine._dst_tick(40),0);
  assert.equal(evaluate('return NumEnts'),'0');
  assert.equal(evaluate('return tostring(GONE.entity:GetGUID())'),'nil');
  assert.throws(()=>evaluate('GONE.Transform:GetWorldPosition()'),/removed/);
});
test('entity hierarchy applies parent transforms, rejects cycles and removes children',async t=>{
  const {engine,evaluate}=await loadEngine();t.after(()=>engine._dst_close());
  evaluate('P=CreateEntity();P.entity:AddTransform();P.Transform:SetPosition(10,0,20);P.Transform:SetRotation(90);C=CreateEntity();C.entity:AddTransform();P:AddChild(C);C.Transform:SetPosition(1,0,0)');
  const xyz=evaluate('local x,y,z=C.Transform:GetWorldPosition();return x..","..y..","..z').split(',').map(Number);
  assert.deepEqual(xyz,[10,0,19]);
  assert.equal(evaluate('return C.entity:GetParent()==P.entity and "yes" or "no"'),'yes');
  assert.throws(()=>evaluate('P.entity:SetParent(C.entity)'),/hierarchy cycle/);
  evaluate('P:Remove()');
  assert.equal(engine._dst_entity_count(),0);assert.equal(evaluate('return tostring(C:IsValid())'),'false');
});

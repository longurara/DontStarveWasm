import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../tools/load-engine.mjs';

test('SoundEmitter component binds to Entity, tracks named/one-shot sounds, parameters, mute, and GetEntity', async t => {
  const { engine, evaluate } = await loadEngine(1);
  t.after(() => engine._dst_close());
  evaluate('json = require("json")');

  const raw = evaluate(`
    Ents = {}
    local e = TheSim:CreateEntity()
    local id = e:GetGUID()
    local inst = { entity = e, tag = "test_inst" }
    Ents[id] = inst

    local se1 = e:AddSoundEmitter()
    local se2 = e:AddSoundEmitter()
    assert(Ents[id].SoundEmitter == se2)
    assert(tostring(se1):match("^SoundEmitter %(") ~= nil)
    assert(se1:GetEntity() == inst)

    se1:PlaySound("dontstarve/HUD/click_move")
    se1:PlaySound("dontstarve/HUD/click_move")
    se1:PlaySound("dontstarve/music/music_FE", "FEMusic", 0.75, true)
    se1:PlaySound("dontstarve/music/music_FE_alt", "FEMusic", 0.25, false)
    assert(se2:PlayingSound("FEMusic") == true)
    assert(se2:PlayingSound("other") == false)

    se1:SetVolume("FEMusic", 0.5)
    se1:SetParameter("FEMusic", "intensity", 0.8)
    se1:OverrideVolumeMultiplier(0.6)
    se1:PlaySoundWithParams("dontstarve/rain/rain", { intensity = 0.4, wetness = 0.9 }, 0.9)
    local active_state = WebSoundEmitters.Inspect(id)

    se1:KillSound("FEMusic")
    local after_kill = se2:PlayingSound("FEMusic")

    se1:PlaySound("dontstarve/HUD/loop", "loop1")
    se1:SetMute(true)
    local after_mute_playing = se2:PlayingSound("loop1")
    se1:PlaySound("dontstarve/HUD/loop2", "loop2")
    local muted_state = WebSoundEmitters.Inspect(id)
    se1:SetMute(false)
    se1:PlaySound("dontstarve/HUD/loop3", "loop3")
    se1:KillAllSounds()
    local after_kill_all = se2:PlayingSound("loop3")

    e:Retire()
    return json.encode_compliant({
      activeState = active_state,
      afterKill = after_kill,
      afterMutePlaying = after_mute_playing,
      mutedState = muted_state,
      afterKillAll = after_kill_all,
      summary = WebSoundEmitters.Inspect(),
    })
  `);

  const res = JSON.parse(raw);
  assert.equal(res.activeState.typeId, 0xeea70eff);
  assert.equal(res.activeState.muted, false);
  assert.ok(Math.abs(res.activeState.volumeMultiplier - 0.6) < 1e-6);
  assert.equal(res.activeState.oneShotCount, 1);
  assert.equal(res.activeState.activeSoundCount, 1);
  assert.equal(res.activeState.activeSounds.FEMusic.event, 'dontstarve/music/music_FE');
  assert.equal(res.activeState.activeSounds.FEMusic.volume, 0.5);
  assert.equal(res.activeState.activeSounds.FEMusic.autonamed, true);
  assert.ok(Math.abs(res.activeState.activeSounds.FEMusic.params.intensity - 0.8) < 1e-6);
  assert.equal(res.afterKill, false);
  assert.equal(res.afterMutePlaying, false);
  assert.equal(res.mutedState.muted, true);
  assert.equal(res.mutedState.activeSoundCount, 0);
  assert.equal(res.afterKillAll, false);
  assert.equal(res.summary.soundEmitters, 0);
});

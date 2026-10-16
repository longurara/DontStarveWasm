import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../tools/load-engine.mjs';

test('ImageWidget component binds to Entity, resolves owned ATLAS regions, and tracks native visual state', async t => {
  const { engine, evaluate } = await loadEngine(1);
  t.after(() => engine._dst_close());
  evaluate('json = require("json")');
  engine.FS.mkdirTree('/fixture');
  const xml = '<Atlas><Texture filename="ui.tex"/><Elements>'
    + '<Element name="button.tex" u1="0.125" v1="0.25" u2="0.625" v2="0.75"/>'
    + '<Element name="fallback.tex" u1="0.0" v1="0.0" u2="1.0" v2="1.0"/>'
    + '</Elements></Atlas>';
  engine.FS.writeFile('/fixture/ui.xml', new TextEncoder().encode(xml));
  evaluate('TheSim:RegisterPrefab("ui_test", {{type="DYNAMIC_ATLAS", file="fixture/ui.xml"}}, {})');
  evaluate('TheSim:LoadPrefabs({"ui_test"})');

  const raw = evaluate(`
    Ents = {}
    local e = TheSim:CreateEntity()
    local id = e:GetGUID()
    Ents[id] = { entity = e }
    local iw1 = e:AddImageWidget()
    local iw2 = e:AddImageWidget()
    assert(Ents[id].ImageWidget == iw2)
    assert(tostring(iw1):match("^ImageWidget %(") ~= nil)

    local init = WebImageWidgets.Inspect(id)
    iw1:SetTexture("fixture/ui.xml", "missing.tex", "fallback.tex")
    local after_fallback = WebImageWidgets.Inspect(id)
    iw1:SetTexture("fixture/ui.xml", "button.tex")
    local after_primary = WebImageWidgets.Inspect(id)

    iw1:SetSize(128.5, 64.25)
    local w, h = iw2:GetSize()
    iw1:SetHAnchor(1)
    iw1:SetVAnchor(2)
    iw1:SetHAnchor(9)
    iw1:SetTint(1, 0.5, 0.25, 0.75)
    iw1:SetAlphaRange(0.2, 0.8)
    iw1:SetBlendMode(2)
    iw1:SetUVMode(0)
    iw1:SetUVScale(2.0, 3.0)
    iw1:SetEffect("shaders/ui_cc.ksh")
    iw1:SetEffectParams(0.1, 0.2, 0.3, 0.4)
    iw1:SetEffectParams2(0.5, 0.6, 0.7, 0.8)
    iw1:EnableEffectParams(false)
    iw1:SetRadiusForRayTraces(5.0)
    iw1:SetTextureHandle(42)
    local final_state = WebImageWidgets.Inspect(id)
    local atlas_state = WebAtlases.Inspect("fixture/ui.xml")

    e:Retire()
    local after_retire = WebImageWidgets.Inspect(id)
    return json.encode_compliant({
      init = init,
      afterFallback = after_fallback,
      afterPrimary = after_primary,
      size = { w, h },
      finalState = final_state,
      atlasTextureLoaded = atlas_state.textureLoaded,
      afterRetire = after_retire,
      summary = WebImageWidgets.Inspect(),
    })
  `);
  const res = JSON.parse(raw);
  assert.equal(res.init.typeId, 0x38c7a65f);
  assert.equal(res.init.textureHandle, -1);
  assert.equal(res.init.hasRegion, false);
  assert.equal(res.init.blendMode, 3);
  assert.equal(res.init.uvMode, 1);
  assert.equal(res.init.tintBits, 'ffffffff');
  assert.equal(res.afterFallback.hasRegion, true);
  assert.equal(res.afterFallback.uvBits, '00000000000000000000803f0000803f');
  assert.equal(res.afterPrimary.hasRegion, true);
  assert.equal(res.afterPrimary.uvBits, '0000003e0000803e0000203f0000403f');
  assert.equal(res.atlasTextureLoaded, true);
  assert.deepEqual(res.size, [128.5, 64.25]);
  assert.equal(res.finalState.hAnchor, 1);
  assert.equal(res.finalState.vAnchor, 2);
  assert.equal(res.finalState.tintBits, 'ff8040bf');
  assert.equal(res.finalState.blendMode, 2);
  assert.equal(res.finalState.uvMode, 0);
  assert.equal(res.finalState.effect, 'shaders/ui_cc.ksh');
  assert.equal(res.finalState.enableEffectParams, false);
  assert.equal(res.finalState.enableEffectParams2, true);
  assert.equal(res.finalState.radiusSqBits, '0000c841'); // 25.0f
  assert.equal(res.finalState.textureHandle, 42);
  assert.equal(res.afterRetire, undefined);
  assert.equal(res.summary.imageWidgets, 0);
});

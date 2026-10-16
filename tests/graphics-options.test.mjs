import assert from "node:assert/strict";
import test from "node:test";
import createEngine from "../public/generated/engine/engine.mjs";

test("GraphicsOptions component implements native 21-method surface", async () => {
    const engine = await createEngine();
    assert.equal(engine._dst_init(0), 0);

    const script = `
        Ents = {}
        local e = TheSim:CreateEntity()
        local guid = e:GetGUID()
        Ents[guid] = { entity = e }
        local go = e:AddGraphicsOptions()
        assert(Ents[guid].GraphicsOptions == go)
        assert(tostring(go):find("^GraphicsOptions %(") ~= nil)

        assert(go:IsFullScreen() == false)
        assert(go:IsFullScreenEnabled() == true)
        go:ToggleFullScreen()
        assert(go:IsFullScreen() == true)
        go:SetFullScreen(false)
        assert(go:IsFullScreen() == false)

        assert(go:GetNumDisplays() == 1)
        assert(go:GetDisplayName(0) == "")
        assert(go:GetNumDisplayModes(0) == 1)
        local w, h, hz = go:GetDisplayMode(0, 0)
        assert(w == 1280 and h == 720 and hz == 60)
        assert(go:GetNumRefreshRates(0, 1280, 720) == 1)
        assert(go:GetRefreshRate(0, 1280, 720, 0) == 60)
        assert(go:GetFullscreenDisplayID() == 0)
        assert(go:GetFullscreenDisplayRefreshRate() == 60)
        assert(go:GetCurrentDisplayModeID(0) == 0)

        go:SetDisplayMode(0, 0, true)
        assert(go:IsFullScreen() == true)

        go:EnableStencil()
        go:EnableLightMapComponent()
        assert(go:IsSmallTexturesMode() == false)
        assert(go:GetSmallTexturesModeSettingValue() == false)
        go:SetSmallTexturesMode(true)
        assert(go:IsSmallTexturesMode() == true)
        assert(go:GetSmallTexturesModeSettingValue() == true)

        local info = WebGraphicsOptions.Inspect(guid)
        assert(info.kind == "GraphicsOptions")
        assert(info.typeId == 0xab1f3b13)
        assert(info.stencilEnabled == true)
        assert(info.lightMapEnabled == true)
        assert(info.smallTexturesMode == true)

        go:DisableStencil()
        go:DisableLightMapComponent()
        info = WebGraphicsOptions.Inspect(guid)
        assert(info.stencilEnabled == false)
        assert(info.lightMapEnabled == false)

        e:Retire()
        assert(WebGraphicsOptions.Inspect(guid) == nil)
    `;
    const status = engine.ccall("dst_eval", "number", ["string"], [script]);
    assert.equal(status, 0, engine.ccall("dst_result", "string", [], []));
    engine._dst_close();
});

import assert from "node:assert/strict";
import test from "node:test";
import createEngine from "../public/generated/engine/engine.mjs";

test("TwitchOptions component implements native 19-method surface", async () => {
    const engine = await createEngine();
    assert.equal(engine._dst_init(0), 0);

    const script = `
        Ents = {}
        local e = TheSim:CreateEntity()
        local guid = e:GetGUID()
        Ents[guid] = { entity = e }
        local to = e:AddTwitchOptions()
        assert(Ents[guid].TwitchOptions == to)
        assert(tostring(to):find("^TwitchOptions %(") ~= nil)

        assert(to:IsStreaming() == false)
        assert(to:SupportedByPlatform() == false)
        assert(to:Start() == false)
        assert(to:IsInitialized() == false)
        assert(to:IsPastInitializedState() == false)
        assert(to:GetStreamingState() == 0)
        assert(to:GetStreamingStateString() == "Uninitialized")
        assert(to:GetUserName() == "")
        assert(to:GetChannelURL() == "")
        assert(to:GetChannelName() == "")
        assert(to:GetBroadcastingEnabled() == false)
        assert(to:GetVisibleChatEnabled() == false)

        to:Login()
        assert(to:GetBroadcastingEnabled() == true)

        to:SetVisibleChatEnabled(true)
        assert(to:GetVisibleChatEnabled() == true)

        to:SetBroadcastingEnabled(false)
        to:ToggleStreaming()
        to:Stop()
        to:SaveSettings()

        to:Forget()
        assert(to:GetStreamingState() == 1)
        assert(to:GetStreamingStateString() == "Stream Logged Out")
        assert(to:IsInitialized() == true)
        assert(to:IsPastInitializedState() == false)

        local info = WebTwitchOptions.Inspect(guid)
        assert(info.kind == "TwitchOptions")
        assert(info.typeId == 0x4eb52701)
        assert(info.streamingState == 1)
        assert(info.visibleChatEnabled == true)

        e:Retire()
        assert(WebTwitchOptions.Inspect(guid) == nil)
    `;
    const status = engine.ccall("dst_eval", "number", ["string"], [script]);
    assert.equal(status, 0, engine.ccall("dst_result", "string", [], []));
    engine._dst_close();
});

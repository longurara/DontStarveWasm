import assert from "node:assert/strict";
import test from "node:test";
import createEngine from "../public/generated/engine/engine.mjs";

test("AccountManager component implements native 17-method surface", async () => {
    const engine = await createEngine();
    assert.equal(engine._dst_init(0), 0);

    const script = `
        Ents = {}
        local e = TheSim:CreateEntity()
        local guid = e:GetGUID()
        Ents[guid] = { entity = e }
        local am = e:AddAccountManager()
        assert(Ents[guid].AccountManager == am)
        assert(tostring(am):find("^AccountManager %(") ~= nil)

        assert(am:HasAuthToken() == false)
        assert(am:HasSteamTicket() == false)
        assert(am:IsWaitingForResponse() == false)
        assert(am:MustUpgradeClient() == false)
        assert(am:CommunicationSucceeded() == false)
        assert(am:GetUsername() == "")
        assert(am:GetToken() == nil)
        assert(am:ValidateToken() == nil)

        local banned, reason = am:IsBanned()
        assert(banned == false and reason == "")

        assert(am:Login("Client Login") == "")
        assert(am:TokenPurpose("Client Login") == "Client Login")
        assert(am:CancelLogin() == false)
        am:VisitAccountPage("rewards")
        assert(am:CreateAccount("u", "p", "e") == "")
        assert(am:RecoverPassword("u", "e") == "")
        assert(am:AddGameKeyToAccount("u", "k") == nil)

        local info = WebAccountManager.Inspect(guid)
        assert(info.kind == "AccountManager")
        assert(info.typeId == 0x49b209a0)
        assert(info.tokenPurpose == "Client Login")
        assert(info.lastVisitedPage == "rewards")

        am:Logout()
        info = WebAccountManager.Inspect(guid)
        assert(info.tokenPurpose == "")

        e:Retire()
        assert(WebAccountManager.Inspect(guid) == nil)
    `;
    const status = engine.ccall("dst_eval", "number", ["string"], [script]);
    assert.equal(status, 0, engine.ccall("dst_result", "string", [], []));
    engine._dst_close();
});

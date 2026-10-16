import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEngine } from '../tools/load-engine.mjs';

test('Sim spatial tag queries, WorldPointInPoly, time scale, ambient colour, and sparse prefab deps match native 756039', async () => {
  const { engine, evaluate } = await loadEngine(1);
  try {
    const out = JSON.parse(evaluate(`
      local json = require("json")
      Ents = {}
      Prefabs = {}

      local function make_ent(x, y, z, tags)
        local e = TheSim:CreateEntity()
        e:AddTransform()
        e:SetPosition(x, y, z)
        for _, t in ipairs(tags or {}) do e:AddTag(t) end
        local id = e:GetGUID()
        Ents[id] = { GUID = id, entity = e }
        return id
      end

      local id1 = make_ent(1, 0, 0, {"tree", "plant"})
      local id2 = make_ent(3, 0, 0, {"tree", "burning"})
      local id3 = make_ent(2, 0, 0, {"tree", "INLIMBO"})
      local id4 = make_ent(10, 0, 0, {"tree", "plant"})

      local h1 = TheSim:RegisterFindTags({"tree"}, {"burning"}, nil)
      local h1_dup = TheSim:RegisterFindTags({"tree"}, {"burning"}, nil)
      local h2 = TheSim:RegisterFindTags({"tree", "INLIMBO"}, nil, nil)

      local reg_hits = TheSim:FindEntities_Registered(0, 0, 0, 5, h1)
      local direct_hits = TheSim:FindEntities(0, 0, 0, 5, {"tree"}, nil, {"plant", "burning"})
      local limbo_hits = TheSim:FindEntities_Registered(0, 0, 0, 5, h2)
      local count_trees = TheSim:CountEntities(0, 0, 0, 5, {"tree"})
      local first_burning = TheSim:FindFirstEntityWithTag("burning")

      local inside = TheSim:WorldPointInPoly(2, 2, {{0, 0}, {5, 0}, {5, 5}, {0, 5}})
      local outside = TheSim:WorldPointInPoly(6, 2, {{0, 0}, {5, 0}, {5, 5}, {0, 5}})

      TheSim:SetTimeScale(0.5)
      local ts1 = TheSim:GetTimeScale()
      TheSim:SetTimeScale(-2)
      local ts2 = TheSim:GetTimeScale()

      TheSim:SetAmbientColour(1.0, 0.5, 0.0)
      local ar, ag, ab = TheSim:GetAmbientColour()
      local light = TheSim:GetLightAtPoint(0, 0, 0)

      TheSim:RegisterPrefab("sparse_test", {}, {[1] = "dep_a", [3] = "dep_b", [6] = "dep_c"})
      local sparse_info = WebPrefabs.Inspect("sparse_test")

      return json.encode_compliant({
        h1 = h1,
        h1_dup = h1_dup,
        h2 = h2,
        reg_ids = { reg_hits[1] and reg_hits[1].GUID or nil, reg_hits[2] and reg_hits[2].GUID or nil },
        direct_ids = { direct_hits[1] and direct_hits[1].GUID or nil, direct_hits[2] and direct_hits[2].GUID or nil },
        limbo_ids = { limbo_hits[1] and limbo_hits[1].GUID or nil },
        count_trees = count_trees,
        first_burning = first_burning and first_burning.GUID or nil,
        inside = inside,
        outside = outside,
        ts1 = ts1,
        ts2 = ts2,
        ambient = { ar, ag, ab },
        light_gt_one = light > 1.0,
        sparse_deps = sparse_info.deps,
      })
    `));

    assert.equal(out.h1, 0);
    assert.equal(out.h1_dup, 0);
    assert.equal(out.h2, 1);
    assert.deepEqual(out.reg_ids, [1]);
    assert.deepEqual(out.direct_ids, [1, 2]);
    assert.deepEqual(out.limbo_ids, [3]);
    assert.equal(out.count_trees, 2);
    assert.equal(out.first_burning, 2);
    assert.equal(out.inside, true);
    assert.equal(out.outside, false);
    assert.equal(out.ts1, 0.5);
    assert.equal(out.ts2, 0);
    assert.deepEqual(out.ambient, [255, 128, 0]);
    assert.equal(out.light_gt_one, true);
    assert.deepEqual([...out.sparse_deps].sort(), ['dep_a', 'dep_b', 'dep_c']);
  } finally {
    engine._dst_close();
  }
});

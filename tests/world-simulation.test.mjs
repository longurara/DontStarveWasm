import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../tools/load-engine.mjs';

test('original main.lua boots through Stage 1 and Stage 2, populates TheWorld from native snapshot, and steps simulation ticks', async t => {
  const { engine, evaluate, evaluateAsync } = await loadEngine(1, {
    fullScripts: true,
    diagnosticBootstrap: false,
    resources: true,
  });
  t.after(() => engine._dst_close());

  const shardIndex = await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/shardindex', import.meta.url));
  const sessionSnap = await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/session/15CD1F748D1D1C77/0000000183', import.meta.url));
  const sessionMeta = await readFile(new URL('../output/native-reference/storage/fixtures/Cluster_1/Master/save/session/15CD1F748D1D1C77/0000000183.meta', import.meta.url));

  engine.FS.mkdirTree('/persistent/master/session/15CD1F748D1D1C77');
  engine.FS.writeFile('/persistent/master/shardindex', shardIndex);
  engine.FS.writeFile('/persistent/master/session/15CD1F748D1D1C77/0000000183', sessionSnap);
  engine.FS.writeFile('/persistent/master/session/15CD1F748D1D1C77/0000000183.meta', sessionMeta);

  evaluate(`
    TheNet:StartServer(false)
    RUN_GLOBAL_INIT = false
    json_settings = [=[{"reset_action":1,"save_slot":1}]=]
    local orig_reg = TheSim.RegisterPrefab
    TheSim.RegisterPrefab = function(self, name, assets, deps)
      local filtered = {}
      if assets then
        for i, a in ipairs(assets) do
          if a.type == "ATLAS" or a.type == "FILE" or a.type == "SCRIPT" then
            table.insert(filtered, a)
          end
        end
      end
      return orig_reg(self, name, filtered, deps)
    end
  `);

  await evaluateAsync('dofile("/scripts/main.lua"); json_settings = nil; Start()', 200000000);

  const summary = JSON.parse(evaluate(`
    local json = require("json")
    local w, h = TheWorld.Map:GetSize()
    return json.encode({
      hasFrontEnd = TheFrontEnd ~= nil,
      hasWorld = TheWorld ~= nil,
      worldPrefab = TheWorld.prefab,
      ismastersim = TheWorld.ismastersim,
      inGamePlay = InGamePlay(),
      mapWidth = w,
      mapHeight = h,
      season = TheWorld.state.season,
      phase = TheWorld.state.phase,
      cycles = TheWorld.state.cycles,
      hasPathfinder = TheWorld.Pathfinder ~= nil,
      hasGroundCreep = TheWorld.GroundCreep ~= nil,
      hasMiniMap = TheWorld.minimap ~= nil and TheWorld.minimap.MiniMap ~= nil,
    })
  `));

  assert.equal(summary.hasFrontEnd, true);
  assert.equal(summary.hasWorld, true);
  assert.equal(summary.worldPrefab, 'world');
  assert.equal(summary.ismastersim, true);
  assert.equal(summary.inGamePlay, true);
  assert.equal(summary.mapWidth, 400);
  assert.equal(summary.mapHeight, 400);
  assert.equal(summary.season, 'autumn');
  assert.equal(summary.phase, 'day');
  assert.equal(summary.cycles, 0);
  assert.equal(summary.hasPathfinder, true);
  assert.equal(summary.hasGroundCreep, true);
  assert.equal(summary.hasMiniMap, true);
  assert.ok(engine._dst_entity_count() > 15000);

  const tickStatus = engine._dst_tick(10);
  assert.equal(tickStatus, 0, engine.ccall('dst_result', 'string', [], []));
  assert.equal(engine._dst_tick_count(), 10);
  assert.ok(engine._dst_entity_count() > 17000);
});

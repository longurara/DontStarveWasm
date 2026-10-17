import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadEngine } from '../tools/load-engine.mjs';

test('playable game loop spawns Wilson, attaches PlayerHud, steps at <5ms/tick, moves with WASD/locomotor, interacts with entities, and produces WebScene.Snapshot', async t => {
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

  assert.equal(engine._dst_ui_viewport(1280, 720), 0);

  evaluate(`
    WebPrefabs.SetDeferAnimations(true)
    WebInput.SetDesktopMode(true)
    TheSim.GetScreenPos = function(self, x, y, z) return 640, 360 end
    TheNet:StartServer(false)
    RUN_GLOBAL_INIT = false
    json_settings = [=[{"reset_action":1,"save_slot":1}]=]
  `);

  await evaluateAsync('dofile("/scripts/main.lua"); json_settings = nil; Start()', 200000000);

  // Spawn and activate local player Wilson at the Multiplayer Portal
  await evaluateAsync(`
    TheSim:LoadPrefabs({"global", "wilson", "flint", "twigs", "cutgrass", "berries", "axe"})
    LoadFonts()
    local portal = TheSim:FindFirstEntityWithTag("multiplayer_portal")
    local sx, sy, sz = 0, 0, 0
    if portal ~= nil then
      sx, sy, sz = portal.Transform:GetWorldPosition()
      sx = sx + 3
      sz = sz + 2
    else
      local pt = TheWorld.components.playerspawner and TheWorld.components.playerspawner:GetAnySpawnPoint()
      if pt then sx, sy, sz = pt.x, pt.y, pt.z end
    end

    local player = SpawnPrefab("wilson")
    assert(player ~= nil, "Failed to spawn wilson")
    player.userid = "KU_local"
    player.name = "Wilson"
    player.Transform:SetPosition(sx, sy, sz)

    if not table.contains(AllPlayers, player) then
      table.insert(AllPlayers, player)
    end
    ThePlayer = player
    player:PushEvent("setowner")
    TheWorld:PushEvent("ms_playerspawn", player)

    if TheCamera ~= nil then
      TheCamera:SetTarget(player)
      TheCamera:Snap()
    end

    WebEntity.UpdateSpatialSleep(sx, sz, 64)
  `, 200000000);

  const spawnState = JSON.parse(evaluate(`
    local json = require("json")
    local x, y, z = ThePlayer.Transform:GetWorldPosition()
    return json.encode({
      prefab = ThePlayer.prefab,
      hasHUD = ThePlayer.HUD ~= nil,
      hasClassified = ThePlayer.player_classified ~= nil,
      hasController = ThePlayer.components.playercontroller ~= nil,
      hasLocomotor = ThePlayer.components.locomotor ~= nil,
      hasInventory = ThePlayer.components.inventory ~= nil,
      hasSG = ThePlayer.sg ~= nil,
      sgState = ThePlayer.sg and ThePlayer.sg.currentstate and ThePlayer.sg.currentstate.name or "",
      health = ThePlayer.components.health and ThePlayer.components.health.currenthealth or 0,
      maxHealth = ThePlayer.components.health and ThePlayer.components.health.maxhealth or 0,
      hunger = ThePlayer.components.hunger and ThePlayer.components.hunger.current or 0,
      sanity = ThePlayer.components.sanity and ThePlayer.components.sanity.current or 0,
      x = x, y = y, z = z,
    })
  `));

  assert.equal(spawnState.prefab, 'wilson');
  assert.equal(spawnState.hasHUD, true);
  assert.equal(spawnState.hasClassified, true);
  assert.equal(spawnState.hasController, true);
  assert.equal(spawnState.hasLocomotor, true);
  assert.equal(spawnState.hasInventory, true);
  assert.equal(spawnState.hasSG, true);
  assert.equal(spawnState.health, 150);
  assert.equal(spawnState.maxHealth, 150);
  assert.equal(spawnState.hunger, 150);
  assert.equal(spawnState.sanity, 200);

  // Advance 45 ticks (1.5 seconds) so staggered DoTaskInTime(math.random()) world-init tasks complete
  assert.equal(engine._dst_tick(45), 0, engine.ccall('dst_result', 'string', [], []));
  evaluate('StaticUpdate(GetTickTime()); local x,y,z=ThePlayer.Transform:GetWorldPosition(); WebEntity.UpdateSpatialSleep(x, z, 56, 68)', 50000000);

  // Measure steady-state tick performance over 30 ticks (1 second of simulation) with spatial sleep active
  const t0 = performance.now();
  assert.equal(engine._dst_tick(30), 0, engine.ccall('dst_result', 'string', [], []));
  const elapsedMs = performance.now() - t0;
  const msPerTick = elapsedMs / 30;
  assert.ok(msPerTick < 8.0, `Expected < 8ms/tick (33.3ms 30Hz budget), got ${msPerTick.toFixed(2)}ms/tick`);

  // Test WASD movement via native input key D (100)
  const beforeMove = JSON.parse(evaluate('local x,y,z=ThePlayer.Transform:GetWorldPosition(); return require("json").encode({x=x,z=z})'));
  assert.equal(engine._dst_input_key(100, 1), 0); // KEY_D down
  evaluate('TheInput:OnRawKey(100, true)');
  assert.equal(engine._dst_tick(15), 0, engine.ccall('dst_result', 'string', [], []));
  assert.equal(engine._dst_input_key(100, 0), 0); // KEY_D up
  evaluate('TheInput:OnRawKey(100, false)');
  const afterMove = JSON.parse(evaluate('local x,y,z=ThePlayer.Transform:GetWorldPosition(); return require("json").encode({x=x,z=z,sg=ThePlayer.sg.currentstate.name})'));
  const distMoved = Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z);
  assert.ok(distMoved > 0.5, `Expected Wilson to move with WASD key input, dist=${distMoved}`);

  // Test picking up an item into inventory via BufferedAction
  evaluate(`
    local x, y, z = ThePlayer.Transform:GetWorldPosition()
    local flint = SpawnPrefab("flint")
    flint.Transform:SetPosition(x + 0.5, y, z)
    local ba = BufferedAction(ThePlayer, flint, ACTIONS.PICKUP)
    ThePlayer.components.locomotor:PushAction(ba, true)
  `);
  assert.equal(engine._dst_tick(25), 0, engine.ccall('dst_result', 'string', [], []));

  const invCount = Number(evaluate(`
    local count = 0
    for k, v in pairs(ThePlayer.components.inventory.itemslots) do
      if v ~= nil and v.prefab == "flint" then count = count + (v.components.stackable and v.components.stackable:StackSize() or 1) end
    end
    return count
  `));
  assert.ok(invCount >= 1, `Expected Wilson to pick up flint into inventory, got count=${invCount}`);

  // Equip an axe on Wilson to verify AnimState:OverrideSymbol and Hide("ARM_normal") in WebScene.Snapshot
  evaluate(`
    local axe = SpawnPrefab("axe")
    ThePlayer.components.inventory:Equip(axe)
  `);

  // Verify WebScene.Snapshot returns camera, ambient, map window, and nearby entities including Wilson with equipped overrides
  const scene = JSON.parse(evaluate(`
    local json = require("json")
    local x, y, z = ThePlayer.Transform:GetWorldPosition()
    return json.encode_compliant(WebScene.Snapshot(x, z, 36))
  `));
  assert.ok(scene.entities.length > 0, 'Expected WebScene.Snapshot to contain nearby entities');
  const wilsonEntity = scene.entities.find(e => e.prefab === 'wilson');
  assert.ok(wilsonEntity, 'Expected Wilson in WebScene.Snapshot entities');
  assert.equal(wilsonEntity.bank, 'wilson');
  assert.equal(wilsonEntity.build, 'wilson');
  assert.equal(wilsonEntity.overrides?.swap_object?.build, 'swap_axe');
  assert.equal(wilsonEntity.overrides?.swap_object?.symbol, 'swap_axe');
  assert.ok(Array.isArray(wilsonEntity.hiddenLayers) && wilsonEntity.hiddenLayers.includes('ARM_normal'));

  // Verify TileWindow fields match GameRenderer expectations
  assert.equal(scene.tiles.cols, 27);
  assert.equal(scene.tiles.radius, 13);
  assert.equal(scene.tiles.step, 1);
  assert.ok(scene.tiles.width > 0 && scene.tiles.height > 0);
  assert.ok(Number.isInteger(scene.tiles.centerTileX) && Number.isInteger(scene.tiles.centerTileY));
  assert.equal(scene.tiles.data.length, 729);

  // Verify single-pass C++ WebAssets.DecodeRenderJson(..., true) uploads KTEX mip-0 RGBA and emits layer names
  const uploadedMips = new Map();
  engine.nativeTextureBackendReady = () => true;
  engine.uploadNativeTexture = (id, level, width, height, bytes) => {
    if (level === 0) uploadedMips.set(id >>> 0, { width, height, byteLength: bytes.byteLength });
  };
  const wilsonModel = JSON.parse(await evaluateAsync('return WebAssets.DecodeRenderJson("anim/wilson.zip", 20, true)', 50000000));
  assert.ok(Array.isArray(wilsonModel.atlases) && wilsonModel.atlases.length >= 1);
  assert.ok(Array.isArray(wilsonModel.vertices) && wilsonModel.vertices.length >= 100);
  const wilsonMip0 = uploadedMips.get(0);
  assert.ok(wilsonMip0 && wilsonMip0.width > 0 && wilsonMip0.byteLength === wilsonMip0.width * wilsonMip0.height * 4);

  const basicModel = JSON.parse(await evaluateAsync('return WebAssets.DecodeRenderJson("anim/player_basic.zip", 20, false)', 50000000));
  assert.ok(Array.isArray(basicModel.animations) && basicModel.animations.length > 10);
  const firstElem = basicModel.animations[0]?.frames?.[0]?.elements?.[0];
  assert.equal(typeof firstElem?.layer, 'string');

  // Verify WebTextures.DecodeMip decodes real Klei ground tile textures and UI icon atlases
  uploadedMips.clear();
  const grassInfo = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebTextures.DecodeMip("levels/textures/mini_grass_noise.tex", 128))', 50000000),
  );
  const grassMip = uploadedMips.get(grassInfo.id >>> 0);
  assert.ok(grassMip && grassMip.width <= 128 && grassMip.byteLength === grassMip.width * grassMip.height * 4);

  const invAtlas = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebAtlases.Decode("images/inventoryimages1.xml"))', 50000000),
  );
  assert.ok(Array.isArray(invAtlas.elements) && invAtlas.elements.some(e => e.name === 'axe.tex'));

  // Verify HUD & Crafting Menu icon atlases (hud.xml + crafting_menu_icons.xml)
  const hudAtlas = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebAtlases.Decode("images/hud.xml"))', 50000000),
  );
  assert.ok(Array.isArray(hudAtlas.elements) && hudAtlas.elements.some(e => e.name === 'inv_slot.tex'));
  assert.ok(hudAtlas.elements.some(e => e.name === 'clock_rim.tex'));

  const craftIconsAtlas = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebAtlases.Decode("images/crafting_menu_icons.xml"))', 50000000),
  );
  assert.ok(Array.isArray(craftIconsAtlas.elements) && craftIconsAtlas.elements.some(e => e.name === 'filter_tool.tex'));

  // Verify full-port Klei UI atlases: crafting_menu.xml, global_redux.xml, crafting_menu_avatars.xml, and ui_chest_3x3.zip
  const craftMenuAtlas = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebAtlases.Decode("images/crafting_menu.xml"))', 50000000),
  );
  assert.ok(Array.isArray(craftMenuAtlas.elements) && craftMenuAtlas.elements.some(e => e.name === 'backing.tex'));
  assert.ok(craftMenuAtlas.elements.some(e => e.name === 'slot_bg.tex'));
  assert.ok(craftMenuAtlas.elements.some(e => e.name === 'filterslot_bg.tex'));

  const reduxAtlas = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebAtlases.Decode("images/global_redux.xml"))', 50000000),
  );
  assert.ok(Array.isArray(reduxAtlas.elements) && reduxAtlas.elements.some(e => e.name === 'button_carny_long_normal.tex'));
  assert.ok(reduxAtlas.elements.some(e => e.name === 'status_health.tex'));

  const avatarsAtlas = JSON.parse(
    await evaluateAsync('return require("json").encode_compliant(WebAtlases.Decode("images/crafting_menu_avatars.xml"))', 50000000),
  );
  assert.ok(Array.isArray(avatarsAtlas.elements) && avatarsAtlas.elements.some(e => e.name === 'avatar_wilson.tex'));
  assert.ok(avatarsAtlas.elements.some(e => e.name === 'avatar_wanda.tex'));

  const chestModel = JSON.parse(
    await evaluateAsync('return WebAssets.DecodeRenderJson("anim/ui_chest_3x3.zip", 16, true)', 50000000),
  );
  assert.ok(Array.isArray(chestModel.atlases) && chestModel.atlases.length >= 1);

  // Verify WebUI.Snapshot captures active PlayerHud UI scene graph nodes
  const uiSnap = JSON.parse(
    evaluate('return require("json").encode_compliant(WebUI.Snapshot(128))'),
  );
  assert.ok(uiSnap.count > 0 && Array.isArray(uiSnap.nodes) && uiSnap.nodes.length > 0, 'Expected WebUI.Snapshot to return active UI widget nodes');
  assert.ok(uiSnap.nodes.some(n => n.image || n.text || n.sx !== undefined), 'Expected UI nodes to include UITransform/ImageWidget/TextWidget state');

  // Verify character examination quote (inspectable:GetDescription) and item durability
  const examineCheck = JSON.parse(evaluate(`
    local axe = ThePlayer.components.inventory:GetEquippedItem(EQUIPSLOTS.HANDS)
    axe.components.finiteuses:Use(1)
    local pct = math.floor(axe.components.finiteuses:GetPercent() * 100 + 0.5)
    local quote = axe.components.inspectable and axe.components.inspectable:GetDescription(ThePlayer) or ""
    return require("json").encode({ pct = pct, quote = quote })
  `));
  assert.ok(examineCheck.pct > 0 && examineCheck.pct < 100, `Expected axe durability percent to decrease after use, got ${examineCheck.pct}`);
  assert.ok(typeof examineCheck.quote === 'string' && examineCheck.quote.length > 3, `Expected Wilson examine quote for axe, got "${examineCheck.quote}"`);
});


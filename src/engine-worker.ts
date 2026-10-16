import { unzipSync } from 'fflate';
import { safeAssetPath, assertCompatibility } from './protocol.mjs';
import { AssetPreview } from './asset-preview';
import { decodeNativeEnvelope } from './native-save.mjs';
import { mountEngineStorage } from './engine-storage';
import { Resources, sha256 } from './resources.mjs';
import { sessionParameters, configureSession } from './session.mjs';
import { lifecycleProbe } from './lifecycle-probe';
import { engineEvaluator } from './evaluate.mjs';
import { animationProbe } from './animation-probe';
import { shaderProbe } from './shader-probe';
import { textureProbe } from './texture-probe';
import { fontProbe } from './font-probe';
import { componentProbe } from './component-probe';
import { mapLayerProbe } from './map-layer-probe';
import { uiTransformProbe } from './ui-transform-probe';

let engine: any;
let role: string;
let ready = false;
let preview: AssetPreview | undefined;
let drainStorage: (() => Promise<void>) | undefined;
let contentManifest: any;
let resources: any;
const pressedKeys = new Set<number>();
const pressedButtons = new Set<number>();
let pointer = [0, 0];
let lastCursor: boolean | undefined;
let evaluations:any;

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function evaluate(code: string): string {
  return evaluations.evaluate(code);
}

async function initialize(message: any) {
  role = message.role;
  if (!['client', 'master', 'caves'].includes(role)) throw new Error('Unknown worker role');
  const response = await fetch('/generated/manifest.json');
  if (!response.ok) throw new Error('Run tools/prepare.py first');
  const manifest = await response.json();
  if(message.expected)assertCompatibility(manifest,message.expected);
  contentManifest = manifest;
  const wasmResponse = await fetch('/generated/engine/engine.wasm');
  if (!wasmResponse.ok) throw new Error('Build the WASM engine first');
  const wasmBytes = new Uint8Array(await wasmResponse.arrayBuffer());
  if (!manifest.engineWasmSha256 || await digest(wasmBytes) !== manifest.engineWasmSha256) throw new Error('WASM/manifest mismatch; rebuild engine and site together');
  const module = await import(/* @vite-ignore */ new URL('/generated/engine/engine.mjs', self.location.origin).href);
  engine = await module.default({ wasmBinary: wasmBytes, print: (text: string) => postMessage({ type: 'log', role, text }), printErr: console.error });
  drainStorage = await mountEngineStorage(engine, role);
  engine.FS.chdir('/');
  const pack = manifest.packs.find((p: any) => p.sha256 === manifest.bootPack);
  if (!pack) throw new Error('Missing boot pack');
  const packResponse = await fetch('/generated/' + safeAssetPath(pack.url));
  if (!packResponse.ok) throw new Error('Boot pack unavailable');
  const bytes = new Uint8Array(await packResponse.arrayBuffer());
  if (await digest(bytes) !== pack.sha256) throw new Error('Boot pack hash mismatch');
  const files = unzipSync(bytes);
  let totalBytes = 0;
  for (const [name, contents] of Object.entries(files)) {
    safeAssetPath(name);
    totalBytes += contents.length;
    if (totalBytes > 32 * 1024 * 1024) throw new Error('Boot pack exceeds memory limit');
    const entry = manifest.files[name];
    if (!entry || entry.pack !== pack.sha256 || await digest(contents) !== entry.sha256) throw new Error('Script integrity mismatch: ' + name);
    const path = '/' + name;
    engine.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    engine.FS.writeFile(path, contents);
  }
  if (engine._dst_init(['client', 'master', 'caves'].indexOf(role))) throw new Error('Lua initialization failed');
  if(role==='client'&&message.viewport){
    const {width,height}=message.viewport;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<0||height<0||width>32768||height>32768)throw new Error('Invalid client UI viewport');
    if(engine._dst_ui_viewport(width,height))throw new Error(engine.ccall('dst_result','string',[],[]));
  }
  engine._dst_platform_storage(1); // IDBFS was mounted and populated above.
  if (role === 'client') engine._dst_platform_focus(message.focus === false ? 0 : 1);
  if (manifest.resources) {
    let cache: Cache | null = null;
    try { cache = await caches.open('dst-native-assets-v1'); }
    catch (error) { postMessage({ type: 'log', role, text: 'Resource disk cache unavailable: ' + String(error) }); }
    resources = await Resources.open(manifest.resources, async (path: string) => {
      const response = await fetch('/generated/' + safeAssetPath(path));
      if (!response.ok) throw new Error('Resource download failed: ' + path);
      return new Uint8Array(await response.arrayBuffer());
    }, { cache });
    resources.install(engine);
  }
  ready = true;
  evaluations=engineEvaluator(engine,()=>ready);
  const boot = evaluate('return dofile("/compat/bootstrap.lua")');
  configureSession(engine,sessionParameters(manifest,message.session??{}),manifest);
  const snapshot = JSON.parse(evaluate('return dofile("/compat/diagnostic.lua")'));
  return { role, boot, manifest: { gameBuild: manifest.gameBuild, engineVersion: manifest.engineVersion, schemaVersion: manifest.schemaVersion, contentHash: manifest.contentHash }, snapshot, heap: engine.HEAPU8.buffer.byteLength };
}

async function handle(data: any) {
  try {
    let result;
    const transfers: Transferable[] = [];
    switch (data.type) {
      case 'init': result = await initialize(data); break;
      case 'tick':
        if (!ready) throw new Error('Engine is not initialized');
        if (!Number.isInteger(data.count) || data.count < 0 || data.count > 300) throw new Error('Invalid tick count');
        if (engine._dst_tick(data.count)) throw new Error(engine.ccall('dst_result', 'string', [], []));
        result = JSON.parse(evaluate('return _WEB_Snapshot()')); break;
      case 'snapshot': result = JSON.parse(evaluate('return _WEB_Snapshot()')); break;
      case 'consume':
        if (!Number.isInteger(data.amount) || data.amount < 1 || data.amount > 10) throw new Error('Invalid uses amount');
        evaluate(`WEB_PROBE.components.finiteuses:Use(${data.amount})`);
        result = JSON.parse(evaluate('return _WEB_Snapshot()')); break;
      case 'self-test':
        result = evaluate('assert(math.abs(GetTickTime()-0.03333333507180214)<1e-15); local p=Vector3(3,0,4); assert(p:Length()==5); return "Lua 5.1 + original Vector3 verified"'); break;
      case 'platform-focus':
        if (role !== 'client' || typeof data.focused !== 'boolean') throw new Error('Invalid platform focus');
        engine._dst_platform_focus(data.focused ? 1 : 0);result = true;break;
      case 'platform-state': result = { role, ...JSON.parse(evaluate('return json.encode(WebSystem.Inspect())')) };break;
      case 'session-state': result = { role, ...JSON.parse(evaluate('return json.encode_compliant(WebSession.Inspect())')),userId:evaluate('return TheNet:GetUserID()'),launches:Number(evaluate('return TheSim:GetNumLaunches()')) };break;
      case 'lifecycle-probe': result = { role, ...lifecycleProbe(engine,evaluate) };break;
      case 'component-probe': result=componentProbe(engine,evaluate,resources,role);break;
      case 'map-layer-probe': result=await mapLayerProbe(engine,evaluations,resources,role);break;
      case 'ui-transform-probe': result=await uiTransformProbe(engine,evaluate,role);break;
      case 'animation-probe': result = { role, ...await animationProbe(engine,evaluations,role) };break;
      case 'shader-probe':
        if(role!=='client'||!preview)throw new Error('Shader probe requires client WebGL2 context');
        result=await shaderProbe(engine,evaluations,resources,preview);break;
      case 'texture-probe':
        if(role!=='client'||!preview)throw new Error('Texture probe requires client WebGL2 context');
        result=await textureProbe(engine,evaluations,resources,preview);break;
      case 'font-probe':
        if(role!=='client'||!preview)throw new Error('Font probe requires client WebGL2 context');
        result=await fontProbe(engine,evaluations,resources,preview);break;
      case 'input': {
        if (role !== 'client') throw new Error('Device input belongs to client');
        const event = data.event;
        if (event?.kind === 'key') {
          if (!Number.isInteger(event.code) || typeof event.down !== 'boolean' || engine._dst_input_key(event.code, event.down ? 1 : 0)) throw new Error('Invalid native key input');
          if (event.down) pressedKeys.add(event.code); else pressedKeys.delete(event.code);
          evaluate(`if rawget(_G,"TheInput") then TheInput:OnRawKey(${event.code},${event.down}) end`);
        } else if (event?.kind === 'pointer') {
          if (!Number.isFinite(event.x) || !Number.isFinite(event.y) || !Number.isInteger(event.button) || typeof event.down !== 'boolean' || engine._dst_input_pointer(event.x, event.y, event.button, event.down ? 1 : 0)) throw new Error('Invalid native pointer input');
          pointer = [event.x, event.y];
          if (event.button !== -1) { if (event.down) pressedButtons.add(event.button); else pressedButtons.delete(event.button); }
          if (event.button !== -1) evaluate(`if rawget(_G,"TheInput") and rawget(_G,"TheFrontEnd") then TheInput:OnMouseButton(${event.button},${event.down},${event.x},${event.y}) end`);
          else evaluate(`if rawget(_G,"TheInput") and rawget(_G,"TheFrontEnd") then TheInput:OnMouseMove(${event.x},${event.y}) end`);
        } else if (event?.kind === 'reset') {
          const keys = [...pressedKeys], buttons = [...pressedButtons];
          pressedKeys.clear(); pressedButtons.clear(); engine._dst_input_reset();
          for (const code of keys) evaluate(`if rawget(_G,"TheInput") then TheInput:OnRawKey(${code},false) end`);
          for (const button of buttons) evaluate(`if rawget(_G,"TheInput") and rawget(_G,"TheFrontEnd") then TheInput:OnMouseButton(${button},false,${pointer[0]},${pointer[1]}) end`);
        }
        else throw new Error('Unknown input event');
        result = { cursorVisible: !!engine._dst_input_cursor_visible() }; break;
      }
      case 'input-state':
        result = { w: evaluate('return tostring(TheSim:IsKeyDown(119))') === 'true', shift: evaluate('return tostring(TheSim:IsKeyDown(402))') === 'true',
          mouseLeft: evaluate('return tostring(TheSim:GetMouseButtonState(1000))') === 'true', position: evaluate('local x,y=TheSim:GetPosition();return x..","..y').split(',').map(Number) }; break;
      case 'resource-test': {
        if (!resources) throw new Error('Prepare resources and rebuild first');
        const path = 'levels/tiles/cave.tex';
        if (evaluate('return tostring(kleifileexists("levels/tiles/cave.tex"))') !== 'true') throw new Error('Lua resource lookup failed');
        const bytes = await resources.read(path);
        if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'KTEX') throw new Error('Resource contents are not original KTEX');
        result = { role, path, bytes: bytes.length, sha256: await sha256(bytes), stats: { ...resources.stats }, indexed: Object.keys(resources.index.files).length };
        break;
      }
      case 'storage-test': {
        if (!/^[a-f0-9]{32}$/.test(data.token)) throw new Error('Invalid storage test token');
        const before = evaluate('local value="";TheSim:GetPersistentString("web_storage_probe",function(ok,text) if ok then value=text end end,false);return value');
        evaluate(`WEB_IO_OK=nil;TheSim:SetPersistentString("web_storage_probe","${data.token}",true,function(ok) WEB_IO_OK=ok end)`);
        await drainStorage!();
        if (evaluate('return tostring(WEB_IO_OK)') !== 'true') throw new Error('Persistent write was not acknowledged');
        const after = evaluate('local value="";TheSim:GetPersistentString("web_storage_probe",function(ok,text) if ok then value=text end end,false);return value');
        if (after !== data.token) throw new Error('Persistent readback mismatch');
        result = { role, before, after }; break;
      }
      case 'audio-probe': {
        if (role !== 'client') throw new Error('Audio decode belongs to client worker');
        const bank = contentManifest.audio?.banks?.wilson;
        if (!bank) throw new Error('Convert wilson.fsb and rebuild the content manifest first');
        const bankResponse = await fetch('/generated/' + safeAssetPath(bank.url));
        if (!bankResponse.ok) throw new Error('Audio bank metadata unavailable');
        const bankBytes = new Uint8Array(await bankResponse.arrayBuffer());
        if (bankBytes.length > 2 * 1024 * 1024 || await digest(bankBytes) !== bank.sha256) throw new Error('Audio bank hash mismatch');
        const catalog = JSON.parse(new TextDecoder().decode(bankBytes));
        if (catalog.gameBuild !== contentManifest.gameBuild || !catalog.pcmVerified) throw new Error('Unverified native audio bank');
        const sample = catalog.samples[0];
        const response = await fetch('/generated/' + safeAssetPath(sample.url));
        if (!response.ok) throw new Error('Audio sample unavailable');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== sample.bytes || await digest(bytes) !== sample.sha256) throw new Error('FLAC hash mismatch');
        const ptr = engine._malloc(bytes.length);
        if (!ptr) throw new Error('Cannot allocate FLAC buffer');
        try {
          engine.HEAPU8.set(bytes, ptr);
          const status = engine._dst_audio_decode(ptr, bytes.length);
          const info = engine.ccall('dst_audio_result', 'string', [], []);
          if (status) throw new Error(info);
          const meta = JSON.parse(info);
          for (const key of ['channels', 'sampleRate', 'frames', 'pcmBytes']) if (meta[key] !== sample[key]) throw new Error('Decoded audio metadata mismatch');
          const pcm = engine.HEAPU8.slice(engine._dst_audio_pcm(), engine._dst_audio_pcm() + meta.pcmBytes);
          if (await digest(pcm) !== sample.pcmSha256) throw new Error('WASM PCM differs from native decoder');
          result = { ...meta, name: sample.name, pcm: pcm.buffer, pcmVerified: true };
          transfers.push(pcm.buffer);
        } finally { engine._free(ptr); engine._dst_audio_release(); }
        break;
      }
      case 'preview':
        if (role !== 'client') throw new Error('Preview belongs to client worker');
        if(engine._dst_ui_viewport(data.canvas.width,data.canvas.height))throw new Error(engine.ccall('dst_result','string',[],[]));
        preview = new AssetPreview(data.canvas,engine,evaluations);result = await preview.load();break;
      case 'preview-tick': preview?.draw(data.tick);result = true;break;
      case 'inspect-native': {
        const bytes = decodeNativeEnvelope(new Uint8Array(data.bytes));
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Native save must be between 1 byte and 8 MiB');
        const pointer = engine._malloc(bytes.length);
        if (!pointer) throw new Error('Cannot allocate save buffer');
        try {
          engine.HEAPU8.set(bytes, pointer);
          const status = engine._dst_inspect_save(pointer, bytes.length);
          const output = engine.ccall('dst_result', 'string', [], []);
          if (status) throw new Error(output);
          result = JSON.parse(output);
        } finally { engine._free(pointer); }
        break;
      }
      case 'restore':
        if (data.snapshot.role !== role) throw new Error('Snapshot role mismatch');
        if (!Number.isSafeInteger(data.snapshot.tick) || data.snapshot.tick < 0 || data.snapshot.tick > 0xffffffff) throw new Error('Invalid restore tick');
        evaluate(`return _WEB_Restore(${JSON.stringify(JSON.stringify(data.snapshot))})`);
        engine._dst_restore_clock(data.snapshot.tick);
        result = JSON.parse(evaluate('return _WEB_Snapshot()')); break;
      case 'start-game': {
        if (!ready) throw new Error('Engine is not initialized');
        // 1. Mount remaining original Lua script packs if not yet mounted
        const extraPacks = contentManifest.packs.filter((p: any) => p.sha256 !== contentManifest.bootPack);
        await Promise.all(extraPacks.map(async (pack: any) => {
          const packResp = await fetch('/generated/' + safeAssetPath(pack.url));
          if (!packResp.ok) throw new Error('Script pack unavailable: ' + pack.url);
          const bytes = new Uint8Array(await packResp.arrayBuffer());
          const files = unzipSync(bytes);
          for (const [name, contents] of Object.entries(files)) {
            safeAssetPath(name);
            const path = '/' + name;
            engine.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
            engine.FS.writeFile(path, contents);
          }
        }));
        // 2. Ensure Master world save fixture exists in /persistent/master
        engine.FS.mkdirTree('/persistent/master/session/15CD1F748D1D1C77');
        const [shardIndex, sessionSnap, sessionMeta] = await Promise.all([
          fetch('/generated/world/shardindex').then(r => { if (!r.ok) throw new Error('Missing world shardindex'); return r.arrayBuffer(); }),
          fetch('/generated/world/0000000183').then(r => { if (!r.ok) throw new Error('Missing world session snapshot'); return r.arrayBuffer(); }),
          fetch('/generated/world/0000000183.meta').then(r => { if (!r.ok) throw new Error('Missing world session meta'); return r.arrayBuffer(); }),
        ]);
        engine.FS.writeFile('/persistent/master/shardindex', new Uint8Array(shardIndex));
        engine.FS.writeFile('/persistent/master/session/15CD1F748D1D1C77/0000000183', new Uint8Array(sessionSnap));
        engine.FS.writeFile('/persistent/master/session/15CD1F748D1D1C77/0000000183.meta', new Uint8Array(sessionMeta));

        engine._dst_ui_viewport(data.width || 1280, data.height || 720);
        evaluate(`
          WebPrefabs.SetDeferAnimations(true)
          WebInput.SetDesktopMode(true)
          TheNet:StartServer(false)
          RUN_GLOBAL_INIT = false
          json_settings = [=[{"reset_action":1,"save_slot":1}]=]
        `);
        await evaluations.evaluateAsync('dofile("/scripts/main.lua"); json_settings = nil; Start()', 200000000);
        await evaluations.evaluateAsync(`
          TheSim:LoadPrefabs({"global", "wilson", "flint", "twigs", "cutgrass", "berries", "log", "rocks", "goldnugget", "axe", "pickaxe", "torch", "campfire", "firepit", "researchlab", "spear", "backpack", "strawhat", "flowerhat"})
          LoadFonts()
          local portal = TheSim:FindFirstEntityWithTag("multiplayer_portal")
          local sx, sy, sz = 0, 0, 0
          if portal ~= nil then
            sx, sy, sz = portal.Transform:GetWorldPosition()
            sx = sx + 2.5
            sz = sz + 2.5
          else
            local pt = TheWorld.components.playerspawner and TheWorld.components.playerspawner:GetAnySpawnPoint()
            if pt then sx, sy, sz = pt.x, pt.y, pt.z end
          end

          local player = SpawnPrefab("wilson")
          player.userid = "KU_local"
          player.name = "Wilson"
          player.Transform:SetPosition(sx, sy, sz)
          if not table.contains(AllPlayers, player) then
            table.insert(AllPlayers, player)
          end
          ThePlayer = player
          player:PushEvent("setowner")
          TheWorld:PushEvent("ms_playerspawn", player)

          -- Spawn convenient starter survival items near the portal if not already present
          for i, item_def in ipairs({
            {prefab="flint", dx=2.2, dz=-1.2},
            {prefab="flint", dx=-2.4, dz=1.5},
            {prefab="twigs", dx=1.8, dz=2.0},
            {prefab="twigs", dx=-1.8, dz=-2.1},
            {prefab="cutgrass", dx=2.8, dz=0.8},
            {prefab="cutgrass", dx=-2.5, dz=-0.8},
            {prefab="berries", dx=1.2, dz=-2.4},
          }) do
            local ent = SpawnPrefab(item_def.prefab)
            if ent ~= nil and ent.Transform ~= nil then
              ent.Transform:SetPosition(sx + item_def.dx, 0, sz + item_def.dz)
            end
          end

          if TheCamera ~= nil then
            TheCamera:SetTarget(player)
            TheCamera:Snap()
          end

          WebEntity.UpdateSpatialSleep(sx, sz, 56, 68)

          _G._WEB_Announcements = {}
          function _G._WEB_PushNotice(msg)
            table.insert(_G._WEB_Announcements, 1, msg)
            while #_G._WEB_Announcements > 6 do table.remove(_G._WEB_Announcements) end
          end
          _G._WEB_PushNotice("Chào mừng đến vớiThe Constant! Dùng WASD hoặc Click chuột để di chuyển.")

          function _G._WEB_GameSceneSnapshot()
            local json = require("json")
            local p = ThePlayer
            local px, py, pz = 0, 0, 0
            if p ~= nil and p.Transform ~= nil then
              px, py, pz = p.Transform:GetWorldPosition()
            end
            local scene = WebScene.Snapshot(px, pz, 42, 13)
            local cam = TheCamera
            scene.camera = {
              x = cam and cam.currentpos and cam.currentpos.x or px,
              y = cam and cam.currentpos and cam.currentpos.y or 1.5,
              z = cam and cam.currentpos and cam.currentpos.z or pz,
              distance = cam and cam.distance or 30,
              pitch = cam and cam.pitch or 42.85,
              heading = cam and cam.heading or 45,
              fov = cam and cam.fov or 35,
            }
            local inv_list = {}
            local eq_hand, eq_head, eq_body = "", "", ""
            if p ~= nil and p.components.inventory ~= nil then
              local inv = p.components.inventory
              for slot = 1, inv:GetNumSlots() do
                local item = inv.itemslots[slot]
                if item ~= nil then
                  table.insert(inv_list, {
                    slot = slot,
                    prefab = item.prefab or "",
                    name = item:GetBasicDisplayName() or item.prefab or "",
                    count = item.components.stackable and item.components.stackable:StackSize() or 1,
                    uses = item.components.finiteuses and math.floor(item.components.finiteuses:GetPercent() * 100) or nil,
                  })
                end
              end
              local h_item = inv:GetEquippedItem(EQUIPSLOTS.HANDS)
              local head_item = inv:GetEquippedItem(EQUIPSLOTS.HEAD)
              local body_item = inv:GetEquippedItem(EQUIPSLOTS.BODY)
              eq_hand = h_item and h_item.prefab or ""
              eq_head = head_item and head_item.prefab or ""
              eq_body = body_item and body_item.prefab or ""
            end
            scene.player = {
              guid = p and p.GUID or 0,
              name = p and p.name or "Wilson",
              prefab = p and p.prefab or "wilson",
              x = px, y = py, z = pz,
              sgState = p and p.sg and p.sg.currentstate and p.sg.currentstate.name or "idle",
              health = p and p.components.health and p.components.health.currenthealth or 150,
              maxHealth = p and p.components.health and p.components.health.maxhealth or 150,
              hunger = p and p.components.hunger and p.components.hunger.current or 150,
              maxHunger = p and p.components.hunger and p.components.hunger.max or 150,
              sanity = p and p.components.sanity and p.components.sanity.current or 200,
              maxSanity = p and p.components.sanity and p.components.sanity.max or 200,
              moisture = p and p.components.moisture and p.components.moisture:GetMoisture() or 0,
              temperature = p and p.components.temperature and p.components.temperature:GetCurrent() or 25,
              equippedHand = eq_hand,
              equippedHead = eq_head,
              equippedBody = eq_body,
              inventory = inv_list,
            }
            local st = TheWorld and TheWorld.state or {}
            scene.clock = {
              cycles = (st.cycles or 0) + 1,
              phase = st.phase or "day",
              timeInPhase = st.timeinphase or 0,
              normTime = st.time or 0,
              season = st.season or "autumn",
              elapsedDaysInSeason = st.elapseddaysinseason or 0,
              remainingDaysInSeason = st.remainingdaysinseason or 20,
              isRaining = st.israining or false,
            }
            scene.announcements = _G._WEB_Announcements
            return json.encode_compliant(scene)
          end
        `, 200000000);
        if (engine._dst_tick(2)) throw new Error(engine.ccall('dst_result', 'string', [], []));
        evaluations.evaluate('StaticUpdate(GetTickTime()); local x,y,z=ThePlayer.Transform:GetWorldPosition(); WebEntity.UpdateSpatialSleep(x, z, 56, 68)', 50000000);
        result = JSON.parse(evaluate('return _WEB_GameSceneSnapshot()'));
        break;
      }
      case 'game-tick': {
        if (!ready) throw new Error('Engine is not initialized');
        const count = Math.min(10, Math.max(1, Number(data.count) || 1));
        if (engine._dst_tick(count)) throw new Error(engine.ccall('dst_result', 'string', [], []));
        result = JSON.parse(evaluate(`
          if TheCamera ~= nil and ThePlayer ~= nil then
            TheCamera:SetTarget(ThePlayer)
            TheCamera:Update(GetTickTime() * ${count})
          end
          if GetTick() % 15 == 0 and ThePlayer ~= nil then
            local x, y, z = ThePlayer.Transform:GetWorldPosition()
            WebEntity.UpdateSpatialSleep(x, z, 56, 68)
          end
          return _WEB_GameSceneSnapshot()
        `));
        break;
      }
      case 'game-input': {
        if (!ready) throw new Error('Engine is not initialized');
        const event = data.event;
        if (event?.kind === 'key') {
          if (Number.isInteger(event.code) && typeof event.down === 'boolean') {
            engine._dst_input_key(event.code, event.down ? 1 : 0);
            if (event.down) pressedKeys.add(event.code); else pressedKeys.delete(event.code);
            evaluate(`if rawget(_G,"TheInput") then TheInput:OnRawKey(${event.code},${event.down}) end`);
          }
        } else if (event?.kind === 'reset') {
          const keys = [...pressedKeys];
          pressedKeys.clear();
          engine._dst_input_reset();
          for (const code of keys) evaluate(`if rawget(_G,"TheInput") then TheInput:OnRawKey(${code},false) end`);
        }
        result = true;
        break;
      }
      case 'game-action': {
        if (!ready) throw new Error('Engine is not initialized');
        const act = data.action;
        if (act?.kind === 'walk') {
          const x = Number(act.x) || 0;
          const z = Number(act.z) || 0;
          evaluate(`
            if ThePlayer ~= nil and ThePlayer.components.locomotor ~= nil then
              ThePlayer.components.locomotor:GoToPoint(Vector3(${x}, 0, ${z}), nil, true)
            end
          `);
        } else if (act?.kind === 'interact') {
          const guid = Number(act.guid) || 0;
          const code = String(act.code || 'INSPECT').replace(/[^A-Z_]/g, '');
          evaluate(`
            local target = Ents[${guid}]
            local p = ThePlayer
            if p ~= nil and target ~= nil and target:IsValid() then
              local inv = p.components.inventory
              if "${code}" == "CHOP" then
                local equipped = inv and inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                if equipped == nil or not equipped:HasTag("CHOP_tool") then
                  local axe = inv and inv:FindItem(function(it) return it:HasTag("CHOP_tool") or it.prefab == "axe" end)
                  if axe == nil then
                    axe = SpawnPrefab("axe")
                    if inv and axe then inv:GiveItem(axe) end
                  end
                  if inv and axe then inv:Equip(axe) end
                end
              elseif "${code}" == "MINE" then
                local equipped = inv and inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                if equipped == nil or not equipped:HasTag("MINE_tool") then
                  local pick = inv and inv:FindItem(function(it) return it:HasTag("MINE_tool") or it.prefab == "pickaxe" end)
                  if pick == nil then
                    pick = SpawnPrefab("pickaxe")
                    if inv and pick then inv:GiveItem(pick) end
                  end
                  if inv and pick then inv:Equip(pick) end
                end
              end
              local action_def = ACTIONS["${code}"] or ACTIONS.WALKTO
              local ba = BufferedAction(p, target, action_def)
              if p.components.locomotor ~= nil then
                p.components.locomotor:PushAction(ba, true)
              else
                p:PushBufferedAction(ba)
              end
              _WEB_PushNotice("Hành động: " .. tostring(action_def.id) .. " -> " .. tostring(target.prefab))
            end
          `);
        } else if (act?.kind === 'inv-slot') {
          const slot = Number(act.slot) || 1;
          evaluate(`
            local p = ThePlayer
            local inv = p and p.components.inventory
            local item = inv and inv.itemslots[${slot}]
            if item ~= nil then
              if item.components.equippable ~= nil then
                inv:Equip(item)
                _WEB_PushNotice("Đã trang bị: " .. tostring(item.prefab))
              elseif item.components.edible ~= nil and p.components.eater ~= nil then
                p.components.eater:Eat(item)
                _WEB_PushNotice("Đã ăn: " .. tostring(item.prefab))
              elseif item.components.healer ~= nil then
                item.components.healer:Heal(p)
              else
                inv:DropItem(item, true, true)
                _WEB_PushNotice("Đã thả: " .. tostring(item.prefab))
              end
            end
          `);
        } else if (act?.kind === 'craft') {
          const recipe = String(act.recipe || 'axe').replace(/[^a-z0-9_]/g, '');
          evaluate(`
            local p = ThePlayer
            if p ~= nil and p.components.inventory ~= nil then
              local inv = p.components.inventory
              local px, py, pz = p.Transform:GetWorldPosition()
              if "${recipe}" == "campfire" or "${recipe}" == "firepit" or "${recipe}" == "researchlab" then
                local structure = SpawnPrefab("${recipe}")
                if structure ~= nil and structure.Transform ~= nil then
                  structure.Transform:SetPosition(px + 2.2, 0, pz + 1.8)
                  _WEB_PushNotice("Đã dựng: " .. "${recipe}")
                end
              else
                local item = SpawnPrefab("${recipe}")
                if item ~= nil then
                  if item.components.equippable ~= nil then
                    inv:Equip(item)
                    _WEB_PushNotice("Đã chế tạo & trang bị: " .. "${recipe}")
                  else
                    inv:GiveItem(item)
                    _WEB_PushNotice("Đã chế tạo: " .. "${recipe}")
                  end
                end
              end
            end
          `);
        } else if (act?.kind === 'camera') {
          const dHeading = Number(act.deltaHeading) || 0;
          const dDist = Number(act.deltaDistance) || 0;
          evaluate(`
            if TheCamera ~= nil then
              if ${dHeading} ~= 0 then
                TheCamera:SetHeadingTarget((TheCamera.headingtarget or 45) + (${dHeading}))
              end
              if ${dDist} ~= 0 then
                TheCamera.distancetarget = math.clamp((TheCamera.distancetarget or 30) + (${dDist}), 14, 52)
              end
            end
          `);
        } else if (act?.kind === 'next-phase') {
          evaluate(`
            if TheWorld ~= nil then
              TheWorld:PushEvent("ms_nextphase")
              _WEB_PushNotice("Đã chuyển pha thời gian trong ngày.")
            end
          `);
        }
        result = JSON.parse(evaluate('return _WEB_GameSceneSnapshot()'));
        break;
      }
      default: throw new Error('Unsupported worker message: ' + data.type);
    }
    await drainStorage?.();
    if (ready && role === 'client') {
      const cursorVisible = !!engine._dst_input_cursor_visible();
      if (cursorVisible !== lastCursor) { lastCursor = cursorVisible; postMessage({ type: 'platform', role, cursorVisible }); }
    }
    postMessage({ id: data.id, ok: true, result }, transfers);
  } catch (error) {
    postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
// Filesystem sync is asynchronous: a tick or another command must not mutate
// the WASM filesystem while its preceding commit is being acknowledged.
let requests = Promise.resolve();
self.onmessage = ({ data }) => { requests = requests.then(() => handle(data)); };

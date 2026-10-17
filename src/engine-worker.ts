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

function evaluate(code: string, budget = 25000000): string {
  return evaluations.evaluate(code, budget);
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
      case 'load-anim-asset': {
        if (!ready || !resources) throw new Error('Engine or resources not initialized');
        const prefab = String(data.prefab || '').trim();
        const build = String(data.build || '').trim();
        const bank = String(data.bank || '').trim();
        if (!build && !prefab) { result = null; break; }

        const candidateZips: string[] = [];
        const addZip = (z: string) => {
          if (z && resources.exists(z) && !candidateZips.includes(z)) candidateZips.push(z);
        };

        if (build) addZip(`anim/${build}.zip`);
        if (prefab === 'deciduoustree' || build.startsWith('tree_leaf') || bank === 'tree_leaf') {
          addZip('anim/tree_leaf_trunk_build.zip');
          addZip('anim/tree_leaf_green_build.zip');
          addZip('anim/tree_leaf_normal.zip');
          addZip('anim/tree_leaf_short.zip');
          addZip('anim/tree_leaf_tall.zip');
        }
        if (prefab === 'rabbit' || build === 'rabbit_build' || bank === 'rabbit') {
          addZip('anim/rabbit_build.zip');
          addZip('anim/ds_rabbit_basic.zip');
        }
        if (prefab === 'wormhole' || build === 'teleporter_worm_build' || bank === 'teleporter_worm') {
          addZip('anim/teleporter_worm_build.zip');
          addZip('anim/teleporter_worm.zip');
        }
        const CHARACTER_PREFABS = new Set([
          'wilson', 'willow', 'wolfgang', 'wendy', 'wx78', 'wickerbottom', 'woodie', 'wes', 'waxwell',
          'wathgrithr', 'webber', 'winona', 'warly', 'wortox', 'wormwood', 'wurt', 'walter', 'wanda',
        ]);
        const isCharacter = CHARACTER_PREFABS.has(prefab) || CHARACTER_PREFABS.has(build) || bank === 'wilson';

        const EQUIP_OVERRIDE_ZIPS: Array<{ key: string; zip: string }> = [
          { key: 'axe', zip: 'anim/swap_axe.zip' },
          { key: 'goldenaxe', zip: 'anim/swap_goldenaxe.zip' },
          { key: 'pickaxe', zip: 'anim/swap_pickaxe.zip' },
          { key: 'goldenpickaxe', zip: 'anim/swap_goldenpickaxe.zip' },
          { key: 'shovel', zip: 'anim/swap_shovel.zip' },
          { key: 'goldenshovel', zip: 'anim/swap_goldenshovel.zip' },
          { key: 'hammer', zip: 'anim/swap_hammer.zip' },
          { key: 'torch', zip: 'anim/swap_torch.zip' },
          { key: 'lantern', zip: 'anim/swap_lantern.zip' },
          { key: 'lighter', zip: 'anim/swap_lighter.zip' },
          { key: 'lucy', zip: 'anim/swap_lucy_axe.zip' },
          { key: 'spear', zip: 'anim/swap_spear.zip' },
          { key: 'spear_wathgrithr', zip: 'anim/swap_spear_wathgrithr.zip' },
          { key: 'hambat', zip: 'anim/swap_ham_bat.zip' },
          { key: 'cane', zip: 'anim/swap_cane.zip' },
          { key: 'armorgrass', zip: 'anim/armor_grass.zip' },
          { key: 'armorwood', zip: 'anim/armor_wood.zip' },
          { key: 'armormarble', zip: 'anim/armor_marble.zip' },
          { key: 'backpack', zip: 'anim/swap_backpack.zip' },
          { key: 'flowerhat', zip: 'anim/hat_flower.zip' },
          { key: 'strawhat', zip: 'anim/hat_straw.zip' },
          { key: 'footballhat', zip: 'anim/hat_football.zip' },
          { key: 'wathgrithrhat', zip: 'anim/hat_wathgrithr.zip' },
          { key: 'tophat', zip: 'anim/hat_top.zip' },
          { key: 'winterhat', zip: 'anim/hat_winter.zip' },
          { key: 'minerhat', zip: 'anim/hat_miner.zip' },
        ];

        if (isCharacter) {
          if (build && resources.exists(`anim/${build}.zip`)) {
            addZip(`anim/${build}.zip`);
          } else if (prefab && resources.exists(`anim/${prefab}.zip`)) {
            addZip(`anim/${prefab}.zip`);
          } else {
            addZip('anim/wilson.zip');
          }
          addZip('anim/player_basic.zip');
          addZip('anim/player_idles.zip');
          addZip('anim/player_actions.zip');
          addZip('anim/player_actions_axe.zip');
          addZip('anim/player_actions_pickaxe.zip');
          addZip('anim/player_actions_shovel.zip');
          addZip('anim/player_actions_eat.zip');
          addZip('anim/player_actions_item.zip');
          addZip('anim/player_attacks.zip');
        } else if (prefab) {
          try {
            const pInfo = JSON.parse(evaluate(`
              local info = WebPrefabs.Inspect(${JSON.stringify(prefab)})
              if not info or not info.assets then return "[]" end
              local out = {}
              for _, a in ipairs(info.assets) do
                if a.type == "ANIM" or a.type == "DYNAMIC_ANIM" then
                  table.insert(out, a.file)
                end
              end
              return require("json").encode(out)
            `));
            if (Array.isArray(pInfo)) {
              for (const z of pInfo) {
                if (build && z === `anim/${build}.zip`) addZip(z);
              }
              for (const z of pInfo) {
                if (
                  typeof z === 'string' &&
                  !z.includes('dust_fx') &&
                  !z.includes('pine_needles') &&
                  !z.includes('tree_leaf_fx') &&
                  !z.includes('tree_leaf_red_build') &&
                  !z.includes('tree_leaf_orange_build') &&
                  !z.includes('tree_leaf_yellow_build') &&
                  !z.includes('tree_leaf_poison_build') &&
                  !z.includes('tree_leaf_monster')
                ) {
                  addZip(z);
                }
              }
            }
          } catch {}
        }

        if (prefab === 'evergreen') {
          addZip('anim/evergreen_new.zip');
          addZip('anim/evergreen_short_normal.zip');
          addZip('anim/evergreen_tall_old.zip');
        }
        if (prefab === 'evergreen_sparse') {
          addZip('anim/evergreen_new_2.zip');
          addZip('anim/evergreen_short_normal.zip');
          addZip('anim/evergreen_tall_old.zip');
        }
        if (prefab === 'campfire' || prefab === 'firepit') {
          addZip('anim/campfire_fire.zip');
        }
        if (prefab === 'cookpot' || build === 'cook_pot') addZip('anim/cook_pot.zip');
        if (prefab === 'icebox' || build === 'ice_box') addZip('anim/ice_box.zip');
        if (prefab === 'meatrack' || build === 'meat_rack') addZip('anim/meat_rack.zip');
        if (prefab === 'treasurechest' || build === 'treasure_chest') addZip('anim/treasure_chest.zip');
        if (prefab === 'researchlab2' || build === 'researchlab2') addZip('anim/researchlab2.zip');
        if (prefab === 'firehound' || bank === 'hound') {
          addZip('anim/hound_red_ocean.zip');
          addZip('anim/hound_basic.zip');
        }
        if (prefab === 'mole' || prefab === 'molehill' || bank === 'mole') {
          addZip('anim/mole_build.zip');
          addZip('anim/mole_basic.zip');
        }
        if (prefab === 'wobster_den' || bank === 'lobster_den') {
          addZip('anim/lobster_den_build.zip');
          addZip('anim/lobster_den.zip');
        }
        if (prefab === 'fence_junk' || bank === 'fence_junk') {
          addZip('anim/fence_junk_build3.zip');
          addZip('anim/fence_junk.zip');
        }

        if (bank && bank !== build) {
          for (const c of [`anim/${bank}.zip`, `anim/ds_${bank}_basic.zip`, `anim/${bank}_normal.zip`, `anim/${bank}_short.zip`, `anim/${bank}_tall.zip`]) {
            addZip(c);
          }
        }

        if (candidateZips.length === 0) { result = null; break; }

        const capturedMip0 = new Map<number, { width: number; height: number; rgba: ArrayBuffer }>();
        engine.nativeTextureBackendReady = () => true;
        engine.hasNativeTexture = (id: number) => capturedMip0.has(id >>> 0);
        engine.beginNativeTexture = () => {};
        engine.uploadNativeTexture = (id: number, level: number, width: number, height: number, bytes: Uint8Array) => {
          if (level === 0) {
            capturedMip0.set(id >>> 0, { width, height, rgba: bytes.slice().buffer });
          }
        };
        engine.finishNativeTexture = () => {};
        engine.releaseNativeTexture = (id: number) => capturedMip0.delete(id >>> 0);

        let model: any = null;
        const atlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }> = [];
        const overrides: Record<string, { model: any; atlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }> }> = {};

        for (const z of candidateZips.slice(0, 14)) {
          const isSupplementaryBuild = z.endsWith('_build.zip') || z === 'anim/campfire_fire.zip';
          const needBuild = !model || !Array.isArray(model.vertices) || model.vertices.length === 0 || isSupplementaryBuild;
          capturedMip0.clear();
          try {
            const parsed = JSON.parse(
              await evaluations.evaluateAsync(`return WebAssets.DecodeRenderJson(${JSON.stringify(z)}, 20, ${needBuild ? 'true' : 'false'})`, 50000000),
            );
            if (!model) {
              model = parsed;
              if (Array.isArray(parsed.atlases) && parsed.atlases.length > 0) {
                for (let i = 0; i < parsed.atlases.length; ++i) {
                  const mip = capturedMip0.get(i);
                  if (mip) {
                    atlases.push({ name: parsed.atlases[i], width: mip.width, height: mip.height, rgba: mip.rgba });
                    transfers.push(mip.rgba);
                  }
                }
              }
            } else {
              if (!Array.isArray(model.vertices) || model.vertices.length === 0) {
                if (Array.isArray(parsed.vertices) && parsed.vertices.length > 0) {
                  model.name = parsed.name || model.name;
                  model.atlases = parsed.atlases;
                  model.symbols = parsed.symbols;
                  model.vertices = parsed.vertices;
                  for (let i = 0; i < (parsed.atlases?.length || 0); ++i) {
                    const mip = capturedMip0.get(i);
                    if (mip) {
                      atlases.push({ name: parsed.atlases[i], width: mip.width, height: mip.height, rgba: mip.rgba });
                      transfers.push(mip.rgba);
                    }
                  }
                }
              } else if (Array.isArray(parsed.vertices) && parsed.vertices.length > 0 && parsed.symbols) {
                // Merge supplementary build symbols (e.g., tree_leaf_green_build swap_leaves onto tree_leaf_trunk_build)
                const newSymEntries = Object.entries(parsed.symbols).filter(([k]) => !model.symbols?.[k]);
                if (newSymEntries.length > 0 && Array.isArray(parsed.atlases) && parsed.atlases.length > 0) {
                  const vertOffset = model.vertices.length;
                  const atlasOffset = atlases.length;
                  for (let i = 0; i < parsed.atlases.length; ++i) {
                    const mip = capturedMip0.get(i);
                    if (mip) {
                      atlases.push({ name: parsed.atlases[i], width: mip.width, height: mip.height, rgba: mip.rgba });
                      transfers.push(mip.rgba);
                    }
                  }
                  model.atlases.push(...parsed.atlases);
                  for (const [symHash, symObj] of newSymEntries as Array<[string, any]>) {
                    const clonedFrames = (symObj.frames || []).map((f: any) => ({
                      ...f,
                      offset: (f.offset || 0) + vertOffset,
                    }));
                    model.symbols[symHash] = { ...symObj, frames: clonedFrames };
                  }
                  for (const vtx of parsed.vertices) {
                    model.vertices.push([vtx[0], vtx[1], vtx[2], vtx[3], vtx[4], (vtx[5] || 0) + atlasOffset]);
                  }
                }
              }
              if (Array.isArray(parsed.animations) && parsed.animations.length > 0) {
                model.animations.push(...parsed.animations);
              }
            }
          } catch {}
        }

        if (isCharacter && model) {
          for (const eq of EQUIP_OVERRIDE_ZIPS) {
            if (!resources.exists(eq.zip)) continue;
            capturedMip0.clear();
            try {
              const eqModel = JSON.parse(
                await evaluations.evaluateAsync(`return WebAssets.DecodeRenderJson(${JSON.stringify(eq.zip)}, 4, true)`, 50000000),
              );
              const eqAtlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }> = [];
              for (let i = 0; i < (eqModel.atlases?.length || 0); ++i) {
                const mip = capturedMip0.get(i);
                if (mip) {
                  eqAtlases.push({ name: eqModel.atlases[i], width: mip.width, height: mip.height, rgba: mip.rgba });
                  transfers.push(mip.rgba);
                }
              }
              if (eqAtlases.length > 0) {
                overrides[eq.key] = { model: eqModel, atlases: eqAtlases };
                const rawZipKey = eq.zip.slice(5, -4);
                overrides[rawZipKey] = { model: eqModel, atlases: eqAtlases };
              }
            } catch {}
          }
        }

        if (!model || !atlases.length) { result = null; break; }
        result = { prefab, build: build || model.name || prefab, bank, model, atlases, overrides };
        break;
      }
      case 'load-tile-textures': {
        if (!ready || !resources) throw new Error('Engine or resources not initialized');
        const tileFiles: Array<{ tileIds: number[]; path: string }> = [
          { tileIds: [6, 35], path: 'levels/textures/mini_grass_noise.tex' },
          { tileIds: [7], path: 'levels/textures/mini_forest_noise.tex' },
          { tileIds: [5], path: 'levels/textures/mini_grass2_noise.tex' },
          { tileIds: [3], path: 'levels/textures/mini_rocky_noise.tex' },
          { tileIds: [4], path: 'levels/textures/mini_dirt_noise.tex' },
          { tileIds: [8], path: 'levels/textures/mini_marsh_noise.tex' },
          { tileIds: [2], path: 'levels/textures/mini_cobblestone_noise.tex' },
          { tileIds: [30], path: 'levels/textures/mini_deciduous_noise.tex' },
          { tileIds: [31], path: 'levels/textures/mini_desert_dirt_noise.tex' },
          { tileIds: [10], path: 'levels/textures/mini_woodfloor_noise.tex' },
          { tileIds: [11], path: 'levels/textures/mini_carpet_noise.tex' },
          { tileIds: [12], path: 'levels/textures/mini_checker_noise.tex' },
          { tileIds: [42], path: 'levels/textures/mini_pebblebeach.tex' },
          { tileIds: [43], path: 'levels/textures/mini_meteor.tex' },
          { tileIds: [0, 1, 201, 202, 203, 204, 272], path: 'levels/textures/ocean_noise.tex' },
        ];

        const captured = new Map<number, { width: number; height: number; rgba: ArrayBuffer }>();
        engine.nativeTextureBackendReady = () => true;
        engine.uploadNativeTexture = (id: number, _level: number, width: number, height: number, bytes: Uint8Array) => {
          captured.set(id >>> 0, { width, height, rgba: bytes.slice().buffer });
        };

        const tiles: Array<{ tileIds: number[]; width: number; height: number; rgba: ArrayBuffer }> = [];
        for (const entry of tileFiles) {
          if (!resources.exists(entry.path)) continue;
          try {
            const info = JSON.parse(
              await evaluations.evaluateAsync(`return require("json").encode_compliant(WebTextures.DecodeMip(${JSON.stringify(entry.path)}, 128))`, 50000000),
            );
            const mip = captured.get(info.id >>> 0);
            if (mip) {
              tiles.push({ tileIds: entry.tileIds, width: mip.width, height: mip.height, rgba: mip.rgba });
              transfers.push(mip.rgba);
              captured.delete(info.id >>> 0);
            }
          } catch {}
        }
        result = { tiles };
        break;
      }
      case 'load-ui-icons': {
        if (!ready || !resources) throw new Error('Engine or resources not initialized');
        // All inventory/recipe/ingredient/structure/food/tool icons across inventoryimages1..3.xml
        const wantedInventoryItems = [
          'flint.tex', 'twigs.tex', 'cutgrass.tex', 'berries.tex', 'berries_juicy.tex', 'log.tex', 'rocks.tex',
          'goldnugget.tex', 'nitre.tex', 'marble.tex', 'axe.tex', 'goldenaxe.tex', 'pickaxe.tex', 'goldenpickaxe.tex',
          'shovel.tex', 'goldenshovel.tex', 'hammer.tex', 'compass.tex', 'razor.tex', 'torch.tex', 'lantern.tex',
          'lighter.tex', 'lucy.tex', 'spear.tex', 'spear_wathgrithr.tex', 'hambat.tex', 'cane.tex', 'slingshot.tex',
          'firestaff.tex', 'panflute.tex', 'pocketwatch_weapon.tex',
          'armorgrass.tex', 'armorwood.tex', 'armormarble.tex', 'backpack.tex',
          'flowerhat.tex', 'strawhat.tex', 'footballhat.tex', 'wathgrithrhat.tex', 'tophat.tex', 'winterhat.tex', 'minerhat.tex',
          'campfire.tex', 'firepit.tex', 'researchlab.tex', 'researchlab2.tex', 'treasurechest.tex',
          'cookpot.tex', 'icebox.tex', 'meatrack.tex', 'homesign.tex', 'pighouse.tex',
          'trap.tex', 'birdtrap.tex', 'bugnet.tex', 'fishingrod.tex', 'umbrella.tex', 'heatrock.tex', 'bedroll_straw.tex',
          'carrot.tex', 'petals.tex', 'red_cap.tex', 'green_cap.tex', 'blue_cap.tex',
          'pinecone.tex', 'charcoal.tex', 'ash.tex', 'rope.tex', 'boards.tex', 'cutstone.tex', 'papyrus.tex', 'transistor.tex',
          'silk.tex', 'spidergland.tex', 'pigskin.tex', 'poop.tex', 'beefalowool.tex', 'houndstooth.tex', 'stinger.tex',
          'healingsalve.tex', 'bandage.tex', 'sewing_tape.tex', 'abigail_flower.tex', 'bathbomb.tex', 'messagebottle.tex',
          'monstermeat.tex', 'meat.tex', 'smallmeat.tex', 'drumstick.tex', 'froglegs.tex',
          'berries_cooked.tex', 'berries_juicy_cooked.tex', 'carrot_cooked.tex',
          'cookedmeat.tex', 'cookedsmallmeat.tex', 'cookedmonstermeat.tex', 'drumstick_cooked.tex', 'froglegs_cooked.tex',
          'red_cap_cooked.tex', 'green_cap_cooked.tex', 'blue_cap_cooked.tex',
          'meatballs.tex', 'kabobs.tex', 'ratatouille.tex', 'bonestew.tex', 'perogies.tex', 'baconeggs.tex',
          'honeyham.tex', 'trailmix.tex', 'monsterlasagna.tex', 'wetgoop.tex', 'smallmeat_dried.tex', 'meat_dried.tex', 'spoiled_food.tex',
        ];
        const wantedIcons: Record<string, string[]> = {
          'images/hud.xml': [
            'inv_slot.tex', 'inv_slot_spoiled.tex', 'slot_select.tex', 'resource_needed.tex',
            'equip_slot.tex', 'equip_slot_body.tex', 'equip_slot_head.tex',
            'equip_slot_hud.tex', 'equip_slot_body_hud.tex', 'equip_slot_head_hud.tex',
            'inventory_bg.tex', 'inventory_bg_cover.tex', 'inventory_bg_arrow.tex',
            'clock_rim.tex', 'clock_wedge.tex', 'clock_hand.tex', 'clock_NIGHT.tex',
            'tab_tool.tex', 'tab_light.tex', 'tab_trap.tex', 'tab_fight.tex',
            'tab_science.tex', 'tab_refine.tex', 'tab_build.tex', 'tab_dress.tex',
            'tab_farm.tex', 'tab_normal.tex', 'tab_selected.tex', 'tab_highlight.tex',
            'craft_bg.tex', 'craft_slot.tex', 'craft_slot_locked.tex',
            'craft_slot_missing_mats.tex', 'craft_slot_prototype.tex', 'craft_slot_place.tex', 'craft_sep.tex',
            'map_button.tex', 'map.tex', 'pause.tex', 'turnarrow_icon.tex', 'turnarrow_icon_over.tex',
            'self_inspect_wilson.tex', 'self_inspect_willow.tex', 'self_inspect_wolfgang.tex',
            'self_inspect_wendy.tex', 'self_inspect_wx78.tex', 'self_inspect_wickerbottom.tex',
            'self_inspect_woodie.tex', 'self_inspect_wes.tex', 'self_inspect_waxwell.tex',
            'self_inspect_wathgrithr.tex', 'self_inspect_webber.tex', 'self_inspect_winona.tex',
            'self_inspect_warly.tex', 'self_inspect_wortox.tex', 'self_inspect_wormwood.tex',
            'self_inspect_wurt.tex', 'self_inspect_walter.tex', 'effigy_button.tex', 'stat_bar.tex',
          ],
          'images/crafting_menu_icons.xml': [
            'filter_none.tex', 'filter_skull.tex',
            'filter_tool.tex', 'filter_fire.tex', 'filter_weapon.tex', 'filter_armour.tex',
            'filter_science.tex', 'filter_refine.tex', 'filter_structure.tex', 'filter_containers.tex',
            'filter_warable.tex', 'filter_health.tex', 'filter_cooking.tex', 'filter_gardening.tex',
            'filter_winter.tex', 'filter_summer.tex', 'filter_rain.tex', 'filter_favorites.tex',
            'filter_fishing.tex', 'station_science.tex', 'station_none.tex',
          ],
          'images/crafting_menu.xml': [
            'backing.tex', 'top.tex', 'bottom.tex', 'side.tex', 'horizontal_bar.tex', 'crafting_tab.tex',
            'filterslot_bg.tex', 'filterslot_bg_highlight.tex', 'filterslot_bg_buffered.tex',
            'filterslot_frame.tex', 'filterslot_frame_select.tex', 'filterslot_frame_highlight.tex', 'filterslot_prototype.tex',
            'slot_bg.tex', 'slot_bg_prototype.tex', 'slot_bg_missing_mats.tex', 'slot_bg_buffered.tex',
            'slot_fg_prototype.tex', 'slot_fg_lock.tex', 'slot_frame.tex', 'slot_frame_select.tex', 'slot_frame_highlight.tex',
            'pinslot_bg.tex', 'pinslot_bg_buffered.tex', 'pinslot_bg_prototype.tex', 'pinslot_bg_missing_mats.tex',
            'pinslot_fg_lock.tex', 'pinslot_fg_pin.tex', 'pinslot_fg_prototype.tex',
            'favorite_checked.tex', 'favorite_unchecked.tex',
            'ingredient_craft.tex', 'ingredient_prototype.tex', 'ingredient_lock.tex',
            'page_bg.tex', 'page_arrow.tex', 'scrollbar_arrow_up.tex', 'scrollbar_arrow_down.tex', 'scrollbar_bar.tex', 'scrollbar_handle.tex',
          ],
          'images/global_redux.xml': [
            'button_carny_long_normal.tex', 'button_carny_long_hover.tex', 'button_carny_long_down.tex', 'button_carny_long_disabled.tex',
            'button_carny_xlong_normal.tex', 'button_carny_xlong_hover.tex', 'button_carny_xlong_down.tex',
            'char_selection.tex', 'textbox3_gold_normal.tex', 'close.tex',
            'status_health.tex', 'status_hunger.tex', 'status_sanity.tex',
          ],
          'images/crafting_menu_avatars.xml': [
            'avatar_wilson.tex', 'avatar_willow.tex', 'avatar_wolfgang.tex', 'avatar_wendy.tex',
            'avatar_wx78.tex', 'avatar_wickerbottom.tex', 'avatar_woodie.tex', 'avatar_wes.tex',
            'avatar_waxwell.tex', 'avatar_wathgrithr.tex', 'avatar_webber.tex', 'avatar_winona.tex',
            'avatar_warly.tex', 'avatar_wortox.tex', 'avatar_wormwood.tex', 'avatar_wurt.tex',
            'avatar_walter.tex', 'avatar_wanda.tex',
          ],
          'images/frontscreen.xml': [
            'title.tex as fe_title_logo',
            'kleipresents.tex as fe_kleipresents',
            'play_highlight.tex as fe_play_highlight',
          ],
          'images/bg_animated_portal.xml': [
            'bg_plate.tex as fe_portal_bg',
          ],
          'images/fg_animated_portal.xml': [
            'fg_plate.tex as fe_portal_fg',
          ],
          'images/fg_trees.xml': [
            'trees.tex as fe_fg_trees',
          ],
          'images/serverplaystyles.xml': [
            'relaxed.tex as playstyle_relaxed',
            'endless.tex as playstyle_endless',
            'survival.tex as playstyle_survival',
            'wilderness.tex as playstyle_wilderness',
            'lightsout.tex as playstyle_lightsout',
            'caves.tex as playstyle_caves',
            'nocaves.tex as playstyle_nocaves',
            'frame.tex as playstyle_frame',
            'frame_hl.tex as playstyle_frame_hl',
          ],
          'images/server_intentions.xml': [
            'social.tex as intention_social',
            'coop.tex as intention_coop',
            'competitive.tex as intention_competitive',
            'madness.tex as intention_madness',
          ],
          'images/saveslot_portraits.xml': [
            'background.tex as saveslot_bg',
            'random.tex as saveslot_random',
          ],
          'images/lavaarena_frontend.xml': [
            'title.tex as mode_forge_title',
          ],
          'images/lavaarena_hud.xml': [
            'lavaarena_inventorybar.tex as forge_inv_bar',
            'victory_dialog.tex as forge_victory_dialog',
          ],
          'images/quagmire_frontend.xml': [
            'gorge_tournament_info.tex as mode_gorge_title',
          ],
          'images/quagmire_hud.xml': [
            'quagmire_hangry_bar.tex as gorge_hangry_bar',
            'quagmire_announcement_bg_centered.tex as gorge_announce_bg',
          ],
          'images/plantregistry.xml': [
            'season_autumn.tex as season_icon_autumn',
            'season_spring.tex as season_icon_spring',
            'season_summer.tex as season_icon_summer',
            'oversizedpictureframe.tex as plant_frame',
          ],
          'images/scrapbook.xml': [
            'scrap_square.tex as scrap_square',
            'icon_health.tex as scrap_health',
            'icon_hunger.tex as scrap_hunger',
            'icon_sanity.tex as scrap_sanity',
          ],
          'images/inventoryimages1.xml': wantedInventoryItems,
          'images/inventoryimages2.xml': wantedInventoryItems,
          'images/inventoryimages3.xml': wantedInventoryItems,
          'minimap/minimap_data.xml': [
            'portal_dst.png', 'wilson.png', 'evergreen.png', 'evergreen_lumpy.png', 'marshtree.png',
            'tree_leaf.png', 'livingtree.png', 'moon_tree.png', 'rock.png', 'rock_gold.png', 'rock_flintless.png',
            'firepit.png', 'researchlab.png', 'researchlab2.png', 'cookpot.png', 'icebox.png', 'meatrack.png',
            'berrybush.png', 'berrybush2.png', 'berrybush_juicy.png', 'bananabush.png', 'marsh_bush.png',
            'grass.png', 'sapling.png', 'wormhole.png', 'pond.png', 'lava_pond.png',
            'cave_closed.png', 'cave_open.png', 'pighouse.png', 'pigking.png', 'spiderden.png', 'treasurechest.png',
          ],
        };

        const captured = new Map<number, { width: number; height: number; rgba: Uint8Array }>();
        engine.nativeTextureBackendReady = () => true;
        engine.hasNativeTexture = (id: number) => captured.has(id >>> 0);
        engine.beginNativeTexture = () => {};
        engine.uploadNativeTexture = (id: number, level: number, width: number, height: number, bytes: Uint8Array) => {
          if (level === 0) {
            captured.set(id >>> 0, { width, height, rgba: bytes.slice() });
          }
        };
        engine.finishNativeTexture = () => {};
        engine.releaseNativeTexture = (id: number) => captured.delete(id >>> 0);

        const icons: Record<string, { width: number; height: number; rgba: ArrayBuffer }> = {};
        for (const [xmlPath, names] of Object.entries(wantedIcons)) {
          if (!resources.exists(xmlPath)) continue;
          try {
            const atlas = JSON.parse(
              await evaluations.evaluateAsync(`return require("json").encode_compliant(WebAtlases.Decode(${JSON.stringify(xmlPath)}))`, 50000000),
            );
            const texPath = String(atlas.texture || '');
            if (!texPath || !resources.exists(texPath)) continue;
            const texInfo = JSON.parse(
              await evaluations.evaluateAsync(`return require("json").encode_compliant(WebTextures.DecodeMip(${JSON.stringify(texPath)}, 2048))`, 50000000),
            );
            const mip = captured.get(texInfo.id >>> 0);
            if (!mip || !Array.isArray(atlas.elements)) continue;

            const elemMap = new Map<string, { u1: number; u2: number; v1: number; v2: number }>();
            for (const el of atlas.elements) elemMap.set(el.name, el);

            const W = mip.width;
            const H = mip.height;
            const src = mip.rgba;

            for (const rawName of names) {
              const parts = rawName.trim().split(/\s+as\s+/i);
              const name = parts[0].trim();
              const customKey = parts[1]?.trim();
              const el = elemMap.get(name);
              if (!el) continue;
              const x0 = Math.max(0, Math.min(W - 1, Math.floor(el.u1 * W)));
              const x1 = Math.max(x0 + 1, Math.min(W, Math.ceil(el.u2 * W)));
              const yMin = Math.max(0, Math.min(H - 1, Math.floor(el.v1 * H)));
              const yMax = Math.max(yMin + 1, Math.min(H, Math.ceil(el.v2 * H)));
              const cw = x1 - x0;
              const ch = yMax - yMin;
              if (cw < 2 || ch < 2) continue;

              const out = new Uint8Array(cw * ch * 4);
              for (let ry = 0; ry < ch; ++ry) {
                const sy = yMax - 1 - ry;
                for (let rx = 0; rx < cw; ++rx) {
                  const sx = x0 + rx;
                  const si = (sy * W + sx) * 4;
                  const di = (ry * cw + rx) * 4;
                  const a = src[si + 3];
                  if (a > 0 && a < 255) {
                    out[di] = Math.min(255, Math.round((src[si] * 255) / a));
                    out[di + 1] = Math.min(255, Math.round((src[si + 1] * 255) / a));
                    out[di + 2] = Math.min(255, Math.round((src[si + 2] * 255) / a));
                    out[di + 3] = a;
                  } else {
                    out[di] = src[si];
                    out[di + 1] = src[si + 1];
                    out[di + 2] = src[si + 2];
                    out[di + 3] = a;
                  }
                }
              }
              const key = customKey || name.replace(/\.(tex|png)$/, '');
              icons[key] = { width: cw, height: ch, rgba: out.buffer };
              transfers.push(out.buffer);
            }
            captured.delete(texInfo.id >>> 0);
            try { evaluate(`WebAtlases.Release(${JSON.stringify(xmlPath)})`); } catch {}
          } catch {}
        }

        // Rasterize authentic Klei BILD status badge symbols (status_health, status_hunger, status_sanity, status_wet, status_meter, temperature_meter)
        const rasterizeSymbol = (parsed: any, mip: { width: number; height: number; rgba: Uint8Array }, symName: string, outSize: number) => {
          const sym: any = Object.values(parsed.symbols || {}).find((s: any) => s?.name === symName);
          if (!sym || !Array.isArray(sym.frames) || !sym.frames.length) return null;
          const f = sym.frames[0];
          const verts = (parsed.vertices || []).slice(f.offset, f.offset + f.count);
          if (verts.length < 3) return null;

          let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
          for (const [x, y] of verts) {
            if (x < xMin) xMin = x;
            if (x > xMax) xMax = x;
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
          }
          const spanW = Math.max(1, xMax - xMin);
          const spanH = Math.max(1, yMax - yMin);
          const pad = 4;
          const scale = Math.min((outSize - pad * 2) / spanW, (outSize - pad * 2) / spanH);
          const cx = (xMin + xMax) * 0.5;
          const cy = (yMin + yMax) * 0.5;

          const out = new Uint8Array(outSize * outSize * 4);
          const W = mip.width;
          const H = mip.height;
          const src = mip.rgba;

          for (let i = 0; i + 2 < verts.length; i += 3) {
            const v0 = verts[i], v1 = verts[i + 1], v2 = verts[i + 2];
            const x0 = outSize * 0.5 + (v0[0] - cx) * scale;
            const y0 = outSize * 0.5 + (v0[1] - cy) * scale;
            const x1 = outSize * 0.5 + (v1[0] - cx) * scale;
            const y1 = outSize * 0.5 + (v1[1] - cy) * scale;
            const x2 = outSize * 0.5 + (v2[0] - cx) * scale;
            const y2 = outSize * 0.5 + (v2[1] - cy) * scale;

            const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
            if (Math.abs(denom) < 1e-5) continue;

            const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
            const bx1 = Math.min(outSize - 1, Math.ceil(Math.max(x0, x1, x2)));
            const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
            const by1 = Math.min(outSize - 1, Math.ceil(Math.max(y0, y1, y2)));

            for (let py = by0; py <= by1; ++py) {
              const sy = py + 0.5;
              for (let px = bx0; px <= bx1; ++px) {
                const sx = px + 0.5;
                const w0 = ((y1 - y2) * (sx - x2) + (x2 - x1) * (sy - y2)) / denom;
                const w1 = ((y2 - y0) * (sx - x2) + (x0 - x2) * (sy - y2)) / denom;
                const w2 = 1 - w0 - w1;
                if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;

                const u = w0 * v0[3] + w1 * v1[3] + w2 * v2[3];
                const v = w0 * v0[4] + w1 * v1[4] + w2 * v2[4];
                const tx = Math.max(0, Math.min(W - 1, Math.floor(u * W)));
                const ty = Math.max(0, Math.min(H - 1, Math.floor(v * H)));
                const si = (ty * W + tx) * 4;
                const a = src[si + 3];
                if (a === 0) continue;
                const di = (py * outSize + px) * 4;
                if (a > 0 && a < 255) {
                  out[di] = Math.min(255, Math.round((src[si] * 255) / a));
                  out[di + 1] = Math.min(255, Math.round((src[si + 1] * 255) / a));
                  out[di + 2] = Math.min(255, Math.round((src[si + 2] * 255) / a));
                  out[di + 3] = a;
                } else {
                  out[di] = src[si];
                  out[di + 1] = src[si + 1];
                  out[di + 2] = src[si + 2];
                  out[di + 3] = a;
                }
              }
            }
          }
          return { width: outSize, height: outSize, rgba: out.buffer };
        };

        const badgeSpecs: Array<{ zip: string; symbols: Array<{ sym: string; key: string; size: number }> }> = [
          { zip: 'anim/status_health.zip', symbols: [{ sym: 'icon', key: 'badge_health', size: 84 }] },
          { zip: 'anim/status_hunger.zip', symbols: [{ sym: 'icon', key: 'badge_hunger', size: 84 }] },
          { zip: 'anim/status_sanity.zip', symbols: [{ sym: 'icon', key: 'badge_sanity', size: 84 }] },
          { zip: 'anim/status_wet.zip', symbols: [{ sym: 'icon', key: 'badge_wet', size: 84 }] },
          {
            zip: 'anim/status_meter.zip',
            symbols: [
              { sym: 'frame_circle', key: 'badge_frame_circle', size: 112 },
              { sym: 'bg', key: 'badge_bg', size: 84 },
            ],
          },
          { zip: 'anim/temperature_meter.zip', symbols: [{ sym: 'meter', key: 'badge_temp', size: 84 }] },
          { zip: 'anim/ui_chest_3x3.zip', symbols: [{ sym: 'background', key: 'chest_bg_9slot', size: 220 }] },
        ];

        for (const spec of badgeSpecs) {
          if (!resources.exists(spec.zip)) continue;
          captured.clear();
          try {
            const parsed = JSON.parse(
              await evaluations.evaluateAsync(`return WebAssets.DecodeRenderJson(${JSON.stringify(spec.zip)}, 2, true)`, 50000000),
            );
            const mip = captured.get(0);
            if (!mip) continue;
            for (const s of spec.symbols) {
              const icon = rasterizeSymbol(parsed, mip, s.sym, s.size);
              if (icon) {
                icons[s.key] = icon;
                transfers.push(icon.rgba);
              }
            }
          } catch {}
        }

        result = { icons };
        break;
      }
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

        // 3. Reinitialize a clean Lua VM with compat/prelude.lua so main.lua runs with MODS_ROOT and native globals
        engine._dst_close();
        if (engine._dst_init(['client', 'master', 'caves'].indexOf(role))) {
          throw new Error('Lua re-initialization failed');
        }
        engine._dst_platform_storage(1);
        if (resources) resources.install(engine);
        evaluations = engineEvaluator(engine, () => ready);
        evaluate('dofile("/compat/prelude.lua")');
        configureSession(engine, sessionParameters(contentManifest, {}), contentManifest);

        const viewportW = Number(data.width) || 1280;
        const viewportH = Number(data.height) || 720;
        engine._dst_ui_viewport(viewportW, viewportH);
        const initialCreative = Boolean(data.creativeMode);
        const chosenCharacter = String(data.character || 'wilson').replace(/[^a-z0-9_]/g, '') || 'wilson';
        const chosenSeason = String(data.season || 'autumn').replace(/[^a-z]/g, '') || 'autumn';
        const chosenPlaystyle = String(data.playstyle || 'survival').replace(/[^a-z]/g, '') || 'survival';
        const chosenIntention = String(data.intention || 'coop').replace(/[^a-z]/g, '') || 'coop';
        const worldSeedStr = String(data.worldSeed || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const enabledModsList: string[] = Array.isArray(data.enabledMods) ? data.enabledMods.map((m: any) => String(m).replace(/[^a-zA-Z0-9_-]/g, '')) : [];
        evaluate(`
          _G._WEB_ViewportW = ${viewportW}
          _G._WEB_ViewportH = ${viewportH}
          WebPrefabs.SetDeferAnimations(true)
          WebInput.SetDesktopMode(true)
          TheNet:StartServer(false)
          RUN_GLOBAL_INIT = false
          json_settings = [=[{"reset_action":1,"save_slot":1}]=]
        `);
        await evaluations.evaluateAsync('dofile("/scripts/main.lua"); json_settings = nil; Start()', 200000000);
        await evaluations.evaluateAsync(`
          TheSim:LoadPrefabs({
            "global", "wilson", "${chosenCharacter}", "flint", "twigs", "cutgrass", "berries", "log", "rocks", "goldnugget",
            "nitre", "petals", "carrot", "rope", "boards", "cutstone", "axe", "pickaxe", "shovel", "hammer",
            "torch", "campfire", "firepit", "researchlab", "researchlab2", "treasurechest", "cookpot", "icebox", "meatrack",
            "spear", "hambat", "armorgrass", "armorwood", "armormarble", "cane", "heatrock", "bedroll_straw", "compass", "homesign", "pighouse",
            "backpack", "strawhat", "flowerhat", "footballhat", "tophat", "winterhat", "minerhat",
            "trap", "birdtrap", "bugnet", "fishingrod", "razor", "lantern", "umbrella", "healingsalve", "bandage",
            "papyrus", "transistor", "berries_cooked", "carrot_cooked", "cookedmeat", "cookedsmallmeat", "cookedmonstermeat",
            "red_cap_cooked", "green_cap_cooked", "blue_cap_cooked", "meatballs", "kabobs", "ratatouille",
            "bonestew", "perogies", "baconeggs", "honeyham", "trailmix", "monsterlasagna", "wetgoop",
            "smallmeat_dried", "meat_dried", "drumstick", "drumstick_cooked", "froglegs", "froglegs_cooked",
            "meat", "smallmeat", "monstermeat", "silk", "spidergland", "ash", "charcoal", "poop"
          })
          LoadFonts()
          if TheWorld ~= nil and "${chosenSeason}" ~= "autumn" then
            TheWorld:PushEvent("ms_setseason", "${chosenSeason}")
          end
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

          local char_specs = {
            wilson       = { name = "Wilson",       hp = 150, hu = 150, sa = 200, items = {} },
            willow       = { name = "Willow",       hp = 150, hu = 150, sa = 120, items = { "torch" } },
            wolfgang     = { name = "Wolfgang",     hp = 200, hu = 200, sa = 200, items = {} },
            wendy        = { name = "Wendy",        hp = 150, hu = 150, sa = 200, items = { "petals", "petals", "petals" } },
            wx78         = { name = "WX-78",        hp = 125, hu = 125, sa = 150, items = {} },
            wickerbottom = { name = "Wickerbottom", hp = 125, hu = 150, sa = 250, items = { "papyrus", "papyrus" } },
            woodie       = { name = "Woodie",       hp = 150, hu = 150, sa = 200, items = { "axe" } },
            wes          = { name = "Wes",          hp = 75,  hu = 75,  sa = 75,  items = {} },
            waxwell      = { name = "Maxwell",      hp = 75,  hu = 150, sa = 200, items = { "papyrus" } },
            wathgrithr   = { name = "Wigfrid",      hp = 200, hu = 120, sa = 120, items = { "spear", "footballhat", "meat", "meat" } },
            webber       = { name = "Webber",       hp = 175, hu = 175, sa = 100, items = { "silk", "silk" } },
            winona       = { name = "Winona",       hp = 150, hu = 150, sa = 200, items = { "rope", "flint" } },
            warly        = { name = "Warly",        hp = 150, hu = 250, sa = 200, items = { "berries", "carrot", "meat" } },
            wortox       = { name = "Wortox",       hp = 200, hu = 175, sa = 150, items = {} },
            wormwood     = { name = "Wormwood",     hp = 150, hu = 150, sa = 150, items = { "log", "twigs" } },
            wurt         = { name = "Wurt",         hp = 150, hu = 200, sa = 150, items = { "cutgrass", "twigs" } },
            walter       = { name = "Walter",       hp = 130, hu = 110, sa = 200, items = { "rocks", "rocks", "twigs" } },
            wanda        = { name = "Wanda",        hp = 150, hu = 175, sa = 200, items = { "goldnugget" } },
          }
          local cspec = char_specs["${chosenCharacter}"] or char_specs.wilson

          local ok_spawn, player = pcall(function() return SpawnPrefab("${chosenCharacter}") end)
          if not ok_spawn or player == nil or player.components == nil or player.components.inventory == nil then
            player = SpawnPrefab("wilson")
            if player ~= nil and player.AnimState ~= nil then
              player.AnimState:SetBuild("${chosenCharacter}")
            end
          end
          player.userid = "KU_local"
          player.name = cspec.name
          player.prefab = "${chosenCharacter}"
          player.Transform:SetPosition(sx, sy, sz)
          if player.components.health ~= nil then
            player.components.health:SetMaxHealth(cspec.hp)
          end
          if player.components.hunger ~= nil then
            player.components.hunger:SetMax(cspec.hu)
          end
          if player.components.sanity ~= nil then
            player.components.sanity:SetMax(cspec.sa)
          end
          if not table.contains(AllPlayers, player) then
            table.insert(AllPlayers, player)
          end
          ThePlayer = player
          player:PushEvent("setowner")
          TheWorld:PushEvent("ms_playerspawn", player)

          if player.components.inventory ~= nil and cspec.items ~= nil then
            for _, start_pf in ipairs(cspec.items) do
              local ok_it, it = pcall(function() return SpawnPrefab(start_pf) end)
              if ok_it and it ~= nil then
                player.components.inventory:GiveItem(it)
              end
            end
          end

          -- Spawn convenient starter survival items near the portal if not already present
          for i, item_def in ipairs({
            {prefab="flint", dx=2.2, dz=-1.2},
            {prefab="flint", dx=-2.4, dz=1.5},
            {prefab="twigs", dx=1.8, dz=2.0},
            {prefab="twigs", dx=-1.8, dz=-2.1},
            {prefab="cutgrass", dx=2.8, dz=0.8},
            {prefab="cutgrass", dx=-2.5, dz=-0.8},
            {prefab="berries", dx=1.2, dz=-2.4},
            {prefab="petals", dx=-1.1, dz=2.3},
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

          _G._WEB_CreativeMode = ${initialCreative ? 'true' : 'false'}
          _G._WEB_InCaves = false
          _G._WEB_Announcements = {}
          _G._WEB_SoundEvents = {}
          _G._WEB_OpenContainerGuid = nil
          _G._WEB_Speech = { text = "", untilTick = 0 }
          _G._WEB_WorldSeed = "${worldSeedStr}"
          _G._WEB_Peers = {}
          _G._WEB_CompState = setmetatable({}, { __mode = "k" })

          function _G._WEB_PushSound(ev, vol, loopName, action)
            if type(ev) == "string" and ev ~= "" and #_G._WEB_SoundEvents < 16 then
              table.insert(_G._WEB_SoundEvents, { path = ev, event = ev, name = loopName, action = action, volume = tonumber(vol) or 1.0 })
            end
          end

          function _G._WEB_PushNotice(msg)
            table.insert(_G._WEB_Announcements, 1, tostring(msg or ""))
            while #_G._WEB_Announcements > 6 do table.remove(_G._WEB_Announcements) end
          end

          function _G._WEB_Say(msg, durationTicks)
            local str = tostring(msg or "")
            if str ~= "" then
              _G._WEB_Speech = { text = str, untilTick = GetTick() + (durationTicks or 140) }
              _G._WEB_PushSound("dontstarve/characters/wilson/talk_LP", 0.7)
            end
          end

          -- =====================================================================
          -- FULL LAYER 1 & LAYER 2 PORT BINDINGS (WorldSim, MapGenSim, ModManager,
          -- Klei Console Commands, TheSim, TheNet, TheShard, Component Userdata)
          -- =====================================================================
          local function _WEB_InstallFullPortBindings()
            -- 1. Top-level missing C++ functions: getminimumradius, getrealtime, kleiregistermods
            rawset(_G, "getminimumradius", function(inst)
              if type(inst) == "table" and inst.Physics ~= nil and inst.Physics.GetRadius ~= nil then
                local ok, r = pcall(function() return inst.Physics:GetRadius() end)
                if ok and type(r) == "number" and r > 0 then return r end
              end
              return 0.5
            end)
            rawset(_G, "getrealtime", function()
              return os.clock()
            end)

            -- 2. WorldSim (all 63 worldgen methods) & MapGenSim (all 8 methods)
            local ws_state = {
              w = 425,
              h = 425,
              impassable = 1,
              save_buf = {},
              sites = {},
              nodes = {},
              links = {},
              tiles = {},
              reserved = {},
              road_params = {},
            }
            if TheWorld and TheWorld.Map and TheWorld.Map.GetSize then
              local ok_sz, mw, mh = pcall(function() return TheWorld.Map:GetSize() end)
              if ok_sz and type(mw) == "number" and mw > 0 then
                ws_state.w = mw
                ws_state.h = mh or mw
              end
            end
            local ws_api = {
              SetWorldSize = function(self, w, h) ws_state.w = tonumber(w) or 425; ws_state.h = tonumber(h) or ws_state.w; return true end,
              GetWorldSize = function(self) return ws_state.w, ws_state.h end,
              SetImpassibleTileType = function(self, tile) ws_state.impassable = tonumber(tile) or 1 end,
              InitSaveString = function(self) ws_state.save_buf = {} end,
              AppendSaveString = function(self, str) table.insert(ws_state.save_buf, tostring(str or "")) end,
              GetSaveString = function(self) return table.concat(ws_state.save_buf, "") end,
              RemoveLastComma = function(self)
                local n = #ws_state.save_buf
                if n > 0 then ws_state.save_buf[n] = string.gsub(ws_state.save_buf[n], ",%s*$", "") end
              end,
              FreeSaveString = function(self) ws_state.save_buf = {} end,
              GenerateSessionIdentifier = function(self) return "15CD1F748D1D1C77" end,
              Sim_LuaPrint = function(self, ...) print(...) end,
              SetTile = function(self, x, y, tile)
                local tx, ty, t = tonumber(x) or 0, tonumber(y) or 0, tonumber(tile) or 6
                ws_state.tiles[ty * 2048 + tx] = t
                if TheWorld and TheWorld.Map and TheWorld.Map.SetTile then
                  pcall(function() TheWorld.Map:SetTile(tx, ty, t) end)
                end
              end,
              GetTile = function(self, x, y)
                local tx, ty = tonumber(x) or 0, tonumber(y) or 0
                local cached = ws_state.tiles[ty * 2048 + tx]
                if cached ~= nil then return cached end
                if TheWorld and TheWorld.Map and TheWorld.Map.GetTile then
                  local ok, t = pcall(function() return TheWorld.Map:GetTile(tx, ty) end)
                  if ok and type(t) == "number" then return t end
                end
                return 6
              end,
              GetVisualTileAtPosition = function(self, x, y)
                return self:GetTile(x, y)
              end,
              GetTileXY = function(self, x, z)
                if TheWorld and TheWorld.Map and TheWorld.Map.GetTileCoordsAtPoint then
                  local ok, tx, ty = pcall(function() return TheWorld.Map:GetTileCoordsAtPoint(tonumber(x) or 0, 0, tonumber(z) or 0) end)
                  if ok and tx then return tx, ty end
                end
                return math.floor((tonumber(x) or 0) / 4 + ws_state.w * 0.5), math.floor((tonumber(z) or 0) / 4 + ws_state.h * 0.5)
              end,
              SetSiteFlags = function(self, id, flags)
                ws_state.sites[id] = ws_state.sites[id] or { x = 0, y = 0, flags = 0, children = {}, poly = { {0,0}, {4,0}, {4,4}, {0,4} } }
                ws_state.sites[id].flags = tonumber(flags) or 0
              end,
              GetSiteFlags = function(self, id)
                return ws_state.sites[id] and ws_state.sites[id].flags or 0
              end,
              GetSite = function(self, id)
                local s = ws_state.sites[id]
                if s then return s.x, s.y end
                return 0, 0
              end,
              GetSiteArea = function(self, id)
                return ws_state.sites[id] and ws_state.sites[id].area or 64
              end,
              GetSiteCentroid = function(self, id)
                local s = ws_state.sites[id]
                if s then return s.x, s.y end
                return 0, 0
              end,
              GetSitePolygon = function(self, id)
                local s = ws_state.sites[id]
                return (s and s.poly) or { {0,0}, {4,0}, {4,4}, {0,4} }
              end,
              PointInSite = function(self, id, x, z)
                local s = ws_state.sites[id]
                if not s then return true end
                local dx, dz = (tonumber(x) or 0) - s.x, (tonumber(z) or 0) - s.y
                return (dx * dx + dz * dz) <= 256
              end,
              AddChild = function(self, parent, child, ...)
                ws_state.sites[parent] = ws_state.sites[parent] or { x = 0, y = 0, flags = 0, children = {} }
                table.insert(ws_state.sites[parent].children, child)
              end,
              GetChildrenForSite = function(self, id)
                return (ws_state.sites[id] and ws_state.sites[id].children) or {}
              end,
              AddExternalLink = function(self, n1, n2)
                table.insert(ws_state.links, { n1, n2 })
              end,
              ClearNodeLinks = function(self, id)
                ws_state.links = {}
              end,
              CreateNodeId = function(self, id, nodeType)
                ws_state.nodes[id] = { id = id, type = nodeType or 0 }
                return id
              end,
              SetNodeType = function(self, id, nodeType)
                ws_state.nodes[id] = ws_state.nodes[id] or { id = id }
                ws_state.nodes[id].type = nodeType
              end,
              SetTileNodeId = function(self, x, y, nodeId)
                ws_state.nodes[tostring(x) .. ":" .. tostring(y)] = nodeId
              end,
              ReserveSpace = function(self, id, size)
                ws_state.reserved[id] = size or 1
                return true
              end,
              ReserveTile = function(self, x, y)
                ws_state.reserved[tostring(x) .. "," .. tostring(y)] = true
              end,
              IsSubtileReserved = function(self, x, y)
                return ws_state.reserved[tostring(x) .. "," .. tostring(y)] == true
              end,
              GetPointsForSite = function(self, id)
                local s = ws_state.sites[id] or { x = 0, y = 0 }
                return { s.x }, { s.y }
              end,
              GetRandomPointsForSite = function(self, id, count)
                local s = ws_state.sites[id] or { x = 0, y = 0 }
                local xs, ys = {}, {}
                local n = math.min(64, math.max(1, tonumber(count) or 4))
                for i = 1, n do
                  local a = (i / n) * 6.2831853
                  xs[i] = s.x + math.cos(a) * (2 + (i % 5) * 2)
                  ys[i] = s.y + math.sin(a) * (2 + (i % 5) * 2)
                end
                return xs, ys
              end,
              GetPointsForMetaMaze = function(self)
                return { 0 }, { 0 }
              end,
              SetRoadParameters = function(self, ...)
                ws_state.road_params = { ... }
              end,
              DrawGroundLine = function(self, x1, y1, x2, y2, tile)
                local steps = 16
                for i = 0, steps do
                  local t = i / steps
                  local x = math.floor((tonumber(x1) or 0) * (1 - t) + (tonumber(x2) or 0) * t)
                  local y = math.floor((tonumber(y1) or 0) * (1 - t) + (tonumber(y2) or 0) * t)
                  self:SetTile(x, y, tile or 2)
                end
              end,
              ConvertToTileMap = function(self, size) return true end,
              DetectDisconnect = function(self) return false end,
              draw_voronoi = function(self) return true end,
              ForceConnectivity = function(self) return true end,
              GenerateBlendedMap = function(self) return true end,
              GenerateVoronoiMap = function(self, ...) return true end,
              ReplaceSingleNonLandTiles = function(self) return true end,
              ResolutionConvex = function(self) return true end,
              RunCA = function(self, ...) return true end,
              RunMaze = function(self, ...) return true end,
              SeparateIslands = function(self) return true end,
              TeleportWormhole = function(self) return true end,
              VoronoiRelax = function(self, ...) return true end,
            }
            setmetatable(ws_api, {
              __index = function(t, k)
                local fn = function() return true end
                rawset(t, k, fn)
                return fn
              end
            })
            rawset(_G, "WorldSim", ws_api)
            rawset(_G, "MapGenSim", setmetatable({}, { __index = ws_api }))

            -- 3. ModManager & Klei Mod System
            local mod_mgr = rawget(_G, "ModManager") or {}
            mod_mgr.mods = mod_mgr.mods or {}
            mod_mgr.modnames = mod_mgr.modnames or {}
            mod_mgr.enabledmods = mod_mgr.enabledmods or {}
            mod_mgr.postinit_prefab = mod_mgr.postinit_prefab or {}
            mod_mgr.postinit_prefab_any = mod_mgr.postinit_prefab_any or {}
            mod_mgr.postinit_component = mod_mgr.postinit_component or {}
            mod_mgr.postinit_player = mod_mgr.postinit_player or {}
            mod_mgr.postinit_sim = mod_mgr.postinit_sim or {}
            mod_mgr.GetEnabledServerModNames = function(self) return self.modnames end
            mod_mgr.GetServerModsNames = function(self) return self.modnames end
            mod_mgr.GetMod = function(self, name) return self.mods[name] end
            mod_mgr.RegisterPrefabs = function(self) return true end
            mod_mgr.SetPostEnv = function(self) return true end
            mod_mgr.FrontendLoadMod = function(self, modname)
              if modname and not table.contains(self.modnames, modname) then
                table.insert(self.modnames, modname)
              end
              self.enabledmods[modname] = true
              return true
            end
            mod_mgr.FrontendUnloadMod = function(self, modname)
              self.enabledmods[modname] = nil
              for i = #self.modnames, 1, -1 do
                if self.modnames[i] == modname then table.remove(self.modnames, i) end
              end
              return true
            end
            mod_mgr.AddPrefabPostInit = function(self, prefab, fn)
              if type(prefab) == "string" and type(fn) == "function" then
                self.postinit_prefab[prefab] = self.postinit_prefab[prefab] or {}
                table.insert(self.postinit_prefab[prefab], fn)
                for _, ent in pairs(Ents) do
                  if ent:IsValid() and ent.prefab == prefab then pcall(fn, ent) end
                end
              end
            end
            mod_mgr.AddPrefabPostInitAny = function(self, fn)
              if type(fn) == "function" then
                table.insert(self.postinit_prefab_any, fn)
                for _, ent in pairs(Ents) do
                  if ent:IsValid() then pcall(fn, ent) end
                end
              end
            end
            mod_mgr.AddComponentPostInit = function(self, comp, fn)
              if type(comp) == "string" and type(fn) == "function" then
                self.postinit_component[comp] = self.postinit_component[comp] or {}
                table.insert(self.postinit_component[comp], fn)
                for _, ent in pairs(Ents) do
                  if ent:IsValid() and ent.components and ent.components[comp] then
                    pcall(fn, ent.components[comp], ent)
                  end
                end
              end
            end
            mod_mgr.AddPlayerPostInit = function(self, fn)
              if type(fn) == "function" then
                table.insert(self.postinit_player, fn)
                if ThePlayer then pcall(fn, ThePlayer) end
              end
            end
            mod_mgr.AddSimPostInit = function(self, fn)
              if type(fn) == "function" then
                table.insert(self.postinit_sim, fn)
                pcall(fn, ThePlayer)
              end
            end
            mod_mgr.GetPostInitFns = function(self, kind, id)
              if kind == "PrefabPostInit" and id then return self.postinit_prefab[id] or {} end
              if kind == "PrefabPostInitAny" then return self.postinit_prefab_any end
              if kind == "ComponentPostInit" and id then return self.postinit_component[id] or {} end
              if kind == "PlayerPostInit" then return self.postinit_player end
              if kind == "SimPostInit" then return self.postinit_sim end
              return {}
            end
            mod_mgr.InitializeModMain = function(self, modname, code_or_path)
              local env = setmetatable({
                GLOBAL = _G,
                env = {},
                modname = modname,
                MODROOT = "/mods/" .. tostring(modname) .. "/",
                AddPrefabPostInit = function(pf, fn) mod_mgr:AddPrefabPostInit(pf, fn) end,
                AddPrefabPostInitAny = function(fn) mod_mgr:AddPrefabPostInitAny(fn) end,
                AddComponentPostInit = function(c, fn) mod_mgr:AddComponentPostInit(c, fn) end,
                AddPlayerPostInit = function(fn) mod_mgr:AddPlayerPostInit(fn) end,
                AddSimPostInit = function(fn) mod_mgr:AddSimPostInit(fn) end,
                GetModConfigData = function(k) return true end,
              }, { __index = _G })
              env.env = env
              mod_mgr.mods[modname] = env
              mod_mgr:FrontendLoadMod(modname)
              local fn, err = loadstring(code_or_path, "@" .. tostring(modname))
              if fn then
                setfenv(fn, env)
                local ok, res = pcall(fn)
                return ok, res
              end
              return false, err
            end
            rawset(_G, "ModManager", mod_mgr)
            rawset(_G, "kleiregistermods", function(mods)
              if type(mods) == "table" then
                for _, m in ipairs(mods) do mod_mgr:FrontendLoadMod(tostring(m)) end
              end
              return true
            end)

            -- 4. Upgrade TheSim runtime methods (3D isometric ProjectScreenPos / GetScreenPos, dynamic GetLightAtPoint, FindEntities)
            TheSim.ProjectScreenPos = function(self, x, y, z)
              local vw = _G._WEB_ViewportW or 1280
              local vh = _G._WEB_ViewportH or 720
              local cam = TheCamera
              local cx, cy, cz = 0, 1.5, 0
              local heading = 45
              local pitch = 42.85
              local dist = 30
              local fov = 35
              if cam then
                if cam.currentpos then cx, cy, cz = cam.currentpos.x, cam.currentpos.y, cam.currentpos.z end
                heading = cam.heading or 45
                pitch = cam.pitch or 42.85
                dist = cam.distance or 30
                fov = cam.fov or 35
              elseif ThePlayer and ThePlayer.Transform then
                cx, cy, cz = ThePlayer.Transform:GetWorldPosition()
              end
              local dx = (tonumber(x) or 0) - cx
              local dy = (tonumber(y) or 0) - cy
              local dz = (tonumber(z) or 0) - cz
              local hRad = heading * 0.017453292519943295
              local pRad = pitch * 0.017453292519943295
              local cosH, sinH = math.cos(hRad), math.sin(hRad)
              local cosP, sinP = math.cos(pRad), math.sin(pRad)
              local rx = -dx * sinH + dz * cosH
              local flatDepth = -dx * cosH - dz * sinH
              local ry = dy * cosP + flatDepth * sinP
              local depth = dist - (flatDepth * cosP - dy * sinP)
              if depth < 1.0 then depth = 1.0 end
              local f = (vh * 0.5) / math.tan(fov * 0.5 * 0.017453292519943295)
              local sx_out = vw * 0.5 + (rx * f) / depth
              local sy_out = vh * 0.5 - (ry * f) / depth
              return sx_out, sy_out
            end
            TheSim.GetScreenPos = TheSim.ProjectScreenPos

            TheSim.GetLightAtPoint = function(self, x, y, z)
              local wx, wz = tonumber(x) or 0, tonumber(z) or 0
              local phase = TheWorld and TheWorld.state and TheWorld.state.phase or "day"
              local ambient = 1.0
              if phase == "dusk" then ambient = 0.65
              elseif phase == "night" then ambient = 0.08 end
              if _G._WEB_InCaves then ambient = math.min(ambient, 0.22) end
              local bonus = 0
              for _, ent in pairs(Ents) do
                if ent:IsValid() and ent.Transform and not ent:IsInLimbo() then
                  local pf = ent.prefab or ""
                  if pf == "campfire" or pf == "firepit" or pf == "torch" or pf == "lantern" or pf == "minerhat" or pf == "lighter" or ent.Light ~= nil then
                    local ex, ey, ez = ent.Transform:GetWorldPosition()
                    local d2 = (ex - wx) * (ex - wx) + (ez - wz) * (ez - wz)
                    if d2 < 100 then
                      bonus = math.max(bonus, math.max(0, 1.0 - math.sqrt(d2) / 10.0))
                    end
                  end
                end
              end
              if ThePlayer and ThePlayer.components and ThePlayer.components.inventory then
                local inv = ThePlayer.components.inventory
                local h = inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                local hd = inv:GetEquippedItem(EQUIPSLOTS.HEAD)
                if (h and (h.prefab == "torch" or h.prefab == "lantern" or h.prefab == "lighter")) or (hd and hd.prefab == "minerhat") then
                  local px, py, pz = ThePlayer.Transform:GetWorldPosition()
                  local d2 = (px - wx) * (px - wx) + (pz - wz) * (pz - wz)
                  if d2 < 81 then
                    bonus = math.max(bonus, math.max(0, 0.95 - math.sqrt(d2) / 9.0))
                  end
                end
              end
              return math.min(1.0, ambient + bonus)
            end

            TheSim.GetAmbientColour = function(self)
              local phase = TheWorld and TheWorld.state and TheWorld.state.phase or "day"
              if phase == "night" then return 30, 35, 65
              elseif phase == "dusk" then return 165, 130, 135
              else return 255, 248, 235 end
            end

            TheSim.FindEntities = function(self, x, y, z, radius, musttags, canttags, mustoneoftags)
              local wx, wz = tonumber(x) or 0, tonumber(z) or 0
              local r = tonumber(radius) or 10
              local r2 = r * r
              local out = {}
              for _, ent in pairs(Ents) do
                if ent:IsValid() and ent.Transform and not ent:IsInLimbo() then
                  local ex, ey, ez = ent.Transform:GetWorldPosition()
                  local d2 = (ex - wx) * (ex - wx) + (ez - wz) * (ez - wz)
                  if d2 <= r2 then
                    local ok = true
                    if type(musttags) == "table" then
                      for _, t in ipairs(musttags) do
                        if not ent:HasTag(t) then ok = false; break end
                      end
                    end
                    if ok and type(canttags) == "table" then
                      for _, t in ipairs(canttags) do
                        if ent:HasTag(t) then ok = false; break end
                      end
                    end
                    if ok and type(mustoneoftags) == "table" and #mustoneoftags > 0 then
                      local any = false
                      for _, t in ipairs(mustoneoftags) do
                        if ent:HasTag(t) then any = true; break end
                      end
                      ok = any
                    end
                    if ok then table.insert(out, ent) end
                  end
                end
              end
              return out
            end

            -- 5. Upgrade TheShard & TheNet for Multi-Shard & WebRTC Peer Replication
            if rawget(_G, "TheShard") then
              TheShard.GetShardId = function(self) return _G._WEB_InCaves and "2" or "1" end
              TheShard.IsMaster = function(self) return not _G._WEB_InCaves end
              TheShard.IsSecondary = function(self) return _G._WEB_InCaves == true end
              TheShard.IsMigrating = function(self, userid) return false end
              TheShard.StartMigration = function(self, userid, worldid)
                _G._WEB_InCaves = (tostring(worldid) == "2" or not _G._WEB_InCaves)
                return true
              end
              TheShard.GetSecondaryShardPlayerCounts = function(self)
                return { ["2"] = _G._WEB_InCaves and 1 or 0 }
              end
            end

            if rawget(_G, "TheNet") then
              TheNet.GetClientTable = function(self)
                local list = {}
                for idx, p in ipairs(AllPlayers or {}) do
                  if p and p:IsValid() then
                    table.insert(list, {
                      userid = p.userid or ("KU_" .. tostring(idx)),
                      name = p.name or "Survivor",
                      prefab = p.prefab or "wilson",
                      admin = (idx == 1),
                      performance = 0,
                      netid = "127.0.0.1",
                      colour = { 1, 1, 1, 1 },
                    })
                  end
                end
                return list
              end
              TheNet.GetClientTableForUser = function(self, userid)
                for _, c in ipairs(self:GetClientTable()) do
                  if c.userid == userid then return c end
                end
                return nil
              end
              TheNet.Say = function(self, msg, whisper)
                _G._WEB_Say(msg, 150)
                _G._WEB_PushNotice((ThePlayer and ThePlayer.name or "Player") .. ": " .. tostring(msg or ""))
                return true
              end
              TheNet.Announce = function(self, msg)
                _G._WEB_PushNotice(tostring(msg or ""))
                return true
              end
              TheNet.SendRemoteExecute = function(self, cmd, x, z)
                local fn = loadstring(tostring(cmd or ""))
                if fn then pcall(fn) end
                return true
              end
              TheNet.SendWorldRollbackRequestToServer = function(self, count)
                _G._WEB_PushNotice("Đã yêu cầu Rollback thế giới (" .. tostring(count or 1) .. " ngày).")
                return true
              end
            end

            -- 6. Upgrade Component Userdata Metatables (LightWatcher, SoundEmitter, MapExplorer, Follower, ShadowManager, etc.)
            if ThePlayer then
              -- SoundEmitter state tracking
              if ThePlayer.SoundEmitter then
                local mt = getmetatable(ThePlayer.SoundEmitter)
                if mt and type(mt.__index) == "table" and not mt.__index._web_hooked then
                  local idx = mt.__index
                  idx._web_hooked = true
                  local orig_play = idx.PlaySound
                  local orig_kill = idx.KillSound
                  local orig_killall = idx.KillAllSounds
                  idx.PlaySound = function(se, event, name, volume, ...)
                    local st = _G._WEB_CompState[se] or { playing = {}, params = {}, vol = 1 }
                    _G._WEB_CompState[se] = st
                    if type(name) == "string" and name ~= "" then st.playing[name] = event or true end
                    if type(event) == "string" then
                      _G._WEB_PushSound(event, volume, type(name) == "string" and name or nil)
                    end
                    if orig_play then return orig_play(se, event, name, volume, ...) end
                  end
                  idx.PlaySoundWithParams = function(se, event, params, volume)
                    local st = _G._WEB_CompState[se] or { playing = {}, params = {}, vol = 1 }
                    _G._WEB_CompState[se] = st
                    if type(params) == "table" then
                      for k, v in pairs(params) do st.params[k] = v end
                    end
                    if type(event) == "string" then _G._WEB_PushSound(event, volume) end
                  end
                  idx.KillSound = function(se, name, ...)
                    local st = _G._WEB_CompState[se]
                    if st and type(name) == "string" then st.playing[name] = nil end
                    if type(name) == "string" and #_G._WEB_SoundEvents < 16 then
                      table.insert(_G._WEB_SoundEvents, { path = "", name = name, action = "kill" })
                    end
                    if orig_kill then return orig_kill(se, name, ...) end
                  end
                  idx.KillAllSounds = function(se, ...)
                    local st = _G._WEB_CompState[se]
                    if st then st.playing = {} end
                    if #_G._WEB_SoundEvents < 16 then
                      table.insert(_G._WEB_SoundEvents, { path = "", action = "killall" })
                    end
                    if orig_killall then return orig_killall(se, ...) end
                  end
                  idx.PlayingSound = function(se, name)
                    local st = _G._WEB_CompState[se]
                    return st ~= nil and st.playing[name] ~= nil
                  end
                  idx.SetParameter = function(se, sound, param, val)
                    local st = _G._WEB_CompState[se] or { playing = {}, params = {}, vol = 1 }
                    _G._WEB_CompState[se] = st
                    st.params[tostring(sound) .. ":" .. tostring(param)] = val
                  end
                  idx.SetVolume = function(se, sound, vol)
                    local st = _G._WEB_CompState[se] or { playing = {}, params = {}, vol = 1 }
                    _G._WEB_CompState[se] = st
                    st.vol = tonumber(vol) or 1
                  end
                end
              end

              -- LightWatcher dynamic light sensing
              if ThePlayer.LightWatcher then
                local mt = getmetatable(ThePlayer.LightWatcher)
                if mt and type(mt.__index) == "table" then
                  local idx = mt.__index
                  idx.GetLightValue = function(lw)
                    if ThePlayer and ThePlayer.Transform then
                      local lx, ly, lz = ThePlayer.Transform:GetWorldPosition()
                      return TheSim:GetLightAtPoint(lx, ly, lz)
                    end
                    return 1.0
                  end
                  idx.IsInLight = function(lw)
                    return idx.GetLightValue(lw) >= 0.15
                  end
                  idx.GetTimeInDark = function(lw)
                    return idx.IsInLight(lw) and 0 or 5.0
                  end
                  idx.GetTimeInLight = function(lw)
                    return idx.IsInLight(lw) and 10.0 or 0
                  end
                end
              end

              -- MapExplorer fog-of-war tile recording
              if ThePlayer.player_classified and ThePlayer.player_classified.MapExplorer then
                local mt = getmetatable(ThePlayer.player_classified.MapExplorer)
                if mt and type(mt.__index) == "table" then
                  local idx = mt.__index
                  local seen_tiles = {}
                  idx.RevealArea = function(me, x, y, z)
                    local tx, ty = ws_api:GetTileXY(x, z)
                    for dx = -4, 4 do
                      for dy = -4, 4 do
                        seen_tiles[(ty + dy) * 2048 + (tx + dx)] = true
                      end
                    end
                    return true
                  end
                  idx.IsTileSeeable = function(me, tx, ty) return true end
                  idx.IsTileVisited = function(me, tx, ty) return seen_tiles[(tonumber(ty) or 0) * 2048 + (tonumber(tx) or 0)] ~= false end
                  idx.RecordMap = function(me) return "KLEI_MAP_V1" end
                  idx.LearnRecordedMap = function(me, data) return true end
                end
              end
            end

            -- 7. Klei Debug Console Helpers (c_give, c_spawn, c_godmode, c_speedmult, c_sethealth, c_sethunger, c_setsanity, c_gonext, c_announce, c_skip)
            rawset(_G, "c_give", function(prefab, count)
              local pf = tostring(prefab or "goldnugget")
              local n = math.min(40, math.max(1, tonumber(count) or 1))
              local p = ThePlayer
              if p and p.components.inventory then
                TheSim:LoadPrefabs({ pf })
                for i = 1, n do
                  local it = SpawnPrefab(pf)
                  if it then p.components.inventory:GiveItem(it) end
                end
                _G._WEB_Say("Đã nhận " .. tostring(n) .. "x " .. pf, 120)
                return "Gave " .. tostring(n) .. "x " .. pf
              end
              return "No player inventory"
            end)
            rawset(_G, "c_spawn", function(prefab, count)
              local pf = tostring(prefab or "beefalo")
              local n = math.min(20, math.max(1, tonumber(count) or 1))
              local p = ThePlayer
              if p and p.Transform then
                TheSim:LoadPrefabs({ pf })
                local px, py, pz = p.Transform:GetWorldPosition()
                for i = 1, n do
                  local ok, ent = pcall(function() return SpawnPrefab(pf) end)
                  if ok and ent and ent.Transform then
                    local ang = (i / n) * 6.2831853
                    ent.Transform:SetPosition(px + math.cos(ang) * 3.2, 0, pz + math.sin(ang) * 3.2)
                  end
                end
                _G._WEB_Say("Đã triệu hồi " .. tostring(n) .. "x " .. pf, 120)
                return "Spawned " .. tostring(n) .. "x " .. pf
              end
              return "Spawn failed"
            end)
            rawset(_G, "c_godmode", function()
              local p = ThePlayer
              if p then
                _G._WEB_GodMode = not _G._WEB_GodMode
                if p.components.health then
                  p.components.health:SetInvincible(_G._WEB_GodMode)
                  p.components.health:SetPercent(1)
                end
                if p.components.hunger then p.components.hunger:SetPercent(1) end
                if p.components.sanity then p.components.sanity:SetPercent(1) end
                local msg = _G._WEB_GodMode and "God Mode: BẬT (Bất tử)" or "God Mode: TẮT"
                _G._WEB_Say(msg, 130)
                return msg
              end
            end)
            rawset(_G, "c_speedmult", function(mult)
              local m = math.clamp(tonumber(mult) or 2, 0.5, 10)
              if ThePlayer and ThePlayer.components.locomotor then
                ThePlayer.components.locomotor:SetExternalSpeedMultiplier(ThePlayer, "c_speedmult", m)
                _G._WEB_Say("Tốc độ chạy: " .. tostring(m) .. "x", 120)
                return "Speed multiplier = " .. tostring(m)
              end
            end)
            rawset(_G, "c_sethealth", function(pct)
              if ThePlayer and ThePlayer.components.health then
                ThePlayer.components.health:SetPercent(math.clamp(tonumber(pct) or 1, 0, 1))
                return "Health set"
              end
            end)
            rawset(_G, "c_sethunger", function(pct)
              if ThePlayer and ThePlayer.components.hunger then
                ThePlayer.components.hunger:SetPercent(math.clamp(tonumber(pct) or 1, 0, 1))
                return "Hunger set"
              end
            end)
            rawset(_G, "c_setsanity", function(pct)
              if ThePlayer and ThePlayer.components.sanity then
                ThePlayer.components.sanity:SetPercent(math.clamp(tonumber(pct) or 1, 0, 1))
                return "Sanity set"
              end
            end)
            rawset(_G, "c_gonext", function(prefab)
              local pf = tostring(prefab or "multiplayer_portal")
              for _, ent in pairs(Ents) do
                if ent:IsValid() and ent.prefab == pf and ent.Transform and ThePlayer and ThePlayer.Transform then
                  local ex, ey, ez = ent.Transform:GetWorldPosition()
                  ThePlayer.Transform:SetPosition(ex + 1.5, 0, ez + 1.5)
                  _G._WEB_Say("Đã dịch chuyển tới " .. pf, 120)
                  return "Teleported to " .. pf
                end
              end
              return "Entity not found: " .. pf
            end)
            rawset(_G, "c_announce", function(msg)
              return TheNet:Announce(msg)
            end)
            rawset(_G, "c_skip", function(days)
              local n = math.min(20, math.max(1, tonumber(days) or 1))
              if TheWorld then
                for i = 1, n * 3 do TheWorld:PushEvent("ms_nextphase") end
                return "Skipped " .. tostring(n) .. " day(s)"
              end
            end)
          end

          _WEB_InstallFullPortBindings()

          -- Apply Seeded Procedural World Generation if a custom World Seed is provided
          if _G._WEB_WorldSeed ~= "" then
            local seed_num = tonumber(_G._WEB_WorldSeed)
            if not seed_num then
              seed_num = 0
              for i = 1, #_G._WEB_WorldSeed do
                seed_num = (seed_num * 31 + string.byte(_G._WEB_WorldSeed, i)) % 2147483647
              end
            end
            math.randomseed(seed_num)
            local tx0, ty0 = WorldSim:GetTileXY(sx, sz)
            local biome_tiles = { 6, 7, 30, 3, 5, 8, 31 }
            for ring = 1, 6 do
              local tile_choice = biome_tiles[((seed_num + ring) % #biome_tiles) + 1]
              local ang = ((seed_num % 360) + ring * 60) * 0.01745329
              local cx = math.floor(tx0 + math.cos(ang) * 6)
              local cy = math.floor(ty0 + math.sin(ang) * 6)
              for dx = -2, 2 do
                for dy = -2, 2 do
                  WorldSim:SetTile(cx + dx, cy + dy, tile_choice)
                end
              end
            end
            -- Spawn deterministic seeded resources & landmarks around the portal
            local seeded_prefabs = { "evergreen", "deciduoustree", "rock1", "rock2", "berrybush", "sapling", "grass", "carrot_planted", "pighouse", "treasurechest" }
            for i = 1, 14 do
              local pf = seeded_prefabs[math.random(1, #seeded_prefabs)]
              TheSim:LoadPrefabs({ pf })
              local ok_e, ent = pcall(function() return SpawnPrefab(pf) end)
              if ok_e and ent and ent.Transform then
                local r = 7 + math.random() * 18
                local a = math.random() * 6.2831853
                ent.Transform:SetPosition(sx + math.cos(a) * r, 0, sz + math.sin(a) * r)
              end
            end
            _G._WEB_PushNotice("WorldGen Seed #" .. tostring(seed_num) .. " đã tạo quần xã địa hình!")
          end

          -- Activate any enabled built-in mods selected in Lobby
          local enabled_mods = ${JSON.stringify(enabledModsList)}
          for _, mname in ipairs(enabled_mods) do
            if mname == "fast_work" then
              ModManager:InitializeModMain("fast_work", [[
                if ThePlayer and ThePlayer.components.locomotor then
                  ThePlayer.components.locomotor:SetExternalSpeedMultiplier(ThePlayer, "mod_fast_work", 1.35)
                end
              ]])
            elseif mname == "extra_light" then
              ModManager:InitializeModMain("extra_light", [[
                c_give("lantern", 1)
                c_give("minerhat", 1)
              ]])
            elseif mname == "boss_hunter" then
              ModManager:InitializeModMain("boss_hunter", [[
                c_give("hambat", 1)
                c_give("armormarble", 1)
                c_give("footballhat", 1)
              ]])
            end
          end

          -- Configure Game Mode / Playstyle (survival, relaxed, endless, wilderness, lightsout, lavaarena, quagmire)
          _G._WEB_Playstyle = "${chosenPlaystyle}"
          _G._WEB_Intention = "${chosenIntention}"
          _G._WEB_ModeState = {
            playstyle = "${chosenPlaystyle}",
            intention = "${chosenIntention}",
            wave = 1,
            maxWaves = 5,
            waveName = "Wave 1/5: Pit Pigs & Hounds",
            enemiesLeft = 0,
            skillCooldown = 0,
            hangry = 100,
            craving = "Meat Dish (Meatballs / Meaty Stew)",
            gnawCoins = 0,
            targetCoins = 6,
            resetTimer = 120,
          }

          if _G._WEB_Playstyle == "lightsout" then
            if TheWorld and TheWorld.state then
              TheWorld.state.phase = "night"
              TheWorld:PushEvent("ms_setphase", "night")
            end
            c_give("torch", 1)
            c_give("log", 4)
            c_give("cutgrass", 6)
            _G._WEB_PushNotice("Chế độ Lights Out: Bóng đêm vĩnh cửu bao trùm Constant!")
          elseif _G._WEB_Playstyle == "relaxed" then
            c_give("flowerhat", 1)
            _G._WEB_PushNotice("Chế độ Relaxed: Khám phá thư giãn, hồi sinh tự do tại Cổng!")
          elseif _G._WEB_Playstyle == "endless" then
            _G._WEB_PushNotice("Chế độ Endless: Thế giới bất tận, tài nguyên tự tái sinh, hồi sinh tại Cổng!")
          elseif _G._WEB_Playstyle == "wilderness" then
            local rx = sx + (math.random() - 0.5) * 32
            local rz = sz + (math.random() - 0.5) * 32
            player.Transform:SetPosition(rx, 0, rz)
            c_give("compass", 1)
            c_give("berries", 3)
            _G._WEB_PushNotice("Chế độ Wilderness: Xuất hiện ngẫu nhiên trên bản đồ!")
          elseif _G._WEB_Playstyle == "lavaarena" then
            if player.components.inventory then
              for _, eq_pf in ipairs({ "spear_wathgrithr", "footballhat", "armorwood" }) do
                local ok_eq, eq = pcall(function() return SpawnPrefab(eq_pf) end)
                if ok_eq and eq then player.components.inventory:Equip(eq) end
              end
              c_give("healingsalve", 3)
            end
            for i, foe_pf in ipairs({ "spider", "spider", "hound" }) do
              TheSim:LoadPrefabs({ foe_pf })
              local ok_f, foe = pcall(function() return SpawnPrefab(foe_pf) end)
              if ok_f and foe and foe.Transform then
                local ang = (i / 3) * 6.2831853
                foe.Transform:SetPosition(sx + math.cos(ang) * 7.5, 0, sz + math.sin(ang) * 7.5)
                foe:AddTag("forge_arena_foe")
              end
            end
            _G._WEB_ModeState.enemiesLeft = 3
            _G._WEB_PushNotice("Chế độ THE FORGE (Lava Arena): Tiêu diệt từng đợt quái vật đấu trường!")
          elseif _G._WEB_Playstyle == "quagmire" then
            for i, st_def in ipairs({
              { pf = "cookpot", dx = 3.2, dz = 0 },
              { pf = "icebox", dx = 4.8, dz = 0 },
              { pf = "firepit", dx = 0, dz = 3.2 },
            }) do
              local st_ent = SpawnPrefab(st_def.pf)
              if st_ent and st_ent.Transform then
                st_ent.Transform:SetPosition(sx + st_def.dx, 0, sz + st_def.dz)
              end
            end
            c_give("meat", 2)
            c_give("carrot", 2)
            c_give("berries", 3)
            c_give("twigs", 2)
            _G._WEB_PushNotice("Chế độ THE GORGE (Quagmire): Nấu món ăn trong Nồi Hầm và dâng lên Altar of Gnaw!")
          end

          if player.components.talker ~= nil then
            local orig_say = player.components.talker.Say
            player.components.talker.Say = function(self, script, time, noanim, force, nobroadcast, colour, ...)
              local line = ""
              if type(script) == "string" then
                line = script
              elseif type(script) == "table" and script[1] ~= nil then
                line = type(script[1]) == "table" and tostring(script[1].message or "") or tostring(script[1])
              end
              if line ~= "" then _G._WEB_Say(line, 140) end
              if orig_say then return orig_say(self, script, time, noanim, force, nobroadcast, colour, ...) end
            end
          end

          function _G._WEB_SyncEquipAnim(p)
            if p == nil or p.AnimState == nil or p.components.inventory == nil then return end
            local inv = p.components.inventory
            local h_item = inv:GetEquippedItem(EQUIPSLOTS.HANDS)
            local head_item = inv:GetEquippedItem(EQUIPSLOTS.HEAD)
            local body_item = inv:GetEquippedItem(EQUIPSLOTS.BODY)

            local hand_map = {
              axe = "swap_axe", goldenaxe = "swap_goldenaxe",
              pickaxe = "swap_pickaxe", goldenpickaxe = "swap_goldenpickaxe",
              shovel = "swap_shovel", goldenshovel = "swap_goldenshovel",
              hammer = "swap_hammer", torch = "swap_torch", lantern = "swap_lantern",
              lighter = "swap_lighter", lucy = "swap_lucy_axe",
              spear = "swap_spear", spear_wathgrithr = "swap_spear_wathgrithr",
              hambat = "swap_ham_bat", cane = "swap_cane",
            }
            if h_item ~= nil and hand_map[h_item.prefab] ~= nil then
              p.AnimState:OverrideSymbol("swap_object", hand_map[h_item.prefab], hand_map[h_item.prefab])
              p.AnimState:Show("ARM_carry")
              p.AnimState:Hide("ARM_normal")
            elseif h_item == nil then
              p.AnimState:ClearOverrideSymbol("swap_object")
              p.AnimState:Hide("ARM_carry")
              p.AnimState:Show("ARM_normal")
            end

            local head_map = {
              flowerhat = "hat_flower", strawhat = "hat_straw",
              footballhat = "hat_football", wathgrithrhat = "hat_wathgrithr",
              tophat = "hat_top", winterhat = "hat_winter", minerhat = "hat_miner",
            }
            if head_item ~= nil and head_map[head_item.prefab] ~= nil then
              p.AnimState:OverrideSymbol("swap_hat", head_map[head_item.prefab], "swap_hat")
              p.AnimState:Show("HAT")
              p.AnimState:Show("HAIR_HAT")
              p.AnimState:Hide("HAIR_NOHAT")
              p.AnimState:Hide("HAIR")
            elseif head_item == nil then
              p.AnimState:ClearOverrideSymbol("swap_hat")
              p.AnimState:Hide("HAT")
              p.AnimState:Hide("HAIR_HAT")
              p.AnimState:Show("HAIR_NOHAT")
              p.AnimState:Show("HAIR")
            end

            local body_map = {
              armorgrass = "armor_grass", armorwood = "armor_wood",
              armormarble = "armor_marble", backpack = "swap_backpack",
            }
            if body_item ~= nil and body_map[body_item.prefab] ~= nil then
              p.AnimState:OverrideSymbol("swap_body", body_map[body_item.prefab], "swap_body")
            elseif body_item == nil then
              p.AnimState:ClearOverrideSymbol("swap_body")
            end
          end

          function _G._WEB_ItemPercent(item)
            if item == nil then return nil end
            if item.components.finiteuses ~= nil then
              return math.clamp(math.floor(item.components.finiteuses:GetPercent() * 100 + 0.5), 0, 100)
            end
            if item.components.fueled ~= nil then
              return math.clamp(math.floor(item.components.fueled:GetPercent() * 100 + 0.5), 0, 100)
            end
            if item.components.armor ~= nil then
              return math.clamp(math.floor(item.components.armor:GetPercent() * 100 + 0.5), 0, 100)
            end
            if item.components.perishable ~= nil then
              return math.clamp(math.floor(item.components.perishable:GetPercent() * 100 + 0.5), 0, 100)
            end
            return nil
          end

          function _G._WEB_DescribeEntity(target)
            if target == nil then return "Hmm, thật thú vị." end
            local p = ThePlayer
            if target.components ~= nil and target.components.inspectable ~= nil then
              local ok, desc = pcall(function() return target.components.inspectable:GetDescription(p) end)
              if ok and type(desc) == "string" and desc ~= "" then
                return desc
              end
            end
            local key = string.upper(tostring(target.prefab or ""))
            if STRINGS and STRINGS.CHARACTERS and STRINGS.CHARACTERS.GENERIC and STRINGS.CHARACTERS.GENERIC.DESCRIBE then
              local d = STRINGS.CHARACTERS.GENERIC.DESCRIBE[key]
              if type(d) == "string" then return d end
              if type(d) == "table" then
                if type(d.GENERIC) == "string" then return d.GENERIC end
                for _, v in pairs(d) do
                  if type(v) == "string" then return v end
                end
              end
            end
            return "Đó là một " .. tostring(target:GetBasicDisplayName() or target.prefab or "vật thể") .. "."
          end

          function _G._WEB_GameSceneSnapshot()
            local json = require("json")
            local p = ThePlayer
            _G._WEB_SyncEquipAnim(p)
            local px, py, pz = 0, 0, 0
            if p ~= nil and p.Transform ~= nil then
              px, py, pz = p.Transform:GetWorldPosition()
            end
            local scene = WebScene.Snapshot(px, pz, 42, 13)
            -- Enrich entities with health/maxHealth for combat HUD bars
            if scene.entities ~= nil then
              for _, ent in ipairs(scene.entities) do
                local inst = Ents[ent.guid]
                if inst ~= nil and inst.components ~= nil and inst.components.health ~= nil then
                  ent.health = inst.components.health.currenthealth
                  ent.maxHealth = inst.components.health.maxhealth
                end
              end
            end
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
            local backpack_list = {}
            local counts = {}
            local eq_hand, eq_head, eq_body = "", "", ""
            local eq_details = {}
            if p ~= nil and p.components.inventory ~= nil then
              local inv = p.components.inventory
              for slot = 1, inv:GetNumSlots() do
                local item = inv.itemslots[slot]
                if item ~= nil then
                  local c = item.components.stackable and item.components.stackable:StackSize() or 1
                  local pf = item.prefab or ""
                  counts[pf] = (counts[pf] or 0) + c
                  local pct = _G._WEB_ItemPercent(item)
                  table.insert(inv_list, {
                    slot = slot,
                    prefab = pf,
                    name = item:GetBasicDisplayName() or pf,
                    count = c,
                    uses = pct,
                    percent = pct,
                    spoiled = item.components.perishable ~= nil,
                    equipSlot = item.components.equippable and tostring(item.components.equippable.equipslot or "") or nil,
                    edible = item.components.edible ~= nil,
                  })
                end
              end
              local h_item = inv:GetEquippedItem(EQUIPSLOTS.HANDS)
              local head_item = inv:GetEquippedItem(EQUIPSLOTS.HEAD)
              local body_item = inv:GetEquippedItem(EQUIPSLOTS.BODY)
              eq_hand = h_item and h_item.prefab or ""
              eq_head = head_item and head_item.prefab or ""
              eq_body = body_item and body_item.prefab or ""
              if h_item then
                eq_details.hands = { prefab = eq_hand, name = h_item:GetBasicDisplayName() or eq_hand, percent = _G._WEB_ItemPercent(h_item) }
              end
              if head_item then
                eq_details.head = { prefab = eq_head, name = head_item:GetBasicDisplayName() or eq_head, percent = _G._WEB_ItemPercent(head_item) }
              end
              if body_item then
                eq_details.body = { prefab = eq_body, name = body_item:GetBasicDisplayName() or eq_body, percent = _G._WEB_ItemPercent(body_item) }
                if body_item.components.container ~= nil then
                  local cont = body_item.components.container
                  for bslot = 1, cont:GetNumSlots() do
                    local bitem = cont.slots[bslot]
                    if bitem ~= nil then
                      local bc = bitem.components.stackable and bitem.components.stackable:StackSize() or 1
                      local bpf = bitem.prefab or ""
                      counts[bpf] = (counts[bpf] or 0) + bc
                      local bpct = _G._WEB_ItemPercent(bitem)
                      table.insert(backpack_list, {
                        slot = bslot,
                        prefab = bpf,
                        name = bitem:GetBasicDisplayName() or bpf,
                        count = bc,
                        percent = bpct,
                        spoiled = bitem.components.perishable ~= nil,
                      })
                    end
                  end
                end
              end
            end

            -- Open world container (treasurechest / cookpot / icebox)
            local open_container = nil
            if _G._WEB_OpenContainerGuid ~= nil then
              local cent = Ents[_G._WEB_OpenContainerGuid]
              if cent ~= nil and cent:IsValid() and cent.components ~= nil and cent.components.container ~= nil and cent.Transform ~= nil then
                local cx, cy, cz = cent.Transform:GetWorldPosition()
                local distSq = (cx - px) * (cx - px) + (cz - pz) * (cz - pz)
                if distSq <= 36 then
                  local cslots = {}
                  local cont = cent.components.container
                  for cslot = 1, cont:GetNumSlots() do
                    local citem = cont.slots[cslot]
                    if citem ~= nil then
                      table.insert(cslots, {
                        slot = cslot,
                        prefab = citem.prefab or "",
                        name = citem:GetBasicDisplayName() or citem.prefab or "",
                        count = citem.components.stackable and citem.components.stackable:StackSize() or 1,
                        percent = _G._WEB_ItemPercent(citem),
                        spoiled = citem.components.perishable ~= nil,
                      })
                    end
                  end
                  open_container = {
                    guid = _G._WEB_OpenContainerGuid,
                    prefab = cent.prefab or "treasurechest",
                    name = cent:GetBasicDisplayName() or cent.prefab or "Chest",
                    numSlots = cont:GetNumSlots(),
                    isCooker = (cent.prefab == "cookpot"),
                    slots = cslots,
                  }
                else
                  if cent.AnimState then cent.AnimState:PlayAnimation("close") cent.AnimState:PushAnimation("closed", false) end
                  _G._WEB_OpenContainerGuid = nil
                end
              else
                _G._WEB_OpenContainerGuid = nil
              end
            end

            -- Check science proximity (researchlab within 7 units or builder science bonus)
            local science_tier = 0
            if p ~= nil and p.components.builder ~= nil and p.components.builder.accessible_tech_trees ~= nil then
              science_tier = p.components.builder.accessible_tech_trees.SCIENCE or 0
            end
            if science_tier < 2 and scene.entities ~= nil then
              for _, ent in ipairs(scene.entities) do
                if ent.prefab == "researchlab" or ent.prefab == "researchlab2" then
                  local dx = (ent.x or 0) - px
                  local dz = (ent.z or 0) - pz
                  if (dx * dx + dz * dz) <= 49 then
                    science_tier = math.max(science_tier, ent.prefab == "researchlab2" and 2 or 1)
                  end
                end
              end
            end

            local active_speech = ""
            if _G._WEB_Speech and _G._WEB_Speech.text ~= "" and GetTick() <= (_G._WEB_Speech.untilTick or 0) then
              active_speech = _G._WEB_Speech.text
            end

            local cur_hp = p and p.components.health and p.components.health.currenthealth or 150
            scene.player = {
              guid = p and p.GUID or 0,
              name = p and p.name or "Wilson",
              prefab = p and p.prefab or "wilson",
              x = px, y = py, z = pz,
              sgState = p and p.sg and p.sg.currentstate and p.sg.currentstate.name or "idle",
              health = cur_hp,
              maxHealth = p and p.components.health and p.components.health.maxhealth or 150,
              hunger = p and p.components.hunger and p.components.hunger.current or 150,
              maxHunger = p and p.components.hunger and p.components.hunger.max or 150,
              sanity = p and p.components.sanity and p.components.sanity.current or 200,
              maxSanity = p and p.components.sanity and p.components.sanity.max or 200,
              moisture = p and p.components.moisture and p.components.moisture:GetMoisture() or 0,
              temperature = p and p.components.temperature and p.components.temperature:GetCurrent() or 25,
              isGhost = (cur_hp <= 0),
              inCaves = (_G._WEB_InCaves == true),
              equippedHand = eq_hand,
              equippedHead = eq_head,
              equippedBody = eq_body,
              equipped = eq_details,
              inventory = inv_list,
              backpackSlots = backpack_list,
              openContainer = open_container,
              ingredientCounts = counts,
              scienceTier = science_tier,
              creativeMode = _G._WEB_CreativeMode == true,
              speech = active_speech,
              worldSeed = _G._WEB_WorldSeed or "",
            }
            local st = TheWorld and TheWorld.state or {}
            local season = st.season or "autumn"
            local day_segs, dusk_segs, night_segs = 8, 6, 2
            if season == "winter" then day_segs, dusk_segs, night_segs = 5, 5, 6
            elseif season == "spring" then day_segs, dusk_segs, night_segs = 5, 8, 3
            elseif season == "summer" then day_segs, dusk_segs, night_segs = 11, 1, 4 end
            scene.clock = {
              cycles = (st.cycles or 0) + 1,
              phase = st.phase or "day",
              timeInPhase = st.timeinphase or 0,
              normTime = st.time or 0,
              season = season,
              elapsedDaysInSeason = st.elapseddaysinseason or 0,
              remainingDaysInSeason = st.remainingdaysinseason or 20,
              isRaining = st.israining or false,
              daySegs = day_segs,
              duskSegs = dusk_segs,
              nightSegs = night_segs,
              moonPhase = st.moonphase or "new",
              inCaves = (_G._WEB_InCaves == true),
            }
            if WebUI ~= nil and WebUI.Snapshot ~= nil then
              scene.ui = WebUI.Snapshot(48)
            end
            scene.mods = ModManager and ModManager:GetEnabledServerModNames() or {}
            scene.peers = TheNet and TheNet:GetClientTable() or {}
            scene.modeState = _G._WEB_ModeState or { playstyle = _G._WEB_Playstyle or "survival" }
            scene.announcements = _G._WEB_Announcements
            scene.soundEvents = _G._WEB_SoundEvents
            _G._WEB_SoundEvents = {}
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
            local ms = _G._WEB_ModeState
            if ms ~= nil then
              if ms.playstyle == "lightsout" and TheWorld and TheWorld.state then
                TheWorld.state.phase = "night"
              elseif ms.playstyle == "relaxed" and ThePlayer.components.health then
                if ThePlayer.components.health.currenthealth > 0 and ThePlayer.components.health.currenthealth < 15 then
                  ThePlayer.components.health.currenthealth = 15
                end
              elseif ms.playstyle == "lavaarena" then
                ms.skillCooldown = math.max(0, (ms.skillCooldown or 0) - 0.5)
                if ThePlayer.components.hunger then ThePlayer.components.hunger.current = ThePlayer.components.hunger.max end
                if ThePlayer.components.sanity then ThePlayer.components.sanity.current = ThePlayer.components.sanity.max end
                local alive_foes = 0
                for _, ent in pairs(Ents) do
                  if ent:IsValid() and ent:HasTag("forge_arena_foe") and ent.components and ent.components.health and not ent.components.health:IsDead() then
                    alive_foes = alive_foes + 1
                  end
                end
                ms.enemiesLeft = alive_foes
                if alive_foes == 0 and (ms.wave or 1) < (ms.maxWaves or 5) then
                  ms.wave = (ms.wave or 1) + 1
                  local wave_defs = {
                    [2] = { name = "Wave 2/5: Crocommanders & Hounds", foes = { "hound", "hound", "spider" } },
                    [3] = { name = "Wave 3/5: Armored Snortoises", foes = { "spider", "spider", "hound", "hound" } },
                    [4] = { name = "Wave 4/5: Boarilla Champion", foes = { "pigman", "hound", "hound" } },
                    [5] = { name = "Wave 5/5: Grand Forge Boarrior", foes = { "deerclops", "hound" } },
                  }
                  local wdef = wave_defs[ms.wave] or wave_defs[2]
                  ms.waveName = wdef.name
                  for idx, fpf in ipairs(wdef.foes) do
                    TheSim:LoadPrefabs({ fpf })
                    local ok_f, foe = pcall(function() return SpawnPrefab(fpf) end)
                    if ok_f and foe and foe.Transform then
                      local ang = (idx / #wdef.foes) * 6.2831853
                      foe.Transform:SetPosition(x + math.cos(ang) * 8.0, 0, z + math.sin(ang) * 8.0)
                      foe:AddTag("forge_arena_foe")
                    end
                  end
                  ms.enemiesLeft = #wdef.foes
                  _G._WEB_PushNotice("THE FORGE · " .. ms.waveName .. " đã xuất hiện!")
                  _G._WEB_PushSound("dontstarve/wilson/attack_weapon", 1.0)
                elseif alive_foes == 0 and (ms.wave or 1) >= (ms.maxWaves or 5) and not ms.victory then
                  ms.victory = true
                  ms.waveName = "VICTORY! Grand Forge Boarrior Defeated!"
                  _G._WEB_PushNotice("CHIẾN THẮNG ĐẤU TRƯỜNG THE FORGE!")
                end
              elseif ms.playstyle == "quagmire" and not ms.victory then
                ms.hangry = math.max(0, (ms.hangry or 100) - 0.35)
                if ms.hangry <= 0 then
                  ms.hangry = 35
                  _G._WEB_PushNotice("The Gnaw nổi giận! Hãy mau dâng món ăn lên Altar!")
                  if ThePlayer.components.health then
                    ThePlayer.components.health:DoDelta(-10)
                  end
                end
              end
            end
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
        } else if (act?.kind === 'resurrect') {
          evaluate(`
            local p = ThePlayer
            if p ~= nil then
              local portal = TheSim:FindFirstEntityWithTag("multiplayer_portal")
              if portal ~= nil and portal.Transform ~= nil and p.Transform ~= nil then
                local sx, sy, sz = portal.Transform:GetWorldPosition()
                p.Transform:SetPosition(sx + 2.0, 0, sz + 2.0)
              end
              if p.components.health ~= nil then
                p.components.health.currenthealth = math.max(50, math.floor(p.components.health.maxhealth * 0.5))
              end
              if p.components.hunger ~= nil then
                p.components.hunger.current = math.max(50, math.floor(p.components.hunger.max * 0.66))
              end
              if p.components.sanity ~= nil then
                p.components.sanity.current = math.max(50, math.floor(p.components.sanity.max * 0.5))
              end
              _G._WEB_Say("Tôi đã hồi sinh tại Florid Postern!", 150)
              _G._WEB_PushSound("dontstarve/common/resurrectionstone_activate", 1.0)
            end
          `);
        } else if (act?.kind === 'examine') {
          const guid = Number(act.guid) || 0;
          evaluate(`
            local target = Ents[${guid}]
            local p = ThePlayer
            if p ~= nil and target ~= nil and target:IsValid() then
              if target.Transform ~= nil and p.Transform ~= nil then
                local tx, ty, tz = target.Transform:GetWorldPosition()
                p:FacePoint(tx, ty, tz)
              end
              local quote = _G._WEB_DescribeEntity(target)
              _G._WEB_Say(quote, 150)
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
              if "${code}" == "RESURRECT" then
                if p.components.health ~= nil then
                  p.components.health.currenthealth = math.max(50, math.floor(p.components.health.maxhealth * 0.5))
                end
                _G._WEB_Say("Sống lại rồi!", 140)
                _G._WEB_PushSound("dontstarve/common/resurrectionstone_activate", 1.0)
              elseif "${code}" == "ENTER_CAVES" or target.prefab == "cave_entrance_open" then
                _G._WEB_InCaves = not _G._WEB_InCaves
                if _G._WEB_InCaves then
                  _G._WEB_Say("Bước xuống Hang Động ngầm sâu thẳm...", 150)
                else
                  _G._WEB_Say("Đã trở lại mặt đất rừng rậm!", 150)
                end
                _G._WEB_PushSound("dontstarve/cave/enter", 0.9)
              elseif "${code}" == "EXIT_CAVES" or target.prefab == "cave_exit" then
                _G._WEB_InCaves = false
                _G._WEB_Say("Đã leo dây trở lại mặt đất!", 150)
                _G._WEB_PushSound("dontstarve/cave/exit", 0.9)
              elseif "${code}" == "COOK" and target.prefab == "cookpot" and target.components.container ~= nil then
                local cont = target.components.container
                local item_count = 0
                local meat_val = 0
                local monster_count = 0
                local veggie_count = 0
                local fruit_count = 0
                local twigs_count = 0
                for s = 1, cont:GetNumSlots() do
                  local it = cont.slots[s]
                  if it ~= nil then
                    item_count = item_count + 1
                    local pf = it.prefab or ""
                    if pf == "meat" or pf == "cookedmeat" then meat_val = meat_val + 1.0
                    elseif pf == "monstermeat" or pf == "cookedmonstermeat" then meat_val = meat_val + 1.0; monster_count = monster_count + 1
                    elseif pf == "smallmeat" or pf == "cookedsmallmeat" or pf == "drumstick" or pf == "drumstick_cooked" or pf == "froglegs" or pf == "froglegs_cooked" then meat_val = meat_val + 0.5
                    elseif pf == "carrot" or pf == "carrot_cooked" or pf:find("_cap") then veggie_count = veggie_count + 1
                    elseif pf:find("berries") then fruit_count = fruit_count + 1
                    elseif pf == "twigs" then twigs_count = twigs_count + 1 end
                  end
                end
                if item_count > 0 then
                  for s = 1, cont:GetNumSlots() do
                    local removed = cont:RemoveItemBySlot(s)
                    if removed then
                      if removed.components.stackable and removed.components.stackable:StackSize() > 1 then
                        removed.components.stackable:Get(1):Remove()
                        cont:GiveItem(removed, s)
                      else
                        removed:Remove()
                      end
                    end
                  end
                  local dish = "meatballs"
                  if monster_count >= 2 then dish = "monsterlasagna"
                  elseif meat_val >= 3.0 and twigs_count == 0 then dish = "bonestew"
                  elseif meat_val >= 0.5 and twigs_count >= 1 then dish = "kabobs"
                  elseif meat_val >= 0.5 and veggie_count >= 1 then dish = "perogies"
                  elseif meat_val >= 0.5 then dish = "meatballs"
                  elseif fruit_count >= 2 and twigs_count >= 1 then dish = "trailmix"
                  elseif veggie_count >= 1 or fruit_count >= 1 then dish = "ratatouille"
                  else dish = "wetgoop" end
                  local cooked_dish = SpawnPrefab(dish)
                  if cooked_dish and inv then inv:GiveItem(cooked_dish) end
                  if target.AnimState then
                    target.AnimState:PlayAnimation("cooking_loop")
                    target.AnimState:PushAnimation("idle_empty", false)
                  end
                  _G._WEB_Say("Món " .. tostring(dish) .. " nóng hổi từ Nồi Hầm đã sẵn sàng!", 140)
                  _G._WEB_PushSound("dontstarve/wilson/make_soup", 0.95)
                else
                  _G._WEB_Say("Cần cho nguyên liệu vào Nồi Hầm trước khi nấu!", 120)
                end
              elseif "${code}" == "DRY" or target.prefab == "meatrack" then
                local dried_any = false
                if inv ~= nil then
                  for _, pair in ipairs({{"meat", "meat_dried"}, {"smallmeat", "smallmeat_dried"}, {"monstermeat", "smallmeat_dried"}}) do
                    if inv:Has(pair[1], 1) then
                      inv:ConsumeByName(pair[1], 1)
                      local jerky = SpawnPrefab(pair[2])
                      if jerky then inv:GiveItem(jerky) end
                      _G._WEB_Say("Đã phơi khô thịt thành Thịt Khô (Jerky) bảo quản lâu dài!", 130)
                      _G._WEB_PushSound("dontstarve/HUD/collect_resource", 0.9)
                      dried_any = true
                      break
                    end
                  end
                end
                if not dried_any then
                  local quote = _G._WEB_DescribeEntity(target)
                  _G._WEB_Say(quote, 140)
                end
              elseif "${code}" == "HAMMER" then
                local tx, ty, tz = target.Transform:GetWorldPosition()
                local pf = target.prefab or ""
                target:Remove()
                for _, drop_pf in ipairs((pf == "skeleton" or pf == "firepit") and {"rocks", "rocks"} or {"boards", "twigs"}) do
                  local d = SpawnPrefab(drop_pf)
                  if d and d.Transform then d.Transform:SetPosition(tx + (math.random()-0.5)*1.2, 0, tz + (math.random()-0.5)*1.2) end
                end
                _G._WEB_PushSound("dontstarve/wilson/rock_break", 0.95)
                _G._WEB_Say("Đã đập vỡ công trình để thu hồi vật liệu!", 120)
              elseif "${code}" == "DIG" then
                local tx, ty, tz = target.Transform:GetWorldPosition()
                local pf = target.prefab or ""
                target:Remove()
                local drop_pf = "twigs"
                if pf == "grass" then drop_pf = "cutgrass"
                elseif pf == "mound" then drop_pf = "goldnugget"
                elseif pf == "rabbithole" or pf == "molehill" then drop_pf = "rocks" end
                local d = SpawnPrefab(drop_pf)
                if d and d.Transform then d.Transform:SetPosition(tx, 0, tz) end
                _G._WEB_PushSound("dontstarve/wilson/dig", 0.95)
                _G._WEB_Say("Đã đào lên bằng xẻng!", 120)
              elseif ("${code}" == "OPEN" or target.components.container ~= nil) and "${code}" ~= "LOOKAT" and "${code}" ~= "HAMMER" then
                local px, py, pz = p.Transform:GetWorldPosition()
                local tx, ty, tz = target.Transform:GetWorldPosition()
                if (tx - px)*(tx - px) + (tz - pz)*(tz - pz) <= 25 then
                  _G._WEB_OpenContainerGuid = target.GUID
                  if target.AnimState then target.AnimState:PlayAnimation("open") target.AnimState:PushAnimation("opened", false) end
                  _G._WEB_PushSound("dontstarve/wilson/chest_open", 0.9)
                elseif p.components.locomotor ~= nil then
                  p.components.locomotor:GoToPoint(Vector3(tx, 0, tz), nil, true)
                  _G._WEB_OpenContainerGuid = target.GUID
                end
              elseif "${code}" == "COOK" or ((target.prefab == "campfire" or target.prefab == "firepit") and "${code}" ~= "LOOKAT") then
                -- Check if player has raw food or fuel in inventory to cook/add fuel on campfire/firepit
                local cook_map = {
                  berries = "berries_cooked", berries_juicy = "berries_juicy_cooked",
                  carrot = "carrot_cooked", meat = "cookedmeat", smallmeat = "cookedsmallmeat",
                  monstermeat = "cookedmonstermeat", drumstick = "drumstick_cooked", froglegs = "froglegs_cooked",
                  red_cap = "red_cap_cooked", green_cap = "green_cap_cooked", blue_cap = "blue_cap_cooked",
                }
                local cooked_any = false
                if inv ~= nil then
                  for slot = 1, inv:GetNumSlots() do
                    local it = inv.itemslots[slot]
                    if it ~= nil and cook_map[it.prefab] ~= nil then
                      local out_pf = cook_map[it.prefab]
                      inv:ConsumeByName(it.prefab, 1)
                      local cooked_item = SpawnPrefab(out_pf)
                      if cooked_item then inv:GiveItem(cooked_item) end
                      _G._WEB_Say("Thơm phức! Đã nướng chín thức ăn trên lửa.", 120)
                      _G._WEB_PushSound("dontstarve/wilson/cook", 0.9)
                      cooked_any = true
                      break
                    end
                  end
                  if not cooked_any and target.components.fueled ~= nil then
                    for _, fuel_pf in ipairs({"log", "boards", "charcoal", "twigs", "cutgrass", "pinecone"}) do
                      if inv:Has(fuel_pf, 1) then
                        inv:ConsumeByName(fuel_pf, 1)
                        target.components.fueled:DoDelta(fuel_pf == "log" and 45 or 15)
                        _G._WEB_Say("Lửa lại bùng sáng ấm áp!", 100)
                        _G._WEB_PushSound("dontstarve/common/fireAddFuel", 0.9)
                        cooked_any = true
                        break
                      end
                    end
                  end
                end
                if not cooked_any then
                  local quote = _G._WEB_DescribeEntity(target)
                  _G._WEB_Say(quote, 140)
                end
              elseif target.prefab == "cave_entrance" and "${code}" == "MINE" then
                local tx, ty, tz = target.Transform:GetWorldPosition()
                target:Remove()
                local open_cave = SpawnPrefab("cave_entrance_open")
                if open_cave and open_cave.Transform then
                  open_cave.Transform:SetPosition(tx, ty, tz)
                end
                _G._WEB_PushSound("dontstarve/wilson/rock_break", 1.0)
                _G._WEB_Say("Lối xuống Hang Động sâu thẳm đã mở ra!", 150)
              elseif "${code}" == "LOOKAT" or "${code}" == "INSPECT" then
                if target.Transform ~= nil and p.Transform ~= nil then
                  local tx, ty, tz = target.Transform:GetWorldPosition()
                  p:FacePoint(tx, ty, tz)
                end
                local quote = _G._WEB_DescribeEntity(target)
                _G._WEB_Say(quote, 150)
              else
                if "${code}" == "CHOP" then
                  local equipped = inv and inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                  if equipped == nil or not equipped:HasTag("CHOP_tool") then
                    local axe = inv and inv:FindItem(function(it) return it:HasTag("CHOP_tool") or it.prefab == "axe" or it.prefab == "goldenaxe" or it.prefab == "lucy" end)
                    if axe == nil and _G._WEB_CreativeMode then
                      axe = SpawnPrefab("axe")
                      if inv and axe then inv:GiveItem(axe) end
                    end
                    if inv and axe then inv:Equip(axe) end
                  end
                elseif "${code}" == "MINE" then
                  local equipped = inv and inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                  if equipped == nil or not equipped:HasTag("MINE_tool") then
                    local pick = inv and inv:FindItem(function(it) return it:HasTag("MINE_tool") or it.prefab == "pickaxe" or it.prefab == "goldenpickaxe" end)
                    if pick == nil and _G._WEB_CreativeMode then
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
              end
            end
          `);
        } else if (act?.kind === 'spacebar-action') {
          evaluate(`
            local p = ThePlayer
            if p ~= nil and p.Transform ~= nil then
              local px, py, pz = p.Transform:GetWorldPosition()
              local inv = p.components.inventory
              local best_ent = nil
              local best_code = nil
              local best_d2 = 196 -- 14 units radius
              for _, ent in pairs(Ents) do
                if ent ~= p and ent:IsValid() and ent.Transform ~= nil and not ent:IsInLimbo() then
                  local ex, ey, ez = ent.Transform:GetWorldPosition()
                  local d2 = (ex - px)*(ex - px) + (ez - pz)*(ez - pz)
                  if d2 < best_d2 then
                    local pf = ent.prefab or ""
                    local code = nil
                    if ent.components and ent.components.inventoryitem ~= nil and ent.components.inventoryitem.canbepickedup then
                      code = "PICKUP"
                    elseif ent.components and ent.components.pickable ~= nil and ent.components.pickable:CanBePicked() then
                      code = "PICK"
                    elseif ent.components and ent.components.workable ~= nil and ent.components.workable:CanBeWorked() then
                      local wact = ent.components.workable:GetWorkAction()
                      if wact == ACTIONS.CHOP then code = "CHOP"
                      elseif wact == ACTIONS.MINE then code = "MINE" end
                    end
                    if code ~= nil then
                      best_d2 = d2
                      best_ent = ent
                      best_code = code
                    end
                  end
                end
              end
              if best_ent ~= nil and best_code ~= nil then
                if best_code == "CHOP" and inv ~= nil then
                  local eq = inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                  if eq == nil or not eq:HasTag("CHOP_tool") then
                    local axe = inv:FindItem(function(it) return it:HasTag("CHOP_tool") or it.prefab == "axe" or it.prefab == "goldenaxe" end)
                    if axe then inv:Equip(axe) end
                  end
                elseif best_code == "MINE" and inv ~= nil then
                  local eq = inv:GetEquippedItem(EQUIPSLOTS.HANDS)
                  if eq == nil or not eq:HasTag("MINE_tool") then
                    local pick = inv:FindItem(function(it) return it:HasTag("MINE_tool") or it.prefab == "pickaxe" or it.prefab == "goldenpickaxe" end)
                    if pick then inv:Equip(pick) end
                  end
                end
                local ba = BufferedAction(p, best_ent, ACTIONS[best_code])
                if p.components.locomotor ~= nil then
                  p.components.locomotor:PushAction(ba, true)
                else
                  p:PushBufferedAction(ba)
                end
              end
            end
          `);
        } else if (act?.kind === 'attack-nearest') {
          evaluate(`
            local p = ThePlayer
            if p ~= nil and p.Transform ~= nil then
              local px, py, pz = p.Transform:GetWorldPosition()
              local best_ent = nil
              local best_d2 = 225 -- 15 units
              for _, ent in pairs(Ents) do
                if ent ~= p and ent:IsValid() and ent.Transform ~= nil and not ent:IsInLimbo() and ent.components and ent.components.health ~= nil and not ent.components.health:IsDead() then
                  local pf = ent.prefab or ""
                  if pf ~= "multiplayer_portal" then
                    local ex, ey, ez = ent.Transform:GetWorldPosition()
                    local d2 = (ex - px)*(ex - px) + (ez - pz)*(ez - pz)
                    if d2 < best_d2 then
                      best_d2 = d2
                      best_ent = ent
                    end
                  end
                end
              end
              if best_ent ~= nil then
                local ba = BufferedAction(p, best_ent, ACTIONS.ATTACK)
                if p.components.locomotor ~= nil then
                  p.components.locomotor:PushAction(ba, true)
                else
                  p:PushBufferedAction(ba)
                end
              end
            end
          `);
        } else if (act?.kind === 'container-transfer') {
          const slot = Number(act.slot) || 1;
          const fromContainer = Boolean(act.fromContainer || act.from === 'container');
          evaluate(`
            local p = ThePlayer
            local inv = p and p.components.inventory
            local cent = _G._WEB_OpenContainerGuid and Ents[_G._WEB_OpenContainerGuid] or nil
            local cont = cent and cent.components and cent.components.container or nil
            if inv ~= nil and cont ~= nil then
              if ${fromContainer ? 'true' : 'false'} then
                local item = cont:RemoveItemBySlot(${slot})
                if item ~= nil then
                  inv:GiveItem(item)
                  _G._WEB_PushSound("dontstarve/HUD/collect_resource", 0.8)
                end
              else
                local item = inv:RemoveItemBySlot(${slot})
                if item ~= nil then
                  cont:GiveItem(item)
                  _G._WEB_PushSound("dontstarve/HUD/collect_resource", 0.8)
                end
              end
            end
          `);
        } else if (act?.kind === 'close-container') {
          evaluate(`
            if _G._WEB_OpenContainerGuid ~= nil then
              local cent = Ents[_G._WEB_OpenContainerGuid]
              if cent and cent.AnimState then
                cent.AnimState:PlayAnimation("close")
                cent.AnimState:PushAnimation("closed", false)
              end
              _G._WEB_OpenContainerGuid = nil
              _G._WEB_PushSound("dontstarve/wilson/chest_close", 0.8)
            end
          `);
        } else if (act?.kind === 'inv-slot') {
          const slot = Number(act.slot) || 1;
          const button = act.button === 'right' ? 'right' : 'left';
          const shift = Boolean(act.shift);
          const isBackpack = Boolean(act.backpack);
          evaluate(`
            local p = ThePlayer
            local inv = p and p.components.inventory
            local item = nil
            if ${isBackpack ? 'true' : 'false'} then
              local body = inv and inv:GetEquippedItem(EQUIPSLOTS.BODY)
              if body and body.components.container then
                item = body.components.container.slots[${slot}]
              end
            else
              item = inv and inv.itemslots[${slot}]
            end
            if item ~= nil and inv ~= nil then
              -- If a chest is open and Shift+LeftClick, transfer to chest
              if ${shift ? 'true' : 'false'} and "${button}" == "left" and _G._WEB_OpenContainerGuid ~= nil and not ${isBackpack ? 'true' : 'false'} then
                local cent = Ents[_G._WEB_OpenContainerGuid]
                if cent and cent.components and cent.components.container then
                  local removed = inv:RemoveItemBySlot(${slot})
                  if removed then
                    cent.components.container:GiveItem(removed)
                    _G._WEB_PushSound("dontstarve/HUD/collect_resource", 0.8)
                  end
                end
              elseif "${button}" == "right" and ${shift ? 'true' : 'false'} then
                inv:DropItem(item, true, true)
              elseif item.prefab == "bedroll_straw" then
                if p.components.health then p.components.health:DoDelta(30) end
                if p.components.sanity then p.components.sanity:DoDelta(50) end
                if p.components.hunger then p.components.hunger:DoDelta(-25) end
                if TheWorld and TheWorld.state and TheWorld.state.phase ~= "day" then
                  TheWorld:PushEvent("ms_nextphase")
                end
                _G._WEB_Say("Một giấc ngủ thật sảng khoái trên cuộn rơm!", 140)
                _G._WEB_PushSound("dontstarve/wilson/yawn", 0.9)
              elseif "${button}" == "right" and not (${shift ? 'true' : 'false'}) then
                if item.components.edible ~= nil and p.components.eater ~= nil then
                  p.components.eater:Eat(item)
                  _G._WEB_PushSound("dontstarve/wilson/eat", 0.9)
                elseif item.components.equippable ~= nil then
                  inv:Equip(item)
                  _G._WEB_SyncEquipAnim(p)
                  _G._WEB_PushSound("dontstarve/wilson/equip_item", 0.8)
                else
                  local quote = _G._WEB_DescribeEntity(item)
                  _G._WEB_Say(quote, 140)
                end
              else
                if item.components.equippable ~= nil then
                  inv:Equip(item)
                  _G._WEB_SyncEquipAnim(p)
                  _G._WEB_PushSound("dontstarve/wilson/equip_item", 0.8)
                elseif item.components.edible ~= nil and p.components.eater ~= nil then
                  p.components.eater:Eat(item)
                  _G._WEB_PushSound("dontstarve/wilson/eat", 0.9)
                elseif item.components.healer ~= nil then
                  item.components.healer:Heal(p)
                  _G._WEB_PushSound("dontstarve/wilson/use_bandage", 0.9)
                else
                  local quote = _G._WEB_DescribeEntity(item)
                  _G._WEB_Say(quote, 140)
                end
              end
            end
          `);
        } else if (act?.kind === 'equip-slot') {
          const slotName = String(act.equipSlot || 'hands').toLowerCase();
          const button = act.button === 'right' ? 'right' : 'left';
          evaluate(`
            local p = ThePlayer
            local inv = p and p.components.inventory
            if inv ~= nil then
              local es = EQUIPSLOTS.HANDS
              if "${slotName}" == "head" then es = EQUIPSLOTS.HEAD
              elseif "${slotName}" == "body" then es = EQUIPSLOTS.BODY end
              local item = inv:GetEquippedItem(es)
              if item ~= nil then
                if "${button}" == "right" then
                  local quote = _G._WEB_DescribeEntity(item)
                  _G._WEB_Say(quote, 140)
                else
                  inv:Unequip(es)
                  inv:GiveItem(item)
                  _G._WEB_SyncEquipAnim(p)
                end
              end
            end
          `);
        } else if (act?.kind === 'craft' || act?.kind === 'place-structure') {
          const recipe = String(act.recipe || 'axe').replace(/[^a-z0-9_]/g, '');
          const forceFree = Boolean(act.forceFree);
          const hasPlacementCoords = act?.kind === 'place-structure' && Number.isFinite(Number(act.x)) && Number.isFinite(Number(act.z));
          const targetX = Number(act.x) || 0;
          const targetZ = Number(act.z) || 0;
          evaluate(`
            local p = ThePlayer
            if p ~= nil and p.components.inventory ~= nil then
              local inv = p.components.inventory
              local px, py, pz = p.Transform:GetWorldPosition()
              local recipe_costs = {
                axe = { { "twigs", 1 }, { "flint", 1 } },
                goldenaxe = { { "twigs", 4 }, { "goldnugget", 2 } },
                pickaxe = { { "twigs", 2 }, { "flint", 2 } },
                goldenpickaxe = { { "twigs", 4 }, { "goldnugget", 2 } },
                shovel = { { "twigs", 2 }, { "flint", 2 } },
                goldenshovel = { { "twigs", 4 }, { "goldnugget", 2 } },
                hammer = { { "twigs", 3 }, { "rocks", 3 }, { "cutgrass", 6 } },
                bugnet = { { "twigs", 4 }, { "silk", 2 }, { "rope", 1 } },
                fishingrod = { { "twigs", 2 }, { "silk", 2 } },
                razor = { { "twigs", 2 }, { "flint", 2 } },
                torch = { { "cutgrass", 2 }, { "twigs", 2 } },
                campfire = { { "cutgrass", 3 }, { "log", 2 } },
                firepit = { { "log", 2 }, { "rocks", 12 } },
                minerhat = { { "strawhat", 1 }, { "goldnugget", 1 } },
                lantern = { { "twigs", 3 }, { "rope", 2 } },
                trap = { { "twigs", 2 }, { "cutgrass", 6 } },
                birdtrap = { { "twigs", 3 }, { "silk", 4 } },
                backpack = { { "cutgrass", 4 }, { "twigs", 4 } },
                healingsalve = { { "ash", 2 }, { "rocks", 1 }, { "spidergland", 1 } },
                bandage = { { "papyrus", 1 }, { "petals", 2 } },
                umbrella = { { "twigs", 6 }, { "petals", 6 } },
                spear = { { "twigs", 2 }, { "rope", 1 }, { "flint", 1 } },
                hambat = { { "twigs", 2 }, { "meat", 2 } },
                armorgrass = { { "cutgrass", 10 }, { "twigs", 2 } },
                armorwood = { { "log", 8 }, { "rope", 2 } },
                armormarble = { { "cutstone", 6 }, { "rope", 2 } },
                footballhat = { { "rope", 1 }, { "cutgrass", 4 } },
                researchlab = { { "goldnugget", 1 }, { "log", 4 }, { "rocks", 4 } },
                researchlab2 = { { "boards", 4 }, { "cutstone", 2 }, { "goldnugget", 2 } },
                rope = { { "cutgrass", 3 } },
                boards = { { "log", 4 } },
                cutstone = { { "rocks", 3 } },
                papyrus = { { "cutgrass", 4 } },
                transistor = { { "goldnugget", 2 }, { "cutstone", 1 } },
                treasurechest = { { "boards", 3 } },
                cookpot = { { "cutstone", 3 }, { "charcoal", 6 }, { "twigs", 6 } },
                icebox = { { "goldnugget", 2 }, { "cutstone", 1 }, { "boards", 1 } },
                meatrack = { { "twigs", 3 }, { "charcoal", 2 }, { "rope", 3 } },
                flowerhat = { { "petals", 12 } },
                strawhat = { { "cutgrass", 12 } },
                tophat = { { "silk", 6 } },
                winterhat = { { "silk", 4 }, { "cutgrass", 4 } },
              }
              local costs = recipe_costs["${recipe}"]
              local free_mode = _G._WEB_CreativeMode or ${forceFree ? 'true' : 'false'}
              if not free_mode and costs ~= nil then
                for _, req in ipairs(costs) do
                  inv:ConsumeByName(req[1], req[2])
                end
              end

              local is_struct = ("${recipe}" == "campfire" or "${recipe}" == "firepit" or "${recipe}" == "researchlab" or "${recipe}" == "researchlab2" or "${recipe}" == "treasurechest" or "${recipe}" == "cookpot" or "${recipe}" == "icebox" or "${recipe}" == "meatrack")
              if is_struct then
                local structure = SpawnPrefab("${recipe}")
                if structure ~= nil and structure.Transform ~= nil then
                  if ${hasPlacementCoords ? 'true' : 'false'} then
                    structure.Transform:SetPosition(${targetX}, 0, ${targetZ})
                  else
                    local angle = math.random() * 6.283185
                    structure.Transform:SetPosition(px + math.cos(angle) * 2.4, 0, pz + math.sin(angle) * 2.4)
                  end
                  if structure.AnimState then
                    structure.AnimState:PlayAnimation("place")
                    structure.AnimState:PushAnimation("idle", true)
                  end
                  _G._WEB_PushSound("dontstarve/common/place_structure_stone", 0.9)
                end
              else
                local item = SpawnPrefab("${recipe}")
                if item ~= nil then
                  if item.components.equippable ~= nil then
                    inv:Equip(item)
                    _G._WEB_SyncEquipAnim(p)
                  else
                    inv:GiveItem(item)
                  end
                  _G._WEB_PushSound("dontstarve/HUD/collect_resource", 0.9)
                end
              end
            end
          `);
        } else if (act?.kind === 'toggle-creative') {
          evaluate(`
            _G._WEB_CreativeMode = not _G._WEB_CreativeMode
          `);
        } else if (act?.kind === 'give-starter-kit') {
          evaluate(`
            local p = ThePlayer
            local inv = p and p.components.inventory
            if inv ~= nil then
              for _, pair in ipairs({
                {"flint", 4}, {"twigs", 6}, {"cutgrass", 8}, {"log", 6},
                {"rocks", 6}, {"goldnugget", 2}, {"petals", 12}, {"berries", 4}
              }) do
                for i = 1, pair[2] do
                  local it = SpawnPrefab(pair[1])
                  if it then inv:GiveItem(it) end
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
            end
          `);
        } else if (act?.kind === 'forge-skill') {
          evaluate(`
            local p = ThePlayer
            local ms = _G._WEB_ModeState
            if p ~= nil and p.Transform ~= nil and ms ~= nil then
              if (ms.skillCooldown or 0) <= 0 then
                ms.skillCooldown = 6
                local px, py, pz = p.Transform:GetWorldPosition()
                local hit_count = 0
                for _, ent in pairs(Ents) do
                  if ent ~= p and ent:IsValid() and ent.Transform and ent.components and ent.components.health and not ent.components.health:IsDead() then
                    if ent:HasTag("forge_arena_foe") or ent:HasTag("monster") or ent:HasTag("hostile") then
                      local ex, ey, ez = ent.Transform:GetWorldPosition()
                      local d2 = (ex - px)*(ex - px) + (ez - pz)*(ez - pz)
                      if d2 <= 100 then
                        ent.components.health:DoDelta(-65)
                        hit_count = hit_count + 1
                      end
                    end
                  end
                end
                if p.components.health then
                  p.components.health:DoDelta(35)
                end
                if p.AnimState then
                  p.AnimState:PlayAnimation("atk")
                  p.AnimState:PushAnimation("idle_loop", true)
                end
                _G._WEB_PushSound("dontstarve/wilson/attack_firestaff", 1.0)
                _G._WEB_Say("Tuyệt kỹ Molten Strike! Đã giáng đòn lên " .. tostring(hit_count) .. " mục tiêu & hồi +35 HP!", 130)
              else
                _G._WEB_Say("Kỹ năng đang hồi chiêu (" .. tostring(math.ceil(ms.skillCooldown or 0)) .. "s)!", 90)
              end
            end
          `);
        } else if (act?.kind === 'gorge-offer') {
          evaluate(`
            local p = ThePlayer
            local inv = p and p.components.inventory
            local ms = _G._WEB_ModeState
            if p ~= nil and inv ~= nil and ms ~= nil then
              local dishes = {
                { pf = "bonestew", coins = 2, hangry = 55 },
                { pf = "perogies", coins = 2, hangry = 50 },
                { pf = "meatballs", coins = 1, hangry = 40 },
                { pf = "kabobs", coins = 1, hangry = 35 },
                { pf = "ratatouille", coins = 1, hangry = 35 },
                { pf = "trailmix", coins = 1, hangry = 35 },
                { pf = "honeyham", coins = 2, hangry = 55 },
                { pf = "baconeggs", coins = 2, hangry = 50 },
                { pf = "cookedmeat", coins = 1, hangry = 25 },
                { pf = "berries_cooked", coins = 1, hangry = 20 },
                { pf = "carrot_cooked", coins = 1, hangry = 20 },
              }
              local offered = nil
              for _, d in ipairs(dishes) do
                if inv:Has(d.pf, 1) then
                  inv:ConsumeByName(d.pf, 1)
                  offered = d
                  break
                end
              end
              if offered ~= nil then
                ms.hangry = math.min(100, (ms.hangry or 50) + offered.hangry)
                ms.gnawCoins = (ms.gnawCoins or 0) + offered.coins
                local cravings = {
                  "Meat Dish (Meatballs / Meaty Stew)",
                  "Pierogi or Vegetable Medley",
                  "Roasted Skewers / Kabobs",
                  "Sweet Berry Trail Mix",
                }
                ms.craving = cravings[((ms.gnawCoins or 0) % #cravings) + 1]
                _G._WEB_PushSound("dontstarve/HUD/collect_resource", 1.0)
                if ms.gnawCoins >= (ms.targetCoins or 6) then
                  ms.victory = true
                  _G._WEB_PushNotice("CHIẾN THẮNG THE GORGE! The Gnaw đã hài lòng và mở cổng dịch chuyển!")
                  _G._WEB_Say("The Gnaw đã được xoa dịu hoàn toàn! Chúng ta thắng rồi!", 160)
                else
                  _G._WEB_Say("Đã dâng " .. offered.pf .. " lên Altar of Gnaw! (+" .. tostring(offered.coins) .. " Gnaw Coin)", 140)
                end
                -- Restock raw ingredients near the player so they can keep cooking
                c_give("meat", 1)
                c_give("berries", 2)
              else
                _G._WEB_Say("Hãy nấu một món ăn trong Nồi Hầm (Crock Pot) hoặc trên Lửa Trại trước khi dâng lên Altar of Gnaw!", 140)
              end
            end
          `);
        } else if (act?.kind === 'wilderness-respawn') {
          const newChar = String(act.character || 'wilson').replace(/[^a-z0-9_]/g, '') || 'wilson';
          evaluate(`
            local p = ThePlayer
            if p ~= nil and p.Transform ~= nil then
              local portal = TheSim:FindFirstEntityWithTag("multiplayer_portal")
              local bx, by, bz = 0, 0, 0
              if portal and portal.Transform then bx, by, bz = portal.Transform:GetWorldPosition() end
              local rx = bx + (math.random() - 0.5) * 32
              local rz = bz + (math.random() - 0.5) * 32
              p.Transform:SetPosition(rx, 0, rz)
              p.prefab = "${newChar}"
              if p.AnimState then p.AnimState:SetBuild("${newChar}") end
              if p.components.health then p.components.health:SetPercent(1) end
              if p.components.hunger then p.components.hunger:SetPercent(1) end
              if p.components.sanity then p.components.sanity:SetPercent(1) end
              _G._WEB_Say("Đã tái sinh tại vị trí ngẫu nhiên mới trong chế độ Wilderness!", 140)
            end
          `);
        }
        result = JSON.parse(evaluate('return _WEB_GameSceneSnapshot()'));
        break;
      }
      case 'save-world-state': {
        if (!ready) throw new Error('Engine is not initialized');
        result = JSON.parse(evaluate(`
          local json = require("json")
          local p = ThePlayer
          local px, py, pz = 0, 0, 0
          if p and p.Transform then px, py, pz = p.Transform:GetWorldPosition() end
          local inv_items = {}
          local equipped = {}
          if p and p.components.inventory then
            local inv = p.components.inventory
            for s = 1, inv:GetNumSlots() do
              local it = inv.itemslots[s]
              if it then
                table.insert(inv_items, { slot = s, prefab = it.prefab, count = it.components.stackable and it.components.stackable:StackSize() or 1 })
              end
            end
            for _, es in ipairs({ EQUIPSLOTS.HANDS, EQUIPSLOTS.HEAD, EQUIPSLOTS.BODY }) do
              local eq = inv:GetEquippedItem(es)
              if eq then equipped[tostring(es)] = eq.prefab end
            end
          end
          local structures = {}
          for _, ent in pairs(Ents) do
            if ent:IsValid() and ent.Transform and (ent.prefab == "campfire" or ent.prefab == "firepit" or ent.prefab == "researchlab" or ent.prefab == "researchlab2" or ent.prefab == "treasurechest" or ent.prefab == "cookpot" or ent.prefab == "icebox") then
              local sx, sy, sz = ent.Transform:GetWorldPosition()
              table.insert(structures, { prefab = ent.prefab, x = sx, z = sz })
            end
          end
          local st = TheWorld and TheWorld.state or {}
          return json.encode_compliant({
            version = 1,
            savedAt = os.time(),
            character = p and p.prefab or "wilson",
            playerName = p and p.name or "Wilson",
            x = px, y = py, z = pz,
            health = p and p.components.health and p.components.health.currenthealth or 150,
            hunger = p and p.components.hunger and p.components.hunger.current or 150,
            sanity = p and p.components.sanity and p.components.sanity.current or 200,
            inventory = inv_items,
            equipped = equipped,
            structures = structures,
            cycles = st.cycles or 0,
            phase = st.phase or "day",
            season = st.season or "autumn",
            creativeMode = _G._WEB_CreativeMode == true,
          })
        `));
        break;
      }
      case 'load-world-state': {
        if (!ready) throw new Error('Engine is not initialized');
        const state = data.state;
        if (state && typeof state === 'object') {
          const stateJson = JSON.stringify(state);
          evaluate(`
            local json = require("json")
            local st = json.decode(${JSON.stringify(stateJson)})
            local p = ThePlayer
            if p and st then
              if p.Transform and st.x and st.z then
                p.Transform:SetPosition(tonumber(st.x) or 0, 0, tonumber(st.z) or 0)
              end
              if p.components.health and st.health then p.components.health.currenthealth = tonumber(st.health) end
              if p.components.hunger and st.hunger then p.components.hunger.current = tonumber(st.hunger) end
              if p.components.sanity and st.sanity then p.components.sanity.current = tonumber(st.sanity) end
              _G._WEB_CreativeMode = st.creativeMode == true
              if p.components.inventory then
                local inv = p.components.inventory
                for s = 1, inv:GetNumSlots() do
                  inv:RemoveItemBySlot(s)
                end
                if type(st.inventory) == "table" then
                  for _, entry in ipairs(st.inventory) do
                    local cnt = tonumber(entry.count) or 1
                    for i = 1, cnt do
                      local it = SpawnPrefab(tostring(entry.prefab))
                      if it then inv:GiveItem(it, tonumber(entry.slot)) end
                    end
                  end
                end
                if type(st.equipped) == "table" then
                  for _, pf in pairs(st.equipped) do
                    local eq = SpawnPrefab(tostring(pf))
                    if eq then inv:Equip(eq) end
                  end
                end
                _G._WEB_SyncEquipAnim(p)
              end
              if type(st.structures) == "table" then
                for _, sdef in ipairs(st.structures) do
                  local sent = SpawnPrefab(tostring(sdef.prefab))
                  if sent and sent.Transform then
                    sent.Transform:SetPosition(tonumber(sdef.x) or 0, 0, tonumber(sdef.z) or 0)
                  end
                end
              end
            end
          `);
        }
        result = JSON.parse(evaluate('return _WEB_GameSceneSnapshot()'));
        break;
      }
      case 'exec-console': {
        if (!ready) throw new Error('Engine is not initialized');
        const cmd = String(data.command || '').trim();
        let output = '';
        if (cmd) {
          if (cmd.startsWith('/')) {
            const chatMsg = cmd.slice(1).trim();
            evaluate(`TheNet:Say(${JSON.stringify(chatMsg)}, false)`);
            output = 'Chat: ' + chatMsg;
          } else {
            output = evaluate(`
              local fn, err = loadstring("return " .. ${JSON.stringify(cmd)})
              if not fn then
                fn, err = loadstring(${JSON.stringify(cmd)})
              end
              if not fn then
                return "Syntax error: " .. tostring(err)
              end
              local ok, res = pcall(fn)
              if not ok then
                return "Runtime error: " .. tostring(res)
              end
              return tostring(res ~= nil and res or "OK")
            `);
          }
        }
        result = { output, scene: JSON.parse(evaluate('return _WEB_GameSceneSnapshot()')) };
        break;
      }
      case 'load-mod': {
        if (!ready) throw new Error('Engine is not initialized');
        const modName = String(data.modName || 'custom_mod').replace(/[^a-zA-Z0-9_-]/g, '') || 'custom_mod';
        let modLua = String(data.luaCode || '');
        if (data.zipBytes instanceof ArrayBuffer || ArrayBuffer.isView(data.zipBytes)) {
          const rawBytes = data.zipBytes instanceof ArrayBuffer ? new Uint8Array(data.zipBytes) : new Uint8Array(data.zipBytes.buffer, data.zipBytes.byteOffset, data.zipBytes.byteLength);
          const files = unzipSync(rawBytes);
          engine.FS.mkdirTree(`/mods/${modName}`);
          for (const [fname, contents] of Object.entries(files)) {
            const clean = fname.replace(/^\/+/, '');
            const targetPath = `/mods/${modName}/${clean}`;
            engine.FS.mkdirTree(targetPath.slice(0, targetPath.lastIndexOf('/')));
            engine.FS.writeFile(targetPath, contents);
            if (clean.endsWith('modmain.lua') && !modLua) {
              modLua = new TextDecoder().decode(contents);
            }
          }
        } else if (modLua) {
          engine.FS.mkdirTree(`/mods/${modName}`);
          engine.FS.writeFile(`/mods/${modName}/modmain.lua`, new TextEncoder().encode(modLua));
        }
        const status = evaluate(`
          if not rawget(_G, "ModManager") then return "ModManager not ready" end
          local ok, res = ModManager:InitializeModMain(${JSON.stringify(modName)}, ${JSON.stringify(modLua || 'return true')})
          _G._WEB_PushNotice("Đã kích hoạt Mod: " .. ${JSON.stringify(modName)})
          return ok and "OK" or tostring(res)
        `);
        result = { status, modName, scene: JSON.parse(evaluate('return _WEB_GameSceneSnapshot()')) };
        break;
      }
      case 'peer-sync': {
        if (!ready) throw new Error('Engine is not initialized');
        const peerId = String(data.peerId || 'peer_2').replace(/[^a-zA-Z0-9_-]/g, '');
        const peerName = String(data.name || peerId);
        const peerChar = String(data.character || 'wendy').replace(/[^a-z0-9_]/g, '') || 'wendy';
        const px = Number(data.x);
        const pz = Number(data.z);
        const chat = typeof data.chat === 'string' ? data.chat : '';
        evaluate(`
          _G._WEB_Peers = _G._WEB_Peers or {}
          local p_ent = _G._WEB_Peers[${JSON.stringify(peerId)}]
          if (p_ent == nil or not p_ent:IsValid()) and TheWorld ~= nil then
            TheSim:LoadPrefabs({ ${JSON.stringify(peerChar)}, "wilson" })
            local ok_s, spawned = pcall(function() return SpawnPrefab(${JSON.stringify(peerChar)}) end)
            if not ok_s or spawned == nil then
              spawned = SpawnPrefab("wilson")
              if spawned and spawned.AnimState then spawned.AnimState:SetBuild(${JSON.stringify(peerChar)}) end
            end
            if spawned ~= nil then
              spawned.userid = ${JSON.stringify('KU_' + peerId)}
              spawned.name = ${JSON.stringify(peerName)}
              spawned.prefab = ${JSON.stringify(peerChar)}
              local sx, sy, sz = 0, 0, 0
              if ThePlayer and ThePlayer.Transform then
                sx, sy, sz = ThePlayer.Transform:GetWorldPosition()
              end
              spawned.Transform:SetPosition(sx + 2.0, 0, sz + 2.0)
              if not table.contains(AllPlayers, spawned) then
                table.insert(AllPlayers, spawned)
              end
              _G._WEB_Peers[${JSON.stringify(peerId)}] = spawned
              _G._WEB_PushNotice("Người chơi WebRTC đã tham gia: " .. ${JSON.stringify(peerName)})
            end
            p_ent = spawned
          end
          if p_ent ~= nil and p_ent:IsValid() then
            if ${Number.isFinite(px) && Number.isFinite(pz) ? 'true' : 'false'} then
              if p_ent.components and p_ent.components.locomotor then
                p_ent.components.locomotor:GoToPoint(Vector3(${Number(px) || 0}, 0, ${Number(pz) || 0}), nil, true)
              elseif p_ent.Transform then
                p_ent.Transform:SetPosition(${Number(px) || 0}, 0, ${Number(pz) || 0})
              end
            end
            if ${chat ? 'true' : 'false'} then
              _G._WEB_PushNotice(${JSON.stringify(peerName)} .. ": " .. ${JSON.stringify(chat)})
            end
          end
        `);
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

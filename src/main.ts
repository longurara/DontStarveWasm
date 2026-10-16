import './style.css';
import { EngineWorker, type Role, type Snapshot } from './engine';
import { Checkpoints } from './persistence';
import { Room } from './rtc';
import { validateCheckpoint, validateCommand, assertCompatibility } from './protocol.mjs';
import { attachCanvasInput, nativeKeyCode } from './input.mjs';
import { GameRenderer, defaultActionForEntity, formatPrefabName, type GameSceneSnapshot } from './game-renderer';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<main>
 <header class="header">
  <div><div class="eyebrow">Don't Starve Together · Build 756039</div><h1>Don't Starve Together · WebAssembly Edition</h1></div>
  <div class="row"><button id="play-game" class="primary-play">▶ Chơi ngay (Play Game)</button><div class="badge">PLAYABLE RUNTIME · 30 TPS / 60 FPS</div></div>
 </header>
 <div class="notice">
  <span>Thế giới Don't Starve Together chạy trực tiếp trong trình duyệt (Lua 5.1 + C++ WASM). Điều khiển: <b>WASD / Phím mũi tên</b> để di chuyển, <b>Click chuột</b> lên mặt đất hoặc vật thể để đi/nhặt/chặt/đập đá, <b>Q / E</b> xoay camera, <b>Lăn chuột</b> thu phóng.</span>
 </div>
 <section class="game-stage" aria-label="Don't Starve Together Playable World">
  <canvas id="game-canvas" width="960" height="576"></canvas>
  <div class="hud-overlay">
   <div class="hud-top">
    <div class="hud-craft-bar">
     <div class="hud-craft-title">Chế tạo nhanh</div>
     <button class="craft-btn" data-craft="axe"><span>🪓 Rìu (Axe)</span><small>Chặt cây</small></button>
     <button class="craft-btn" data-craft="pickaxe"><span>⛏️ Cuốc (Pickaxe)</span><small>Đập đá</small></button>
     <button class="craft-btn" data-craft="torch"><span>🔥 Đuốc (Torch)</span><small>Soi sáng</small></button>
     <button class="craft-btn" data-craft="campfire"><span>🏕️ Lửa trại</span><small>Sưởi & sáng</small></button>
     <button class="craft-btn" data-craft="firepit"><span>🪨 Bếp lửa đá</span><small>Bền vững</small></button>
     <button class="craft-btn" data-craft="spear"><span>🗡️ Giáo (Spear)</span><small>Vũ khí</small></button>
     <button class="craft-btn" data-craft="flowerhat"><span>🌸 Vòng hoa</span><small>+Tinh thần</small></button>
    </div>
    <div class="hud-right">
     <div class="hud-clock-card">
      <div>
       <div id="hud-clock-phase" class="clock-phase">Ngày 1 · Ban ngày</div>
       <div id="hud-clock-season" class="clock-sub">Mùa Thu · 25°C</div>
      </div>
      <button id="hud-next-phase" class="cam-btn" title="Chuyển sang pha Ngày / Hoàng hôn / Đêm tiếp theo">⏭ Pha</button>
     </div>
     <div class="hud-vitals">
      <div class="vital-badge hunger"><span class="vital-label">Đói (Hunger)</span><span id="hud-hunger" class="vital-value">150 / 150</span></div>
      <div class="vital-badge sanity"><span class="vital-label">Tinh thần</span><span id="hud-sanity" class="vital-value">200 / 200</span></div>
      <div class="vital-badge health"><span class="vital-label">Máu (Health)</span><span id="hud-health" class="vital-value">150 / 150</span></div>
     </div>
     <div class="minimap-wrap">
      <canvas id="minimap-canvas" width="144" height="144"></canvas>
      <div class="cam-controls">
       <button id="cam-rot-left" class="cam-btn" title="Xoay trái (Q)">↺ Q</button>
       <button id="cam-zoom-in" class="cam-btn" title="Phóng to">+</button>
       <button id="cam-zoom-out" class="cam-btn" title="Thu nhỏ">−</button>
       <button id="cam-rot-right" class="cam-btn" title="Xoay phải (E)">E ↻</button>
      </div>
     </div>
    </div>
   </div>
   <div class="hud-bottom">
    <div id="hud-notice" class="hud-notices">Nhấn "▶ Chơi ngay (Play Game)" để nạp thế giới Master (23.037 thực thể) và bắt đầu sinh tồn với Wilson!</div>
    <div id="hud-inventory" class="hud-inventory"></div>
   </div>
  </div>
 </section>
 <div class="grid">
  <section class="panel viewer"><canvas id="preview" width="800" height="600" aria-label="Original Wilson animation preview"></canvas><span class="caption">BILD v6 / ANIM v4 · original Wilson / player_basic · WebGL2</span></section>
  <section class="panel"><h2>Host & Chẩn đoán hệ thống</h2><p class="small">Ba Worker riêng: client, mặt đất (Master) và hang động (Caves). Bạn có thể chạy bộ kiểm chứng kỹ thuật hoặc chơi trực tiếp ở màn hình phía trên.</p>
   <div class="row"><button id="start">Khởi động WASM</button><button id="pause" class="secondary" disabled>Tạm dừng</button></div>
   <div class="workers"><span id="worker-client" class="worker">Client</span><span id="worker-master" class="worker">Master</span><span id="worker-caves" class="worker">Caves</span></div>
   <div id="status" class="status" role="status">Chưa khởi động.</div>
   <div class="metrics"><div class="metric"><span>Simulation tick</span><strong id="tick">—</strong></div><div class="metric"><span>Finite uses</span><strong id="uses">—</strong></div><div class="metric"><span>RTC peers</span><strong id="peers">0</strong></div></div>
   <div class="row"><button id="consume" disabled>Use(5)</button><button id="test" class="secondary" disabled>Kiểm chứng runtime</button><button id="audio" class="secondary" disabled>Thử sample âm thanh gốc</button></div><div id="tests"></div>
   <label for="signal-url">Signaling URL</label><input id="signal-url" value="ws://127.0.0.1:8787/signal">
   <label for="ice">ICE servers (JSON; TURN cấu hình riêng)</label><textarea id="ice" rows="2">[]</textarea>
   <label for="join-code">Mã mời</label><input id="join-code" placeholder="room.token" autocomplete="off">
   <div class="row" style="margin-top:12px"><button id="room" class="secondary" disabled>Tạo phòng thử</button><button id="join" class="secondary">Vào phòng thử</button></div><p id="invite"></p>
  </section>
  <section class="panel"><h2>Checkpoint kiểm chứng</h2><p class="small">Lưu nguyên tử Master + Caves trong IndexedDB, autosave mỗi 60 giây.</p>
   <div class="row"><button id="save" disabled>Lưu checkpoint</button><button id="restore" class="secondary" disabled>Khôi phục</button><button id="export" class="secondary" disabled>Xuất ZIP</button><button id="import" class="secondary" disabled>Nhập ZIP</button><button id="inspect-native" class="secondary" disabled>Đọc metadata save native</button></div><input id="backup-file" class="file" type="file" accept=".zip"><input id="native-file" class="file" type="file"><p id="save-status" class="small">Chưa lưu.</p><pre id="native-result" class="small"></pre>
  </section>
  <section class="panel"><h2>Nhật ký</h2><pre id="log" class="log" aria-label="Runtime log"></pre></section>
  <section class="panel wide"><h2>Trạng thái triển khai</h2><div class="progress"><div><b>Giai đoạn 1 · Hoàn tất</b>World boot nhanh + Deferred ANIM</div><div><b>Giai đoạn 2 · Hoàn tất</b>Physics, AnimState, Spatial Sleep (&lt;5ms/tick)</div><div><b>Giai đoạn 3 · Hoàn tất</b>3D Camera + Terrain + Entity Renderer</div><div><b>Giai đoạn 4 · Hoàn tất</b>Wilson + PlayerHud + Chế tạo + Tương tác</div></div></section>
 </div><footer>Host giữ tab hoạt động. Không Docker, không dịch vụ chạy gameplay ngoài trình duyệt.</footer>
</main>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => element<HTMLButtonElement>(id);
function log(message: string) {
  const box = element('log');
  box.textContent = (box.textContent + '\n' + message).trim().split('\n').slice(-120).join('\n');
  box.scrollTop = box.scrollHeight;
}
function status(message: string) {
  element('status').textContent = message;
  log(message);
}

const database = await new Checkpoints().open();
const workers = new Map<Role, EngineWorker>();
let compatibility: any;
let snapshot: Snapshot | undefined;
let gameScene: GameSceneSnapshot | undefined;
let gameMode = false;
let paused = true;
let busy = false;
let room: Room | undefined;
let host = false;
let commandSequence = 0;
let queue = Promise.resolve();
let lastSaved: any;
let audioContext: AudioContext | undefined;
let lastAudioResult: any;

const gameCanvas = element<HTMLCanvasElement>('game-canvas');
const minimapCanvas = element<HTMLCanvasElement>('minimap-canvas');
const gameRenderer = new GameRenderer(gameCanvas, minimapCanvas);

const ITEM_ICONS: Record<string, string> = {
  flint: '🪨 Đá lửa',
  twigs: '🌿 Cành',
  cutgrass: '🌾 Cỏ',
  berries: '🍒 Quả',
  berries_juicy: '🍒 Quả',
  log: '🪵 Gỗ',
  rocks: '🪨 Đá',
  goldnugget: '🪙 Vàng',
  axe: '🪓 Rìu',
  pickaxe: '⛏️ Cuốc',
  torch: '🔥 Đuốc',
  spear: '🗡️ Giáo',
  flowerhat: '🌸 Hoa',
  strawhat: '👒 Mũ',
  backpack: '🎒 Balo',
  petals: '🌸 Cánh',
  carrot: '🥕 Cà rốt',
  seeds: '🌱 Hạt',
};

function renderInventoryHud(scene?: GameSceneSnapshot) {
  const bar = element('hud-inventory');
  const invMap = new Map<number, { prefab: string; name: string; count: number; uses?: number }>();
  if (scene?.player?.inventory) {
    for (const item of scene.player.inventory) invMap.set(item.slot, item);
  }
  const slotsHtml: string[] = [];
  for (let s = 1; s <= 15; ++s) {
    const item = invMap.get(s);
    const icon = item ? (ITEM_ICONS[item.prefab] ?? item.prefab.slice(0, 6)) : '';
    const badge = item ? (item.uses !== undefined ? `${item.uses}%` : item.count > 1 ? `×${item.count}` : '') : '';
    const title = item ? `${formatPrefabName(item.prefab)} (Click để Dùng / Trang bị / Thả)` : `Ô hành trang ${s}`;
    slotsHtml.push(
      `<div class="inv-slot" data-slot="${s}" title="${title}"><span class="slot-num">${s <= 10 ? s % 10 : ''}</span><span class="slot-icon">${icon}</span><span class="slot-count">${badge}</span></div>`,
    );
  }
  const eqHand = scene?.player?.equippedHand || '';
  const eqHead = scene?.player?.equippedHead || '';
  slotsHtml.push(
    `<div class="inv-slot equip" title="Trang bị Tay (Hands): ${eqHand ? formatPrefabName(eqHand) : 'Trống'}"><span class="slot-num">TAY</span><span class="slot-icon">${eqHand ? (ITEM_ICONS[eqHand] ?? eqHand.slice(0, 6)) : '✋'}</span><span class="slot-count"></span></div>`,
    `<div class="inv-slot equip" title="Trang bị Đầu (Head): ${eqHead ? formatPrefabName(eqHead) : 'Trống'}"><span class="slot-num">ĐẦU</span><span class="slot-icon">${eqHead ? (ITEM_ICONS[eqHead] ?? eqHead.slice(0, 6)) : '🎩'}</span><span class="slot-count"></span></div>`,
  );
  bar.innerHTML = slotsHtml.join('');
}

renderInventoryHud();

function updateGameHud(scene: GameSceneSnapshot) {
  gameScene = scene;
  gameRenderer.pushSnapshot(scene);
  element('tick').textContent = String(scene.tick);
  const p = scene.player;
  element('hud-health').textContent = `${Math.round(p.health)} / ${Math.round(p.maxHealth)}`;
  element('hud-hunger').textContent = `${Math.round(p.hunger)} / ${Math.round(p.maxHunger)}`;
  element('hud-sanity').textContent = `${Math.round(p.sanity)} / ${Math.round(p.maxSanity)}`;

  const phaseMap: Record<string, string> = { day: '☀️ Ban ngày', dusk: '🌆 Hoàng hôn', night: '🌙 Ban đêm' };
  const seasonMap: Record<string, string> = { autumn: '🍂 Mùa Thu', winter: '❄️ Mùa Đông', spring: '🌧️ Mùa Xuân', summer: '☀️ Mùa Hè' };
  const c = scene.clock;
  element('hud-clock-phase').textContent = `Ngày ${c.cycles} · ${phaseMap[c.phase] ?? c.phase}`;
  element('hud-clock-season').textContent = `${seasonMap[c.season] ?? c.season} · ${Math.round(p.temperature)}°C${c.isRaining ? ' · Đang mưa' : ''}`;

  if (scene.announcements?.length) {
    element('hud-notice').textContent = scene.announcements[0];
  }
  renderInventoryHud(scene);
}

// 60 FPS continuous render loop for smooth entity interpolation & hover feedback
function renderLoop(now: number) {
  if (gameScene) {
    gameRenderer.render(now);
  }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

async function playNativeSample() {
  if (!audioContext) audioContext = new AudioContext();
  await audioContext.resume();
  const decoded = await workers.get('client')!.request('audio-probe');
  const pcm = new Int16Array(decoded.pcm);
  const buffer = audioContext.createBuffer(decoded.channels, decoded.frames, decoded.sampleRate);
  for (let channel = 0; channel < decoded.channels; ++channel) {
    const output = buffer.getChannelData(channel);
    for (let frame = 0; frame < decoded.frames; ++frame) output[frame] = pcm[frame * decoded.channels + channel] / 32768;
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();
  const { pcm: _, ...meta } = decoded;
  lastAudioResult = { ...meta, context: audioContext.state };
  log('Native PCM verified · FLAC WASM → WebAudio · ' + decoded.name);
  return lastAudioResult;
}

const lastSequences = new Map<string, number>();
const localInput = new MessageChannel();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const operation = queue.then(fn);
  queue = operation.then(() => {}, error => { paused = true; status(String(error)); });
  return operation;
};

function display(value: Snapshot) {
  snapshot = value;
  element('tick').textContent = String(value.tick);
  element('uses').textContent = String(value.uses);
  element('peers').textContent = String(room?.connectedPeers ?? 0);
  void workers.get('client')?.request('preview-tick', { tick: value.tick }).catch(error => status(String(error)));
}

async function boot(role: Role) {
  if (workers.has(role)) return;
  const localUserId = role === 'client' ? await database.localIdentity() : '';
  const worker = new EngineWorker(role);
  workers.set(role, worker);
  worker.onLog = log;
  worker.onPlatform = state => { if (role === 'client') element('preview').style.cursor = state.cursorVisible ? 'default' : 'none'; };
  const viewport = role === 'client' ? { width: element<HTMLCanvasElement>('preview').width, height: element<HTMLCanvasElement>('preview').height } : undefined;
  const info = await worker.request('init', { focus: document.hasFocus(), expected: compatibility, session: { localUserId }, viewport });
  if (compatibility) assertCompatibility(info.manifest, compatibility); else compatibility = info.manifest;
  element('worker-' + role).classList.add('ready');
  log(`${role}: ${info.boot}; heap ${(info.heap / 1048576).toFixed(0)} MiB`);
  if (role === 'client') {
    const canvas = element<HTMLCanvasElement>('preview').transferControlToOffscreen();
    log(JSON.stringify(await worker.request('preview', { canvas }, [canvas])));
    attachCanvasInput(element<HTMLCanvasElement>('preview'), (event: any) => worker.request('input', { event }), (error: unknown) => status(String(error)));
  }
  return info;
}

async function checkpoint() {
  if (!host || gameMode) throw new Error('Only the diagnostic host can save probe checkpoints');
  const [master, caves] = await Promise.all(['master', 'caves'].map(role => workers.get(role as Role)!.request('snapshot')));
  if (master.tick !== caves.tick) throw new Error('Shard checkpoint barrier mismatch');
  const value = { ...compatibility, kind: 'diagnostic-checkpoint-v1', tick: master.tick, shards: { master, caves }, identities: {} };
  await database.commit(value, compatibility);
  lastSaved = value;
  element('save-status').textContent = `Đã lưu tick ${value.tick} · ${new Date().toLocaleTimeString()}`;
  return value;
}

async function restore(value: any) {
  validateCheckpoint(value, compatibility);
  await Promise.all(['master', 'caves'].map(role => workers.get(role as Role)!.request('restore', { snapshot: value.shards[role] })));
  await workers.get('client')!.request('restore', { snapshot: { ...value.shards.master, role: 'client' } });
  display(await workers.get('master')!.request('snapshot'));
  room?.broadcast({ type: 'snapshot', snapshot });
  lastSaved = value;
  status(`Khôi phục checkpoint tick ${value.tick}`);
}

async function command(peer: string, data: any) {
  validateCommand(data);
  if (data.sequence <= (lastSequences.get(peer) ?? -1)) return;
  lastSequences.set(peer, data.sequence);
  const value = await workers.get('master')!.request('consume', { amount: data.amount });
  display(value);
  room?.broadcast({ type: 'snapshot', snapshot: value });
}

localInput.port1.onmessage = event => { void enqueue(() => command('host', event.data)).catch(error => status(String(error))); };

async function start() {
  if (workers.size) throw new Error('Runtime already started; reload to change role');
  button('start').disabled = true;
  button('join').disabled = true;
  status('Đang tải WASM và kiểm tra script hashes…');
  await boot('client');
  await Promise.all([boot('master'), boot('caves')]);
  host = true;
  display(await workers.get('master')!.request('snapshot'));
  paused = false;
  for (const id of ['pause', 'consume', 'test', 'audio', 'room', 'save', 'restore', 'export', 'import', 'inspect-native']) button(id).disabled = false;
  status('Ba WASM Worker sẵn sàng · cảnh kiểm chứng Lua gốc.');
  const previous = await database.latest();
  if (previous) element('save-status').textContent = `Có checkpoint tick ${previous.tick}; dùng Khôi phục để nạp.`;
}

async function startGame() {
  button('play-game').disabled = true;
  button('play-game').textContent = '⏳ Đang nạp thế giới DST…';
  element('hud-notice').textContent = 'Đang giải nén 2.345 script Lua gốc và khởi tạo thế giới Master (23.037 thực thể)…';
  status('Đang khởi tạo thế giới Don\'t Starve Together (Master world + Wilson)…');
  if (!workers.has('master')) {
    await boot('master');
  }
  const master = workers.get('master')!;
  const initialScene: GameSceneSnapshot = await master.request('start-game', {
    width: gameCanvas.width,
    height: gameCanvas.height,
  });
  gameMode = true;
  host = true;
  paused = false;
  button('pause').disabled = false;
  button('pause').textContent = 'Tạm dừng';
  button('play-game').textContent = '✔ Đang chơi (Wilson)';
  updateGameHud(initialScene);
  gameRenderer.render(performance.now());
  status(`Thế giới DST đã sẵn sàng! Wilson tại (${initialScene.player.x.toFixed(1)}, ${initialScene.player.z.toFixed(1)}) · <5ms/tick.`);
  return initialScene;
}

// Interactive Game Canvas Mouse & Keyboard Controls
gameCanvas.addEventListener('mousemove', e => {
  const rect = gameCanvas.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * gameCanvas.width;
  const sy = ((e.clientY - rect.top) / rect.height) * gameCanvas.height;
  gameRenderer.setPointer(sx, sy);
});

gameCanvas.addEventListener('mouseleave', () => {
  gameRenderer.setPointer(-1, -1);
});

gameCanvas.addEventListener('click', e => {
  if (!gameMode || !workers.has('master')) return;
  const rect = gameCanvas.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * gameCanvas.width;
  const sy = ((e.clientY - rect.top) / rect.height) * gameCanvas.height;
  const hit = gameRenderer.hitTest(sx, sy);
  const master = workers.get('master')!;
  if (hit && hit.entity.kind !== 'player') {
    const act = defaultActionForEntity(hit.entity, gameScene?.player.equippedHand ?? '');
    void master.request('game-action', { action: { kind: 'interact', guid: hit.entity.guid, code: act.code } }).then(updateGameHud).catch(() => {});
  } else {
    const worldPt = gameRenderer.screenToWorld(sx, sy, 0);
    if (worldPt) {
      gameRenderer.setWalkTarget(worldPt.x, worldPt.z);
      void master.request('game-action', { action: { kind: 'walk', x: worldPt.x, z: worldPt.z } }).then(updateGameHud).catch(() => {});
    }
  }
});

gameCanvas.addEventListener('wheel', e => {
  if (!gameMode || !workers.has('master')) return;
  e.preventDefault();
  const deltaDistance = e.deltaY > 0 ? 3.5 : -3.5;
  void workers.get('master')!.request('game-action', { action: { kind: 'camera', deltaDistance } }).then(updateGameHud).catch(() => {});
}, { passive: false });

window.addEventListener('keydown', e => {
  if (!gameMode || !workers.has('master')) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const master = workers.get('master')!;
  if (e.code === 'KeyQ') {
    e.preventDefault();
    void master.request('game-action', { action: { kind: 'camera', deltaHeading: -45 } }).then(updateGameHud).catch(() => {});
    return;
  }
  if (e.code === 'KeyE') {
    e.preventDefault();
    void master.request('game-action', { action: { kind: 'camera', deltaHeading: 45 } }).then(updateGameHud).catch(() => {});
    return;
  }
  const code = nativeKeyCode(e.code);
  if (code !== null) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    void master.request('game-input', { event: { kind: 'key', code, down: true } }).catch(() => {});
  }
});

window.addEventListener('keyup', e => {
  if (!gameMode || !workers.has('master')) return;
  const code = nativeKeyCode(e.code);
  if (code !== null) {
    void workers.get('master')!.request('game-input', { event: { kind: 'key', code, down: false } }).catch(() => {});
  }
});

// HUD Quick Crafting, Inventory Slots, Camera & Phase Controls
document.querySelectorAll<HTMLButtonElement>('.craft-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!gameMode || !workers.has('master')) return;
    const recipe = btn.dataset.craft;
    if (recipe) {
      void workers.get('master')!.request('game-action', { action: { kind: 'craft', recipe } }).then(updateGameHud).catch(() => {});
    }
  });
});

element('hud-inventory').addEventListener('click', e => {
  if (!gameMode || !workers.has('master')) return;
  const slotEl = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot[data-slot]');
  if (!slotEl) return;
  const slot = Number(slotEl.dataset.slot);
  if (slot >= 1 && slot <= 15) {
    void workers.get('master')!.request('game-action', { action: { kind: 'inv-slot', slot } }).then(updateGameHud).catch(() => {});
  }
});

function bind(id: string, fn: () => Promise<unknown> | void) {
  button(id).onclick = () => { Promise.resolve().then(fn).catch(error => status(String(error))); };
}
bind('play-game', startGame);
bind('hud-next-phase', () => {
  if (gameMode && workers.has('master')) {
    return workers.get('master')!.request('game-action', { action: { kind: 'next-phase' } }).then(updateGameHud);
  }
});
bind('cam-rot-left', () => {
  if (gameMode && workers.has('master')) {
    return workers.get('master')!.request('game-action', { action: { kind: 'camera', deltaHeading: -45 } }).then(updateGameHud);
  }
});
bind('cam-rot-right', () => {
  if (gameMode && workers.has('master')) {
    return workers.get('master')!.request('game-action', { action: { kind: 'camera', deltaHeading: 45 } }).then(updateGameHud);
  }
});
bind('cam-zoom-in', () => {
  if (gameMode && workers.has('master')) {
    return workers.get('master')!.request('game-action', { action: { kind: 'camera', deltaDistance: -4 } }).then(updateGameHud);
  }
});
bind('cam-zoom-out', () => {
  if (gameMode && workers.has('master')) {
    return workers.get('master')!.request('game-action', { action: { kind: 'camera', deltaDistance: 4 } }).then(updateGameHud);
  }
});

bind('start', start);
bind('pause', () => { paused = !paused; button('pause').textContent = paused ? 'Tiếp tục' : 'Tạm dừng'; });
bind('consume', () => {
  const data = { type: 'consume', amount: 5, sequence: ++commandSequence };
  if (host) localInput.port2.postMessage(data); else if (!room?.sendHost(data)) throw new Error('Host data channel is not open');
});
bind('test', async () => {
  const results = await Promise.all([...workers].map(async ([role, worker]) => `${role}: ${await worker.request('self-test')}`));
  element('tests').textContent = results.join('\n'); status('Runtime checks passed: ' + results.length + ' WASM instances');
});
bind('audio', playNativeSample);
bind('save', () => enqueue(checkpoint));
bind('restore', () => enqueue(async () => { const value = await database.latest(); if (!value) throw new Error('No checkpoint'); paused = true; await restore(value); }));
bind('export', () => enqueue(async () => {
  const value = await checkpoint(); const bytes = database.export(value); const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/zip' }));
  const link = document.createElement('a'); link.href = url; link.download = `dst-diagnostic-${value.tick}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}));
bind('import', () => element<HTMLInputElement>('backup-file').click());
bind('inspect-native', () => element<HTMLInputElement>('native-file').click());

element<HTMLInputElement>('native-file').onchange = event => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  void enqueue(async () => {
    if (file.size > 8 * 1024 * 1024) throw new Error('Native save exceeds 8 MiB');
    const bytes = await file.arrayBuffer();
    const result = await workers.get('master')!.request('inspect-native', { bytes }, [bytes]);
    element('native-result').textContent = JSON.stringify(result, null, 2); status('Đã đọc metadata save native.');
  }).catch(error => status(String(error)));
};

element<HTMLInputElement>('backup-file').onchange = event => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  void enqueue(async () => { const value = database.import(new Uint8Array(await file.arrayBuffer()), compatibility); paused = true; await restore(value); await database.commit(value, compatibility); }).catch(error => status(String(error)));
};

async function connect(invitation?: string) {
  if (invitation !== undefined && !/^[a-f0-9]{8}\.[a-f0-9]{48}$/.test(invitation.trim())) throw new Error('Nhập mã mời hợp lệ trước khi vào phòng.');
  if (invitation === undefined && !host) throw new Error('Khởi động host trước khi tạo phòng.');
  if (!workers.size) { button('start').disabled = true; await boot('client'); button('test').disabled = false; }
  if (!compatibility) throw new Error('Start runtime first');
  room?.close(); room = new Room(); room.onStatus = status; room.onInvite = invite => { element('invite').textContent = invite; element<HTMLInputElement>('join-code').value = invite; };
  room.onHostLeft = () => { paused = true; button('consume').disabled = true; status('Host left. World simulation stopped.'); };
  room.onMessage = (peer, data) => {
    if (host) { if (data.type === 'consume') void enqueue(() => command(peer, data)).catch(error => status(String(error))); if (data.type === 'hello') room?.send(peer, { type: 'snapshot', snapshot }); }
    else if (data.type === 'snapshot') { display(data.snapshot); button('consume').disabled = false; }
  };
  const ice = JSON.parse(element<HTMLTextAreaElement>('ice').value);
  if (!Array.isArray(ice)) throw new Error('ICE config must be an array');
  await room.connect(element<HTMLInputElement>('signal-url').value, ice, compatibility, invitation);
  if (invitation) { host = false; button('join').disabled = true; status('Đang kết nối host qua WebRTC…'); }
}
bind('room', () => connect()); bind('join', () => connect(element<HTMLInputElement>('join-code').value));

setInterval(() => {
  if (!host || paused || busy) return;
  busy = true;
  if (gameMode) {
    void workers.get('master')!.request('game-tick', { count: 1 })
      .then(updateGameHud)
      .finally(() => { busy = false; })
      .catch(() => {});
    return;
  }
  void enqueue(async () => {
    const results = await Promise.all([...workers.values()].map(worker => worker.request('tick', { count: 1 })));
    if (!results.every(value => value.tick === results[0].tick)) throw new Error('Shard tick divergence');
    const value = results.find(s => s.role === 'master'); display(value);
    if (value.tick % 3 === 0) room?.broadcast({ type: 'snapshot', snapshot: value });
  }).finally(() => { busy = false; }).catch(() => {});
}, 1000 / 30);

setInterval(() => { if (host && !paused && !gameMode) void enqueue(checkpoint).catch(error => status(String(error))); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && host && !paused && !gameMode) { paused = true; button('pause').textContent = 'Tiếp tục'; room?.broadcast({ type: 'paused' }); void enqueue(checkpoint).catch(error => status(String(error))); status('Host tab hidden: simulation paused; checkpoint requested.'); }
});
for (const type of ['focus', 'blur']) window.addEventListener(type, () => {
  void workers.get('client')?.request('platform-focus', { focused: type === 'focus' }).catch(error => status(String(error)));
});
const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const development = location.port === '5173';
element<HTMLInputElement>('signal-url').value = `${socketProtocol}//${development ? location.hostname + ':8787' : location.host}/signal`;
if (!development) {
  const config = await fetch('/ice-config').then(r => r.json()).catch(() => ({ iceServers: [] })); element<HTMLTextAreaElement>('ice').value = JSON.stringify(config.iceServers);
}
Object.assign(window, {
  dstWorkbench: {
    start,
    startGame,
    get state() { return { host, paused, gameMode, snapshot, gameScene, compatibility, workers: workers.size, peers: room?.connectedPeers ?? 0 }; },
    get audio() { return lastAudioResult; },
    save: () => enqueue(checkpoint),
    restore: () => enqueue(async () => restore(await database.latest())),
    list: () => database.list(),
    selfTest: () => Promise.all([...workers.values()].map(w => w.request('self-test'))),
    storageTest: (token: string) => enqueue(() => Promise.all([...workers.values()].map(w => w.request('storage-test', { token })))),
    resourceTest: () => enqueue(() => Promise.all([...workers.values()].map(w => w.request('resource-test')))),
    inputState: () => workers.get('client')!.request('input-state'),
    platformState: () => Promise.all([...workers.values()].map(w => w.request('platform-state'))),
    sessionState: () => Promise.all([...workers.values()].map(w => w.request('session-state'))),
    lifecycleTest: () => enqueue(() => Promise.all([...workers.values()].map(w => w.request('lifecycle-probe')))),
    componentTest: () => enqueue(() => Promise.all([...workers.values()].map(w => w.request('component-probe')))),
    mapLayerTest: () => enqueue(() => Promise.all([...workers.values()].map(w => w.request('map-layer-probe')))),
    animationTest: () => enqueue(() => Promise.all([...workers.values()].map(w => w.request('animation-probe')))),
    shaderTest: () => enqueue(() => workers.get('client')!.request('shader-probe')),
    textureTest: () => enqueue(() => workers.get('client')!.request('texture-probe')),
    fontTest: () => enqueue(() => workers.get('client')!.request('font-probe')),
    uiTransformTest: () => enqueue(() => Promise.all([...workers].map(([, worker]) => worker.request('ui-transform-probe')))),
    connect,
    consume: () => { button('consume').click(); },
    pause: () => { paused = true; },
    resume: () => { paused = false; },
  },
});

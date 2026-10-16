export interface SceneEntity {
  guid: number;
  prefab: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  clickable: boolean;
  bank?: string;
  build?: string;
  anim?: string;
  facing?: number;
  frame?: number;
  multColour?: [number, number, number, number];
  addColour?: [number, number, number, number];
  lightRadius?: number;
  lightIntensity?: number;
  lightFalloff?: number;
  lightColour?: [number, number, number];
}

export interface TileWindow {
  centerTileX: number;
  centerTileY: number;
  radius: number;
  step: number;
  cols: number;
  width: number;
  height: number;
  data: number[];
}

export interface CameraSnapshot {
  x: number;
  y: number;
  z: number;
  distance: number;
  pitch: number;
  heading: number;
  fov: number;
}

export interface PlayerHudSnapshot {
  guid: number;
  name: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  sgState: string;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  sanity: number;
  maxSanity: number;
  moisture: number;
  temperature: number;
  equippedHand: string;
  equippedHead: string;
  equippedBody: string;
  inventory: Array<{ slot: number; prefab: string; name: string; count: number; uses?: number }>;
}

export interface WorldClockSnapshot {
  cycles: number;
  phase: string;
  timeInPhase: number;
  normTime: number;
  season: string;
  elapsedDaysInSeason: number;
  remainingDaysInSeason: number;
  isRaining: boolean;
}

export interface GameSceneSnapshot {
  tick: number;
  time: number;
  ambient: [number, number, number];
  tiles: TileWindow;
  minimap: TileWindow;
  entities: SceneEntity[];
  camera: CameraSnapshot;
  player: PlayerHudSnapshot;
  clock: WorldClockSnapshot;
  announcements?: string[];
}

export interface ProjectedEntity {
  entity: SceneEntity;
  ix: number;
  iy: number;
  iz: number;
  sx: number;
  sy: number;
  depth: number;
  scale: number;
  hitRadius: number;
}

const TILE_SIZE = 4.0;
const DEG2RAD = Math.PI / 180;

const TILE_PALETTE: Record<number, { fill: string; stroke: string; accent: string; water?: boolean; name: string }> = {
  0:   { fill: '#0b1924', stroke: '#0e2230', accent: '#163247', water: true, name: 'Biển sâu' },
  1:   { fill: '#0e2233', stroke: '#122b3e', accent: '#1d425c', water: true, name: 'Đại dương' },
  2:   { fill: '#7f6e54', stroke: '#6c5c44', accent: '#998669', name: 'Đường đá' },
  3:   { fill: '#6c6f68', stroke: '#5c5f58', accent: '#83877e', name: 'Đất đá' },
  4:   { fill: '#6b533b', stroke: '#5c4631', accent: '#7e6348', name: 'Đất trống' },
  5:   { fill: '#9f8440', stroke: '#8c7335', accent: '#b5994d', name: 'Thảo nguyên khô' },
  6:   { fill: '#4e6f3a', stroke: '#426030', accent: '#608648', name: 'Đồng cỏ' },
  7:   { fill: '#334d2b', stroke: '#2a4023', accent: '#405f36', name: 'Rừng rậm' },
  8:   { fill: '#3d3342', stroke: '#322936', accent: '#4d4154', name: 'Đầm lầy' },
  10:  { fill: '#785d3c', stroke: '#685032', accent: '#8b6d48', name: 'Sàn gỗ' },
  11:  { fill: '#6a4b5d', stroke: '#593e4e', accent: '#7c596d', name: 'Thảm' },
  12:  { fill: '#828079', stroke: '#6f6d67', accent: '#96948c', name: 'Nền cờ' },
  30:  { fill: '#7d4e2d', stroke: '#6b4124', accent: '#945e38', name: 'Rừng lá rộng' },
  31:  { fill: '#9d7c49', stroke: '#896b3d', accent: '#b08d56', name: 'Sa mạc' },
  35:  { fill: '#576843', stroke: '#4b5a39', accent: '#667a4f', name: 'Đất nông trại' },
  42:  { fill: '#7c7662', stroke: '#6b6554', accent: '#918a74', name: 'Bãi sỏi' },
  43:  { fill: '#5d686e', stroke: '#4f595e', accent: '#707d84', name: 'Bãi thiên thạch' },
  201: { fill: '#15394f', stroke: '#19435c', accent: '#235978', water: true, name: 'Vùng nước ven bờ' },
  202: { fill: '#123146', stroke: '#163a52', accent: '#1d4c6b', water: true, name: 'Vùng nước nông' },
  203: { fill: '#0e283b', stroke: '#123146', accent: '#18405c', water: true, name: 'Biển động' },
  204: { fill: '#0b2030', stroke: '#0e283b', accent: '#14354d', water: true, name: 'Biển sâu' },
};

function getTileStyle(tileId: number) {
  if (TILE_PALETTE[tileId]) return TILE_PALETTE[tileId];
  if (tileId >= 200) return TILE_PALETTE[201];
  return TILE_PALETTE[6];
}

export const PREFAB_LABELS: Record<string, string> = {
  wilson: 'Wilson',
  multiplayer_portal: 'Cổng Florid Postern',
  evergreen: 'Cây thông (Evergreen)',
  evergreen_sparse: 'Cây thông già',
  twiggytree: 'Cây cành khô',
  deciduoustree: 'Cây dẻ (Birchnut)',
  marsh_tree: 'Cây gai đầm lầy',
  rock1: 'Tảng đá (Boulder)',
  rock2: 'Tảng đá vàng (Gold Vein)',
  rock_flintless: 'Tảng đá trơ',
  flint: 'Đá lửa (Flint)',
  twigs: 'Cành cây (Twigs)',
  cutgrass: 'Cỏ cắt (Cut Grass)',
  berries: 'Quả mọng (Berries)',
  berries_juicy: 'Quả mọng nước',
  log: 'Gỗ (Log)',
  rocks: 'Đá (Rocks)',
  goldnugget: 'Vàng cục (Gold Nugget)',
  nitre: 'Diêm tiêu (Nitre)',
  berrybush: 'Bụi quả mọng (Berry Bush)',
  berrybush2: 'Bụi quả mọng gai',
  berrybush_juicy: 'Bụi quả mọng nước',
  grass: 'Bụi cỏ (Grass)',
  sapling: 'Cây non (Sapling)',
  flower: 'Hoa (Flower)',
  flower_evil: 'Hoa hắc ám',
  carrot_planted: 'Cà rốt mọc hoang',
  carrot: 'Cà rốt (Carrot)',
  red_mushroom: 'Nấm đỏ',
  green_mushroom: 'Nấm xanh lá',
  blue_mushroom: 'Nấm xanh lam',
  axe: 'Rìu (Axe)',
  pickaxe: 'Cuốc chim (Pickaxe)',
  torch: 'Đuốc (Torch)',
  spear: 'Giáo (Spear)',
  campfire: 'Lửa trại (Campfire)',
  firepit: 'Bếp lửa đá (Fire Pit)',
  researchlab: 'Máy Khoa Học (Science Machine)',
  homesign: 'Biển chỉ đường',
  rabbit: 'Thỏ (Rabbit)',
  rabbithole: 'Hang thỏ',
  perd: 'Gà tây (Gobbler)',
  pigman: 'Người lợn (Pig Man)',
  pighouse: 'Nhà lợn',
  spider: 'Nhện (Spider)',
  spiderden: 'Tổ nhện',
  beefalo: 'Bò Beefalo',
  tallbird: 'Chim chân cao (Tallbird)',
  bee: 'Ong (Bee)',
  butterfly: 'Bướm (Butterfly)',
  robin: 'Chim cổ đỏ',
  crow: 'Quạ đen',
  frog: 'Ếch (Frog)',
  skeleton: 'Bộ xương',
};

export function formatPrefabName(prefab: string): string {
  if (!prefab) return 'Thực thể';
  if (PREFAB_LABELS[prefab]) return PREFAB_LABELS[prefab];
  return prefab.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function defaultActionForEntity(e: SceneEntity, equippedHand: string): { code: string; label: string } {
  if (e.kind === 'player') return { code: 'INSPECT', label: 'Quan sát bản thân' };
  if (e.kind === 'item') return { code: 'PICKUP', label: 'Nhặt (Pick Up)' };
  if (e.kind === 'plant') {
    if (e.prefab.startsWith('flower') || e.prefab.includes('mushroom') || e.prefab === 'carrot_planted' || e.prefab === 'sapling' || e.prefab === 'grass' || e.prefab.startsWith('berrybush') || e.prefab === 'reeds') {
      return { code: 'PICK', label: 'Thu hoạch (Harvest)' };
    }
  }
  if (e.kind === 'tree') {
    return equippedHand === 'axe'
      ? { code: 'CHOP', label: 'Chặt cây (Chop)' }
      : { code: 'CHOP', label: 'Chặt cây (Tự trang bị Rìu)' };
  }
  if (e.kind === 'rock') {
    return equippedHand === 'pickaxe'
      ? { code: 'MINE', label: 'Đập đá (Mine)' }
      : { code: 'MINE', label: 'Đập đá (Tự trang bị Cuốc)' };
  }
  if (e.kind === 'monster') return { code: 'ATTACK', label: 'Tấn công (Attack)' };
  return { code: 'INSPECT', label: 'Xem xét (Inspect)' };
}

export interface LoadedAnimAsset {
  build: string;
  bank: string;
  model: {
    name?: string;
    atlases: string[];
    symbols: Record<
      string,
      {
        name?: string;
        frames: Array<{ frame: number; duration: number; bbox: number[]; offset: number; count: number }>;
      }
    >;
    vertices: Array<[number, number, number, number, number, number]>;
    animations: Array<{
      name: string;
      facing: number;
      rate: number;
      numFrames?: number;
      frames: Array<{
        bbox?: number[];
        elements: Array<{
          symbol: number;
          frame: number;
          depth: number;
          matrix: [number, number, number, number, number, number];
          mult: [number, number, number, number];
        }>;
      }>;
    }>;
  };
  atlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }>;
}

interface CachedSpriteFrame {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
}

interface GpuAnimBundle {
  build: string;
  bank: string;
  model: LoadedAnimAsset['model'];
  textures: WebGLTexture[];
}

export const PREFAB_ASSET_DEFAULTS: Record<string, { build: string; bank: string; anim: string }> = {
  wilson: { build: 'wilson', bank: 'wilson', anim: 'idle_loop' },
  multiplayer_portal: { build: 'portal_stone', bank: 'portal_dst', anim: 'idle_loop' },
  evergreen: { build: 'evergreen_new', bank: 'evergreen_short', anim: 'sway1_loop_normal' },
  evergreen_sparse: { build: 'evergreen_new_2', bank: 'evergreen_short', anim: 'sway1_loop_normal' },
  twiggytree: { build: 'twiggy_build', bank: 'twiggy', anim: 'sway1_loop_tall' },
  marsh_tree: { build: 'marsh_tree', bank: 'marsh_tree', anim: 'sway1_loop' },
  rock1: { build: 'rock', bank: 'rock', anim: 'full' },
  rock2: { build: 'rock2', bank: 'rock2', anim: 'full' },
  rock_flintless: { build: 'rock_flintless', bank: 'rock_flintless', anim: 'full' },
  flint: { build: 'flint', bank: 'flint', anim: 'idle' },
  twigs: { build: 'twigs', bank: 'twigs', anim: 'idle' },
  cutgrass: { build: 'cutgrass', bank: 'cutgrass', anim: 'idle' },
  berries: { build: 'berries', bank: 'berries', anim: 'idle' },
  berries_juicy: { build: 'berries_juicy', bank: 'berries_juicy', anim: 'idle' },
  log: { build: 'log', bank: 'log', anim: 'idle' },
  rocks: { build: 'rocks', bank: 'rocks', anim: 'idle' },
  goldnugget: { build: 'goldnugget', bank: 'goldnugget', anim: 'idle' },
  nitre: { build: 'nitre', bank: 'nitre', anim: 'idle' },
  berrybush: { build: 'berrybush', bank: 'berrybush', anim: 'idle' },
  berrybush2: { build: 'berrybush2', bank: 'berrybush2', anim: 'idle' },
  berrybush_juicy: { build: 'berrybush_juicy', bank: 'berrybush_juicy', anim: 'idle' },
  grass: { build: 'grass1', bank: 'grass', anim: 'idle' },
  sapling: { build: 'sapling', bank: 'sapling', anim: 'sway' },
  flower: { build: 'flowers', bank: 'flowers', anim: 'f1' },
  carrot_planted: { build: 'carrot', bank: 'carrot', anim: 'planted' },
  carrot: { build: 'carrot', bank: 'carrot', anim: 'idle' },
  red_mushroom: { build: 'mushrooms', bank: 'mushrooms', anim: 'red' },
  green_mushroom: { build: 'mushrooms', bank: 'mushrooms', anim: 'green' },
  blue_mushroom: { build: 'mushrooms', bank: 'mushrooms', anim: 'blue' },
  axe: { build: 'axe', bank: 'axe', anim: 'idle' },
  pickaxe: { build: 'pickaxe', bank: 'pickaxe', anim: 'idle' },
  torch: { build: 'torch', bank: 'torch', anim: 'idle' },
  spear: { build: 'spear', bank: 'spear', anim: 'idle' },
  campfire: { build: 'campfire', bank: 'campfire', anim: 'idle' },
  firepit: { build: 'firepit', bank: 'firepit', anim: 'idle' },
  researchlab: { build: 'researchlab', bank: 'researchlab', anim: 'idle' },
  homesign: { build: 'sign_home', bank: 'sign_home', anim: 'idle' },
  rabbit: { build: 'ds_rabbit_basic', bank: 'rabbit', anim: 'idle' },
  rabbithole: { build: 'rabbit_hole', bank: 'rabbithole', anim: 'idle' },
  pigman: { build: 'pig_build', bank: 'pigman', anim: 'idle_loop' },
  pighouse: { build: 'pig_house', bank: 'pig_house', anim: 'idle' },
  spider: { build: 'spider_build', bank: 'spider', anim: 'idle' },
  spiderden: { build: 'spider_cocoon', bank: 'spider_cocoon', anim: 'cocoon_small' },
  beefalo: { build: 'beefalo_build', bank: 'beefalo', anim: 'idle_loop' },
};

const HIDDEN_SYMBOLS = new Set([
  'arm_carry',
  'swap_object',
  'swap_hat',
  'hat',
  'hat_hair',
  'swap_body',
  'swap_body_tall',
]);

class OriginalAnimCompositor {
  private glCanvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private posLoc = -1;
  private uvLoc = -1;
  private colLoc = -1;
  private matLoc: WebGLUniformLocation | null = null;
  private samplerLoc: WebGLUniformLocation | null = null;

  private bundles = new Map<string, GpuAnimBundle | 'pending' | 'unavailable'>();
  private frameCache = new Map<string, CachedSpriteFrame | null>();
  public loadedCount = 0;

  private static readonly SIZE = 384;
  private static readonly ANCHOR_X = 192;
  private static readonly ANCHOR_Y = 308;
  private static readonly BILD_SCALE = 0.5;

  constructor(private onRequestAsset?: (build: string, bank: string) => void) {
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.width = OriginalAnimCompositor.SIZE;
    this.glCanvas.height = OriginalAnimCompositor.SIZE;
    const gl = this.glCanvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) return;
    this.gl = gl;
    this.initPipeline(gl);
  }

  private initPipeline(gl: WebGL2RenderingContext) {
    const vsSource = `#version 300 es
      in vec2 a_pos;
      in vec2 a_uv;
      in vec4 a_color;
      uniform mat4 u_matrix;
      out vec2 v_uv;
      out vec4 v_color;
      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        v_uv = a_uv;
        v_color = a_color;
      }
    `;
    const fsSource = `#version 300 es
      precision mediump float;
      in vec2 v_uv;
      in vec4 v_color;
      uniform sampler2D u_tex;
      out vec4 outColor;
      void main() {
        vec4 tex = texture(u_tex, v_uv);
        outColor = vec4(tex.rgb * v_color.rgb * v_color.a, tex.a * v_color.a);
      }
    `;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    this.program = prog;
    this.buffer = gl.createBuffer();
    this.posLoc = gl.getAttribLocation(prog, 'a_pos');
    this.uvLoc = gl.getAttribLocation(prog, 'a_uv');
    this.colLoc = gl.getAttribLocation(prog, 'a_color');
    this.matLoc = gl.getUniformLocation(prog, 'u_matrix');
    this.samplerLoc = gl.getUniformLocation(prog, 'u_tex');
  }

  static key(build: string, bank: string): string {
    return `${build}::${bank}`;
  }

  ingestAsset(build: string, bank: string, payload: LoadedAnimAsset | null) {
    const key = OriginalAnimCompositor.key(build, bank);
    const gl = this.gl;
    if (
      !gl ||
      !this.program ||
      !payload ||
      !payload.model ||
      !Array.isArray(payload.atlases) ||
      payload.atlases.length === 0 ||
      !Array.isArray(payload.model.vertices) ||
      payload.model.vertices.length === 0 ||
      !Array.isArray(payload.model.animations) ||
      payload.model.animations.length === 0
    ) {
      this.bundles.set(key, 'unavailable');
      return;
    }

    const textures: WebGLTexture[] = [];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    for (const atlas of payload.atlases) {
      const tex = gl.createTexture();
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        atlas.width,
        atlas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(atlas.rgba),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(tex);
    }

    if (textures.length === 0) {
      this.bundles.set(key, 'unavailable');
      return;
    }

    this.bundles.set(key, {
      build,
      bank,
      model: payload.model,
      textures,
    });
    this.loadedCount++;
  }

  private resolveClip(
    anims: LoadedAnimAsset['model']['animations'],
    animName: string,
    entityFacing: number,
  ): { clipIndex: number; flipX: boolean } | null {
    if (!anims.length) return null;
    // AnimState facing: 0=RIGHT, 1=UP, 2=LEFT, 3=DOWN
    // Klei ANIM facing bitmask: 1=RIGHT, 2=UP, 4=LEFT, 8=DOWN, 5=SIDE, 255=ALL
    const desiredMask = entityFacing === 1 ? 2 : entityFacing === 3 ? 8 : entityFacing === 2 ? 4 : 1;

    const candidates = [
      animName,
      animName.endsWith('_loop') ? animName.slice(0, -5) : `${animName}_loop`,
      `${animName}_normal`,
      'idle_loop',
      'sway1_loop_normal',
      'sway1_loop',
      'idle',
      'full',
      'f1',
    ];

    let matchedIdx = -1;
    for (const target of candidates) {
      if (!target) continue;
      // First pass: exact name + matching facing bit
      for (let i = 0; i < anims.length; ++i) {
        const a = anims[i];
        if (a.name === target && a.frames.length > 0 && ((a.facing & desiredMask) !== 0 || a.facing === 255)) {
          matchedIdx = i;
          break;
        }
      }
      if (matchedIdx >= 0) break;
      // Second pass: exact name with any facing
      for (let i = 0; i < anims.length; ++i) {
        const a = anims[i];
        if (a.name === target && a.frames.length > 0) {
          matchedIdx = i;
          break;
        }
      }
      if (matchedIdx >= 0) break;
    }

    if (matchedIdx < 0) {
      // Substring match
      for (let i = 0; i < anims.length; ++i) {
        if (anims[i].frames.length > 0 && anims[i].name.includes(animName)) {
          matchedIdx = i;
          break;
        }
      }
    }
    if (matchedIdx < 0) {
      matchedIdx = anims.findIndex(a => a.frames.length > 0);
    }
    if (matchedIdx < 0) return null;

    const clip = anims[matchedIdx];
    const flipX = entityFacing === 2 && clip.facing !== 4;
    return { clipIndex: matchedIdx, flipX };
  }

  private renderFrameToCache(bundle: GpuAnimBundle, clipIndex: number, frameIdx: number): CachedSpriteFrame | null {
    const gl = this.gl;
    const prog = this.program;
    if (!gl || !prog || !this.buffer) return null;

    const clip = bundle.model.animations[clipIndex];
    const frame = clip?.frames[frameIdx];
    if (!frame || !frame.elements || frame.elements.length === 0) return null;

    const W = OriginalAnimCompositor.SIZE;
    const H = OriginalAnimCompositor.SIZE;
    const ax = OriginalAnimCompositor.ANCHOR_X;
    const ay = OriginalAnimCompositor.ANCHOR_Y;
    const sc = OriginalAnimCompositor.BILD_SCALE;

    const elements = [...frame.elements].sort((a, b) => b.depth - a.depth);
    const batches = new Map<number, number[]>();
    let minX = W;
    let minY = H;
    let maxX = 0;
    let maxY = 0;
    let totalVerts = 0;

    for (const item of elements) {
      const symbol = bundle.model.symbols[String(item.symbol)];
      if (!symbol || !symbol.frames || symbol.frames.length === 0) continue;
      if (symbol.name && HIDDEN_SYMBOLS.has(symbol.name.toLowerCase())) continue;

      const sf =
        symbol.frames.find(f => item.frame >= f.frame && item.frame < f.frame + f.duration) ??
        symbol.frames[symbol.frames.length - 1];
      if (!sf || sf.count <= 0) continue;

      const [a, b, c, d, tx, ty] = item.matrix;
      const [mr, mg, mb, ma] = item.mult ?? [1, 1, 1, 1];
      const end = Math.min(bundle.model.vertices.length, sf.offset + sf.count);

      for (let i = sf.offset; i < end; ++i) {
        const vtx = bundle.model.vertices[i];
        if (!vtx) continue;
        const [x, y, _z, u, v, atlas] = vtx;
        const px = ax + (a * x + b * y + tx) * sc;
        const py = ay + (c * x + d * y + ty) * sc;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        const texIdx = Math.max(0, Math.min(bundle.textures.length - 1, Math.round(atlas || 0)));
        let arr = batches.get(texIdx);
        if (!arr) {
          arr = [];
          batches.set(texIdx, arr);
        }
        arr.push(px, py, u, v, mr, mg, mb, ma);
        totalVerts++;
      }
    }

    if (totalVerts < 3) return null;

    const cropX = Math.max(0, Math.floor(minX) - 3);
    const cropY = Math.max(0, Math.floor(minY) - 3);
    const cropR = Math.min(W, Math.ceil(maxX) + 3);
    const cropB = Math.min(H, Math.ceil(maxY) + 3);
    const cropW = cropR - cropX;
    const cropH = cropB - cropY;
    if (cropW < 2 || cropH < 2) return null;

    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    const stride = 8 * 4;
    if (this.posLoc >= 0) {
      gl.enableVertexAttribArray(this.posLoc);
      gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, stride, 0);
    }
    if (this.uvLoc >= 0) {
      gl.enableVertexAttribArray(this.uvLoc);
      gl.vertexAttribPointer(this.uvLoc, 2, gl.FLOAT, false, stride, 8);
    }
    if (this.colLoc >= 0) {
      gl.enableVertexAttribArray(this.colLoc);
      gl.vertexAttribPointer(this.colLoc, 4, gl.FLOAT, false, stride, 16);
    }

    gl.uniformMatrix4fv(
      this.matLoc,
      false,
      new Float32Array([2 / W, 0, 0, 0, 0, -2 / H, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]),
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    for (const [texIdx, geom] of batches) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bundle.textures[texIdx]);
      gl.uniform1i(this.samplerLoc, 0);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, geom.length / 8);
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = cropW;
    outCanvas.height = cropH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;
    outCtx.drawImage(this.glCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return {
      canvas: outCanvas,
      anchorX: ax - cropX,
      anchorY: ay - cropY,
      width: cropW,
      height: cropH,
    };
  }

  getEntitySprite(
    entity: SceneEntity,
    playerHud: PlayerHudSnapshot,
    now: number,
  ): { frame: CachedSpriteFrame; flipX: boolean } | null {
    if (!this.gl || !this.program) return null;
    const def = PREFAB_ASSET_DEFAULTS[entity.prefab];
    const build = entity.build || def?.build || '';
    const bank = entity.bank || def?.bank || build;
    if (!build) return null;

    const key = OriginalAnimCompositor.key(build, bank);
    const state = this.bundles.get(key);
    if (!state) {
      this.bundles.set(key, 'pending');
      this.onRequestAsset?.(build, bank);
      return null;
    }
    if (state === 'pending' || state === 'unavailable') return null;

    let animName = entity.anim || def?.anim || 'idle';
    if (entity.kind === 'player' || entity.prefab === 'wilson') {
      if (playerHud.sgState?.includes('run')) animName = 'run_loop';
      else if (playerHud.sgState?.includes('chop')) animName = 'chop_loop';
      else if (playerHud.sgState?.includes('mine')) animName = 'pickaxe_loop';
      else if (!entity.anim || entity.anim === 'idle') animName = 'idle_loop';
    }

    const resolved = this.resolveClip(state.model.animations, animName, entity.facing ?? 3);
    if (!resolved) return null;

    const clip = state.model.animations[resolved.clipIndex];
    const numSampled = clip.frames.length;
    const frameIdx =
      numSampled <= 1
        ? 0
        : Math.floor((now * 0.014 + (entity.guid % 19) * 0.65) % numSampled);

    const cacheKey = `${key}#${resolved.clipIndex}#${frameIdx}`;
    let cached = this.frameCache.get(cacheKey);
    if (cached === undefined) {
      if (this.frameCache.size > 380) {
        const oldest = this.frameCache.keys().next().value;
        if (oldest !== undefined) this.frameCache.delete(oldest);
      }
      cached = this.renderFrameToCache(state, resolved.clipIndex, frameIdx);
      this.frameCache.set(cacheKey, cached);
    }
    if (!cached) return null;
    return { frame: cached, flipX: resolved.flipX };
  }
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private miniCtx: CanvasRenderingContext2D | null;
  private animCompositor: OriginalAnimCompositor;
  private prevSnapshot: GameSceneSnapshot | null = null;
  private currSnapshot: GameSceneSnapshot | null = null;
  private lastSnapshotPerf = 0;
  private projectedEntities: ProjectedEntity[] = [];
  public hoveredEntity: ProjectedEntity | null = null;
  public walkTarget: { x: number; z: number; until: number } | null = null;
  private mouseX = -1;
  private mouseY = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    minimapCanvas?: HTMLCanvasElement | null,
    onRequestAsset?: (build: string, bank: string) => void,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.miniCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    this.animCompositor = new OriginalAnimCompositor(onRequestAsset);
  }

  ingestAnimAsset(build: string, bank: string, payload: LoadedAnimAsset | null) {
    this.animCompositor.ingestAsset(build, bank, payload);
  }

  get loadedOriginalAssetCount(): number {
    return this.animCompositor.loadedCount;
  }

  pushSnapshot(snapshot: GameSceneSnapshot) {
    this.prevSnapshot = this.currSnapshot ?? snapshot;
    this.currSnapshot = snapshot;
    this.lastSnapshotPerf = performance.now();
  }

  setPointer(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
  }

  setWalkTarget(x: number, z: number) {
    this.walkTarget = { x, z, until: performance.now() + 1400 };
  }

  private getInterpolatedCamera(alpha: number): CameraSnapshot {
    const curr = this.currSnapshot!.camera;
    const prev = this.prevSnapshot?.camera ?? curr;
    let dHeading = curr.heading - prev.heading;
    if (dHeading > 180) dHeading -= 360;
    if (dHeading < -180) dHeading += 360;
    return {
      x: prev.x + (curr.x - prev.x) * alpha,
      y: prev.y + (curr.y - prev.y) * alpha,
      z: prev.z + (curr.z - prev.z) * alpha,
      distance: prev.distance + (curr.distance - prev.distance) * alpha,
      pitch: prev.pitch + (curr.pitch - prev.pitch) * alpha,
      heading: prev.heading + dHeading * alpha,
      fov: curr.fov || 35,
    };
  }

  projectWorld(wx: number, wy: number, wz: number, cam: CameraSnapshot): { sx: number; sy: number; depth: number; scale: number } | null {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const heading = cam.heading * DEG2RAD;
    const pitch = cam.pitch * DEG2RAD;
    const rightX = -Math.sin(heading);
    const rightZ = Math.cos(heading);
    const fwdX = -Math.cos(heading);
    const fwdZ = -Math.sin(heading);

    const dx = wx - cam.x;
    const dy = wy - cam.y;
    const dz = wz - cam.z;

    const rx = dx * rightX + dz * rightZ;
    const hz = dx * fwdX + dz * fwdZ;

    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const ry = dy * cosP - hz * sinP;
    const depth = cam.distance + hz * cosP + dy * sinP;
    if (depth <= 1.0) return null;

    const tanHalfFov = Math.tan((cam.fov * 0.5) * DEG2RAD);
    const focal = (h * 0.5) / tanHalfFov;
    const sx = w * 0.5 + (rx * focal) / depth;
    const sy = h * 0.54 - (ry * focal) / depth;
    const scale = focal / depth;
    return { sx, sy, depth, scale };
  }

  screenToWorld(sx: number, sy: number, planeY = 0): { x: number; y: number; z: number } | null {
    if (!this.currSnapshot) return null;
    const cam = this.currSnapshot.camera;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const heading = cam.heading * DEG2RAD;
    const pitch = cam.pitch * DEG2RAD;
    const rightX = -Math.sin(heading);
    const rightZ = Math.cos(heading);
    const fwdX = -Math.cos(heading);
    const fwdZ = -Math.sin(heading);

    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const tanHalfFov = Math.tan((cam.fov * 0.5) * DEG2RAD);
    const focal = (h * 0.5) / tanHalfFov;

    const u = (sx - w * 0.5) / focal;
    const v = (h * 0.54 - sy) / focal;
    const dy = planeY - cam.y;

    // ry = dy * cosP - hz * sinP = v * (cam.distance + hz * cosP + dy * sinP)
    // hz * (sinP + v * cosP) = dy * cosP - v * cam.distance - v * dy * sinP
    const denom = sinP + v * cosP;
    if (Math.abs(denom) < 1e-4) return null;
    const hz = (dy * cosP - v * (cam.distance + dy * sinP)) / denom;
    const depth = cam.distance + hz * cosP + dy * sinP;
    if (depth <= 1.0) return null;
    const rx = u * depth;

    const wx = cam.x + rx * rightX + hz * fwdX;
    const wz = cam.z + rx * rightZ + hz * fwdZ;
    return { x: wx, y: planeY, z: wz };
  }

  hitTest(sx: number, sy: number): ProjectedEntity | null {
    for (let i = this.projectedEntities.length - 1; i >= 0; --i) {
      const item = this.projectedEntities[i];
      if (!item.entity.clickable || item.entity.kind === 'fx') continue;
      const dx = sx - item.sx;
      const dy = sy - (item.sy - item.hitRadius * 0.45);
      if (dx * dx + dy * dy <= item.hitRadius * item.hitRadius) {
        return item;
      }
    }
    return null;
  }

  render(now = performance.now()) {
    const snap = this.currSnapshot;
    if (!snap) return;

    const alpha = Math.min(1, Math.max(0, (now - this.lastSnapshotPerf) / 33.333));
    const cam = this.getInterpolatedCamera(alpha);
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Background ocean & horizon sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, '#091722');
    skyGrad.addColorStop(0.4, '#102738');
    skyGrad.addColorStop(1, '#0d202e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Render 3D projected terrain tile grid
    this.renderTerrain(ctx, snap.tiles, cam, now);

    // 3. Render ground walk target ring if active
    if (this.walkTarget && now < this.walkTarget.until) {
      const p = this.projectWorld(this.walkTarget.x, 0, this.walkTarget.z, cam);
      if (p) {
        const pulse = 0.65 + 0.35 * Math.sin(now * 0.012);
        ctx.save();
        ctx.strokeStyle = `rgba(232, 200, 114, ${pulse})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, p.scale * 0.55, p.scale * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 4. Interpolate & project entities
    const prevMap = new Map<number, SceneEntity>();
    if (this.prevSnapshot) {
      for (const e of this.prevSnapshot.entities) prevMap.set(e.guid, e);
    }

    const projected: ProjectedEntity[] = [];
    for (const e of snap.entities) {
      const prev = prevMap.get(e.guid);
      const ix = prev && Math.hypot(e.x - prev.x, e.z - prev.z) < 6 ? prev.x + (e.x - prev.x) * alpha : e.x;
      const iy = prev ? prev.y + (e.y - prev.y) * alpha : e.y;
      const iz = prev && Math.hypot(e.x - prev.x, e.z - prev.z) < 6 ? prev.z + (e.z - prev.z) * alpha : e.z;
      const p = this.projectWorld(ix, iy, iz, cam);
      if (!p) continue;
      if (p.sx < -160 || p.sx > w + 160 || p.sy < -160 || p.sy > h + 180) continue;

      let baseRadius = 0.85;
      if (e.kind === 'tree' || e.prefab === 'multiplayer_portal') baseRadius = 1.45;
      else if (e.kind === 'player' || e.kind === 'rock' || e.kind === 'structure') baseRadius = 1.15;
      else if (e.kind === 'item') baseRadius = 0.65;

      projected.push({
        entity: e,
        ix,
        iy,
        iz,
        sx: p.sx,
        sy: p.sy,
        depth: p.depth,
        scale: p.scale,
        hitRadius: Math.max(14, p.scale * baseRadius),
      });
    }

    // Sort back-to-front (largest depth first)
    projected.sort((a, b) => b.depth - a.depth);
    this.projectedEntities = projected;
    this.hoveredEntity = this.mouseX >= 0 && this.mouseY >= 0 ? this.hitTest(this.mouseX, this.mouseY) : null;

    // 5. Draw ground drop shadows
    for (const item of projected) {
      if (item.entity.kind === 'fx') continue;
      this.drawShadow(ctx, item);
    }

    // 6. Draw entities back-to-front
    for (const item of projected) {
      const isHovered = this.hoveredEntity?.entity.guid === item.entity.guid;
      if (isHovered) {
        ctx.save();
        ctx.strokeStyle = '#f2d379';
        ctx.fillStyle = 'rgba(242, 211, 121, 0.16)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(item.sx, item.sy, item.scale * 0.85, item.scale * 0.46, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      this.drawEntity(ctx, item, snap, now);
    }

    // 7. Day / Dusk / Night ambient & point lights overlay
    this.renderLightingOverlay(ctx, snap, projected, cam);

    // 8. Hover nameplate & action prompt
    if (this.hoveredEntity) {
      this.drawHoverTooltip(ctx, this.hoveredEntity, snap.player.equippedHand);
    }

    // 9. Minimap radar
    if (this.miniCtx) {
      this.renderMinimap(this.miniCtx, snap, cam);
    }
  }

  private renderTerrain(ctx: CanvasRenderingContext2D, tiles: TileWindow, cam: CameraSnapshot, now: number) {
    if (!tiles || !tiles.data || !tiles.cols) return;
    const halfW = tiles.width * 0.5;
    const halfH = tiles.height * 0.5;
    const r = tiles.radius;
    const step = tiles.step || 1;
    const tileWorld = TILE_SIZE * step;
    const wave = Math.sin(now * 0.0025);

    ctx.lineWidth = 1;
    for (let dy = -r; dy <= r; ++dy) {
      for (let dx = -r; dx <= r; ++dx) {
        const idx = (dy + r) * tiles.cols + (dx + r);
        const tileId = tiles.data[idx] ?? 1;
        const tx = tiles.centerTileX + dx * step;
        const ty = tiles.centerTileY + dy * step;
        const wx0 = (tx - halfW) * TILE_SIZE;
        const wz0 = (ty - halfH) * TILE_SIZE;
        const wx1 = wx0 + tileWorld;
        const wz1 = wz0 + tileWorld;

        const p00 = this.projectWorld(wx0, 0, wz0, cam);
        const p10 = this.projectWorld(wx1, 0, wz0, cam);
        const p11 = this.projectWorld(wx1, 0, wz1, cam);
        const p01 = this.projectWorld(wx0, 0, wz1, cam);
        if (!p00 || !p10 || !p11 || !p01) continue;

        const style = getTileStyle(tileId);
        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;

        ctx.beginPath();
        ctx.moveTo(p00.sx, p00.sy);
        ctx.lineTo(p10.sx, p10.sy);
        ctx.lineTo(p11.sx, p11.sy);
        ctx.lineTo(p01.sx, p01.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Subtle DST surface detail inside tile
        const cx = (p00.sx + p11.sx) * 0.5;
        const cy = (p00.sy + p11.sy) * 0.5;
        const hash = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if (style.water) {
          if ((hash & 3) === 0) {
            ctx.strokeStyle = style.accent;
            ctx.beginPath();
            const offset = wave * 3 * ((hash & 1) ? 1 : -1);
            ctx.moveTo(cx - 8 + offset, cy);
            ctx.quadraticCurveTo(cx + offset, cy - 3, cx + 8 + offset, cy);
            ctx.stroke();
          }
        } else if ((hash % 3) === 0 && p00.scale > 10) {
          ctx.strokeStyle = style.accent;
          ctx.beginPath();
          ctx.moveTo(cx - 3, cy + 2);
          ctx.lineTo(cx - 5, cy - 4);
          ctx.moveTo(cx + 1, cy + 2);
          ctx.lineTo(cx + 3, cy - 5);
          ctx.stroke();
        }
      }
    }
  }

  private drawShadow(ctx: CanvasRenderingContext2D, item: ProjectedEntity) {
    const { entity, sx, sy, scale } = item;
    let rx = scale * 0.52;
    let ry = scale * 0.24;
    if (entity.kind === 'tree' || entity.prefab === 'multiplayer_portal') {
      rx = scale * 0.95;
      ry = scale * 0.45;
    } else if (entity.kind === 'item') {
      rx = scale * 0.28;
      ry = scale * 0.14;
    }
    ctx.fillStyle = 'rgba(8, 10, 7, 0.42)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEntity(ctx: CanvasRenderingContext2D, item: ProjectedEntity, snap: GameSceneSnapshot, now: number) {
    const { entity, sx, sy, scale } = item;
    const s = Math.max(8, scale);
    ctx.save();
    ctx.translate(sx, sy);

    const originalSprite = this.animCompositor.getEntitySprite(entity, snap.player, now);
    if (originalSprite) {
      const { frame, flipX } = originalSprite;
      const ratio = (s / 54) * Math.max(0.5, Math.min(2.2, Math.abs(entity.sx || 1)));
      const shouldFlip = flipX !== ((entity.sx ?? 1) < 0);
      ctx.save();
      if (shouldFlip) ctx.scale(-1, 1);
      ctx.drawImage(
        frame.canvas,
        -frame.anchorX * ratio,
        -frame.anchorY * ratio,
        frame.width * ratio,
        frame.height * ratio,
      );
      ctx.restore();

      if (entity.kind === 'player' || entity.prefab === 'wilson') {
        if (s > 12) {
          const topY = -Math.max(s * 2.15, frame.anchorY * ratio + 6);
          ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(14, 18, 13, 0.72)';
          ctx.fillRect(-28, topY - 11, 56, 15);
          ctx.fillStyle = '#f2d379';
          ctx.fillText('Wilson', 0, topY);
        }
      }
      ctx.restore();
      return;
    }

    if (entity.kind === 'player' || entity.prefab === 'wilson') {
      this.drawWilson(ctx, s, entity, snap.player, now);
    } else if (entity.prefab === 'multiplayer_portal') {
      this.drawPortal(ctx, s, now);
    } else if (entity.kind === 'tree') {
      this.drawTree(ctx, s, entity, now);
    } else if (entity.kind === 'rock') {
      this.drawRock(ctx, s, entity);
    } else if (entity.kind === 'fire' || entity.prefab === 'campfire' || entity.prefab === 'firepit') {
      this.drawCampfire(ctx, s, entity, now);
    } else if (entity.kind === 'plant') {
      this.drawPlant(ctx, s, entity, now);
    } else if (entity.kind === 'item') {
      this.drawItem(ctx, s, entity, now);
    } else if (entity.kind === 'creature' || entity.kind === 'monster') {
      this.drawCreature(ctx, s, entity, now);
    } else {
      this.drawStructureOrProp(ctx, s, entity);
    }

    ctx.restore();
  }

  private drawWilson(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity, playerHud: PlayerHudSnapshot, now: number) {
    const isMoving = (entity.anim && entity.anim.includes('run')) || (playerHud.sgState && playerHud.sgState.includes('run'));
    const isWorking = (entity.anim && (entity.anim.includes('chop') || entity.anim.includes('mine') || entity.anim.includes('pickup')))
      || (playerHud.sgState && (playerHud.sgState.includes('chop') || playerHud.sgState.includes('mine') || playerHud.sgState.includes('dolongaction')));
    const bob = isMoving ? Math.abs(Math.sin(now * 0.018)) * s * 0.14 : Math.sin(now * 0.004) * s * 0.03;
    const stride = isMoving ? Math.sin(now * 0.018) * s * 0.22 : 0;
    const swing = isWorking ? Math.sin(now * 0.025) * 0.7 : stride * 0.03;

    ctx.translate(0, -bob);
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.strokeStyle = '#141210';

    // Legs
    ctx.beginPath();
    ctx.moveTo(-s * 0.14, -s * 0.35);
    ctx.lineTo(-s * 0.16 - stride * 0.5, 0);
    ctx.moveTo(s * 0.14, -s * 0.35);
    ctx.lineTo(s * 0.16 + stride * 0.5, 0);
    ctx.stroke();

    // Red DST waistcoat torso
    ctx.fillStyle = '#9e2a2b';
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, -s * 0.32);
    ctx.lineTo(s * 0.28, -s * 0.32);
    ctx.lineTo(s * 0.22, -s * 0.92);
    ctx.lineTo(-s * 0.22, -s * 0.92);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // White shirt V-collar & gold vest buttons
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, -s * 0.92);
    ctx.lineTo(0, -s * 0.68);
    ctx.lineTo(s * 0.12, -s * 0.92);
    ctx.closePath();
    ctx.fill();

    // Equipped hand tool (Axe / Pickaxe / Torch)
    const tool = playerHud.equippedHand;
    ctx.save();
    ctx.translate(s * 0.28, -s * 0.68);
    ctx.rotate(swing);
    if (tool === 'axe') {
      ctx.strokeStyle = '#7c5333';
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, s * 0.12);
      ctx.lineTo(s * 0.42, -s * 0.38);
      ctx.stroke();
      ctx.fillStyle = '#c5c9c7';
      ctx.strokeStyle = '#1a1817';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s * 0.28, -s * 0.36);
      ctx.lineTo(s * 0.56, -s * 0.22);
      ctx.lineTo(s * 0.44, -s * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (tool === 'pickaxe') {
      ctx.strokeStyle = '#7c5333';
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, s * 0.12);
      ctx.lineTo(s * 0.42, -s * 0.38);
      ctx.stroke();
      ctx.strokeStyle = '#b8bcc0';
      ctx.lineWidth = Math.max(2.5, s * 0.09);
      ctx.beginPath();
      ctx.arc(s * 0.36, -s * 0.32, s * 0.22, -0.4, 1.8);
      ctx.stroke();
    } else if (tool === 'torch') {
      ctx.strokeStyle = '#6d492b';
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, s * 0.1);
      ctx.lineTo(s * 0.36, -s * 0.42);
      ctx.stroke();
      ctx.fillStyle = '#ff9f2e';
      ctx.beginPath();
      ctx.arc(s * 0.38, -s * 0.48, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Pale parchment DST head
    ctx.fillStyle = '#f0e5cf';
    ctx.strokeStyle = '#181512';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, -s * 1.28, s * 0.36, s * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Signature Wilson spiky black hair (iconic 3-peak W silhouette)
    ctx.fillStyle = '#191817';
    ctx.beginPath();
    ctx.moveTo(-s * 0.34, -s * 1.32);
    ctx.lineTo(-s * 0.56, -s * 1.66);
    ctx.lineTo(-s * 0.22, -s * 1.56);
    ctx.lineTo(0, -s * 1.92);
    ctx.lineTo(s * 0.22, -s * 1.56);
    ctx.lineTo(s * 0.56, -s * 1.66);
    ctx.lineTo(s * 0.34, -s * 1.32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Eyes & brow
    ctx.fillStyle = '#181512';
    ctx.beginPath();
    ctx.arc(-s * 0.13, -s * 1.26, Math.max(1.5, s * 0.045), 0, Math.PI * 2);
    ctx.arc(s * 0.13, -s * 1.26, Math.max(1.5, s * 0.045), 0, Math.PI * 2);
    ctx.fill();

    // Nameplate above Wilson
    if (s > 12) {
      ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(14, 18, 13, 0.72)';
      ctx.fillRect(-28, -s * 2.25 - 11, 56, 15);
      ctx.fillStyle = '#f2d379';
      ctx.fillText('Wilson', 0, -s * 2.25);
    }
  }

  private drawPortal(ctx: CanvasRenderingContext2D, s: number, now: number) {
    const pulse = 0.7 + 0.3 * Math.sin(now * 0.004);
    // Stone base
    ctx.fillStyle = '#5a5852';
    ctx.strokeStyle = '#1b1a17';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.15, s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Swirling portal vortex
    const grad = ctx.createRadialGradient(0, -s * 1.2, s * 0.1, 0, -s * 1.2, s * 0.85);
    grad.addColorStop(0, `rgba(255, 110, 90, ${0.85 * pulse})`);
    grad.addColorStop(0.6, 'rgba(140, 35, 55, 0.65)');
    grad.addColorStop(1, 'rgba(30, 12, 22, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, -s * 1.2, s * 0.78, s * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ornate wrought-iron arch
    ctx.strokeStyle = '#282423';
    ctx.lineWidth = Math.max(3, s * 0.14);
    ctx.beginPath();
    ctx.arc(0, -s * 1.1, s * 0.78, Math.PI, 0, false);
    ctx.lineTo(s * 0.78, 0);
    ctx.moveTo(-s * 0.78, -s * 1.1);
    ctx.lineTo(-s * 0.78, 0);
    ctx.stroke();

    // Top red gem
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.arc(0, -s * 1.9, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawTree(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity, now: number) {
    const sway = Math.sin(now * 0.002 + entity.guid) * s * 0.08;
    // Trunk
    ctx.fillStyle = '#5c3d28';
    ctx.strokeStyle = '#1b140e';
    ctx.lineWidth = Math.max(1.4, s * 0.05);
    ctx.beginPath();
    ctx.rect(-s * 0.16, -s * 0.75, s * 0.32, s * 0.75);
    ctx.fill();
    ctx.stroke();

    if (entity.prefab === 'twiggytree' || entity.prefab === 'marsh_tree') {
      ctx.strokeStyle = '#4a3525';
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.6);
      ctx.lineTo(sway, -s * 2.1);
      ctx.moveTo(0, -s * 1.2);
      ctx.lineTo(-s * 0.65 + sway, -s * 1.75);
      ctx.moveTo(0, -s * 1.4);
      ctx.lineTo(s * 0.65 + sway, -s * 1.9);
      ctx.stroke();
      return;
    }

    const isDeciduous = entity.prefab === 'deciduoustree';
    const c1 = isDeciduous ? '#8c3b20' : '#254228';
    const c2 = isDeciduous ? '#ad4c28' : '#2f5432';
    const c3 = isDeciduous ? '#c96432' : '#3b683f';

    // Three layered pine/leaf tiers
    const tiers = [
      { y: -s * 0.65, w: s * 1.05, h: s * 0.95, fill: c1 },
      { y: -s * 1.25, w: s * 0.86, h: s * 0.88, fill: c2 },
      { y: -s * 1.82, w: s * 0.64, h: s * 0.82, fill: c3 },
    ];
    for (let i = 0; i < tiers.length; ++i) {
      const t = tiers[i];
      const off = sway * (i + 1) * 0.45;
      ctx.fillStyle = t.fill;
      ctx.beginPath();
      ctx.moveTo(-t.w + off * 0.4, t.y);
      ctx.lineTo(off, t.y - t.h);
      ctx.lineTo(t.w + off * 0.4, t.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawRock(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity) {
    ctx.fillStyle = '#7a7d78';
    ctx.strokeStyle = '#1f211e';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(-s * 0.72, -s * 0.05);
    ctx.lineTo(-s * 0.58, -s * 0.72);
    ctx.lineTo(-s * 0.08, -s * 1.05);
    ctx.lineTo(s * 0.52, -s * 0.82);
    ctx.lineTo(s * 0.74, -s * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Gold vein accent for rock2
    if (entity.prefab === 'rock2') {
      ctx.strokeStyle = '#e5b942';
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(-s * 0.25, -s * 0.75);
      ctx.lineTo(0, -s * 0.45);
      ctx.lineTo(s * 0.28, -s * 0.62);
      ctx.stroke();
    }
  }

  private drawCampfire(ctx: CanvasRenderingContext2D, s: number, _entity: SceneEntity, now: number) {
    // Logs & stones ring
    ctx.fillStyle = '#5c4028';
    ctx.strokeStyle = '#181410';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.62, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Animated flame tongues
    const f1 = 0.85 + 0.22 * Math.sin(now * 0.019);
    const f2 = 0.85 + 0.22 * Math.cos(now * 0.027);
    ctx.fillStyle = '#e85d1a';
    ctx.beginPath();
    ctx.moveTo(-s * 0.42, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.2, -s * 0.9 * f1, 0, -s * 1.25 * f1);
    ctx.quadraticCurveTo(s * 0.2, -s * 0.9 * f2, s * 0.42, -s * 0.05);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffd152';
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.05);
    ctx.quadraticCurveTo(0, -s * 0.65 * f2, 0, -s * 0.82 * f2);
    ctx.quadraticCurveTo(0, -s * 0.65 * f1, s * 0.22, -s * 0.05);
    ctx.closePath();
    ctx.fill();
  }

  private drawPlant(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity, now: number) {
    const sway = Math.sin(now * 0.003 + entity.guid) * s * 0.06;
    ctx.strokeStyle = '#1b1d16';
    ctx.lineWidth = Math.max(1.2, s * 0.05);

    if (entity.prefab.startsWith('berrybush')) {
      ctx.fillStyle = '#385e32';
      ctx.beginPath();
      ctx.arc(sway * 0.4, -s * 0.48, s * 0.48, 0, Math.PI * 2);
      ctx.arc(-s * 0.28 + sway * 0.2, -s * 0.32, s * 0.34, 0, Math.PI * 2);
      ctx.arc(s * 0.28 + sway * 0.2, -s * 0.32, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Red berries
      ctx.fillStyle = '#d62828';
      for (const [bx, by] of [[-0.18, -0.52], [0.16, -0.58], [0.02, -0.32], [-0.24, -0.28], [0.24, -0.26]]) {
        ctx.beginPath();
        ctx.arc(s * bx + sway * 0.3, s * by, Math.max(2, s * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (entity.prefab === 'grass' || entity.prefab === 'reeds') {
      ctx.strokeStyle = entity.prefab === 'grass' ? '#8ea844' : '#6c7d47';
      ctx.lineWidth = Math.max(2, s * 0.08);
      for (const offset of [-0.26, -0.1, 0.08, 0.24]) {
        ctx.beginPath();
        ctx.moveTo(s * offset * 0.4, 0);
        ctx.quadraticCurveTo(s * offset + sway, -s * 0.45, s * offset * 1.45 + sway, -s * 0.85);
        ctx.stroke();
      }
      return;
    }

    if (entity.prefab === 'sapling') {
      ctx.strokeStyle = '#755233';
      ctx.lineWidth = Math.max(1.8, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sway, -s * 0.78);
      ctx.moveTo(sway * 0.4, -s * 0.35);
      ctx.lineTo(-s * 0.28 + sway, -s * 0.62);
      ctx.moveTo(sway * 0.6, -s * 0.48);
      ctx.lineTo(s * 0.28 + sway, -s * 0.72);
      ctx.stroke();
      return;
    }

    // Flower / mushroom / carrot
    ctx.strokeStyle = '#3d6e2f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(sway, -s * 0.38);
    ctx.stroke();

    ctx.fillStyle = entity.prefab.includes('red') ? '#d62828'
      : entity.prefab.includes('blue') ? '#3a86ff'
      : entity.prefab.includes('carrot') ? '#f77f00'
      : '#f4a261';
    ctx.beginPath();
    ctx.arc(sway, -s * 0.42, Math.max(3, s * 0.18), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawItem(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity, now: number) {
    const bob = Math.sin(now * 0.005 + entity.guid) * s * 0.05;
    ctx.translate(0, -bob);
    ctx.strokeStyle = '#181612';
    ctx.lineWidth = 1.5;

    if (entity.prefab === 'flint') {
      ctx.fillStyle = '#8b949e';
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, -s * 0.05);
      ctx.lineTo(0, -s * 0.45);
      ctx.lineTo(s * 0.3, -s * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (entity.prefab === 'twigs') {
      ctx.strokeStyle = '#8a623e';
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, -s * 0.05);
      ctx.lineTo(s * 0.28, -s * 0.38);
      ctx.moveTo(-s * 0.18, -s * 0.35);
      ctx.lineTo(s * 0.25, -s * 0.08);
      ctx.stroke();
    } else if (entity.prefab === 'cutgrass') {
      ctx.fillStyle = '#a7bd4e';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.18, s * 0.28, s * 0.16, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (entity.prefab === 'log') {
      ctx.fillStyle = '#6e472b';
      ctx.beginPath();
      ctx.roundRect(-s * 0.32, -s * 0.28, s * 0.64, s * 0.24, 4);
      ctx.fill();
      ctx.stroke();
    } else if (entity.prefab === 'goldnugget') {
      ctx.fillStyle = '#f5c542';
      ctx.beginPath();
      ctx.arc(0, -s * 0.2, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (entity.prefab.startsWith('berries')) {
      ctx.fillStyle = '#d62828';
      ctx.beginPath();
      ctx.arc(-s * 0.08, -s * 0.16, s * 0.14, 0, Math.PI * 2);
      ctx.arc(s * 0.1, -s * 0.2, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = '#d8b874';
      ctx.beginPath();
      ctx.arc(0, -s * 0.2, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawCreature(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity, now: number) {
    const hop = Math.abs(Math.sin(now * 0.009 + entity.guid)) * s * 0.15;
    ctx.translate(0, -hop);
    ctx.strokeStyle = '#161412';
    ctx.lineWidth = 1.6;

    const isMonster = entity.kind === 'monster' || entity.prefab.includes('spider') || entity.prefab.includes('hound');
    ctx.fillStyle = isMonster ? '#2b252c' : entity.prefab === 'pigman' ? '#d99b82' : '#b89f7d';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.36, s * 0.36, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eyes
    ctx.fillStyle = isMonster ? '#e63946' : '#161412';
    ctx.beginPath();
    ctx.arc(-s * 0.12, -s * 0.4, Math.max(1.5, s * 0.05), 0, Math.PI * 2);
    ctx.arc(s * 0.12, -s * 0.4, Math.max(1.5, s * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawStructureOrProp(ctx: CanvasRenderingContext2D, s: number, entity: SceneEntity) {
    ctx.fillStyle = '#7d6346';
    ctx.strokeStyle = '#181410';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.rect(-s * 0.35, -s * 0.7, s * 0.7, s * 0.7);
    ctx.fill();
    ctx.stroke();
    if (entity.prefab === 'researchlab') {
      ctx.fillStyle = '#d8b874';
      ctx.beginPath();
      ctx.arc(0, -s * 0.85, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private renderLightingOverlay(
    ctx: CanvasRenderingContext2D,
    snap: GameSceneSnapshot,
    projected: ProjectedEntity[],
    cam: CameraSnapshot,
  ) {
    const [ar, ag, ab] = snap.ambient ?? [255, 255, 255];
    const brightness = (ar * 0.299 + ag * 0.587 + ab * 0.114) / 255;

    // Draw warm additive glow around light-emitting entities
    for (const item of projected) {
      const e = item.entity;
      if (!e.lightRadius || e.lightRadius <= 0.1) continue;
      const rPx = Math.max(40, item.scale * e.lightRadius * 1.35);
      const [lr, lg, lb] = e.lightColour ?? [255, 195, 110];
      const grad = ctx.createRadialGradient(item.sx, item.sy - item.scale * 0.4, rPx * 0.08, item.sx, item.sy - item.scale * 0.4, rPx);
      grad.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.38)`);
      grad.addColorStop(0.5, `rgba(${lr}, ${lg}, ${lb}, 0.14)`);
      grad.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(item.sx, item.sy - item.scale * 0.4, rPx, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dusk / Night ambient tinting
    if (brightness < 0.92) {
      const darkness = Math.min(0.76, (1 - brightness) * 0.85);
      ctx.save();
      ctx.fillStyle = `rgba(${Math.round(ar * 0.18)}, ${Math.round(ag * 0.2)}, ${Math.round(ab * 0.32)}, ${darkness.toFixed(3)})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
    void cam;
  }

  private drawHoverTooltip(ctx: CanvasRenderingContext2D, hovered: ProjectedEntity, equippedHand: string) {
    const title = formatPrefabName(hovered.entity.prefab);
    const act = defaultActionForEntity(hovered.entity, equippedHand);
    const text = `${title} · [Click] ${act.label}`;
    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const width = ctx.measureText(text).width + 20;
    const tx = Math.min(this.canvas.width - width - 10, Math.max(10, hovered.sx - width * 0.5));
    const ty = Math.max(14, hovered.sy - hovered.hitRadius - 32);

    ctx.fillStyle = 'rgba(16, 21, 15, 0.9)';
    ctx.strokeStyle = '#d8b874';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(tx, ty, width, 26, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f2e8cf';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx + 10, ty + 13);
    ctx.restore();
  }

  private renderMinimap(ctx: CanvasRenderingContext2D, snap: GameSceneSnapshot, cam: CameraSnapshot) {
    const mw = ctx.canvas.width;
    const mh = ctx.canvas.height;
    ctx.fillStyle = '#0c1c29';
    ctx.fillRect(0, 0, mw, mh);

    const mm = snap.minimap;
    if (mm && mm.cols > 0 && mm.data) {
      const cellW = mw / mm.cols;
      const cellH = mh / mm.cols;
      for (let r = 0; r < mm.cols; ++r) {
        for (let c = 0; c < mm.cols; ++c) {
          const tileId = mm.data[r * mm.cols + c] ?? 1;
          ctx.fillStyle = getTileStyle(tileId).fill;
          ctx.fillRect(c * cellW, r * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }

    // Draw nearby entities on minimap
    const span = (mm?.radius ?? 20) * (mm?.step ?? 3) * TILE_SIZE;
    for (const e of snap.entities) {
      const dx = (e.x - snap.player.x) / span;
      const dz = (e.z - snap.player.z) / span;
      const px = mw * 0.5 + dx * mw * 0.5;
      const py = mh * 0.5 + dz * mh * 0.5;
      if (px < 2 || px > mw - 2 || py < 2 || py > mh - 2) continue;
      if (e.prefab === 'multiplayer_portal') {
        ctx.fillStyle = '#e63946';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'fire') {
        ctx.fillStyle = '#ffb703';
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'tree') {
        ctx.fillStyle = '#2b5832';
        ctx.fillRect(px - 1, py - 1, 2.2, 2.2);
      } else if (e.kind === 'rock') {
        ctx.fillStyle = '#adb5bd';
        ctx.fillRect(px - 1.2, py - 1.2, 2.5, 2.5);
      }
    }

    // Player marker at center + camera heading arrow
    ctx.save();
    ctx.translate(mw * 0.5, mh * 0.5);
    ctx.rotate((cam.heading - 90) * DEG2RAD);
    ctx.fillStyle = '#f2d379';
    ctx.strokeStyle = '#141610';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

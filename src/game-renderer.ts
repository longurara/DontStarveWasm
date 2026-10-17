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
  overrides?: Record<string, { build: string; symbol: string }>;
  hiddenLayers?: string[];
  hiddenSymbols?: string[];
  lightRadius?: number;
  lightIntensity?: number;
  lightFalloff?: number;
  lightColour?: [number, number, number];
  health?: number;
  maxHealth?: number;
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

export interface EquippedSlotSnapshot {
  prefab: string;
  name: string;
  percent?: number;
}

export interface InventoryItemSnapshot {
  slot: number;
  prefab: string;
  name: string;
  count: number;
  uses?: number;
  percent?: number;
  equipSlot?: string;
  edible?: boolean;
  spoiled?: boolean;
}

export interface OpenContainerSnapshot {
  guid: number;
  prefab: string;
  name: string;
  numSlots: number;
  isCooker?: boolean;
  slots: InventoryItemSnapshot[];
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
  isGhost?: boolean;
  inCaves?: boolean;
  equippedHand: string;
  equippedHead: string;
  equippedBody: string;
  equipped?: {
    hands?: EquippedSlotSnapshot;
    head?: EquippedSlotSnapshot;
    body?: EquippedSlotSnapshot;
  };
  inventory: InventoryItemSnapshot[];
  backpackSlots?: InventoryItemSnapshot[];
  openContainer?: OpenContainerSnapshot | null;
  ingredientCounts?: Record<string, number>;
  scienceTier?: number;
  creativeMode?: boolean;
  speech?: string;
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
  daySegs?: number;
  duskSegs?: number;
  nightSegs?: number;
  moonPhase?: string;
  inCaves?: boolean;
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
  ui?: { rootGuid: number; count: number; nodes: unknown[] };
  announcements?: string[];
  soundEvents?: Array<{ path: string; name?: string; volume?: number; action?: string }>;
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
  willow: 'Willow',
  wolfgang: 'Wolfgang',
  wendy: 'Wendy',
  wx78: 'WX-78',
  wickerbottom: 'Wickerbottom',
  woodie: 'Woodie',
  wes: 'Wes',
  waxwell: 'Maxwell',
  wathgrithr: 'Wigfrid',
  webber: 'Webber',
  winona: 'Winona',
  warly: 'Warly',
  wortox: 'Wortox',
  wormwood: 'Wormwood',
  wurt: 'Wurt',
  walter: 'Walter',
  wanda: 'Wanda',
  multiplayer_portal: 'Florid Postern',
  evergreen: 'Evergreen',
  evergreen_sparse: 'Lumpy Evergreen',
  twiggytree: 'Twiggy Tree',
  deciduoustree: 'Birchnut Tree',
  marsh_tree: 'Spiky Tree',
  rock1: 'Boulder',
  rock2: 'Gold Vein Boulder',
  rock_flintless: 'Flintless Boulder',
  flint: 'Flint',
  twigs: 'Twigs',
  cutgrass: 'Cut Grass',
  berries: 'Berries',
  berries_cooked: 'Roasted Berries',
  berries_juicy: 'Juicy Berries',
  berries_juicy_cooked: 'Roasted Juicy Berries',
  log: 'Log',
  rocks: 'Rocks',
  goldnugget: 'Gold Nugget',
  nitre: 'Nitre',
  berrybush: 'Berry Bush',
  berrybush2: 'Berry Bush',
  berrybush_juicy: 'Juicy Berry Bush',
  grass: 'Grass',
  sapling: 'Sapling',
  flower: 'Flower',
  flower_evil: 'Evil Flower',
  petals: 'Petals',
  carrot_planted: 'Carrot',
  carrot: 'Carrot',
  carrot_cooked: 'Roasted Carrot',
  red_mushroom: 'Red Mushroom',
  green_mushroom: 'Green Mushroom',
  blue_mushroom: 'Blue Mushroom',
  red_cap: 'Red Cap',
  red_cap_cooked: 'Cooked Red Cap',
  green_cap: 'Green Cap',
  green_cap_cooked: 'Cooked Green Cap',
  blue_cap: 'Blue Cap',
  blue_cap_cooked: 'Cooked Blue Cap',
  axe: 'Axe',
  goldenaxe: 'Luxury Axe',
  pickaxe: 'Pickaxe',
  goldenpickaxe: 'Opulent Pickaxe',
  shovel: 'Shovel',
  goldenshovel: 'Regal Shovel',
  hammer: 'Hammer',
  torch: 'Torch',
  lantern: 'Lantern',
  lighter: "Willow's Lighter",
  lucy: 'Lucy the Axe',
  spear: 'Spear',
  spear_wathgrithr: 'Battle Spear',
  hambat: 'Ham Bat',
  cane: 'Walking Cane',
  armorgrass: 'Grass Suit',
  armorwood: 'Log Suit',
  armormarble: 'Marble Suit',
  backpack: 'Backpack',
  flowerhat: 'Garland',
  strawhat: 'Straw Hat',
  footballhat: 'Football Helmet',
  wathgrithrhat: 'Battle Helm',
  tophat: 'Top Hat',
  winterhat: 'Winter Hat',
  minerhat: 'Miner Hat',
  rope: 'Rope',
  boards: 'Boards',
  cutstone: 'Cut Stone',
  papyrus: 'Papyrus',
  charcoal: 'Charcoal',
  ash: 'Ashes',
  poop: 'Manure',
  silk: 'Silk',
  spidergland: 'Spider Gland',
  healingsalve: 'Healing Salve',
  trap: 'Trap',
  birdtrap: 'Bird Trap',
  bugnet: 'Bug Net',
  fishingrod: 'Freshwater Fishing Rod',
  compass: 'Compass',
  heatrock: 'Thermal Stone',
  bedroll_straw: 'Straw Roll',
  campfire: 'Campfire',
  firepit: 'Fire Pit',
  researchlab: 'Science Machine',
  researchlab2: 'Alchemy Engine',
  cookpot: 'Crock Pot',
  icebox: 'Ice Box',
  meatrack: 'Drying Rack',
  treasurechest: 'Chest',
  homesign: 'Sign',
  pighouse: 'Pig House',
  meat: 'Meat',
  cookedmeat: 'Cooked Meat',
  monstermeat: 'Monster Meat',
  cookedmonstermeat: 'Cooked Monster Meat',
  smallmeat: 'Morsel',
  cookedsmallmeat: 'Cooked Morsel',
  drumstick: 'Drumstick',
  drumstick_cooked: 'Fried Drumstick',
  froglegs: 'Frog Legs',
  froglegs_cooked: 'Cooked Frog Legs',
  meatballs: 'Meatballs',
  kabobs: 'Kabobs',
  ratatouille: 'Ratatouille',
  bonestew: 'Meaty Stew',
  perogies: 'Pierogi',
  baconeggs: 'Bacon and Eggs',
  honeyham: 'Honey Ham',
  trailmix: 'Trail Mix',
  monsterlasagna: 'Monster Lasagna',
  wetgoop: 'Wet Goop',
  smallmeat_dried: 'Small Jerky',
  meat_dried: 'Jerky',
  spoiled_food: 'Rot',
  abigail_flower: "Abigail's Flower",
  slingshot: 'Trusty Slingshot',
  pocketwatch_weapon: 'Alarming Clock',
  rabbit: 'Rabbit',
  rabbithole: 'Rabbit Hole',
  perd: 'Gobbler',
  pigman: 'Pig Man',
  spider: 'Spider',
  spiderden: 'Spider Den',
  beefalo: 'Beefalo',
  tallbird: 'Tallbird',
  bee: 'Bee',
  butterfly: 'Butterfly',
  robin: 'Redbird',
  crow: 'Crow',
  frog: 'Frog',
  skeleton: 'Skeleton',
  wormhole: 'Wormhole',
  pond: 'Pond',
  cave_entrance: 'Plugged Sinkhole',
  cave_entrance_open: 'Open Sinkhole',
  cave_exit: 'Rope to Surface',
  moose_nesting_ground: 'Moose/Goose Nest',
  carnival_host: 'Corvus Goodfeather',
  fireflies: 'Fireflies',
};

export function formatPrefabName(prefab: string): string {
  if (!prefab) return 'Entity';
  if (PREFAB_LABELS[prefab]) return PREFAB_LABELS[prefab];
  return prefab.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function defaultActionForEntity(e: SceneEntity, equippedHand: string, isGhost = false): { code: string; label: string } {
  if (isGhost) {
    if (e.prefab === 'multiplayer_portal') return { code: 'RESURRECT', label: 'Haunt to Resurrect' };
    return { code: 'INSPECT', label: 'Haunt / Examine' };
  }
  if (e.kind === 'player') return { code: 'INSPECT', label: 'Examine Self' };
  if (e.kind === 'item') return { code: 'PICKUP', label: 'Pick Up' };
  if (equippedHand === 'hammer' && (e.kind === 'structure' || e.prefab === 'skeleton' || e.prefab === 'pighouse')) {
    return { code: 'HAMMER', label: 'Hammer' };
  }
  if ((equippedHand === 'shovel' || equippedHand === 'goldenshovel') && (e.prefab === 'mound' || e.prefab === 'rabbithole' || e.prefab === 'molehill' || e.prefab === 'sapling' || e.prefab === 'grass' || e.prefab.startsWith('berrybush'))) {
    return { code: 'DIG', label: 'Dig' };
  }
  if (e.prefab === 'treasurechest' || e.prefab === 'cookpot' || e.prefab === 'icebox') {
    return { code: 'OPEN', label: 'Open' };
  }
  if (e.prefab === 'meatrack') {
    return { code: 'DRY', label: 'Hang Meat / Harvest' };
  }
  if (e.prefab === 'campfire' || e.prefab === 'firepit') {
    return { code: 'COOK', label: 'Cook / Add Fuel' };
  }
  if (e.prefab === 'cave_entrance') {
    return { code: 'MINE', label: 'Mine Sinkhole' };
  }
  if (e.prefab === 'cave_entrance_open') {
    return { code: 'ENTER_CAVES', label: 'Enter Caves' };
  }
  if (e.prefab === 'cave_exit') {
    return { code: 'EXIT_CAVES', label: 'Ascend to Surface' };
  }
  if (e.kind === 'plant') {
    if (e.prefab.startsWith('flower') || e.prefab.includes('mushroom') || e.prefab === 'carrot_planted' || e.prefab === 'sapling' || e.prefab === 'grass' || e.prefab.startsWith('berrybush') || e.prefab === 'reeds') {
      return { code: 'PICK', label: 'Pick' };
    }
  }
  if (e.kind === 'tree') {
    return { code: 'CHOP', label: 'Chop' };
  }
  if (e.kind === 'rock') {
    return { code: 'MINE', label: 'Mine' };
  }
  if (e.kind === 'monster') return { code: 'ATTACK', label: 'Attack' };
  return { code: 'INSPECT', label: 'Examine' };
}

export interface LoadedAnimAsset {
  prefab?: string;
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
      bankName?: string;
      facing: number;
      rate: number;
      numFrames?: number;
      frames: Array<{
        bbox?: number[];
        elements: Array<{
          symbol: number;
          layer?: string;
          frame: number;
          depth: number;
          matrix: [number, number, number, number, number, number];
          mult: [number, number, number, number];
        }>;
      }>;
    }>;
  };
  atlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }>;
  overrides?: Record<
    string,
    {
      model: LoadedAnimAsset['model'];
      atlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }>;
    }
  >;
}

interface CachedSpriteFrame {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  worldScale: number;
}

interface GpuAnimBundle {
  build: string;
  bank: string;
  model: LoadedAnimAsset['model'];
  textures: WebGLTexture[];
  overrides: Record<string, { model: LoadedAnimAsset['model']; textures: WebGLTexture[] }>;
}

export const PREFAB_ASSET_DEFAULTS: Record<string, { build: string; bank: string; anim: string }> = {
  wilson: { build: 'wilson', bank: 'wilson', anim: 'idle_loop' },
  willow: { build: 'willow', bank: 'wilson', anim: 'idle_loop' },
  wolfgang: { build: 'wolfgang', bank: 'wilson', anim: 'idle_loop' },
  wendy: { build: 'wendy', bank: 'wilson', anim: 'idle_loop' },
  wx78: { build: 'wx78', bank: 'wilson', anim: 'idle_loop' },
  wickerbottom: { build: 'wickerbottom', bank: 'wilson', anim: 'idle_loop' },
  woodie: { build: 'woodie', bank: 'wilson', anim: 'idle_loop' },
  wes: { build: 'wes', bank: 'wilson', anim: 'idle_loop' },
  waxwell: { build: 'waxwell', bank: 'wilson', anim: 'idle_loop' },
  wathgrithr: { build: 'wathgrithr', bank: 'wilson', anim: 'idle_loop' },
  webber: { build: 'webber', bank: 'wilson', anim: 'idle_loop' },
  winona: { build: 'winona', bank: 'wilson', anim: 'idle_loop' },
  warly: { build: 'warly', bank: 'wilson', anim: 'idle_loop' },
  wortox: { build: 'wortox', bank: 'wilson', anim: 'idle_loop' },
  wormwood: { build: 'wormwood', bank: 'wilson', anim: 'idle_loop' },
  wurt: { build: 'wurt', bank: 'wilson', anim: 'idle_loop' },
  walter: { build: 'walter', bank: 'wilson', anim: 'idle_loop' },
  wanda: { build: 'wanda', bank: 'wilson', anim: 'idle_loop' },
  multiplayer_portal: { build: 'portal_stone', bank: 'portal_dst', anim: 'idle_loop' },
  evergreen: { build: 'evergreen_new', bank: 'evergreen_short', anim: 'sway1_loop_normal' },
  evergreen_sparse: { build: 'evergreen_new_2', bank: 'evergreen_short', anim: 'sway1_loop_normal' },
  twiggytree: { build: 'twiggy_build', bank: 'twiggy', anim: 'sway1_loop_tall' },
  deciduoustree: { build: 'tree_leaf_trunk_build', bank: 'tree_leaf', anim: 'sway1_loop_normal' },
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
  flower_evil: { build: 'flowers_evil', bank: 'flowers_evil', anim: 'f1' },
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
  researchlab2: { build: 'researchlab2', bank: 'researchlab2', anim: 'idle' },
  cookpot: { build: 'cook_pot', bank: 'cook_pot', anim: 'idle_empty' },
  icebox: { build: 'ice_box', bank: 'icebox', anim: 'closed' },
  meatrack: { build: 'meat_rack', bank: 'meat_rack', anim: 'idle_empty' },
  treasurechest: { build: 'treasure_chest', bank: 'chest', anim: 'closed' },
  homesign: { build: 'sign_home', bank: 'sign_home', anim: 'idle' },
  rabbit: { build: 'rabbit_build', bank: 'rabbit', anim: 'idle' },
  rabbithole: { build: 'rabbit_hole', bank: 'rabbithole', anim: 'idle' },
  wormhole: { build: 'teleporter_worm_build', bank: 'teleporter_worm', anim: 'idle_loop' },
  pond: { build: 'marsh_tile', bank: 'marsh_tile', anim: 'idle' },
  cave_entrance: { build: 'cave_entrance', bank: 'cave_entrance', anim: 'idle_closed' },
  cave_entrance_open: { build: 'cave_entrance', bank: 'cave_entrance', anim: 'open' },
  moose_nesting_ground: { build: 'nesting_ground', bank: 'nesting_ground', anim: 'idle' },
  carnival_host: { build: 'carnival_host', bank: 'carnival_host', anim: 'idle' },
  fireflies: { build: 'fireflies', bank: 'fireflies', anim: 'swarm_loop' },
  perd: { build: 'perd', bank: 'perd', anim: 'idle_loop' },
  pigman: { build: 'pig_build', bank: 'pigman', anim: 'idle_loop' },
  pighouse: { build: 'pig_house', bank: 'pig_house', anim: 'idle' },
  spider: { build: 'spider_build', bank: 'spider', anim: 'idle' },
  spiderden: { build: 'spider_cocoon', bank: 'spider_cocoon', anim: 'cocoon_small' },
  beefalo: { build: 'beefalo_build', bank: 'beefalo', anim: 'idle_loop' },
  bee: { build: 'bee_build', bank: 'bee', anim: 'idle' },
  butterfly: { build: 'butterfly_basic', bank: 'butterfly', anim: 'idle' },
  robin: { build: 'robin_build', bank: 'crow', anim: 'idle' },
  crow: { build: 'crow_build', bank: 'crow', anim: 'idle' },
  frog: { build: 'frog', bank: 'frog', anim: 'idle' },
  skeleton: { build: 'skeletons', bank: 'skeleton', anim: 'idle' },
  marsh_plant: { build: 'marsh_plant', bank: 'marsh_plant', anim: 'idle' },
  fence_junk: { build: 'fence_junk_build', bank: 'fence_junk', anim: 'idle' },
  junk_pile: { build: 'scrappile', bank: 'scrappile', anim: 'idle' },
  junk_pile_big: { build: 'scrappile', bank: 'scrappile', anim: 'big_idle' },
  junk_pile_side: { build: 'scrappile', bank: 'scrappile', anim: 'side_idle1' },
  bullkelp_plant: { build: 'bullkelp_plant', bank: 'bullkelp_plant', anim: 'idle' },
  bullkelp_plant_leaves: { build: 'bullkelp_plant', bank: 'bullkelp_plant', anim: 'idle' },
  storage_robot: { build: 'storage_robot', bank: 'storage_robot', anim: 'idle' },
  wobster_den: { build: 'lobster_den_build', bank: 'lobster_den', anim: 'full' },
  firehound: { build: 'hound_red_ocean', bank: 'hound', anim: 'idle' },
  firestaff: { build: 'staffs', bank: 'staffs', anim: 'redstaff' },
  mound: { build: 'gravestones', bank: 'mound', anim: 'gravedirt' },
  gravestone: { build: 'gravestones', bank: 'gravestone', anim: 'grave1' },
  molehill: { build: 'mole_build', bank: 'mole', anim: 'mound_idle' },
  mole: { build: 'mole_build', bank: 'mole', anim: 'idle' },
  campfirefire: { build: 'campfire_fire', bank: 'campfire_fire', anim: 'level1' },
};

const HIDDEN_SYMBOLS = new Set([
  'arm_carry',
  'swap_object',
  'swap_hat',
  'hat',
  'hat_hair',
  'swap_body',
  'swap_body_tall',
  'snow',
  'snow_bitmap',
  'mouseover',
  'legs_mouseover',
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
  private static readonly BILD_SCALE = 0.5;

  constructor(private onRequestAsset?: (prefab: string, build: string, bank: string) => void) {
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

  static key(prefab: string, build: string, bank: string): string {
    return `${prefab || build}::${build}::${bank}`;
  }

  private uploadAtlases(
    gl: WebGL2RenderingContext,
    atlases: Array<{ name: string; width: number; height: number; rgba: ArrayBuffer }>,
  ): WebGLTexture[] {
    const textures: WebGLTexture[] = [];
    for (const atlas of atlases) {
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
    return textures;
  }

  ingestAsset(prefab: string, build: string, bank: string, payload: LoadedAnimAsset | null) {
    const key = OriginalAnimCompositor.key(prefab, build, bank);
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

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const textures = this.uploadAtlases(gl, payload.atlases);
    if (textures.length === 0) {
      this.bundles.set(key, 'unavailable');
      return;
    }

    const overrides: Record<string, { model: LoadedAnimAsset['model']; textures: WebGLTexture[] }> = {};
    if (payload.overrides) {
      for (const [eqName, eqData] of Object.entries(payload.overrides)) {
        if (eqData?.model?.vertices?.length && eqData?.atlases?.length) {
          const eqTex = this.uploadAtlases(gl, eqData.atlases);
          if (eqTex.length > 0) {
            overrides[eqName] = { model: eqData.model, textures: eqTex };
          }
        }
      }
    }

    this.bundles.set(key, {
      build,
      bank,
      model: payload.model,
      textures,
      overrides,
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
    const hasElements = (a: LoadedAnimAsset['model']['animations'][number]) =>
      a.frames.some(f => f.elements && f.elements.length > 0);

    const candidates = [
      animName,
      animName.endsWith('_loop') ? animName.slice(0, -5) : `${animName}_loop`,
      `${animName}_normal`,
      `${animName}_short`,
      `${animName}_tall`,
      'idle_loop',
      'sway1_loop_normal',
      'sway1_loop_short',
      'sway1_loop_tall',
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
        if (a.name === target && hasElements(a) && ((a.facing & desiredMask) !== 0 || a.facing === 255)) {
          matchedIdx = i;
          break;
        }
      }
      if (matchedIdx >= 0) break;
      // Second pass: exact name with SIDE (1 or 5) when LEFT (2) is requested so we can mirror X
      if (entityFacing === 2) {
        for (let i = 0; i < anims.length; ++i) {
          const a = anims[i];
          if (a.name === target && hasElements(a) && (a.facing & 5) !== 0) {
            matchedIdx = i;
            break;
          }
        }
        if (matchedIdx >= 0) break;
      }
      // Third pass: exact name with any facing
      for (let i = 0; i < anims.length; ++i) {
        const a = anims[i];
        if (a.name === target && hasElements(a)) {
          matchedIdx = i;
          break;
        }
      }
      if (matchedIdx >= 0) break;
    }

    if (matchedIdx < 0) {
      // Substring match
      for (let i = 0; i < anims.length; ++i) {
        if (hasElements(anims[i]) && anims[i].name.includes(animName)) {
          matchedIdx = i;
          break;
        }
      }
    }
    if (matchedIdx < 0) {
      matchedIdx = anims.findIndex(hasElements);
    }
    if (matchedIdx < 0) return null;

    const clip = anims[matchedIdx];
    const flipX = entityFacing === 2 && clip.facing !== 4;
    return { clipIndex: matchedIdx, flipX };
  }

  private renderFrameToCache(
    bundle: GpuAnimBundle,
    clipIndex: number,
    frameIdx: number,
    equippedHand: string,
    equippedHead: string,
    equippedBody: string,
    dynHiddenLayers?: Set<string>,
    dynHiddenSymbols?: Set<string>,
    entityOverrides?: SceneEntity['overrides'],
  ): CachedSpriteFrame | null {
    const gl = this.gl;
    const prog = this.program;
    if (!gl || !prog || !this.buffer) return null;

    const clip = bundle.model.animations[clipIndex];
    const frame = clip?.frames[frameIdx];
    if (!frame || !frame.elements || frame.elements.length === 0) return null;

    const W = OriginalAnimCompositor.SIZE;
    const H = OriginalAnimCompositor.SIZE;
    const elements = [...frame.elements].sort((a, b) => b.depth - a.depth);

    const resolveElementSource = (item: LoadedAnimAsset['model']['animations'][number]['frames'][number]['elements'][number]) => {
      let model = bundle.model;
      let textures = bundle.textures;
      let texNamespace = 0;
      let symbol = model.symbols[String(item.symbol)];
      const rawSymName = symbol?.name || '';
      const rawLayerName = item.layer || '';
      const symName = rawSymName.toLowerCase();
      const layerName = rawLayerName.toLowerCase();

      if (dynHiddenLayers && layerName && dynHiddenLayers.has(layerName)) return null;
      if (dynHiddenSymbols && symName && dynHiddenSymbols.has(symName)) return null;

      if (entityOverrides) {
        const entOv =
          entityOverrides[rawSymName] ||
          entityOverrides[symName] ||
          entityOverrides[rawLayerName] ||
          entityOverrides[layerName];
        if (entOv?.symbol) {
          const targetSym = entOv.symbol.toLowerCase();
          const syms = Object.values(model.symbols);
          const overridden = syms.find(s => s.name?.toLowerCase() === targetSym && s.frames?.length);
          if (overridden) {
            symbol = overridden;
          }
        }
      }

      if (equippedHand) {
        if (symName === 'arm_normal' || layerName === 'arm_normal') return null;
        if (symName === 'swap_object' || layerName === 'swap_object') {
          const eq = bundle.overrides[equippedHand];
          if (!eq) return null;
          model = eq.model;
          textures = eq.textures;
          texNamespace = 100;
          const syms = Object.values(model.symbols);
          symbol = syms.find(s => s.name?.toLowerCase() === equippedHand && s.frames?.length)
            ?? syms.find(s => s.name?.toLowerCase().includes('swap') && s.frames?.length)
            ?? syms.find(s => s.frames?.length)!;
        }
      } else {
        if (symName === 'arm_carry' || layerName === 'arm_carry' || symName === 'swap_object' || layerName === 'swap_object') {
          return null;
        }
      }

      if (equippedBody) {
        if (symName === 'swap_body' || layerName === 'swap_body' || symName === 'swap_body_tall' || layerName === 'swap_body_tall') {
          const eq = bundle.overrides[equippedBody];
          if (eq) {
            model = eq.model;
            textures = eq.textures;
            texNamespace = 300;
            const syms = Object.values(model.symbols);
            symbol = syms.find(s => s.name?.toLowerCase() === 'swap_body' && s.frames?.length)
              ?? syms.find(s => s.frames?.length)!;
          } else {
            return null;
          }
        }
      } else {
        if (symName === 'swap_body' || layerName === 'swap_body' || symName === 'swap_body_tall' || layerName === 'swap_body_tall') {
          return null;
        }
      }

      if (equippedHead) {
        if (symName === 'swap_hat' || layerName === 'swap_hat' || symName === 'hat' || layerName === 'hat') {
          const eq = bundle.overrides[equippedHead];
          if (!eq) return null;
          model = eq.model;
          textures = eq.textures;
          texNamespace = 200;
          const syms = Object.values(model.symbols);
          symbol = syms.find(s => s.name?.toLowerCase() === 'swap_hat' && s.frames?.length)
            ?? syms.find(s => s.frames?.length)!;
        }
      } else {
        if (symName === 'swap_hat' || layerName === 'swap_hat' || symName === 'hat' || layerName === 'hat' || symName === 'hat_hair' || layerName === 'hat_hair') {
          return null;
        }
      }

      if (texNamespace === 0 && ((symName && HIDDEN_SYMBOLS.has(symName)) || (layerName && HIDDEN_SYMBOLS.has(layerName)))) {
        if (!(equippedHand && (symName === 'arm_carry' || layerName === 'arm_carry'))) return null;
      }

      if (!symbol || !symbol.frames || symbol.frames.length === 0) return null;
      const sf =
        symbol.frames.find(f => item.frame >= f.frame && item.frame < f.frame + f.duration) ??
        symbol.frames[symbol.frames.length - 1];
      if (!sf || sf.count <= 0) return null;
      return { model, textures, texNamespace, sf };
    };

    // Pass 1: Compute exact BILD-space bounding box so tall trees/portals auto-fit inside 384x384 without clipping
    let minBx = Infinity;
    let maxBx = -Infinity;
    let minBy = Infinity;
    let maxBy = -Infinity;
    let validVerts = 0;

    for (const item of elements) {
      const resolved = resolveElementSource(item);
      if (!resolved) continue;
      const { model, sf } = resolved;
      const [a, b, c, d, tx, ty] = item.matrix;
      const end = Math.min(model.vertices.length, sf.offset + sf.count);
      for (let i = sf.offset; i < end; ++i) {
        const vtx = model.vertices[i];
        if (!vtx) continue;
        const [x, y] = vtx;
        const bx = a * x + b * y + tx;
        const by = c * x + d * y + ty;
        if (bx < minBx) minBx = bx;
        if (bx > maxBx) maxBx = bx;
        if (by < minBy) minBy = by;
        if (by > maxBy) maxBy = by;
        validVerts++;
      }
    }

    if (validVerts < 3 || !Number.isFinite(minBx) || !Number.isFinite(minBy)) return null;

    const spanW = Math.max(16, maxBx - minBx);
    const spanH = Math.max(16, maxBy - minBy);
    let sc = OriginalAnimCompositor.BILD_SCALE;
    const maxAllowedW = W - 28;
    const maxAllowedH = H - 28;
    if (spanW * sc > maxAllowedW || spanH * sc > maxAllowedH) {
      sc = Math.min(maxAllowedW / spanW, maxAllowedH / spanH);
    }
    const ax = W * 0.5 - ((minBx + maxBx) * 0.5) * sc;
    const ay = H * 0.5 - ((minBy + maxBy) * 0.5) * sc;

    // Pass 2: Build WebGL vertex batches
    const batches = new Map<number, { tex: WebGLTexture; geom: number[] }>();
    let minX = W;
    let minY = H;
    let maxX = 0;
    let maxY = 0;
    let totalVerts = 0;

    for (const item of elements) {
      const resolved = resolveElementSource(item);
      if (!resolved) continue;
      const { model, textures, texNamespace, sf } = resolved;
      const [a, b, c, d, tx, ty] = item.matrix;
      const [mr, mg, mb, ma] = item.mult ?? [1, 1, 1, 1];
      const end = Math.min(model.vertices.length, sf.offset + sf.count);

      for (let i = sf.offset; i < end; ++i) {
        const vtx = model.vertices[i];
        if (!vtx) continue;
        const [x, y, _z, u, v, atlas] = vtx;
        const px = ax + (a * x + b * y + tx) * sc;
        const py = ay + (c * x + d * y + ty) * sc;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        const texIdx = Math.max(0, Math.min(textures.length - 1, Math.round(atlas || 0)));
        const batchKey = texNamespace + texIdx;
        let batch = batches.get(batchKey);
        if (!batch) {
          batch = { tex: textures[texIdx], geom: [] };
          batches.set(batchKey, batch);
        }
        batch.geom.push(px, py, u, v, mr, mg, mb, ma);
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

    for (const batch of batches.values()) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, batch.tex);
      gl.uniform1i(this.samplerLoc, 0);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.geom), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, batch.geom.length / 8);
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
      worldScale: OriginalAnimCompositor.BILD_SCALE / sc,
    };
  }

  private static mapHandOverride(prefab: string): string {
    if (!prefab) return '';
    if (prefab === 'lucy') return 'swap_lucy_axe';
    if (prefab === 'hambat') return 'swap_ham_bat';
    return `swap_${prefab}`;
  }

  private static mapHeadOverride(prefab: string): string {
    if (!prefab) return '';
    const map: Record<string, string> = {
      flowerhat: 'hat_flower',
      strawhat: 'hat_straw',
      footballhat: 'hat_football',
      wathgrithrhat: 'hat_wathgrithr',
      tophat: 'hat_top',
      winterhat: 'hat_winter',
      minerhat: 'hat_miner',
    };
    return map[prefab] || '';
  }

  private static mapBodyOverride(prefab: string): string {
    if (!prefab) return '';
    const map: Record<string, string> = {
      armorgrass: 'armor_grass',
      armorwood: 'armor_wood',
      armormarble: 'armor_marble',
      backpack: 'swap_backpack',
    };
    return map[prefab] || '';
  }

  getEntitySprite(
    entity: SceneEntity,
    playerHud: PlayerHudSnapshot,
    cam: CameraSnapshot,
    now: number,
  ): { frame: CachedSpriteFrame; flipX: boolean } | null {
    if (!this.gl || !this.program) return null;
    if (entity.prefab === 'firefx_light' || (!entity.build && !entity.bank && entity.prefab.endsWith('_light'))) {
      return null;
    }
    const def = PREFAB_ASSET_DEFAULTS[entity.prefab];
    const build = entity.build || def?.build || entity.prefab || '';
    const bank = entity.bank || def?.bank || build;
    const prefab = entity.prefab || build;
    if (!build) return null;

    const key = OriginalAnimCompositor.key(prefab, build, bank);
    const state = this.bundles.get(key);
    if (!state) {
      this.bundles.set(key, 'pending');
      this.onRequestAsset?.(prefab, build, bank);
      return null;
    }
    if (state === 'pending' || state === 'unavailable') return null;

    const isPlayer = entity.kind === 'player';
    let animName = entity.anim || def?.anim || 'idle';
    if (isPlayer) {
      if (playerHud.sgState?.includes('run')) animName = 'run_loop';
      else if (playerHud.sgState?.includes('chop')) animName = 'chop_loop';
      else if (playerHud.sgState?.includes('mine')) animName = 'pickaxe_loop';
      else if (playerHud.sgState?.includes('atk') || playerHud.sgState?.includes('attack')) animName = 'atk';
      else if (!entity.anim || entity.anim === 'idle') animName = 'idle_loop';
    }

    let facing = entity.facing ?? 3;
    if (isPlayer || entity.kind === 'creature' || entity.kind === 'monster') {
      if (entity.rot !== 0 || (isPlayer && playerHud.sgState && playerHud.sgState !== 'idle')) {
        const heading = cam.heading * DEG2RAD;
        const rightX = -Math.sin(heading);
        const rightZ = Math.cos(heading);
        const fwdX = -Math.cos(heading);
        const fwdZ = -Math.sin(heading);
        const rotRad = entity.rot * DEG2RAD;
        const vx = Math.cos(rotRad);
        const vz = -Math.sin(rotRad);
        const screenRight = vx * rightX + vz * rightZ;
        const screenAway = vx * fwdX + vz * fwdZ;
        if (Math.abs(screenRight) >= Math.abs(screenAway) * 0.85) {
          facing = screenRight >= 0 ? 0 : 2;
        } else {
          facing = screenAway > 0 ? 1 : 3;
        }
      }
    }

    const resolved = this.resolveClip(state.model.animations, animName, facing);
    if (!resolved) return null;

    const clip = state.model.animations[resolved.clipIndex];
    const numSampled = clip.frames.length;
    let frameIdx =
      numSampled <= 1
        ? 0
        : Math.floor((now * 0.014 + (entity.guid % 19) * 0.65) % numSampled);
    if (!clip.frames[frameIdx]?.elements?.length) {
      const nonEmptyIdx = clip.frames.findIndex(f => f.elements && f.elements.length > 0);
      if (nonEmptyIdx >= 0) frameIdx = nonEmptyIdx;
    }

    let equippedHand = '';
    let equippedHead = '';
    let equippedBody = '';
    if (isPlayer) {
      equippedHand =
        entity.overrides?.swap_object?.build ||
        OriginalAnimCompositor.mapHandOverride(playerHud.equippedHand);
      equippedHead =
        entity.overrides?.swap_hat?.build ||
        OriginalAnimCompositor.mapHeadOverride(playerHud.equippedHead);
      equippedBody =
        entity.overrides?.swap_body?.build ||
        OriginalAnimCompositor.mapBodyOverride(playerHud.equippedBody);
    }

    const dynLayers = entity.hiddenLayers?.length ? new Set(entity.hiddenLayers.map(s => s.toLowerCase())) : undefined;
    const dynSyms = entity.hiddenSymbols?.length ? new Set(entity.hiddenSymbols.map(s => s.toLowerCase())) : undefined;
    const hideKey = dynLayers || dynSyms
      ? `${entity.hiddenLayers?.join(',') || ''}:${entity.hiddenSymbols?.join(',') || ''}`
      : '';
    const ovKey = entity.overrides
      ? Object.entries(entity.overrides)
          .map(([k, v]) => `${k}=${v.symbol || v.build || ''}`)
          .join(',')
      : '';

    const cacheKey = `${key}#${resolved.clipIndex}#${frameIdx}#${equippedHand}#${equippedHead}#${equippedBody}#${hideKey}#${ovKey}`;
    let cached = this.frameCache.get(cacheKey);
    if (cached === undefined) {
      if (this.frameCache.size > 480) {
        const oldest = this.frameCache.keys().next().value;
        if (oldest !== undefined) this.frameCache.delete(oldest);
      }
      cached = this.renderFrameToCache(
        state,
        resolved.clipIndex,
        frameIdx,
        equippedHand,
        equippedHead,
        equippedBody,
        dynLayers,
        dynSyms,
        entity.overrides,
      );
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
  private tilePatterns = new Map<number, CanvasPattern>();
  private uiIconCanvases = new Map<string, HTMLCanvasElement>();
  private uiIconDataUrls = new Map<string, string>();
  private clockWedgeTints = new Map<string, HTMLCanvasElement>();
  private prevSnapshot: GameSceneSnapshot | null = null;
  private currSnapshot: GameSceneSnapshot | null = null;
  private lastSnapshotPerf = 0;
  private projectedEntities: ProjectedEntity[] = [];
  public hoveredEntity: ProjectedEntity | null = null;
  public walkTarget: { x: number; z: number; until: number } | null = null;
  public pendingBuildPrefab: string | null = null;
  public clockHovered = false;
  private mouseX = -1;
  private mouseY = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    minimapCanvas?: HTMLCanvasElement | null,
    onRequestAsset?: (prefab: string, build: string, bank: string) => void,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.miniCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    this.animCompositor = new OriginalAnimCompositor(onRequestAsset);
  }

  ingestAnimAsset(prefab: string, build: string, bank: string, payload: LoadedAnimAsset | null) {
    this.animCompositor.ingestAsset(prefab, build, bank, payload);
  }

  ingestTileTextures(tiles: Array<{ tileIds: number[]; width: number; height: number; rgba: ArrayBuffer }>) {
    for (const entry of tiles) {
      if (!entry.rgba || entry.width < 2 || entry.height < 2) continue;
      const c = document.createElement('canvas');
      c.width = entry.width;
      c.height = entry.height;
      const cctx = c.getContext('2d');
      if (!cctx) continue;
      const img = new ImageData(new Uint8ClampedArray(entry.rgba), entry.width, entry.height);
      cctx.putImageData(img, 0, 0);
      for (const tileId of entry.tileIds) {
        const tinted = document.createElement('canvas');
        tinted.width = entry.width;
        tinted.height = entry.height;
        const tctx = tinted.getContext('2d')!;
        tctx.drawImage(c, 0, 0);
        const style = getTileStyle(tileId);
        tctx.globalCompositeOperation = 'Soft-Light' as GlobalCompositeOperation;
        tctx.fillStyle = style.fill;
        tctx.fillRect(0, 0, entry.width, entry.height);
        const pat = this.ctx.createPattern(tinted, 'repeat');
        if (pat) this.tilePatterns.set(tileId, pat);
      }
    }
  }

  private buildTintedWedge(base: HTMLCanvasElement, rMul: number, gMul: number, bMul: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] * rMul);
      d[i + 1] = Math.round(d[i + 1] * gMul);
      d[i + 2] = Math.round(d[i + 2] * bMul);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  ingestUiIcons(icons: Record<string, { width: number; height: number; rgba: ArrayBuffer }>) {
    for (const [key, icon] of Object.entries(icons)) {
      if (!icon.rgba || icon.width < 2 || icon.height < 2) continue;
      const c = document.createElement('canvas');
      c.width = icon.width;
      c.height = icon.height;
      const cctx = c.getContext('2d');
      if (!cctx) continue;
      const img = new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height);
      cctx.putImageData(img, 0, 0);
      this.uiIconCanvases.set(key, c);
      this.uiIconDataUrls.set(key, c.toDataURL());

      if (key === 'clock_wedge') {
        // Exact Klei UIClock colors from scripts/widgets/uiclock.lua:
        // DAY_COLOUR = (254/255, 212/255, 86/255), DUSK_COLOUR = (165/255, 91/255, 82/255), DARKEN_PERCENT = 0.75
        const dr = 254 / 255, dg = 212 / 255, db = 86 / 255;
        const kr = 165 / 255, kg = 91 / 255, kb = 82 / 255;
        this.clockWedgeTints.set('day_light', this.buildTintedWedge(c, dr, dg, db));
        this.clockWedgeTints.set('day_dark', this.buildTintedWedge(c, dr * 0.75, dg * 0.75, db * 0.75));
        this.clockWedgeTints.set('dusk_light', this.buildTintedWedge(c, kr, kg, kb));
        this.clockWedgeTints.set('dusk_dark', this.buildTintedWedge(c, kr * 0.75, kg * 0.75, kb * 0.75));
      }
    }
  }

  getIconDataUrl(name: string): string | undefined {
    return this.uiIconDataUrls.get(name);
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
      this.drawEntity(ctx, item, snap, cam, now);
    }

    // 6b. Draw Ground Placer Ghost Preview if placing a structure
    if (this.pendingBuildPrefab && this.mouseX >= 0 && this.mouseY >= 0) {
      this.drawPlacerPreview(ctx, this.pendingBuildPrefab, snap, cam, now);
    }

    // 7. Day / Dusk / Night ambient & point lights overlay
    this.renderLightingOverlay(ctx, snap, projected, cam);

    // 8. Optional minimap canvas
    if (this.miniCtx) {
      this.renderMinimap(this.miniCtx, snap, cam);
    }
  }

  private drawPlacerPreview(
    ctx: CanvasRenderingContext2D,
    prefab: string,
    snap: GameSceneSnapshot,
    cam: CameraSnapshot,
    now: number,
  ) {
    const worldPos = this.screenToWorld(this.mouseX, this.mouseY, 0);
    if (!worldPos) return;
    const p = this.projectWorld(worldPos.x, 0, worldPos.z, cam);
    if (!p) return;

    const fakeEnt: SceneEntity = {
      guid: 999999,
      prefab,
      kind: 'structure',
      x: worldPos.x,
      y: 0,
      z: worldPos.z,
      rot: 0,
      sx: 1,
      sy: 1,
      sz: 1,
      clickable: false,
    };

    const s = Math.max(10, p.scale);
    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.strokeStyle = 'rgba(95, 225, 110, 0.85)';
    ctx.fillStyle = 'rgba(95, 225, 110, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.9, s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 0.68;
    const sprite = this.animCompositor.getEntitySprite(fakeEnt, snap.player, cam, now);
    if (sprite) {
      const { frame } = sprite;
      const ratio = (s / 54) * (frame.worldScale || 1);
      ctx.drawImage(
        frame.canvas,
        -frame.anchorX * ratio,
        -frame.anchorY * ratio,
        frame.width * ratio,
        frame.height * ratio,
      );
    } else {
      const icon = this.uiIconCanvases.get(prefab);
      if (icon) {
        const sz = Math.max(24, s * 1.2);
        ctx.drawImage(icon, -sz * 0.5, -sz * 0.85, sz, sz);
      }
    }
    ctx.restore();
  }

  private renderTerrain(ctx: CanvasRenderingContext2D, tiles: TileWindow, cam: CameraSnapshot, _now: number) {
    if (!tiles || !tiles.data || !tiles.cols) return;
    const halfW = tiles.width * 0.5;
    const halfH = tiles.height * 0.5;
    const r = tiles.radius;
    const step = tiles.step || 1;
    const tileWorld = TILE_SIZE * step;

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
        const pat = this.tilePatterns.get(tileId) ?? (tileId >= 200 ? this.tilePatterns.get(201) : undefined);
        if (pat) {
          try {
            if (typeof DOMMatrix !== 'undefined' && typeof pat.setTransform === 'function') {
              const patScale = Math.max(0.3, Math.min(1.5, p00.scale / 42));
              pat.setTransform(new DOMMatrix().translate(p00.sx, p00.sy).scale(patScale));
            }
          } catch {}
          ctx.fillStyle = pat;
        } else {
          ctx.fillStyle = style.fill;
        }
        ctx.strokeStyle = style.stroke;

        ctx.beginPath();
        ctx.moveTo(p00.sx, p00.sy);
        ctx.lineTo(p10.sx, p10.sy);
        ctx.lineTo(p11.sx, p11.sy);
        ctx.lineTo(p01.sx, p01.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private drawShadow(ctx: CanvasRenderingContext2D, item: ProjectedEntity) {
    const { entity, sx, sy, scale } = item;
    if (entity.prefab === 'firefx_light' || (!entity.build && !entity.bank && entity.prefab.endsWith('_light'))) {
      return;
    }
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

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    item: ProjectedEntity,
    snap: GameSceneSnapshot,
    cam: CameraSnapshot,
    now: number,
  ) {
    const { entity, sx, sy, scale } = item;
    if (entity.prefab === 'firefx_light' || (!entity.build && !entity.bank && entity.prefab.endsWith('_light'))) {
      return;
    }
    const s = Math.max(8, scale);
    const isHovered = this.hoveredEntity?.entity.guid === entity.guid;
    const isGhostPlayer = entity.kind === 'player' && Boolean(snap.player.isGhost || snap.player.health <= 0);
    ctx.save();
    ctx.translate(sx, sy);

    const filters: string[] = [];
    if (isHovered) {
      filters.push('brightness(1.22)');
    }
    if (isGhostPlayer) {
      ctx.globalAlpha = 0.62;
      filters.push('saturate(0.35) brightness(1.35)');
    } else if (entity.multColour) {
      const [mr, mg, mb, ma] = entity.multColour;
      if (ma !== undefined && ma < 0.99) {
        ctx.globalAlpha = Math.max(0.05, Math.min(1, ma));
      }
      const lum = (mr + mg + mb) / 3;
      if (Math.abs(lum - 1) > 0.08) {
        filters.push(`brightness(${Math.max(0.25, Math.min(2.0, lum)).toFixed(2)})`);
      }
    }
    if (entity.addColour) {
      const [ar, ag, ab] = entity.addColour;
      if (ar + ag + ab > 0.15) {
        filters.push(`brightness(${(1 + (ar + ag + ab) * 0.45).toFixed(2)})`);
      }
    }
    if (filters.length > 0) {
      ctx.filter = filters.join(' ');
    }

    const originalSprite = this.animCompositor.getEntitySprite(entity, snap.player, cam, now);
    if (originalSprite) {
      const { frame, flipX } = originalSprite;
      const ratio =
        (s / 54) * (frame.worldScale || 1) * Math.max(0.5, Math.min(2.2, Math.abs(entity.sx || 1)));
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
      ctx.filter = 'none';
      ctx.globalAlpha = 1;

      const topY = -Math.max(s * 2.0, frame.anchorY * ratio + 4);
      if (
        entity.kind !== 'player' &&
        entity.health !== undefined &&
        entity.maxHealth !== undefined &&
        entity.maxHealth > 0 &&
        (entity.health < entity.maxHealth || (isHovered && (entity.kind === 'monster' || entity.kind === 'creature')))
      ) {
        const hpPct = Math.max(0, Math.min(1, entity.health / entity.maxHealth));
        const bw = Math.max(34, Math.min(68, s * 1.15));
        const bh = 5;
        const bx = -bw * 0.5;
        const by = topY - 12;
        ctx.fillStyle = 'rgba(12, 9, 6, 0.85)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = hpPct > 0.5 ? '#5ec24e' : hpPct > 0.25 ? '#e0a938' : '#d63e34';
        ctx.fillRect(bx, by, bw * hpPct, bh);
      }
      if (entity.kind === 'player' && snap.player.speech && s > 10) {
        this.drawPlayerSpeechBubble(ctx, topY - 8, snap.player.speech);
      }
      ctx.restore();
      return;
    }

    const itemIcon = entity.kind === 'item' ? this.uiIconCanvases.get(entity.prefab) : undefined;
    if (itemIcon) {
      const sz = Math.max(16, s * 0.85);
      ctx.drawImage(itemIcon, -sz * 0.5, -sz * 0.85, sz, sz);
      ctx.restore();
      return;
    }

    ctx.restore();
  }

  private renderLightingOverlay(
    ctx: CanvasRenderingContext2D,
    snap: GameSceneSnapshot,
    projected: ProjectedEntity[],
    cam: CameraSnapshot,
  ) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const [ar, ag, ab] = snap.ambient ?? [255, 255, 255];
    const brightness = (ar * 0.299 + ag * 0.587 + ab * 0.114) / 255;

    // 1. Draw warm additive glow around light-emitting entities
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

    // 2. Seasonal / Subterranean Caves colour-cube grading
    const season = snap.clock?.season || 'autumn';
    const inCaves = Boolean(snap.clock?.inCaves || snap.player?.inCaves);
    ctx.save();
    if (inCaves) {
      ctx.fillStyle = 'rgba(18, 22, 38, 0.42)';
      ctx.fillRect(0, 0, W, H);
    } else if (season === 'winter') {
      ctx.fillStyle = 'rgba(165, 210, 245, 0.12)';
      ctx.fillRect(0, 0, W, H);
    } else if (season === 'spring') {
      ctx.fillStyle = 'rgba(120, 175, 140, 0.08)';
      ctx.fillRect(0, 0, W, H);
    } else if (season === 'summer') {
      ctx.fillStyle = 'rgba(245, 190, 110, 0.11)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // 3. Rain streaks when raining
    if (snap.clock?.isRaining) {
      const now = performance.now();
      ctx.save();
      ctx.strokeStyle = 'rgba(185, 215, 240, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 42; ++i) {
        const rx = ((i * 173 + now * 0.45) % (W + 120)) - 60;
        const ry = ((i * 251 + now * 1.15) % (H + 120)) - 60;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 9, ry + 26);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Dusk / Night ambient tinting
    if (brightness < 0.92) {
      const darkness = Math.min(0.76, (1 - brightness) * 0.85);
      ctx.save();
      ctx.fillStyle = `rgba(${Math.round(ar * 0.18)}, ${Math.round(ag * 0.2)}, ${Math.round(ab * 0.32)}, ${darkness.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 5. Vitals Screen Overlays (BloodOver, IceOver, HeatOver, SanityOver)
    const p = snap.player;
    if (p) {
      const hpRatio = p.health / Math.max(1, p.maxHealth);
      const saRatio = p.sanity / Math.max(1, p.maxSanity);
      const temp = p.temperature ?? 25;

      const drawEdgeVignette = (r: number, g: number, b: number, maxAlpha: number) => {
        ctx.save();
        const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.max(W, H) * 0.68);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${maxAlpha.toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      };

      if (hpRatio < 0.35 && hpRatio > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
        drawEdgeVignette(165, 18, 18, (0.35 - hpRatio) * (0.85 + 0.35 * pulse));
      }
      if (temp < 5) {
        drawEdgeVignette(120, 200, 255, Math.min(0.45, ((5 - temp) / 15) * 0.45));
      } else if (temp > 65) {
        drawEdgeVignette(255, 120, 25, Math.min(0.42, ((temp - 65) / 20) * 0.42));
      }
      if (saRatio < 0.33) {
        const pulse = 0.5 + 0.5 * Math.cos(performance.now() * 0.005);
        drawEdgeVignette(35, 12, 48, (0.33 - saRatio) * (0.9 + 0.25 * pulse));
      }
    }
    void cam;
  }

  private drawPlayerSpeechBubble(ctx: CanvasRenderingContext2D, topY: number, speech: string) {
    const clean = speech.trim();
    if (!clean) return;
    ctx.save();
    ctx.font = '700 15px Georgia, "Times New Roman", serif';
    const maxW = 280;
    const words = clean.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    for (const w of words) {
      const candidate = currentLine ? `${currentLine} ${w}` : w;
      if (ctx.measureText(candidate).width > maxW && currentLine) {
        lines.push(currentLine);
        currentLine = w;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) lines.push(currentLine);

    const lineHeight = 19;
    const totalH = lines.length * lineHeight;
    const by = topY - totalH - 6;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 8, 6, 0.95)';
    ctx.fillStyle = '#fff5d6';
    for (let i = 0; i < lines.length; ++i) {
      const ly = by + i * lineHeight;
      ctx.strokeText(lines[i], 0, ly);
      ctx.fillText(lines[i], 0, ly);
    }
    ctx.restore();
  }

  renderWorldClock(clockCanvas: HTMLCanvasElement, snap: GameSceneSnapshot) {
    const cctx = clockCanvas.getContext('2d');
    if (!cctx) return;
    const w = clockCanvas.width;
    const h = clockCanvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    cctx.clearRect(0, 0, w, h);

    // 1. Base face: clock_NIGHT.tex (scripts/widgets/uiclock.lua: self._face:SetScale(0.5))
    const nightFace = this.uiIconCanvases.get('clock_NIGHT');
    const rimCanvas = this.uiIconCanvases.get('clock_rim');
    const refW = rimCanvas?.width || nightFace?.width || 256;
    const baseScale = w / refW; // Maps Klei 0.5 scale to our canvas size
    const segScale = baseScale * (0.4 / 0.5); // uiclock.lua: segscale = 0.4 vs face scale = 0.5

    if (nightFace) {
      const fw = nightFace.width * baseScale;
      const fh = nightFace.height * baseScale;
      cctx.drawImage(nightFace, cx - fw * 0.5, cy - fh * 0.5, fw, fh);
    }

    // 2. 16 rotated clock_wedge.tex segments (uiclock.lua lines 97-105 & 214-239)
    const daySegs = snap.clock.daySegs ?? 8;
    const duskSegs = snap.clock.duskSegs ?? 6;
    const nightSegs = snap.clock.nightSegs ?? 2;
    const totalSegs = Math.max(1, daySegs + duskSegs + nightSegs);
    const stepAngle = (Math.PI * 2) / totalSegs;

    let dark = true;
    for (let i = 0; i < totalSegs; ++i) {
      if (i >= daySegs + duskSegs) {
        // Night segments are hidden so clock_NIGHT.tex shows underneath
        continue;
      }
      const isDay = i < daySegs;
      const tintKey = isDay
        ? dark
          ? 'day_dark'
          : 'day_light'
        : dark
          ? 'dusk_dark'
          : 'dusk_light';
      dark = !dark;

      const wedge = this.clockWedgeTints.get(tintKey);
      if (wedge) {
        const dw = wedge.width * segScale;
        const dh = wedge.height * segScale;
        cctx.save();
        cctx.translate(cx, cy);
        cctx.rotate(i * stepAngle);
        // SetHRegPoint(ANCHOR_LEFT), SetVRegPoint(ANCHOR_BOTTOM) -> bottom-left corner at (0, 0)
        cctx.drawImage(wedge, 0, -dh, dw, dh);
        cctx.restore();
      }
    }

    // 3. Rim: clock_rim.tex (self._rim:SetScale(0.5))
    if (rimCanvas) {
      const rw = rimCanvas.width * baseScale;
      const rh = rimCanvas.height * baseScale;
      cctx.drawImage(rimCanvas, cx - rw * 0.5, cy - rh * 0.5, rw, rh);
    }

    // 4. Hand: clock_hand.tex (self._hands:SetScale(0.5), self._hands:SetRotation(self._time * 360))
    const norm = Math.max(0, Math.min(1, snap.clock.normTime || 0));
    const handCanvas = this.uiIconCanvases.get('clock_hand');
    if (handCanvas) {
      const hw = handCanvas.width * baseScale;
      const hh = handCanvas.height * baseScale;
      cctx.save();
      cctx.translate(cx, cy);
      cctx.rotate(norm * Math.PI * 2);
      cctx.drawImage(handCanvas, -hw * 0.5, -hh * 0.5, hw, hh);
      cctx.restore();
    }

    // 5. Center text: self._text = self:AddChild(Text(BODYTEXTFONT, 33 / basescale))
    // No dark circle medallion in original DST! Just crisp outlined text at (5, 0)
    const dayNum = Math.max(1, snap.clock.cycles || 1);
    const line1 = this.clockHovered ? 'Survived' : 'World';
    const line2 = this.clockHovered ? `${dayNum} ${dayNum === 1 ? 'Day' : 'Days'}` : `Day ${dayNum}`;
    cctx.save();
    cctx.font = '700 13px Georgia, "Times New Roman", serif';
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    cctx.lineJoin = 'round';
    cctx.lineWidth = 3.2;
    cctx.strokeStyle = 'rgba(12, 9, 6, 0.92)';
    cctx.fillStyle = '#ffffff';
    cctx.strokeText(line1, cx + 2, cy - 8);
    cctx.fillText(line1, cx + 2, cy - 8);
    cctx.strokeText(line2, cx + 2, cy + 8);
    cctx.fillText(line2, cx + 2, cy + 8);
    cctx.restore();
  }

  private resolveMinimapIconKey(e: SceneEntity): string {
    if (e.prefab === 'multiplayer_portal') return 'portal_dst';
    if (e.prefab === 'evergreen_sparse') return 'evergreen_lumpy';
    if (e.prefab === 'evergreen') return 'evergreen';
    if (e.prefab === 'deciduoustree') return 'tree_leaf';
    if (e.prefab === 'marsh_tree') return 'marshtree';
    if (e.kind === 'tree') return 'evergreen';
    if (e.prefab === 'rock2') return 'rock_gold';
    if (e.prefab === 'rock_flintless') return 'rock_flintless';
    if (e.kind === 'rock') return 'rock';
    if (e.prefab === 'berrybush2') return 'berrybush2';
    if (e.prefab === 'berrybush_juicy') return 'berrybush_juicy';
    if (e.prefab.startsWith('berrybush')) return 'berrybush';
    if (e.prefab === 'wormhole') return 'wormhole';
    if (e.prefab === 'pond') return 'pond';
    if (e.prefab === 'cave_entrance') return 'cave_closed';
    if (e.prefab === 'cave_entrance_open') return 'cave_open';
    if (e.prefab === 'red_mushroom') return 'red_cap';
    if (e.prefab === 'green_mushroom') return 'green_cap';
    if (e.prefab === 'blue_mushroom') return 'blue_cap';
    if (e.prefab === 'carrot_planted') return 'carrot';
    if (e.prefab === 'flower') return 'petals';
    if (this.uiIconCanvases.has(e.prefab)) return e.prefab;
    return '';
  }

  renderFullScreenMap(
    mapCanvas: HTMLCanvasElement,
    zoom = 1,
    panX = 0,
    panY = 0,
  ) {
    const snap = this.currSnapshot;
    const mctx = mapCanvas.getContext('2d');
    if (!snap || !mctx) return;
    const W = mapCanvas.width;
    const H = mapCanvas.height;

    // 1. Parchment vintage ocean background
    const bgGrad = mctx.createRadialGradient(W * 0.5, H * 0.5, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.65);
    bgGrad.addColorStop(0, '#2b2318');
    bgGrad.addColorStop(1, '#14100b');
    mctx.fillStyle = bgGrad;
    mctx.fillRect(0, 0, W, H);

    const mm = snap.minimap;
    if (!mm || !mm.cols || !mm.data) return;

    const mapSize = Math.min(W, H) * 0.78 * zoom;
    const originX = (W - mapSize) * 0.5 + panX;
    const originY = (H - mapSize) * 0.5 + panY;
    const cellW = mapSize / mm.cols;
    const cellH = mapSize / mm.cols;

    mctx.save();
    // 2. Render terrain tiles
    for (let r = 0; r < mm.cols; ++r) {
      for (let c = 0; c < mm.cols; ++c) {
        const tileId = mm.data[r * mm.cols + c] ?? 1;
        const pat = this.tilePatterns.get(tileId) ?? (tileId >= 200 ? this.tilePatterns.get(201) : undefined);
        mctx.fillStyle = pat || getTileStyle(tileId).fill;
        mctx.fillRect(originX + c * cellW, originY + r * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Map border frame
    mctx.strokeStyle = '#b9935a';
    mctx.lineWidth = 2.5;
    mctx.strokeRect(originX, originY, mapSize, mapSize);

    // 3. Draw world entities on full-screen map using authentic Klei minimap icons
    const span = (mm.radius || 20) * (mm.step || 3) * TILE_SIZE;
    for (const e of snap.entities) {
      if (e.kind === 'player') continue;
      const dx = (e.x - snap.player.x) / span;
      const dz = (e.z - snap.player.z) / span;
      const px = originX + mapSize * 0.5 + dx * mapSize * 0.5;
      const py = originY + mapSize * 0.5 + dz * mapSize * 0.5;
      if (px < originX || px > originX + mapSize || py < originY || py > originY + mapSize) continue;

      const mmKey = this.resolveMinimapIconKey(e);
      const mmIcon = mmKey ? this.uiIconCanvases.get(mmKey) : undefined;
      if (mmIcon) {
        const isLandmark = e.prefab === 'multiplayer_portal' || e.kind === 'fire' || e.kind === 'structure';
        const isz = Math.max(12, (isLandmark ? 24 : 16) * Math.sqrt(zoom));
        mctx.drawImage(mmIcon, px - isz * 0.5, py - isz * 0.5, isz, isz);
      }
    }

    // 4. Draw Player at map center using Klei character avatar/minimap icon
    const wx = originX + mapSize * 0.5;
    const wy = originY + mapSize * 0.5;
    const charPrefab = snap.player.prefab || 'wilson';
    const playerIcon =
      this.uiIconCanvases.get(charPrefab) ||
      this.uiIconCanvases.get(`avatar_${charPrefab}`) ||
      this.uiIconCanvases.get('wilson');
    if (playerIcon) {
      mctx.drawImage(playerIcon, wx - 14, wy - 14, 28, 28);
    }
    mctx.restore();
  }

  private renderMinimap(ctx: CanvasRenderingContext2D, snap: GameSceneSnapshot, _cam: CameraSnapshot) {
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
          const pat = this.tilePatterns.get(tileId) ?? (tileId >= 200 ? this.tilePatterns.get(201) : undefined);
          ctx.fillStyle = pat || getTileStyle(tileId).fill;
          ctx.fillRect(c * cellW, r * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }

    // Draw nearby entities on minimap using Klei minimap icons
    const span = (mm?.radius ?? 20) * (mm?.step ?? 3) * TILE_SIZE;
    for (const e of snap.entities) {
      if (e.kind === 'player' || e.prefab === 'wilson') continue;
      const dx = (e.x - snap.player.x) / span;
      const dz = (e.z - snap.player.z) / span;
      const px = mw * 0.5 + dx * mw * 0.5;
      const py = mh * 0.5 + dz * mh * 0.5;
      if (px < 2 || px > mw - 2 || py < 2 || py > mh - 2) continue;

      const mmKey = this.resolveMinimapIconKey(e);
      const mmIcon = mmKey ? this.uiIconCanvases.get(mmKey) : undefined;
      if (mmIcon) {
        const isBig = e.prefab === 'multiplayer_portal' || e.kind === 'fire' || e.kind === 'structure';
        const isz = isBig ? 14 : 9;
        ctx.drawImage(mmIcon, px - isz * 0.5, py - isz * 0.5, isz, isz);
      }
    }

    // Player marker at center using Klei character minimap icon
    const wilsonIcon = this.uiIconCanvases.get('wilson');
    if (wilsonIcon) {
      ctx.drawImage(wilsonIcon, mw * 0.5 - 8, mh * 0.5 - 8, 16, 16);
    }
  }
}


import './style.css';
import { EngineWorker, type Role, type Snapshot } from './engine';
import { Checkpoints } from './persistence';
import { Room } from './rtc';
import { validateCheckpoint, validateCommand, assertCompatibility } from './protocol.mjs';
import { attachCanvasInput, nativeKeyCode } from './input.mjs';
import { GameRenderer, defaultActionForEntity, formatPrefabName, type GameSceneSnapshot } from './game-renderer';
import { DstAudioEngine } from './audio-engine';

interface CharacterInfo {
  id: string;
  name: string;
  title: string;
  quote: string;
  perk: string;
  health: number;
  hunger: number;
  sanity: number;
}

const CHARACTER_ROSTER: CharacterInfo[] = [
  { id: 'wilson', name: 'Wilson P. Higgsbury', title: 'The Gentleman Scientist', quote: '"I will conquer this world with the power of my MIND!"', perk: 'Grows a magnificent insulating beard.', health: 150, hunger: 150, sanity: 200 },
  { id: 'willow', name: 'Willow', title: 'The Firestarter', quote: '"Things are so much prettier when they burn."', perk: 'Starts with her trusty Lighter; immune to fire damage.', health: 150, hunger: 150, sanity: 120 },
  { id: 'wolfgang', name: 'Wolfgang', title: 'The Strongman', quote: '"I am mighty! No one is mightier!"', perk: 'Grows mighty with a full belly, dealing heavy melee damage.', health: 200, hunger: 200, sanity: 200 },
  { id: 'wendy', name: 'Wendy', title: 'The Bereaved', quote: '"Abigail, come back! I am not done playing with you."', perk: "Haunted by her twin sister Abigail's Flower; fears the dark less.", health: 150, hunger: 150, sanity: 200 },
  { id: 'wx78', name: 'WX-78', title: 'The Soulless Automaton', quote: '"EMPATHY MODULE NOT RESPONDING."', perk: 'Upgrades circuits and charges from lightning; damaged by moisture.', health: 125, hunger: 125, sanity: 150 },
  { id: 'wickerbottom', name: 'Ms. Wickerbottom', title: 'The Librarian', quote: '"Shhhh! No talking in the library!"', perk: 'Starts with Science Tier 1 unlocked and Papyrus for books.', health: 125, hunger: 150, sanity: 250 },
  { id: 'woodie', name: 'Woodie', title: 'The Lumberjack', quote: '"That is a nice looking tree, eh Lucy?"', perk: 'Starts with Lucy the sentient axe; chops trees rapidly.', health: 150, hunger: 150, sanity: 200 },
  { id: 'wes', name: 'Wes', title: 'The Silent', quote: '...', perk: 'Communicates through pantomime; a true survival challenge.', health: 75, hunger: 75, sanity: 75 },
  { id: 'waxwell', name: 'Maxwell', title: 'The Puppet Master', quote: '"Freedom, at last!"', perk: 'Dapper sanity regeneration and shadow magic mastery.', health: 75, hunger: 150, sanity: 200 },
  { id: 'wathgrithr', name: 'Wigfrid', title: 'The Performance Artist', quote: '"All the world is a stage, and I am the valkyrie!"', perk: 'Starts with Battle Spear, Battle Helm, and Meat; excels in combat.', health: 200, hunger: 120, sanity: 120 },
  { id: 'webber', name: 'Webber', title: 'The Indigestible', quote: '"We can overcome anything together!"', perk: 'Befriends spiders, walks on webbing, and starts with Monster Meat.', health: 175, hunger: 175, sanity: 100 },
  { id: 'winona', name: 'Winona', title: 'The Handywoman', quote: '"Anything can be fixed with enough elbow grease."', perk: 'Fast builder and craftswoman of industrial gadgets.', health: 150, hunger: 150, sanity: 200 },
  { id: 'warly', name: 'Warly', title: 'The Culinarian', quote: '"Bon appétit!"', perk: 'Master chef who seasons gourmet dishes in his Portable Crock Pot.', health: 150, hunger: 250, sanity: 200 },
  { id: 'wortox', name: 'Wortox', title: 'The Soul Starved', quote: '"Hyuyu! A prankster imp am I!"', perk: 'Hops through space using souls dropped by creatures.', health: 200, hunger: 175, sanity: 150 },
  { id: 'wormwood', name: 'Wormwood', title: 'The Lonesome', quote: '"Hello friend?"', perk: 'Plants seeds directly in soil without a farm; blooms in Spring.', health: 150, hunger: 150, sanity: 200 },
  { id: 'wurt', name: 'Wurt', title: 'The Half-Pint', quote: '"Florp! Mermfolk strong!"', perk: 'Vegetarian Merm who thrives in marshlands and builds Merm villages.', health: 150, hunger: 200, sanity: 150 },
  { id: 'walter', name: 'Walter', title: 'The Fearless', quote: '"Pinetree Pioneers are always prepared!"', perk: 'Starts with his Trusty Slingshot; loses no sanity from monsters.', health: 130, hunger: 110, sanity: 200 },
  { id: 'wanda', name: 'Wanda', title: 'The Timekeeper', quote: '"Time is slipping away!"', perk: 'Manipulates age and time using her Alarming Clock.', health: 150, hunger: 175, sanity: 200 },
];

interface RecipeDefinition {
  id: string;
  name: string;
  category: string;
  tech: number;
  isStructure?: boolean;
  desc: string;
  ingredients: Array<{ prefab: string; name: string; count: number }>;
}

interface CraftingCategory {
  id: string;
  label: string;
  iconKey: string;
}

const CRAFT_CATEGORIES: CraftingCategory[] = [
  { id: 'all', label: 'All Recipes', iconKey: 'filter_none' },
  { id: 'tools', label: 'Tools', iconKey: 'filter_tool' },
  { id: 'light', label: 'Light Sources', iconKey: 'filter_fire' },
  { id: 'survival', label: 'Survival', iconKey: 'filter_containers' },
  { id: 'food', label: 'Food & Gardening', iconKey: 'filter_gardening' },
  { id: 'science', label: 'Science', iconKey: 'filter_science' },
  { id: 'fight', label: 'Armour & Weapons', iconKey: 'filter_weapon' },
  { id: 'structures', label: 'Structures', iconKey: 'filter_structure' },
  { id: 'refine', label: 'Refined Materials', iconKey: 'filter_refine' },
  { id: 'magic', label: 'Shadow & Magic', iconKey: 'filter_skull' },
  { id: 'dress', label: 'Clothing', iconKey: 'filter_warable' },
];

const RECIPES: RecipeDefinition[] = [
  // Tools
  { id: 'axe', name: 'Axe', category: 'tools', tech: 0, desc: 'Chop down trees!', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 1 }, { prefab: 'flint', name: 'Flint', count: 1 }] },
  { id: 'goldenaxe', name: 'Luxury Axe', category: 'tools', tech: 1, desc: 'Chop down trees with style and four times the durability.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 4 }, { prefab: 'goldnugget', name: 'Gold Nugget', count: 2 }] },
  { id: 'pickaxe', name: 'Pickaxe', category: 'tools', tech: 0, desc: 'Break down rocks and boulders.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 2 }, { prefab: 'flint', name: 'Flint', count: 2 }] },
  { id: 'goldenpickaxe', name: 'Opulent Pickaxe', category: 'tools', tech: 1, desc: 'Break down rocks like a boss.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 4 }, { prefab: 'goldnugget', name: 'Gold Nugget', count: 2 }] },
  { id: 'shovel', name: 'Shovel', category: 'tools', tech: 1, desc: 'Dig up all sorts of things.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 2 }, { prefab: 'flint', name: 'Flint', count: 2 }] },
  { id: 'goldenshovel', name: 'Regal Shovel', category: 'tools', tech: 1, desc: 'Digs up the same stuff, but lasts longer.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 4 }, { prefab: 'goldnugget', name: 'Gold Nugget', count: 2 }] },
  { id: 'hammer', name: 'Hammer', category: 'tools', tech: 0, desc: 'Smash all kinds of things.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 3 }, { prefab: 'rocks', name: 'Rocks', count: 3 }, { prefab: 'cutgrass', name: 'Cut Grass', count: 6 }] },
  { id: 'compass', name: 'Compass', category: 'tools', tech: 0, desc: 'Points the way north.', ingredients: [{ prefab: 'goldnugget', name: 'Gold Nugget', count: 1 }, { prefab: 'papyrus', name: 'Papyrus', count: 1 }] },

  // Light
  { id: 'torch', name: 'Torch', category: 'light', tech: 0, desc: 'Portable light source to ward off the night.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 2 }, { prefab: 'twigs', name: 'Twigs', count: 2 }] },
  { id: 'campfire', name: 'Campfire', category: 'light', tech: 0, isStructure: true, desc: 'Provides light while burning, then turns to ash.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 3 }, { prefab: 'log', name: 'Log', count: 2 }] },
  { id: 'firepit', name: 'Fire Pit', category: 'light', tech: 0, isStructure: true, desc: 'A safer, more efficient permanent campfire.', ingredients: [{ prefab: 'log', name: 'Log', count: 2 }, { prefab: 'rocks', name: 'Rocks', count: 12 }] },
  { id: 'lantern', name: 'Lantern', category: 'light', tech: 2, desc: 'Refuelable, bright, portable light.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 3 }, { prefab: 'rope', name: 'Rope', count: 2 }] },
  { id: 'minerhat', name: 'Miner Hat', category: 'light', tech: 2, desc: 'Light up the night with your noggin.', ingredients: [{ prefab: 'strawhat', name: 'Straw Hat', count: 1 }, { prefab: 'goldnugget', name: 'Gold Nugget', count: 1 }] },

  // Survival
  { id: 'backpack', name: 'Backpack', category: 'survival', tech: 1, desc: 'Carry more stuff on your back.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 4 }, { prefab: 'twigs', name: 'Twigs', count: 4 }] },
  { id: 'trap', name: 'Trap', category: 'survival', tech: 0, desc: 'Capture small creatures like rabbits and spiders.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 6 }, { prefab: 'twigs', name: 'Twigs', count: 2 }] },
  { id: 'birdtrap', name: 'Bird Trap', category: 'survival', tech: 1, desc: 'Capture winged beasts.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 3 }, { prefab: 'silk', name: 'Silk', count: 4 }] },
  { id: 'bugnet', name: 'Bug Net', category: 'survival', tech: 1, desc: 'Catch bugs and fireflies.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 4 }, { prefab: 'silk', name: 'Silk', count: 2 }, { prefab: 'rope', name: 'Rope', count: 1 }] },
  { id: 'fishingrod', name: 'Freshwater Fishing Rod', category: 'survival', tech: 1, desc: 'Go fishing. For fish.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 2 }, { prefab: 'silk', name: 'Silk', count: 2 }] },
  { id: 'healingsalve', name: 'Healing Salve', category: 'survival', tech: 1, desc: 'Disinfectant for cuts and abrasions (+20 Health).', ingredients: [{ prefab: 'ash', name: 'Ashes', count: 2 }, { prefab: 'rocks', name: 'Rocks', count: 1 }, { prefab: 'spidergland', name: 'Spider Gland', count: 1 }] },
  { id: 'heatrock', name: 'Thermal Stone', category: 'survival', tech: 2, desc: 'Stores thermals for travel.', ingredients: [{ prefab: 'rocks', name: 'Rocks', count: 10 }, { prefab: 'pickaxe', name: 'Pickaxe', count: 1 }, { prefab: 'flint', name: 'Flint', count: 3 }] },
  { id: 'bedroll_straw', name: 'Straw Roll', category: 'survival', tech: 1, desc: 'Sleep the night away.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 6 }, { prefab: 'rope', name: 'Rope', count: 1 }] },

  // Food
  { id: 'cookpot', name: 'Crock Pot', category: 'food', tech: 1, isStructure: true, desc: 'Make better food from 4 ingredients.', ingredients: [{ prefab: 'cutstone', name: 'Cut Stone', count: 3 }, { prefab: 'charcoal', name: 'Charcoal', count: 6 }, { prefab: 'twigs', name: 'Twigs', count: 6 }] },
  { id: 'icebox', name: 'Ice Box', category: 'food', tech: 2, isStructure: true, desc: 'Slows food spoilage.', ingredients: [{ prefab: 'goldnugget', name: 'Gold Nugget', count: 2 }, { prefab: 'boards', name: 'Boards', count: 1 }, { prefab: 'cutstone', name: 'Cut Stone', count: 1 }] },
  { id: 'meatrack', name: 'Drying Rack', category: 'food', tech: 1, isStructure: true, desc: 'The rack of ages for drying jerky.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 3 }, { prefab: 'charcoal', name: 'Charcoal', count: 2 }, { prefab: 'rope', name: 'Rope', count: 3 }] },

  // Science
  { id: 'researchlab', name: 'Science Machine', category: 'science', tech: 0, isStructure: true, desc: 'Unlock new crafting recipes!', ingredients: [{ prefab: 'goldnugget', name: 'Gold Nugget', count: 1 }, { prefab: 'log', name: 'Log', count: 4 }, { prefab: 'rocks', name: 'Rocks', count: 4 }] },
  { id: 'researchlab2', name: 'Alchemy Engine', category: 'science', tech: 1, isStructure: true, desc: 'Unlock even more crafting recipes!', ingredients: [{ prefab: 'boards', name: 'Boards', count: 4 }, { prefab: 'cutstone', name: 'Cut Stone', count: 2 }, { prefab: 'goldnugget', name: 'Gold Nugget', count: 6 }] },

  // Fight
  { id: 'spear', name: 'Spear', category: 'fight', tech: 1, desc: 'Use the pointy end.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 2 }, { prefab: 'rope', name: 'Rope', count: 1 }, { prefab: 'flint', name: 'Flint', count: 1 }] },
  { id: 'hambat', name: 'Ham Bat', category: 'fight', tech: 2, desc: 'It takes food to make food.', ingredients: [{ prefab: 'twigs', name: 'Twigs', count: 2 }, { prefab: 'meat', name: 'Meat', count: 2 }] },
  { id: 'armorgrass', name: 'Grass Suit', category: 'fight', tech: 0, desc: 'Provides a small amount of protection.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 10 }, { prefab: 'twigs', name: 'Twigs', count: 2 }] },
  { id: 'armorwood', name: 'Log Suit', category: 'fight', tech: 1, desc: 'Protects you from some damage.', ingredients: [{ prefab: 'log', name: 'Log', count: 8 }, { prefab: 'rope', name: 'Rope', count: 2 }] },
  { id: 'armormarble', name: 'Marble Suit', category: 'fight', tech: 2, desc: 'It is heavy, but it will protect you.', ingredients: [{ prefab: 'cutstone', name: 'Cut Stone', count: 6 }, { prefab: 'rope', name: 'Rope', count: 2 }] },
  { id: 'footballhat', name: 'Football Helmet', category: 'fight', tech: 2, desc: 'Protect your braincase.', ingredients: [{ prefab: 'rope', name: 'Rope', count: 1 }, { prefab: 'rocks', name: 'Rocks', count: 2 }] },

  // Structures
  { id: 'treasurechest', name: 'Chest', category: 'structures', tech: 1, isStructure: true, desc: 'A sturdy container for your belongings.', ingredients: [{ prefab: 'boards', name: 'Boards', count: 3 }] },
  { id: 'homesign', name: 'Sign', category: 'structures', tech: 1, isStructure: true, desc: 'Make your mark upon the world.', ingredients: [{ prefab: 'boards', name: 'Boards', count: 1 }] },
  { id: 'pighouse', name: 'Pig House', category: 'structures', tech: 2, isStructure: true, desc: 'Shelters one pig.', ingredients: [{ prefab: 'boards', name: 'Boards', count: 4 }, { prefab: 'cutstone', name: 'Cut Stone', count: 3 }] },

  // Refine
  { id: 'rope', name: 'Rope', category: 'refine', tech: 1, desc: 'Tightly woven coils of usefulness.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 3 }] },
  { id: 'boards', name: 'Boards', category: 'refine', tech: 1, desc: 'Like logs, but flatter.', ingredients: [{ prefab: 'log', name: 'Log', count: 4 }] },
  { id: 'cutstone', name: 'Cut Stone', category: 'refine', tech: 1, desc: 'Nicely squared rocks.', ingredients: [{ prefab: 'rocks', name: 'Rocks', count: 3 }] },
  { id: 'papyrus', name: 'Papyrus', category: 'refine', tech: 1, desc: 'For writing things.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 4 }] },

  // Magic / Dress
  { id: 'flowerhat', name: 'Garland', category: 'dress', tech: 0, desc: 'Something to soothe the nerves.', ingredients: [{ prefab: 'petals', name: 'Petals', count: 12 }] },
  { id: 'strawhat', name: 'Straw Hat', category: 'dress', tech: 0, desc: 'Helps you stay cool and dry.', ingredients: [{ prefab: 'cutgrass', name: 'Cut Grass', count: 12 }] },
  { id: 'tophat', name: 'Top Hat', category: 'dress', tech: 1, desc: 'The classiest hat of all.', ingredients: [{ prefab: 'silk', name: 'Silk', count: 6 }] },
  { id: 'winterhat', name: 'Winter Hat', category: 'dress', tech: 2, desc: 'Keeps your noggin warm.', ingredients: [{ prefab: 'silk', name: 'Silk', count: 4 }, { prefab: 'cutgrass', name: 'Cut Grass', count: 4 }] },
  { id: 'cane', name: 'Walking Cane', category: 'dress', tech: 2, desc: 'Trot on with speed and poise.', ingredients: [{ prefab: 'goldnugget', name: 'Gold Nugget', count: 2 }, { prefab: 'twigs', name: 'Twigs', count: 4 }] },
];

const FAVORITE_RECIPES = new Set<string>(['axe', 'pickaxe', 'torch', 'campfire', 'spear']);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div class="app-shell">
 <section id="game-stage" class="game-stage" aria-label="Don't Starve Together Playable World">
  <canvas id="game-canvas" width="1280" height="720"></canvas>

  <!-- Cursor-Following Authentic Klei Hoverer (scripts/widgets/hoverer.lua) -->
  <div id="hud-hoverer" class="dst-hoverer hidden" aria-hidden="true"></div>

  <!-- 100% Authentic Klei PlayerHud Overlay (scripts/screens/playerhud.lua) -->
  <div class="hud-overlay">
   <div class="hud-top">
    <!-- Top-Left CraftingMenuHUD (scripts/widgets/redux/craftingmenu_hud.lua) -->
    <div id="hud-crafting-root" class="crafting-root">
     <button id="crafting-pinbar-toggle" class="crafting-pinbar-tab" title="Open/Close Crafting Menu (C)"></button>
     <div id="crafting-drawer" class="crafting-menu-widget">
      <div class="cm-frame-top"></div>
      <div class="cm-frame-body">
       <div id="crafting-dock" class="cm-filter-grid" role="tablist" aria-label="Crafting Filters"></div>
       <div class="cm-hbar"></div>
       <div id="recipe-grid" class="cm-recipe-grid"></div>
       <div class="cm-hbar"></div>
       <div id="recipe-detail-card" class="cm-details"></div>
       <!-- Hidden compatibility strip for automated tests -->
       <div class="hud-quick-craft-strip hidden" aria-hidden="true">
        <button class="craft-btn" data-craft="axe"><span>Axe</span></button>
        <button class="craft-btn" data-craft="pickaxe"><span>Pickaxe</span></button>
        <button class="craft-btn" data-craft="torch"><span>Torch</span></button>
        <button class="craft-btn" data-craft="campfire"><span>Campfire</span></button>
        <button class="craft-btn" data-craft="firepit"><span>Fire Pit</span></button>
        <button class="craft-btn" data-craft="spear"><span>Spear</span></button>
        <button class="craft-btn" data-craft="flowerhat"><span>Garland</span></button>
        <button class="craft-btn" data-craft="backpack"><span>Backpack</span></button>
       </div>
      </div>
      <div class="cm-frame-bottom"></div>
     </div>
    </div>

    <!-- Top-Right UIClock & Triangular StatusDisplays (scripts/widgets/uiclock.lua + statusdisplays.lua) -->
    <div class="hud-right-top">
     <div class="clock-widget" id="hud-clock-widget">
      <canvas id="hud-clock-canvas" width="144" height="144"></canvas>
     </div>

     <!-- Triangular StatusDisplays: Stomach (-38, 0), Heart (+38, 0), Brain (0, 52), Moisture (0, 114) -->
     <div class="status-displays-triangle">
      <div id="badge-hunger" class="status-badge hunger" style="--fill-pct:100%" data-hover-title="Hunger">
       <div class="badge-fill"></div>
       <span class="badge-icon"></span>
       <span id="hud-hunger" class="vital-value">150</span>
      </div>
      <div id="badge-health" class="status-badge health" style="--fill-pct:100%" data-hover-title="Health">
       <div class="badge-fill"></div>
       <span class="badge-icon"></span>
       <span id="hud-health" class="vital-value">150</span>
      </div>
      <div id="badge-sanity" class="status-badge sanity" style="--fill-pct:100%" data-hover-title="Sanity">
       <div class="badge-fill"></div>
       <span class="badge-icon"></span>
       <span id="hud-sanity" class="vital-value">200</span>
      </div>
      <div id="badge-climate" class="status-badge moisture" style="--fill-pct:0%" data-hover-title="Wetness">
       <div class="badge-fill"></div>
       <span class="badge-icon"></span>
       <span id="hud-moisture" class="vital-value">0</span>
      </div>
     </div>
    </div>
   </div>

   <!-- Bottom-Center Arched InventoryBar + Open Container/Backpack & Bottom-Right MapControls -->
   <div class="hud-bottom">
    <div id="hud-notice" class="hidden" aria-hidden="true"></div>
    <div id="hud-temp" class="hidden" aria-hidden="true"></div>
    <div id="hud-clock-phase" class="hidden" aria-hidden="true"></div>
    <div id="hud-clock-season" class="hidden" aria-hidden="true"></div>

    <!-- Open World Container (Chest / Crock Pot / Ice Box) or Backpack (scripts/widgets/containerwidget.lua) -->
    <div class="container-popups-row">
     <div id="hud-open-container" class="dst-container-widget hidden" aria-label="Container"></div>
     <div id="hud-backpack" class="dst-container-widget hidden" aria-label="Backpack"></div>
    </div>

    <div class="inventory-dock-row">
     <div id="hud-inventory" class="hud-inventory"></div>
    </div>

    <!-- Bottom-Right MapControls (scripts/widgets/mapcontrols.lua) -->
    <div class="map-controls-root" aria-label="Map Controls">
     <div class="map-controls-rot-row">
      <button id="cam-rot-left" class="klei-img-btn rot-left" data-hover-title="Rotate Camera Left (Q)"></button>
      <button id="cam-rot-right" class="klei-img-btn rot-right" data-hover-title="Rotate Camera Right (E)"></button>
     </div>
     <div class="map-controls-main-row">
      <button id="hud-open-map" class="klei-img-btn map-btn" data-hover-title="Map (M / Tab)"></button>
      <button id="hud-open-pause" class="klei-img-btn pause-btn" data-hover-title="Pause (Esc)"></button>
     </div>
    </div>
   </div>
  </div>

  <!-- Bottom-Left Floating Technical Drawer Toggle (F12) -->
  <div class="diag-fab">
   <button id="toggle-diag-drawer" class="klei-subtle-diag" title="WASM Diagnostics Workbench (F12)">F12</button>
  </div>

  <!-- Main Screen / Character Selection Overlay (scripts/screens/redux/lobbyscreen.lua) -->
  <div id="main-screen-overlay" class="screen-modal">
   <div class="dst-card dst-lobby-card">
    <div class="dst-title-eyebrow">Klei Entertainment · Don't Starve Together</div>
    <h1 class="dst-title-heading">Choose Your Survivor</h1>
    <div class="lobby-layout">
     <div id="char-roster-grid" class="char-roster-grid" role="listbox" aria-label="Playable Characters"></div>
     <div class="char-details-box">
      <div class="character-hero-box">
       <div id="title-wilson-avatar" class="character-avatar-frame"></div>
       <div>
        <div id="title-char-name" class="char-detail-name">Wilson P. Higgsbury</div>
        <div id="title-char-title" class="char-detail-title">The Gentleman Scientist</div>
        <div id="title-char-quote" class="char-detail-quote">"I will conquer this world with the power of my MIND!"</div>
        <div id="title-char-stats" class="char-detail-stats">Health: 150 · Hunger: 150 · Sanity: 200</div>
        <div id="title-char-perk" class="char-detail-perk">Grows a magnificent insulating beard.</div>
       </div>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:12px">
       <div class="row">
        <button id="play-game" class="klei-carny-xlong-btn">Start World</button>
        <button id="load-saved-world-btn" class="klei-carny-long-btn">Load Saved World</button>
       </div>
       <label style="display:inline-flex;align-items:center;gap:6px;margin:0;color:#ebd9b4;cursor:pointer;font-size:12.5px">
        <input id="title-creative-check" type="checkbox" style="width:auto"> Free Crafting Mode
       </label>
       <button id="open-diag-from-title" class="secondary" style="padding:6px 10px;font-size:12px">WASM Diag (F12)</button>
      </div>
     </div>
    </div>
   </div>
  </div>

  <!-- Full-Screen Interactive MapScreen Modal (scripts/screens/mapscreen.lua) -->
  <div id="map-screen-modal" class="screen-modal hidden" role="dialog" aria-label="Map">
   <div class="map-modal-card">
    <canvas id="map-screen-canvas" width="1280" height="720"></canvas>
    <div class="map-controls-root" style="z-index:5">
     <div class="map-controls-rot-row">
      <button id="map-zoom-in" class="klei-img-btn rot-left" data-hover-title="Zoom In">+</button>
      <button id="map-zoom-out" class="klei-img-btn rot-right" data-hover-title="Zoom Out">−</button>
      <button id="map-reset-view" class="klei-img-btn" data-hover-title="Center Map">⟲</button>
     </div>
     <div class="map-controls-main-row">
      <button id="map-close-btn" class="klei-img-btn map-btn" data-hover-title="Close Map (M / Esc)"></button>
     </div>
    </div>
   </div>
  </div>

  <!-- Pause / Server Control Modal (scripts/screens/redux/pausescreen.lua) -->
  <div id="pause-screen-modal" class="screen-modal hidden" role="dialog" aria-label="Pause Menu">
   <div class="dst-card" style="max-width:420px;text-align:center">
    <h2 style="font-family:Georgia,serif;font-size:24px;color:#f5dca0;margin:4px 0 14px">Paused</h2>
    <div style="display:flex;flex-direction:column;gap:8px;align-items:center">
     <button id="pause-resume-btn" class="klei-carny-xlong-btn" style="width:100%">Continue</button>
     <button id="pause-save-world-btn" class="klei-carny-xlong-btn" style="width:100%">Save World</button>
     <button id="pause-load-world-btn" class="klei-carny-xlong-btn" style="width:100%">Load World</button>
     <button id="pause-creative-btn" class="klei-carny-xlong-btn" style="width:100%">Toggle Free Crafting</button>
     <button id="pause-starter-kit-btn" class="klei-carny-xlong-btn" style="width:100%">Supply Starter Kit</button>
     <button id="pause-next-phase-btn" class="klei-carny-xlong-btn" style="width:100%">Advance Time Phase</button>
     <button id="pause-change-char-btn" class="klei-carny-xlong-btn" style="width:100%">Change Survivor</button>
     <button id="pause-open-diag-btn" class="klei-carny-xlong-btn" style="width:100%">WASM Diagnostics (F12)</button>
    </div>
   </div>
  </div>

  <!-- Hidden legacy buttons so existing bindings never fail -->
  <div class="hidden" aria-hidden="true">
   <button id="hud-toggle-creative"></button>
   <button id="hud-next-phase"></button>
   <button id="cam-zoom-in"></button>
   <button id="cam-zoom-out"></button>
  </div>

  <!-- Collapsible Diagnostics Workbench Drawer (F12) -->
  <aside id="diag-drawer" class="diag-drawer hidden" aria-label="WASM Diagnostics">
   <div class="row" style="justify-content:space-between;margin-bottom:14px">
    <div>
     <div class="dst-title-eyebrow">Don't Starve Together · Build 756039</div>
     <h2 style="margin:4px 0 0;color:#f4d78c">WASM Diagnostics Workbench</h2>
    </div>
    <button id="close-diag-drawer" class="secondary">✕ Close (F12)</button>
   </div>
   <div class="grid">
    <section class="panel viewer">
     <canvas id="preview" width="800" height="600" aria-label="Original Wilson animation preview"></canvas>
     <span class="caption">BILD v6 / ANIM v4 · original Wilson / player_basic · WebGL2</span>
    </section>
    <section class="panel">
     <h2>Host & Runtime Diagnostics</h2>
     <p class="small">Three dedicated Workers: client, Master, and Caves.</p>
     <div class="row"><button id="start">Boot WASM</button><button id="pause" class="secondary" disabled>Pause</button></div>
     <div class="workers"><span id="worker-client" class="worker">Client</span><span id="worker-master" class="worker">Master</span><span id="worker-caves" class="worker">Caves</span></div>
     <div id="status" class="status" role="status">Idle.</div>
     <div class="metrics"><div class="metric"><span>Simulation tick</span><strong id="tick">—</strong></div><div class="metric"><span>Finite uses</span><strong id="uses">—</strong></div><div class="metric"><span>RTC peers</span><strong id="peers">0</strong></div></div>
     <div class="row"><button id="consume" disabled>Use(5)</button><button id="test" class="secondary" disabled>Verify runtime</button><button id="audio" class="secondary" disabled>Probe native audio</button></div>
     <div id="tests"></div>
     <label for="signal-url">Signaling URL</label><input id="signal-url" value="ws://127.0.0.1:8787/signal">
     <label for="ice">ICE servers (JSON)</label><textarea id="ice" rows="2">[]</textarea>
     <label for="join-code">Invite code</label><input id="join-code" placeholder="room.token" autocomplete="off">
     <div class="row" style="margin-top:12px"><button id="room" class="secondary" disabled>Create Room</button><button id="join" class="secondary">Join Room</button></div>
     <p id="invite"></p>
    </section>
    <section class="panel">
     <h2>Checkpoint Verification</h2>
     <p class="small">Atomic Master + Caves checkpoint in IndexedDB.</p>
     <div class="row"><button id="save" disabled>Save Checkpoint</button><button id="restore" class="secondary" disabled>Restore</button><button id="export" class="secondary" disabled>Export ZIP</button><button id="import" class="secondary" disabled>Import ZIP</button><button id="inspect-native" class="secondary" disabled>Inspect Native Save</button></div>
     <input id="backup-file" class="file" type="file" accept=".zip"><input id="native-file" class="file" type="file">
     <p id="save-status" class="small">Not saved.</p><pre id="native-result" class="small"></pre>
    </section>
    <section class="panel">
     <h2>Runtime Log</h2>
     <pre id="log" class="log" aria-label="Runtime log"></pre>
    </section>
   </div>
  </aside>
 </section>
</div>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => element<HTMLButtonElement>(id);
function log(message: string) {
  const box = element('log');
  if (!box) return;
  box.textContent = (box.textContent + '\n' + message).trim().split('\n').slice(-120).join('\n');
  box.scrollTop = box.scrollHeight;
}
function status(message: string) {
  const st = element('status');
  if (st) st.textContent = message;
  log(message);
}

const database = await new Checkpoints().open();
const workers = new Map<Role, EngineWorker>();
const dstAudio = new DstAudioEngine();
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

// UI State for 100% Authentic Klei HUD
let selectedCharacter = 'wilson';
let selectedCategory = 'tools';
let selectedRecipeId = 'axe';
let craftingDrawerOpen = true;
let mapModalOpen = false;
let pauseModalOpen = false;
let mapZoom = 1.0;
let mapPanX = 0;
let mapPanY = 0;
let mapDragging = false;
let mapDragStartX = 0;
let mapDragStartY = 0;
let uiHoverText = '';

const gameCanvas = element<HTMLCanvasElement>('game-canvas');
const clockCanvas = element<HTMLCanvasElement>('hud-clock-canvas');
const mapScreenCanvas = element<HTMLCanvasElement>('map-screen-canvas');
const hovererEl = element<HTMLDivElement>('hud-hoverer');

function syncViewportCanvasSize() {
  const w = Math.max(960, Math.min(1920, window.innerWidth || 1280));
  const h = Math.max(540, Math.min(1080, window.innerHeight || 720));
  if (gameCanvas.width !== w || gameCanvas.height !== h) {
    gameCanvas.width = w;
    gameCanvas.height = h;
  }
  if (mapScreenCanvas.width !== w || mapScreenCanvas.height !== h) {
    mapScreenCanvas.width = w;
    mapScreenCanvas.height = h;
  }
}
syncViewportCanvasSize();
window.addEventListener('resize', syncViewportCanvasSize);

const assetQueue: Array<{ prefab: string; build: string; bank: string }> = [];
let assetPumpActive = false;

async function pumpAnimAssets() {
  if (assetPumpActive) return;
  assetPumpActive = true;
  try {
    while (assetQueue.length > 0) {
      const worker = workers.get('master') ?? workers.get('client');
      if (!worker) break;
      const next = assetQueue.shift()!;
      try {
        const payload = await worker.request('load-anim-asset', next);
        gameRenderer.ingestAnimAsset(next.prefab, next.build, next.bank, payload);
      } catch {
        gameRenderer.ingestAnimAsset(next.prefab, next.build, next.bank, null);
      }
      await new Promise(r => setTimeout(r, 8));
    }
  } finally {
    assetPumpActive = false;
  }
}

const gameRenderer = new GameRenderer(gameCanvas, null, (prefab, build, bank) => {
  if (prefab === selectedCharacter || build === selectedCharacter || prefab === 'multiplayer_portal') {
    assetQueue.unshift({ prefab, build, bank });
  } else {
    assetQueue.push({ prefab, build, bank });
  }
  void pumpAnimAssets();
});

function resolveIconKey(prefab: string): string {
  if (prefab === 'red_mushroom') return 'red_cap';
  if (prefab === 'green_mushroom') return 'green_cap';
  if (prefab === 'blue_mushroom') return 'blue_cap';
  if (prefab === 'flower') return 'petals';
  return prefab;
}

function formatSlotIconHtml(prefab: string, emptyFallback = ''): string {
  if (!prefab) return emptyFallback;
  const url = gameRenderer.getIconDataUrl(resolveIconKey(prefab));
  if (url) {
    return `<img class="real-inv-icon" src="${url}" alt="${prefab}">`;
  }
  return '';
}

function hasRecipeIngredients(recipe: RecipeDefinition, scene?: GameSceneSnapshot): boolean {
  if (scene?.player?.creativeMode) return true;
  const counts = scene?.player?.ingredientCounts ?? {};
  return recipe.ingredients.every(ing => (counts[ing.prefab] ?? 0) >= ing.count);
}

function renderCharacterRoster() {
  const grid = element('char-roster-grid');
  if (!grid) return;
  grid.innerHTML = CHARACTER_ROSTER.map(ch => {
    const avatarUrl = gameRenderer.getIconDataUrl(`avatar_${ch.id}`);
    const active = ch.id === selectedCharacter ? 'selected' : '';
    const imgHtml = avatarUrl ? `<img src="${avatarUrl}" alt="${ch.name}">` : `<span>${ch.name.slice(0, 2)}</span>`;
    return `<button class="char-select-slot ${active}" data-char-select="${ch.id}" title="${ch.name} (${ch.title})">${imgHtml}</button>`;
  }).join('');

  const cur = CHARACTER_ROSTER.find(c => c.id === selectedCharacter) ?? CHARACTER_ROSTER[0];
  const heroAvatarUrl = gameRenderer.getIconDataUrl(`avatar_${cur.id}`) || gameRenderer.getIconDataUrl(`self_inspect_${cur.id}`);
  element('title-wilson-avatar').innerHTML = heroAvatarUrl ? `<img src="${heroAvatarUrl}" alt="${cur.name}">` : '';
  element('title-char-name').textContent = cur.name;
  element('title-char-title').textContent = cur.title;
  element('title-char-quote').textContent = cur.quote;
  element('title-char-stats').textContent = `Health: ${cur.health} · Hunger: ${cur.hunger} · Sanity: ${cur.sanity}`;
  element('title-char-perk').textContent = cur.perk;
}

element('char-roster-grid')?.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-char-select]');
  if (!btn) return;
  selectedCharacter = btn.dataset.charSelect!;
  dstAudio.playEvents([{ path: 'dontstarve/HUD/click_move' }]);
  renderCharacterRoster();
});

function renderCraftingHud(scene?: GameSceneSnapshot) {
  const dock = element('crafting-dock');
  // 1. Authentic Klei Filter Grid (icon-only filterslot_bg + filterslot_frame + filter_*.tex)
  dock.innerHTML = CRAFT_CATEGORIES.map(cat => {
    const iconUrl = gameRenderer.getIconDataUrl(cat.iconKey);
    const active = selectedCategory === cat.id ? 'active' : '';
    const iconHtml = iconUrl ? `<img src="${iconUrl}" alt="${cat.label}">` : '';
    return `<button class="cm-filter-slot ${active}" data-cat="${cat.id}" data-hover-title="${cat.label}"><span class="cm-filter-frame"></span>${iconHtml}</button>`;
  }).join('');

  const drawer = element('crafting-drawer');
  drawer.classList.toggle('collapsed', !craftingDrawerOpen);

  const isCreative = Boolean(scene?.player?.creativeMode);
  const scienceTier = scene?.player?.scienceTier ?? 0;

  const catRecipes = selectedCategory === 'all'
    ? RECIPES
    : RECIPES.filter(r => r.category === selectedCategory);
  if (!catRecipes.some(r => r.id === selectedRecipeId) && catRecipes.length > 0) {
    selectedRecipeId = catRecipes[0].id;
  }

  // 2. Authentic Klei 7x3 Recipe Grid (slot_bg + slot_frame + item icon + lock overlay, NO text inside slots)
  const grid = element('recipe-grid');
  const paddedSlots = Math.max(21, Math.ceil(catRecipes.length / 7) * 7);
  const gridHtml: string[] = [];
  for (let i = 0; i < paddedSlots; ++i) {
    const r = catRecipes[i];
    if (!r) {
      gridHtml.push(`<div class="cm-recipe-slot empty"><span class="cm-slot-frame"></span></div>`);
      continue;
    }
    const iconUrl = gameRenderer.getIconDataUrl(r.id);
    const canCraft = hasRecipeIngredients(r, scene);
    const locked = !isCreative && r.tech > scienceTier;
    const selected = r.id === selectedRecipeId ? 'selected' : '';
    const statusCls = canCraft && !locked ? 'can-craft' : locked ? 'locked' : 'missing-ing';
    const iconHtml = iconUrl ? `<img class="cm-item-img" src="${iconUrl}" alt="${r.name}">` : '';
    const lockHtml = locked ? `<span class="cm-slot-lock"></span>` : '';
    gridHtml.push(
      `<button class="cm-recipe-slot ${statusCls} ${selected}" data-recipe-select="${r.id}" data-hover-title="${r.name}"><span class="cm-slot-frame"></span>${iconHtml}${lockHtml}</button>`,
    );
  }
  grid.innerHTML = gridHtml.join('');

  // 3. Authentic Klei CraftingMenuDetails (favorite star, header name, 2-line desc, IngredientUI squares, Carny build button)
  const activeRecipe = RECIPES.find(r => r.id === selectedRecipeId) ?? catRecipes[0] ?? RECIPES[0];
  const detail = element('recipe-detail-card');
  const counts = scene?.player?.ingredientCounts ?? {};
  const isFav = FAVORITE_RECIPES.has(activeRecipe.id);

  const ingHtml = activeRecipe.ingredients.map(ing => {
    const have = counts[ing.prefab] ?? 0;
    const enough = isCreative || have >= ing.count;
    const ingUrl = gameRenderer.getIconDataUrl(resolveIconKey(ing.prefab));
    const ingIcon = ingUrl ? `<img src="${ingUrl}" alt="${ing.name}">` : '';
    return `<div class="klei-ing-slot ${enough ? 'ok' : 'missing'}" data-hover-title="${ing.name} (${have}/${ing.count})">${ingIcon}<span class="klei-ing-count">${have}/${ing.count}</span></div>`;
  }).join('');

  const canMake = hasRecipeIngredients(activeRecipe, scene);
  const actionLabel = activeRecipe.isStructure
    ? gameRenderer.pendingBuildPrefab === activeRecipe.id
      ? 'Click Ground to Place'
      : 'Build Structure'
    : 'Build';

  detail.innerHTML = `
    <div class="cm-details-header">
      <button class="cm-fav-btn ${isFav ? 'checked' : ''}" data-fav-toggle="${activeRecipe.id}" data-hover-title="Pin / Favorite Recipe"></button>
      <div class="cm-details-title">${activeRecipe.name}</div>
    </div>
    <div class="cm-details-desc">${activeRecipe.desc}</div>
    <div class="cm-details-ings">${ingHtml}</div>
    <button id="craft-selected-btn" class="klei-carny-long-btn ${canMake ? '' : 'craft-assist'}" data-craft-exec="${activeRecipe.id}">
      ${actionLabel}
    </button>
  `;
}

function applyKleiHudTextures() {
  const rootStyle = document.documentElement.style;
  const cssTexMap: Array<[string, string]> = [
    ['--tex-inv-slot', 'inv_slot'],
    ['--tex-inv-slot-Spoiled', 'spoilage_bg'],
    ['--tex-res-needed', 'resource_needed'],
    ['--tex-equip-slot', 'equip_slot'],
    ['--tex-inv-bg', 'inventory_bg'],
    ['--tex-inv-bg-cover', 'inventory_bg_cover'],
    ['--tex-chest-9slot', 'chest_bg_9slot'],
    ['--tex-badge-frame', 'badge_frame_circle'],
    ['--tex-badge-bg', 'badge_bg'],
    ['--tex-cm-top', 'cm_top'],
    ['--tex-cm-bottom', 'cm_bottom'],
    ['--tex-cm-side', 'cm_side'],
    ['--tex-cm-backing', 'cm_backing'],
    ['--tex-cm-hbar', 'cm_hbar'],
    ['--tex-cm-tab', 'cm_tab'],
    ['--tex-cm-filterslot-bg', 'cm_filterslot_bg'],
    ['--tex-cm-filterslot-bg-hi', 'cm_filterslot_bg_hi'],
    ['--tex-cm-filterslot-frame', 'cm_filterslot_frame'],
    ['--tex-cm-filterslot-frame-sel', 'cm_filterslot_frame_select'],
    ['--tex-cm-slot-bg', 'cm_slot_bg'],
    ['--tex-cm-slot-bg-ing', 'cm_slot_bg_missing'],
    ['--tex-cm-slot-fg-lock', 'cm_slot_fg_lock'],
    ['--tex-cm-slot-frame', 'cm_slot_frame'],
    ['--tex-cm-slot-frame-hi', 'cm_slot_frame_hi'],
    ['--tex-cm-slot-frame-sel', 'cm_slot_frame_select'],
    ['--tex-cm-fav-on', 'cm_fav_checked'],
    ['--tex-cm-fav-off', 'cm_fav_unchecked'],
    ['--tex-btn-carny-long', 'btn_carny_long_normal'],
    ['--tex-btn-carny-long-over', 'btn_carny_long_over'],
    ['--tex-btn-carny-long-down', 'btn_carny_long_down'],
    ['--tex-btn-carny-long-dis', 'btn_carny_long_disabled'],
    ['--tex-btn-carny-xlong', 'btn_carny_xlong_normal'],
    ['--tex-btn-carny-xlong-over', 'btn_carny_xlong_over'],
    ['--tex-char-select-bg', 'char_selection_bg'],
    ['--tex-textbox-gold', 'textbox_gold'],
    ['--tex-map-btn', 'map_button'],
    ['--tex-pause-btn', 'pause'],
    ['--tex-turnarrow', 'turnarrow_icon'],
    ['--tex-turnarrow-over', 'turnarrow_icon_over'],
  ];
  for (const [cssVar, iconKey] of cssTexMap) {
    const texUrl = gameRenderer.getIconDataUrl(iconKey);
    if (texUrl) {
      rootStyle.setProperty(cssVar, `url("${texUrl}")`);
    }
  }

  // Populate real Klei status badge icons (status_hunger, status_sanity, status_health, status_wet)
  const badgeIconMap: Array<[string, string, string]> = [
    ['badge-hunger', 'status_hunger_icon', 'badge_hunger'],
    ['badge-sanity', 'status_sanity_icon', 'badge_sanity'],
    ['badge-health', 'status_health_icon', 'badge_health'],
    ['badge-climate', 'badge_wet', 'badge_temp'],
  ];
  for (const [badgeId, primaryKey, fallbackKey] of badgeIconMap) {
    const url = gameRenderer.getIconDataUrl(primaryKey) || gameRenderer.getIconDataUrl(fallbackKey);
    const iconSpan = document.querySelector(`#${badgeId} .badge-icon`);
    if (url && iconSpan) {
      iconSpan.innerHTML = `<img src="${url}" alt="">`;
    }
  }

  renderCharacterRoster();
}

function renderItemTileHtml(
  item?: { prefab: string; name: string; count: number; uses?: number; percent?: number; spoiled?: boolean },
  emptyHtml = '',
): string {
  if (!item) {
    return `<span class="slot-icon">${emptyHtml}</span>`;
  }
  const icon = formatSlotIconHtml(item.prefab);
  const pct = item.percent ?? item.uses;
  const qtyText = item.count > 1 ? String(item.count) : '';
  const pctText = pct !== undefined ? `${pct}%` : '';
  const spoilClass = item.spoiled ? 'has-spoilage' : '';
  return `
    ${spoilClass ? '<span class="itemtile-spoilage-bg"></span>' : ''}
    <span class="slot-icon">${icon}</span>
    ${qtyText ? `<span class="itemtile-qty">${qtyText}</span>` : ''}
    ${pctText ? `<span class="itemtile-pct">${pctText}</span>` : ''}
  `;
}

function renderInventoryHud(scene?: GameSceneSnapshot) {
  const bar = element('hud-inventory');
  const invMap = new Map<number, { prefab: string; name: string; count: number; uses?: number; percent?: number; spoiled?: boolean }>();
  if (scene?.player?.inventory) {
    for (const item of scene.player.inventory) invMap.set(item.slot, item);
  }

  // Authentic Klei InventoryBar: 15 InvSlots grouped into 3 sets of 5 (1..5, 6..10, 11..15)
  const groupsHtml: string[] = [];
  for (let g = 0; g < 3; ++g) {
    const groupSlots: string[] = [];
    for (let i = 1; i <= 5; ++i) {
      const s = g * 5 + i;
      const item = invMap.get(s);
      const hover = item
        ? `${formatPrefabName(item.prefab)}\nLMB: Use / Equip   RMB: Examine / Drop`
        : '';
      groupSlots.push(
        `<div class="inv-slot" data-slot="${s}" data-hover-title="${hover}">${renderItemTileHtml(item)}</div>`,
      );
    }
    groupsHtml.push(`<div class="inv-slot-group">${groupSlots.join('')}</div>`);
  }

  // 3 Equipment Slots (Hands, Body, Head) + Self-Inspect Button
  const eqHand = scene?.player?.equippedHand || '';
  const eqBody = scene?.player?.equippedBody || '';
  const eqHead = scene?.player?.equippedHead || '';
  const handPct = scene?.player?.equipped?.hands?.percent;
  const bodyPct = scene?.player?.equipped?.body?.percent;
  const headPct = scene?.player?.equipped?.head?.percent;

  const handSilUrl = gameRenderer.getIconDataUrl('equip_slot_hud');
  const bodySilUrl = gameRenderer.getIconDataUrl('equip_slot_body_hud');
  const headSilUrl = gameRenderer.getIconDataUrl('equip_slot_head_hud');

  const handEmpty = handSilUrl ? `<img class="equip-silhouette" src="${handSilUrl}" alt="">` : '';
  const bodyEmpty = bodySilUrl ? `<img class="equip-silhouette" src="${bodySilUrl}" alt="">` : '';
  const headEmpty = headSilUrl ? `<img class="equip-silhouette" src="${headSilUrl}" alt="">` : '';

  const handItem = eqHand ? { prefab: eqHand, name: eqHand, count: 1, percent: handPct } : undefined;
  const bodyItem = eqBody ? { prefab: eqBody, name: eqBody, count: 1, percent: bodyPct } : undefined;
  const headItem = eqHead ? { prefab: eqHead, name: eqHead, count: 1, percent: headPct } : undefined;

  const charPrefab = scene?.player?.prefab || selectedCharacter || 'wilson';
  const inspectUrl =
    gameRenderer.getIconDataUrl(`self_inspect_${charPrefab}`) ||
    gameRenderer.getIconDataUrl('self_inspect_wilson');
  const inspectImg = inspectUrl ? `<img src="${inspectUrl}" alt="Inspect Self">` : '';

  groupsHtml.push(`
    <div class="inv-equip-group">
      <div class="inv-slot equip" data-equip-slot="hands" data-hover-title="${eqHand ? `${formatPrefabName(eqHand)}\nLMB: Unequip   RMB: Examine` : 'Hands'}">${renderItemTileHtml(handItem, handEmpty)}</div>
      <div class="inv-slot equip" data-equip-slot="body" data-hover-title="${eqBody ? `${formatPrefabName(eqBody)}\nLMB: Unequip   RMB: Examine` : 'Body'}">${renderItemTileHtml(bodyItem, bodyEmpty)}</div>
      <div class="inv-slot equip" data-equip-slot="head" data-hover-title="${eqHead ? `${formatPrefabName(eqHead)}\nLMB: Unequip   RMB: Examine` : 'Head'}">${renderItemTileHtml(headItem, headEmpty)}</div>
      <button id="hud-self-inspect" class="self-inspect-btn" data-hover-title="Inspect ${formatPrefabName(charPrefab)} (I)">${inspectImg}</button>
    </div>
  `);

  bar.innerHTML = groupsHtml.join('');

  // Render Open World Container (Chest 3x3 / Ice Box 3x3 / Crock Pot 4-slot)
  const contBox = element('hud-open-container');
  const openCont = scene?.player?.openContainer;
  if (openCont) {
    contBox.classList.remove('hidden');
    const cMap = new Map<number, { prefab: string; name: string; count: number; percent?: number; spoiled?: boolean }>();
    for (const ci of openCont.slots ?? []) cMap.set(ci.slot, ci);
    const numSlots = openCont.numSlots || 9;
    const cSlots: string[] = [];
    for (let cs = 1; cs <= numSlots; ++cs) {
      const citem = cMap.get(cs);
      const hover = citem ? `${formatPrefabName(citem.prefab)}\nLMB: Take to Inventory` : `${formatPrefabName(openCont.prefab)} Slot ${cs}`;
      cSlots.push(
        `<div class="inv-slot" data-container-slot="${cs}" data-hover-title="${hover}">${renderItemTileHtml(citem)}</div>`,
      );
    }
    const cookBtnHtml = openCont.isCooker
      ? `<button id="container-cook-btn" class="klei-carny-long-btn container-cook-btn" data-container-cook="${openCont.guid}">Cook</button>`
      : '';
    contBox.innerHTML = `
      <div class="container-grid ${openCont.isCooker ? 'cooker-grid' : 'chest-grid'}">${cSlots.join('')}</div>
      ${cookBtnHtml}
    `;
  } else {
    contBox.classList.add('hidden');
  }

  // Render Open Backpack Container Panel if equippedBody == 'backpack'
  const bpBox = element('hud-backpack');
  if (eqBody === 'backpack') {
    bpBox.classList.remove('hidden');
    const bpMap = new Map<number, { prefab: string; name: string; count: number; percent?: number; spoiled?: boolean }>();
    for (const bitem of scene?.player?.backpackSlots ?? []) {
      bpMap.set(bitem.slot, bitem);
    }
    const bpHtml: string[] = [];
    for (let bs = 1; bs <= 8; ++bs) {
      const bitem = bpMap.get(bs);
      const hover = bitem ? `${formatPrefabName(bitem.prefab)}\nLMB: Use / Move` : `Backpack Slot ${bs}`;
      bpHtml.push(
        `<div class="inv-slot" data-backpack-slot="${bs}" data-hover-title="${hover}">${renderItemTileHtml(bitem)}</div>`,
      );
    }
    bpBox.innerHTML = `<div class="container-grid backpack-grid">${bpHtml.join('')}</div>`;
  } else {
    bpBox.classList.add('hidden');
  }
}

renderCharacterRoster();
renderCraftingHud();
renderInventoryHud();

function updateHovererPositionAndText(clientX?: number, clientY?: number) {
  if (clientX !== undefined && clientY !== undefined) {
    hovererEl.style.left = `${clientX}px`;
    hovererEl.style.top = `${Math.max(24, clientY - 28)}px`;
  }
  let text = uiHoverText;
  if (!text && gameMode) {
    if (gameRenderer.pendingBuildPrefab) {
      text = `${formatPrefabName(gameRenderer.pendingBuildPrefab)}\nLMB: Place   RMB: Cancel`;
    } else if (gameRenderer.hoveredEntity) {
      const ent = gameRenderer.hoveredEntity.entity;
      const title = formatPrefabName(ent.prefab);
      const act = defaultActionForEntity(ent, gameScene?.player.equippedHand ?? '');
      text = `${title}\nLMB: ${act.label}   RMB: Examine`;
    }
  }
  if (text) {
    hovererEl.textContent = text;
    hovererEl.classList.remove('hidden');
  } else {
    hovererEl.classList.add('hidden');
  }
}

window.addEventListener('mousemove', e => {
  const target = e.target as HTMLElement | null;
  const hoverEl = target?.closest<HTMLElement>('[data-hover-title]');
  uiHoverText = hoverEl?.dataset.hoverTitle || '';
  updateHovererPositionAndText(e.clientX, e.clientY);
});

element('hud-clock-widget')?.addEventListener('mouseenter', () => {
  gameRenderer.clockHovered = true;
  if (gameScene) gameRenderer.renderWorldClock(clockCanvas, gameScene);
});
element('hud-clock-widget')?.addEventListener('mouseleave', () => {
  gameRenderer.clockHovered = false;
  if (gameScene) gameRenderer.renderWorldClock(clockCanvas, gameScene);
});

function updateGameHud(scene: GameSceneSnapshot) {
  gameScene = scene;
  gameRenderer.pushSnapshot(scene);
  element('tick').textContent = String(scene.tick);
  const p = scene.player;

  // Play streamed engine sound events and update ambient loop
  if (scene.soundEvents?.length) {
    dstAudio.playEvents(scene.soundEvents, p.prefab || selectedCharacter);
  }
  dstAudio.updateAmbient(scene.clock.phase);

  // Update circular status meters (integer only, matching scripts/widgets/badge.lua)
  const healthPct = Math.max(0, Math.min(100, Math.round((p.health / Math.max(1, p.maxHealth)) * 100)));
  const hungerPct = Math.max(0, Math.min(100, Math.round((p.hunger / Math.max(1, p.maxHunger)) * 100)));
  const sanityPct = Math.max(0, Math.min(100, Math.round((p.sanity / Math.max(1, p.maxSanity)) * 100)));
  const moistPct = Math.max(0, Math.min(100, Math.round(p.moisture || 0)));

  element('badge-health').style.setProperty('--fill-pct', `${healthPct}%`);
  element('badge-hunger').style.setProperty('--fill-pct', `${hungerPct}%`);
  element('badge-sanity').style.setProperty('--fill-pct', `${sanityPct}%`);
  element('badge-climate').style.setProperty('--fill-pct', `${moistPct}%`);
  element('badge-climate').classList.toggle('hidden', moistPct <= 0);

  element('hud-health').textContent = `${Math.round(p.health)}`;
  element('hud-hunger').textContent = `${Math.round(p.hunger)}`;
  element('hud-sanity').textContent = `${Math.round(p.sanity)}`;
  element('hud-moisture').textContent = `${Math.round(p.moisture)}`;

  gameRenderer.renderWorldClock(clockCanvas, scene);
  if (mapModalOpen) {
    gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY);
  }

  renderCraftingHud(scene);
  renderInventoryHud(scene);
  updateHovererPositionAndText();
}

// 60 FPS continuous render loop
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
  element('save-status').textContent = `Saved tick ${value.tick} · ${new Date().toLocaleTimeString()}`;
  return value;
}

async function restore(value: any) {
  validateCheckpoint(value, compatibility);
  await Promise.all(['master', 'caves'].map(role => workers.get(role as Role)!.request('restore', { snapshot: value.shards[role] })));
  await workers.get('client')!.request('restore', { snapshot: { ...value.shards.master, role: 'client' } });
  display(await workers.get('master')!.request('snapshot'));
  room?.broadcast({ type: 'snapshot', snapshot });
  lastSaved = value;
  status(`Restored checkpoint tick ${value.tick}`);
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
  status('Loading WASM & verifying script hashes…');
  await boot('client');
  await Promise.all([boot('master'), boot('caves')]);
  host = true;
  display(await workers.get('master')!.request('snapshot'));
  paused = false;
  for (const id of ['pause', 'consume', 'test', 'audio', 'room', 'save', 'restore', 'export', 'import', 'inspect-native']) button(id).disabled = false;
  status('Three WASM Workers ready.');
  const previous = await database.latest();
  if (previous) element('save-status').textContent = `Checkpoint tick ${previous.tick} available.`;
}

async function ensureMasterAssetsLoaded() {
  if (!workers.has('master')) {
    await boot('master');
  }
  const master = workers.get('master')!;
  void master.request('load-tile-textures').then((res: any) => {
    if (res?.tiles) gameRenderer.ingestTileTextures(res.tiles);
  }).catch(() => {});
  void master.request('load-ui-icons').then((res: any) => {
    if (res?.icons) {
      gameRenderer.ingestUiIcons(res.icons);
      applyKleiHudTextures();
      renderCraftingHud(gameScene);
      renderInventoryHud(gameScene);
      if (gameScene) gameRenderer.renderWorldClock(clockCanvas, gameScene);
    }
  }).catch(() => {});
  return master;
}

async function startGame(characterOverride?: string) {
  dstAudio.unlock();
  if (characterOverride) selectedCharacter = characterOverride;
  button('play-game').disabled = true;
  button('play-game').textContent = 'Generating World…';
  status(`Booting Don't Starve Together Master World (${selectedCharacter})…`);
  const master = await ensureMasterAssetsLoaded();
  const creativeChecked = element<HTMLInputElement>('title-creative-check')?.checked ?? false;
  const initialScene: GameSceneSnapshot = await master.request('start-game', {
    width: gameCanvas.width,
    height: gameCanvas.height,
    creativeMode: creativeChecked,
    character: selectedCharacter,
  });
  gameMode = true;
  host = true;
  paused = false;
  element('main-screen-overlay').classList.add('hidden');
  button('pause').disabled = false;
  button('pause').textContent = 'Pause';
  button('play-game').disabled = false;
  button('play-game').textContent = 'Start World';
  updateGameHud(initialScene);
  gameRenderer.render(performance.now());
  status(`DST World Ready · ${formatPrefabName(selectedCharacter)} at (${initialScene.player.x.toFixed(1)}, ${initialScene.player.z.toFixed(1)})`);
  return initialScene;
}

async function saveWorldToLocalStorage() {
  if (!gameMode || !workers.has('master')) return;
  const master = workers.get('master')!;
  const res = await master.request('save-world-state');
  if (res?.state) {
    localStorage.setItem('dst_saved_world_v1', JSON.stringify(res.state));
    dstAudio.playEvents([{ path: 'dontstarve/HUD/collect_resource' }]);
    status(`Saved world state at Day ${res.state.clock?.cycles ?? 1}.`);
  }
}

async function loadWorldFromLocalStorage() {
  const raw = localStorage.getItem('dst_saved_world_v1');
  if (!raw) {
    status('No saved world found in browser storage.');
    return;
  }
  const state = JSON.parse(raw);
  if (!gameMode) {
    await startGame(state.player?.prefab || selectedCharacter);
  }
  const master = workers.get('master')!;
  const scene: GameSceneSnapshot = await master.request('load-world-state', { state });
  togglePauseModal(false);
  updateGameHud(scene);
  status('Restored saved world state.');
}

// Preload Klei UI textures on the title screen so the character selection lobby & HUD have real Klei textures immediately
void ensureMasterAssetsLoaded();

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
  dstAudio.unlock();
  if (!gameMode || !workers.has('master')) return;
  const rect = gameCanvas.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * gameCanvas.width;
  const sy = ((e.clientY - rect.top) / rect.height) * gameCanvas.height;
  const master = workers.get('master')!;

  // If Ground Placer mode is active, place the structure at the clicked ground point
  if (gameRenderer.pendingBuildPrefab) {
    const worldPt = gameRenderer.screenToWorld(sx, sy, 0);
    const recipe = gameRenderer.pendingBuildPrefab;
    gameRenderer.pendingBuildPrefab = null;
    if (worldPt) {
      void master
        .request('game-action', { action: { kind: 'place-structure', recipe, x: worldPt.x, z: worldPt.z } })
        .then(updateGameHud)
        .catch(() => {});
    } else {
      renderCraftingHud(gameScene);
    }
    return;
  }

  const hit = gameRenderer.hitTest(sx, sy);
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

gameCanvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  dstAudio.unlock();
  if (!gameMode || !workers.has('master')) return;
  if (gameRenderer.pendingBuildPrefab) {
    gameRenderer.pendingBuildPrefab = null;
    renderCraftingHud(gameScene);
    updateHovererPositionAndText();
    return;
  }
  const rect = gameCanvas.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * gameCanvas.width;
  const sy = ((e.clientY - rect.top) / rect.height) * gameCanvas.height;
  const hit = gameRenderer.hitTest(sx, sy);
  const master = workers.get('master')!;
  if (hit) {
    void master.request('game-action', { action: { kind: 'examine', guid: hit.entity.guid } }).then(updateGameHud).catch(() => {});
  }
});

gameCanvas.addEventListener('wheel', e => {
  if (!gameMode || !workers.has('master')) return;
  e.preventDefault();
  const deltaDistance = e.deltaY > 0 ? 3.5 : -3.5;
  void workers.get('master')!.request('game-action', { action: { kind: 'camera', deltaDistance } }).then(updateGameHud).catch(() => {});
}, { passive: false });

function toggleMapModal(force?: boolean) {
  mapModalOpen = force !== undefined ? force : !mapModalOpen;
  element('map-screen-modal').classList.toggle('hidden', !mapModalOpen);
  dstAudio.playEvents([{ path: 'dontstarve/HUD/click_move' }]);
  if (mapModalOpen && gameScene) {
    gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY);
  }
}

function togglePauseModal(force?: boolean) {
  pauseModalOpen = force !== undefined ? force : !pauseModalOpen;
  element('pause-screen-modal').classList.toggle('hidden', !pauseModalOpen);
  if (gameMode) {
    paused = pauseModalOpen;
    button('pause').textContent = paused ? 'Resume' : 'Pause';
  }
}

function toggleDiagDrawer(force?: boolean) {
  const drawer = element('diag-drawer');
  const nextOpen = force !== undefined ? force : drawer.classList.contains('hidden');
  drawer.classList.toggle('hidden', !nextOpen);
}

window.addEventListener('keydown', e => {
  if (e.code === 'F12') {
    e.preventDefault();
    toggleDiagDrawer();
    return;
  }
  if (!gameMode || !workers.has('master')) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.code === 'Escape') {
    e.preventDefault();
    if (gameRenderer.pendingBuildPrefab) {
      gameRenderer.pendingBuildPrefab = null;
      renderCraftingHud(gameScene);
      return;
    }
    if (mapModalOpen) {
      toggleMapModal(false);
    } else {
      togglePauseModal();
    }
    return;
  }
  if (e.code === 'KeyM' || e.code === 'Tab') {
    e.preventDefault();
    toggleMapModal();
    return;
  }
  if (e.code === 'KeyC') {
    e.preventDefault();
    craftingDrawerOpen = !craftingDrawerOpen;
    renderCraftingHud(gameScene);
    return;
  }

  const master = workers.get('master')!;
  if (e.code === 'Space') {
    e.preventDefault();
    void master.request('game-action', { action: { kind: 'spacebar-action' } }).then(updateGameHud).catch(() => {});
    return;
  }
  if (e.code === 'KeyF') {
    e.preventDefault();
    void master.request('game-action', { action: { kind: 'attack-nearest' } }).then(updateGameHud).catch(() => {});
    return;
  }
  if (e.code === 'KeyI') {
    e.preventDefault();
    if (gameScene?.player.guid) {
      void master.request('game-action', { action: { kind: 'examine', guid: gameScene.player.guid } }).then(updateGameHud).catch(() => {});
    }
    return;
  }
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

  // Hotkeys 1..9, 0 for inventory slots 1..10
  if (e.code.startsWith('Digit')) {
    const digit = Number(e.code.slice(5));
    const slot = digit === 0 ? 10 : digit;
    if (slot >= 1 && slot <= 10) {
      e.preventDefault();
      void master.request('game-action', { action: { kind: 'inv-slot', slot, button: 'left' } }).then(updateGameHud).catch(() => {});
      return;
    }
  }

  const code = nativeKeyCode(e.code);
  if (code !== null) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
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

// CraftingMenuHUD Interactions
element('hud-crafting-root').addEventListener('click', e => {
  dstAudio.unlock();
  const target = e.target as HTMLElement;

  if (target.closest('#crafting-pinbar-toggle')) {
    craftingDrawerOpen = !craftingDrawerOpen;
    dstAudio.playEvents([{ path: 'dontstarve/HUD/craft_open' }]);
    renderCraftingHud(gameScene);
    return;
  }

  const tabBtn = target.closest<HTMLElement>('[data-cat]');
  if (tabBtn) {
    selectedCategory = tabBtn.dataset.cat!;
    craftingDrawerOpen = true;
    dstAudio.playEvents([{ path: 'dontstarve/HUD/click_move' }]);
    renderCraftingHud(gameScene);
    return;
  }

  const favBtn = target.closest<HTMLElement>('[data-fav-toggle]');
  if (favBtn) {
    const id = favBtn.dataset.favToggle!;
    if (FAVORITE_RECIPES.has(id)) FAVORITE_RECIPES.delete(id);
    else FAVORITE_RECIPES.add(id);
    renderCraftingHud(gameScene);
    return;
  }

  const selectBtn = target.closest<HTMLElement>('[data-recipe-select]');
  if (selectBtn) {
    const recId = selectBtn.dataset.recipeSelect!;
    if (selectedRecipeId === recId && gameMode && workers.has('master')) {
      // Clicking an already-selected recipe slot triggers build/place
      const recDef = RECIPES.find(r => r.id === recId);
      if (recDef?.isStructure) {
        gameRenderer.pendingBuildPrefab = recId;
        renderCraftingHud(gameScene);
      } else {
        void workers.get('master')!.request('game-action', { action: { kind: 'craft', recipe: recId } }).then(updateGameHud).catch(() => {});
      }
      return;
    }
    selectedRecipeId = recId;
    dstAudio.playEvents([{ path: 'dontstarve/HUD/click_move' }]);
    renderCraftingHud(gameScene);
    return;
  }

  const execBtn = target.closest<HTMLElement>('[data-craft-exec]');
  if (execBtn && gameMode && workers.has('master')) {
    const recipe = execBtn.dataset.craftExec!;
    const recDef = RECIPES.find(r => r.id === recipe);
    if (recDef?.isStructure && gameRenderer.pendingBuildPrefab !== recipe) {
      gameRenderer.pendingBuildPrefab = recipe;
      renderCraftingHud(gameScene);
      return;
    }
    gameRenderer.pendingBuildPrefab = null;
    void workers.get('master')!.request('game-action', { action: { kind: 'craft', recipe } }).then(updateGameHud).catch(() => {});
    return;
  }

  const quickBtn = target.closest<HTMLElement>('.craft-btn[data-craft]');
  if (quickBtn && gameMode && workers.has('master')) {
    const recipe = quickBtn.dataset.craft!;
    void workers.get('master')!.request('game-action', { action: { kind: 'craft', recipe } }).then(updateGameHud).catch(() => {});
  }
});

// Inventory, Equipment, Self-Inspect, Backpack & Container Interactions
function handleInventoryMouse(e: MouseEvent, buttonType: 'left' | 'right') {
  dstAudio.unlock();
  if (!gameMode || !workers.has('master')) return;
  const target = e.target as HTMLElement;
  const master = workers.get('master')!;

  if (target.closest('#hud-self-inspect')) {
    if (gameScene?.player.guid) {
      void master.request('game-action', { action: { kind: 'examine', guid: gameScene.player.guid } }).then(updateGameHud).catch(() => {});
    }
    return;
  }

  const cookEl = target.closest<HTMLElement>('[data-container-cook]');
  if (cookEl) {
    const guid = Number(cookEl.dataset.containerCook);
    void master.request('game-action', { action: { kind: 'interact', guid, code: 'COOK' } }).then(updateGameHud).catch(() => {});
    return;
  }

  const contEl = target.closest<HTMLElement>('[data-container-slot]');
  if (contEl) {
    const slot = Number(contEl.dataset.containerSlot);
    void master.request('game-action', { action: { kind: 'container-transfer', from: 'container', slot } }).then(updateGameHud).catch(() => {});
    return;
  }

  const equipEl = target.closest<HTMLElement>('[data-equip-slot]');
  if (equipEl) {
    const equipSlot = equipEl.dataset.equipSlot!;
    void master.request('game-action', { action: { kind: 'equip-slot', equipSlot, button: buttonType } }).then(updateGameHud).catch(() => {});
    return;
  }

  const bpEl = target.closest<HTMLElement>('[data-backpack-slot]');
  if (bpEl) {
    const slot = Number(bpEl.dataset.backpackSlot);
    if (slot >= 1 && slot <= 8) {
      void master.request('game-action', { action: { kind: 'inv-slot', slot, button: buttonType, shift: e.shiftKey, backpack: true } }).then(updateGameHud).catch(() => {});
    }
    return;
  }

  const slotEl = target.closest<HTMLElement>('.inv-slot[data-slot]');
  if (slotEl) {
    const slot = Number(slotEl.dataset.slot);
    if (slot >= 1 && slot <= 15) {
      if (gameScene?.player.openContainer && (e.shiftKey || buttonType === 'left' && gameScene.player.openContainer.isCooker)) {
        void master.request('game-action', { action: { kind: 'container-transfer', from: 'inventory', slot } }).then(updateGameHud).catch(() => {});
      } else {
        void master.request('game-action', { action: { kind: 'inv-slot', slot, button: buttonType, shift: e.shiftKey } }).then(updateGameHud).catch(() => {});
      }
    }
  }
}

element('hud-inventory').addEventListener('click', e => handleInventoryMouse(e, 'left'));
element('hud-inventory').addEventListener('contextmenu', e => { e.preventDefault(); handleInventoryMouse(e, 'right'); });
element('hud-backpack').addEventListener('click', e => handleInventoryMouse(e, 'left'));
element('hud-backpack').addEventListener('contextmenu', e => { e.preventDefault(); handleInventoryMouse(e, 'right'); });
element('hud-open-container').addEventListener('click', e => handleInventoryMouse(e, 'left'));
element('hud-open-container').addEventListener('contextmenu', e => { e.preventDefault(); handleInventoryMouse(e, 'right'); });

// MapScreen Zoom & Pan Interactions
mapScreenCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.18 : 0.85;
  mapZoom = Math.max(0.6, Math.min(3.5, mapZoom * factor));
  gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY);
}, { passive: false });

mapScreenCanvas.addEventListener('mousedown', e => {
  mapDragging = true;
  mapDragStartX = e.clientX - mapPanX;
  mapDragStartY = e.clientY - mapPanY;
});
window.addEventListener('mousemove', e => {
  if (!mapDragging || !mapModalOpen) return;
  mapPanX = e.clientX - mapDragStartX;
  mapPanY = e.clientY - mapDragStartY;
  gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY);
});
window.addEventListener('mouseup', () => { mapDragging = false; });
mapScreenCanvas.addEventListener('contextmenu', e => { e.preventDefault(); toggleMapModal(false); });

function bind(id: string, fn: () => Promise<unknown> | void) {
  const b = button(id);
  if (!b) return;
  b.onclick = () => { Promise.resolve().then(fn).catch(error => status(String(error))); };
}
bind('play-game', () => startGame());
bind('load-saved-world-btn', loadWorldFromLocalStorage);
bind('open-diag-from-title', () => toggleDiagDrawer(true));
bind('toggle-diag-drawer', () => toggleDiagDrawer());
bind('close-diag-drawer', () => toggleDiagDrawer(false));

bind('hud-open-map', () => toggleMapModal());
bind('map-close-btn', () => toggleMapModal(false));
bind('map-zoom-in', () => { mapZoom = Math.min(3.5, mapZoom * 1.25); gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY); });
bind('map-zoom-out', () => { mapZoom = Math.max(0.6, mapZoom * 0.8); gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY); });
bind('map-reset-view', () => { mapZoom = 1.0; mapPanX = 0; mapPanY = 0; gameRenderer.renderFullScreenMap(mapScreenCanvas, mapZoom, mapPanX, mapPanY); });

bind('hud-open-pause', () => togglePauseModal());
bind('pause-resume-btn', () => togglePauseModal(false));
bind('pause-save-world-btn', () => saveWorldToLocalStorage());
bind('pause-load-world-btn', () => loadWorldFromLocalStorage());
bind('pause-change-char-btn', () => {
  togglePauseModal(false);
  element('main-screen-overlay').classList.remove('hidden');
});
bind('hud-toggle-creative', () => {
  if (gameMode && workers.has('master')) {
    return workers.get('master')!.request('game-action', { action: { kind: 'toggle-creative' } }).then(updateGameHud);
  }
});
bind('pause-creative-btn', () => {
  if (gameMode && workers.has('master')) {
    togglePauseModal(false);
    return workers.get('master')!.request('game-action', { action: { kind: 'toggle-creative' } }).then(updateGameHud);
  }
});
bind('pause-starter-kit-btn', () => {
  if (gameMode && workers.has('master')) {
    togglePauseModal(false);
    return workers.get('master')!.request('game-action', { action: { kind: 'give-starter-kit' } }).then(updateGameHud);
  }
});
bind('pause-next-phase-btn', () => {
  if (gameMode && workers.has('master')) {
    togglePauseModal(false);
    return workers.get('master')!.request('game-action', { action: { kind: 'next-phase' } }).then(updateGameHud);
  }
});
bind('pause-open-diag-btn', () => {
  togglePauseModal(false);
  toggleDiagDrawer(true);
});

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
bind('pause', () => { paused = !paused; button('pause').textContent = paused ? 'Resume' : 'Pause'; });
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
    element('native-result').textContent = JSON.stringify(result, null, 2); status('Inspected native save metadata.');
  }).catch(error => status(String(error)));
};

element<HTMLInputElement>('backup-file').onchange = event => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  void enqueue(async () => { const value = database.import(new Uint8Array(await file.arrayBuffer()), compatibility); paused = true; await restore(value); await database.commit(value, compatibility); }).catch(error => status(String(error)));
};

async function connect(invitation?: string) {
  if (invitation !== undefined && !/^[a-f0-9]{8}\.[a-f0-9]{48}$/.test(invitation.trim())) throw new Error('Enter a valid invite code.');
  if (invitation === undefined && !host) throw new Error('Boot host before creating a room.');
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
  if (invitation) { host = false; button('join').disabled = true; status('Connecting to host via WebRTC…'); }
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
  if (document.hidden && host && !paused && !gameMode) { paused = true; button('pause').textContent = 'Resume'; room?.broadcast({ type: 'paused' }); void enqueue(checkpoint).catch(error => status(String(error))); status('Host tab hidden: simulation paused; checkpoint requested.'); }
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
    saveWorldToLocalStorage,
    loadWorldFromLocalStorage,
    toggleMapModal,
    togglePauseModal,
    toggleDiagDrawer,
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

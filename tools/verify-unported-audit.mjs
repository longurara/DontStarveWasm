// Automated Verification Script for DST Web Port Unported Functions Audit
// Programmatically verifies UNPORTED_FUNCTIONS.md against live WASM engine and Klei scripts.zip.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { loadEngine } from './load-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(REPO_ROOT, 'UNPORTED_FUNCTIONS.md');
const AUDIT_DATA_PATH = path.join(__dirname, 'unported_audit_data.json');

async function main() {
  console.log('=== DST WebAssembly Port Unported Functions Audit Verification ===\n');

  // 1. Verify that UNPORTED_FUNCTIONS.md exists and has all required sections
  console.log('Step 1: Verifying UNPORTED_FUNCTIONS.md existence and structure...');
  assert.ok(fs.existsSync(REPORT_PATH), 'UNPORTED_FUNCTIONS.md must exist in repository root');
  const reportContent = fs.readFileSync(REPORT_PATH, 'utf8');
  assert.ok(reportContent.includes('## 1. Executive Summary & Inventory Matrix'), 'Report must contain Section 1');
  assert.ok(reportContent.includes('## 2. Layer 1 — Detailed Method Audit by Subsystem'), 'Report must contain Section 2');
  assert.ok(reportContent.includes('## 3. Layer 2 — Lua Compatibility Shims & Disabled Subsystems Audit'), 'Report must contain Section 3');
  assert.ok(reportContent.includes('## 4. Layer 3 — TypeScript Web Runtime, Renderer, Audio & UI Bridge Audit'), 'Report must contain Section 4');
  console.log('✔ UNPORTED_FUNCTIONS.md structure verified.');

  // 2. Load audit data
  console.log('\nStep 2: Loading audit verification dataset...');
  assert.ok(fs.existsSync(AUDIT_DATA_PATH), 'unported_audit_data.json must exist');
  const auditData = JSON.parse(fs.readFileSync(AUDIT_DATA_PATH, 'utf8'));
  console.log(`✔ Loaded audit data for ${auditData.summary.length} classes and ${auditData.standalone_items.length} standalone globals.`);

  console.log('\nStep 2b: Verifying UNPORTED_FUNCTIONS.md Summary Matrix matches audit dataset...');
  for (const s of auditData.summary) {
    const linePattern = new RegExp(`\\|\\s*\`?${s.name}\`?\\s*\\|[^\\n]+\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`);
    const match = reportContent.match(linePattern);
    assert.ok(match, `Class ${s.name} must exist in UNPORTED_FUNCTIONS.md summary matrix table`);
    const [_, total, impl, noop, mock, synth, part, miss] = match.map(Number);
    const c = s.counts;
    assert.equal(total, c.total, `Total count mismatch for ${s.name}: markdown=${total}, json=${c.total}`);
    assert.equal(impl, c.fully_implemented, `Implemented count mismatch for ${s.name}: markdown=${impl}, json=${c.fully_implemented}`);
    assert.equal(noop, c.noop_stub, `No-op count mismatch for ${s.name}: markdown=${noop}, json=${c.noop_stub}`);
    assert.equal(mock, c.mock, `Mock count mismatch for ${s.name}: markdown=${mock}, json=${c.mock}`);
    assert.equal(synth, c.synthesized, `Synthesized count mismatch for ${s.name}: markdown=${synth}, json=${c.synthesized}`);
    assert.equal(part, c.partial, `Partial count mismatch for ${s.name}: markdown=${part}, json=${c.partial}`);
    assert.equal(miss, c.missing, `Missing count mismatch for ${s.name}: markdown=${miss}, json=${c.missing}`);
  }
  console.log(`✔ Verified all ${auditData.summary.length} summary matrix rows in UNPORTED_FUNCTIONS.md match audit dataset exactly.`);

  // 3. Introspect live WASM engine and confirm matches
  console.log('\nStep 3: Introspecting live WASM runtime...');
  const { engine, evaluate } = await loadEngine(1, { diagnosticBootstrap: false, configure: false });

  const luaCheck = `
    local res = { globals = {}, metatables = {}, standalone = {} }

    for _, name in ipairs({"TheSim", "TheNet", "TheShard", "TheInputProxy", "TheInventory", "TheSystemService", "TheGameService", "TheHaptics", "TileGroupManager", "Entity", "Transform", "MapGenSim", "RawImgui", "ShadeRenderer", "ManifestManager", "ItemServerProxy"}) do
      local val = _G[name]
      if val ~= nil then
        local count = 0
        local src = val
        if type(val) == "userdata" then
          local mt = getmetatable(val)
          if mt and type(mt.__index) == "table" then src = mt.__index end
        end
        if type(src) == "table" then
          for k, v in pairs(src) do
            if type(v) == "function" then count = count + 1 end
          end
        end
        res.globals[name] = count
      end
    end

    res.worldSimExists = _G["WorldSim"] ~= nil

    local reg = debug.getregistry()
    for k, v in pairs(reg) do
      if type(k) == "string" and k:match("^dst%..*") then
        local count = 0
        local idx = v.__index
        local src = type(idx) == "table" and idx or v
        for mk, mv in pairs(src) do
          if type(mv) == "function" then count = count + 1 end
        end
        res.metatables[k] = count
      end
    end

    for _, name in ipairs({"createTable", "VisitURL", "anglediff", "hash", "smallhash", "utf8char", "utf8strlen", "utf8substr", "utf8strtoupper", "utf8strtolower", "stringidsorter", "toarray", "toarrayornil", "walltime", "kleiloadlua", "kleifileexists", "kleiregistermods", "requireeventfile", "perlin", "string_search_subwords", "getminimumradius", "getrealtime"}) do
      res.standalone[name] = type(_G[name]) == "function"
    end

    return require("json").encode(res)
  `;

  const liveState = JSON.parse(evaluate(luaCheck));
  console.log('✔ Live WASM runtime successfully introspected.');

  console.log('\nStep 4: Validating live globals and metatables against UNPORTED_FUNCTIONS.md summary...');
  const metatableClassMap = {
    'dst.AnimState': 'AnimState',
    'dst.Physics': 'Physics',
    'dst.Light': 'Light',
    'dst.LightWatcher': 'LightWatcher',
    'dst.MiniMap': 'MiniMap',
    'dst.MiniMapEntity': 'MiniMapEntity',
    'dst.Follower': 'Follower',
    'dst.DynamicShadow': 'DynamicShadow',
    'dst.StaticShadow': 'StaticShadow',
    'dst.ShadowManager': 'ShadowManager',
    'dst.Map': 'Map',
    'dst.MapExplorer': 'MapExplorer',
    'dst.GroundCreep': 'GroundCreep',
    'dst.GroundCreepEntity': 'GroundCreepEntity',
    'dst.RoadManager': 'RoadManager',
    'dst.EnvelopeManager': 'EnvelopeManager',
    'dst.FontManager': 'FontManager',
    'dst.MapLayerManager': 'MapLayerManager',
    'dst.UITransform': 'UITransform',
    'dst.TextWidget': 'TextWidget',
    'dst.TextEditWidget': 'TextEditWidget',
    'dst.ImageWidget': 'ImageWidget',
    'dst.VideoWidget': 'VideoWidget',
    'dst.TwitchOptions': 'TwitchOptions',
    'dst.GraphicsOptions': 'GraphicsOptions',
    'dst.AccountManager': 'AccountManager',
    'dst.PostProcessor': 'PostProcessor',
    'dst.ParticleEmitter': 'ParticleEmitter',
    'dst.VFXEffect': 'VFXEffect',
    'dst.WaveComponent': 'WaveComponent',
    'dst.Image': 'Image',
    'dst.Label': 'Label',
    'dst.Pathfinder': 'Pathfinder',
    'dst.DebugRender': 'DebugRender',
    'dst.Network': 'Network',
    'dst.NetVar': 'NetVar',
    'dst.PhysicsWaker': 'PhysicsWaker',
    'dst.TileGroupManager': 'TileGroupManager',
    'dst.SoundEmitter': 'SoundEmitter'
  };

  const globalMap = {
    'TheSim': 'TheSim',
    'TheNet': 'TheNet',
    'TheShard': 'TheShard',
    'TheInputProxy': 'TheInputProxy',
    'TheInventory': 'TheInventory',
    'TheSystemService': 'TheSystemService',
    'TheGameService': 'TheGameService',
    'TheHaptics': 'TheHaptics',
    'TileGroupManager': 'TileGroupManager'
  };

  console.log('--- Validating Live Globals ---');
  for (const [globalName, className] of Object.entries(globalMap)) {
    const liveCount = liveState.globals[globalName];
    assert.ok(liveCount !== undefined, `Live global ${globalName} must exist`);
    const documented = auditData.summary.find(s => s.name === className);
    assert.ok(documented, `Documented summary for ${className} must exist`);
    assert.equal(liveCount, documented.counts.total, `Live count for ${globalName} (${liveCount}) must equal documented count (${documented.counts.total})`);
    console.log(`  - ${globalName}: live methods = ${liveCount}, documented methods = ${documented.counts.total}`);
  }

  console.log('--- Validating Live Metatables ---');
  for (const [metaKey, className] of Object.entries(metatableClassMap)) {
    const liveCount = liveState.metatables[metaKey];
    assert.ok(liveCount !== undefined, `Live metatable ${metaKey} must exist in registry`);
    const documented = auditData.summary.find(s => s.name === className);
    assert.ok(documented, `Documented summary for ${className} must exist`);
    assert.equal(liveCount, documented.counts.total, `Live count for ${metaKey} (${liveCount}) must equal documented count (${documented.counts.total})`);
    console.log(`  - ${className} (${metaKey}): live methods = ${liveCount}, documented methods = ${documented.counts.total}`);
  }
  console.log('✔ All live globals and metatables match documented classes with exact counts.');

  console.log('--- Validating Entity Metatable & Global ---');
  const docEntity = auditData.catalog['Entity'];
  assert.ok(docEntity, 'Documented Entity must exist');
  const liveEntityMethods = JSON.parse(evaluate(`
    local t = {}
    for k, v in pairs(Entity) do
      if type(v) == "function" then table.insert(t, k) end
    end
    return require("json").encode(t)
  `));
  const entitySet = new Set(liveEntityMethods);
  for (const item of docEntity.items) {
    assert.ok(entitySet.has(item.name), `Entity method ${item.name} must exist on live Entity`);
  }
  console.log(`  - Entity: verified all ${docEntity.items.length} documented methods present on live Entity table`);

  console.log('--- Validating Component / Secondary Globals ---');
  const additionalGlobalsMap = {
    'Transform': 'Transform',
    'MapGenSim': 'MapGenSim',
    'RawImgui': 'RawImgui',
    'ShadeRenderer': 'ShadeRenderer',
    'ManifestManager': 'ManifestManager',
    'ItemServerProxy': 'ItemServerProxy'
  };
  for (const [globalName, className] of Object.entries(additionalGlobalsMap)) {
    const liveCount = liveState.globals[globalName];
    assert.ok(liveCount !== undefined, `Live global ${globalName} must exist`);
    const documented = auditData.summary.find(s => s.name === className);
    assert.ok(documented, `Documented summary for ${className} must exist`);
    assert.equal(liveCount, documented.counts.total, `Live count for ${globalName} (${liveCount}) must equal documented count (${documented.counts.total})`);
    console.log(`  - ${globalName}: live methods = ${liveCount}, documented methods = ${documented.counts.total}`);
  }

  console.log('--- Validating Missing Subsystems ---');
  assert.equal(liveState.worldSimExists, false, 'WorldSim must be nil/unbound in live WASM engine');
  const docWorldSim = auditData.summary.find(s => s.name === 'WorldSim');
  assert.ok(docWorldSim, 'Documented summary for WorldSim must exist');
  assert.equal(docWorldSim.counts.missing, docWorldSim.counts.total, 'All WorldSim methods must be documented as MISSING');
  console.log(`  - WorldSim: verified nil in live WASM and all ${docWorldSim.counts.total} methods documented as MISSING`);

  // Verify 100% coverage of all documented classes in Step 4
  const verifiedClassNames = new Set([
    ...Object.values(globalMap),
    ...Object.values(metatableClassMap),
    ...Object.values(additionalGlobalsMap),
    'Entity',
    'WorldSim'
  ]);
  assert.equal(verifiedClassNames.size, auditData.summary.length, `All ${auditData.summary.length} classes must be validated in Step 4, but only ${verifiedClassNames.size} were checked`);
  console.log(`✔ Verified complete 100% live coverage across all ${auditData.summary.length} documented classes.`);

  console.log('--- Validating Standalone Globals ---');
  for (const item of auditData.standalone_items) {
    if (item.status === 'FULLY IMPLEMENTED' || item.status === 'NO-OP STUB') {
      assert.equal(liveState.standalone[item.name], true, `Live standalone function ${item.name} must exist`);
    } else if (item.status === 'MISSING') {
      assert.equal(liveState.standalone[item.name], false, `Missing standalone function ${item.name} must be nil`);
    }
  }
  console.log('✔ All standalone globals match live WASM state.');

  // 5. Verify source citations exist on disk
  console.log('\nStep 5: Verifying all source file citations in UNPORTED_FUNCTIONS.md exist on disk...');
  const citedFiles = new Set();
  const fileRegex = /`((?:web-port|scripts)\/[^`:,\s]+\.[a-zA-Z0-9]+)(?::\d+)?`/g;
  let match;
  while ((match = fileRegex.exec(reportContent)) !== null) {
    citedFiles.add(match[1]);
  }

  let verifiedFiles = 0;
  for (const relPath of citedFiles) {
    if (relPath.startsWith('web-port/')) {
      const fullPath = path.join(REPO_ROOT, relPath);
      assert.ok(fs.existsSync(fullPath), `Cited source file must exist: ${relPath}`);
      verifiedFiles++;
    }
  }
  console.log(`✔ Verified ${verifiedFiles} referenced C++/TypeScript/Lua files exist on disk.`);

  // 6. Deep programmatic verification of Klei scripts.zip call sites
  console.log('\nStep 6: Programmatically extracting and verifying Klei scripts.zip call sites...');
  const scriptsZip = path.join(REPO_ROOT, 'data/databundles/scripts.zip');
  assert.ok(fs.existsSync(scriptsZip), 'scripts.zip must exist');
  
  const zipBytes = fs.readFileSync(scriptsZip);
  const unzipped = unzipSync(new Uint8Array(zipBytes));
  const scriptLines = {};
  for (const [fname, data] of Object.entries(unzipped)) {
    if (fname.endsWith('.lua')) {
      scriptLines[fname] = new TextDecoder('utf-8', { fatal: false }).decode(data).split('\n');
    }
  }

  let checkedCallSites = 0;
  let verifiedCallSites = 0;

  for (const [className, cdata] of Object.entries(auditData.catalog)) {
    for (const item of cdata.items) {
      const callLoc = item.call_loc;
      if (callLoc && callLoc.startsWith('scripts/') && !callLoc.startsWith('scripts/...')) {
        checkedCallSites++;
        const [filePath, lineStr] = callLoc.split(':');
        const lineNum = parseInt(lineStr, 10);
        assert.ok(scriptLines[filePath], `Script file ${filePath} must exist in scripts.zip`);
        assert.ok(lineNum >= 1 && lineNum <= scriptLines[filePath].length, `Line ${lineNum} must be within bounds for ${filePath}`);
        const lineText = scriptLines[filePath][lineNum - 1];
        assert.ok(lineText.includes(item.name), `Method ${item.name} must appear on line ${lineNum} of ${filePath}`);
        verifiedCallSites++;
      }
    }
  }

  for (const item of auditData.standalone_items) {
    const callLoc = item.call_loc;
    if (callLoc && callLoc.startsWith('scripts/') && !callLoc.startsWith('scripts/...')) {
      checkedCallSites++;
      const [filePath, lineStr] = callLoc.split(':');
      const lineNum = parseInt(lineStr, 10);
      assert.ok(scriptLines[filePath], `Script file ${filePath} must exist in scripts.zip`);
      assert.ok(lineNum >= 1 && lineNum <= scriptLines[filePath].length, `Line ${lineNum} must be within bounds for ${filePath}`);
      const lineText = scriptLines[filePath][lineNum - 1];
      assert.ok(lineText.includes(item.name), `Function ${item.name} must appear on line ${lineNum} of ${filePath}`);
      verifiedCallSites++;
    }
  }

  assert.ok(verifiedCallSites > 1000, `Expected over 1000 verified script call sites, verified: ${verifiedCallSites}`);
  console.log(`✔ Programmatically verified ${verifiedCallSites} / ${checkedCallSites} call sites directly inside scripts.zip with 0 errors.`);

  console.log('\n============================================================');
  console.log('✔ ALL VERIFICATION CHECKS PASSED SUCCESSFULLY (Exit code 0)');
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});

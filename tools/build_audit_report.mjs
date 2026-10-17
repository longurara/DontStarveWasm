import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { loadEngine } from './load-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WEB_PORT = path.resolve(__dirname, '..');
const SCRIPTS_ZIP_PATH = path.join(REPO_ROOT, 'data/databundles/scripts.zip');

async function build() {
  console.log('--- DST Web Port Unported Functions Audit Generator ---');

  // 1. Read Steam analysis JSON
  const steamAnalysis = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'analysis/output/dontstarve_steam_x64.json'), 'utf8'));
  const steamGlobals = JSON.parse(fs.readFileSync(path.join(WEB_PORT, 'output/dontstarve_steam_x64-globals.json'), 'utf8'));

  // 2. Read scripts.zip
  console.log('Unzipping scripts.zip...');
  const scriptsZipBytes = fs.readFileSync(SCRIPTS_ZIP_PATH);
  const unzipped = unzipSync(new Uint8Array(scriptsZipBytes));
  const scriptFiles = {};
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith('.lua')) {
      scriptFiles[name] = new TextDecoder('utf-8', { fatal: false }).decode(data);
    }
  }
  console.log(`Loaded ${Object.keys(scriptFiles).length} script files.`);

  // Function to search scripts.zip for call sites
  function findScriptCallSite(prefix, methodName) {
    // Look for patterns like prefix:methodName( or prefix.methodName(
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedMethod = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex1 = new RegExp(`\\b${escapedPrefix}[:.]${escapedMethod}\\s*\\(`, 'g');
    const regex2 = new RegExp(`[:.]${escapedMethod}\\s*\\(`, 'g');

    // First try specific prefix
    for (const [filePath, content] of Object.entries(scriptFiles)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex1.test(line)) {
          return { file: filePath, line: i + 1, snippet: line.trim() };
        }
      }
    }

    // Try just :methodName(
    for (const [filePath, content] of Object.entries(scriptFiles)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex2.test(line)) {
          return { file: filePath, line: i + 1, snippet: line.trim() };
        }
      }
    }

    // Try just method name
    const regex3 = new RegExp(`\\b${escapedMethod}\\b`);
    for (const [filePath, content] of Object.entries(scriptFiles)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex3.test(line)) {
          return { file: filePath, line: i + 1, snippet: line.trim() };
        }
      }
    }

    return null;
  }

  // 3. Load C++ source files
  const engineDir = path.join(WEB_PORT, 'engine');
  const cppFiles = fs.readdirSync(engineDir).filter(f => f.endsWith('.cpp') || f.endsWith('.hpp'));
  const cppSources = {};
  for (const f of cppFiles) {
    cppSources[f] = fs.readFileSync(path.join(engineDir, f), 'utf8');
  }

  // Function to find method in C++ sources
  function findCppMethod(methodName, preferredFiles = []) {
    // First search preferred files
    for (const f of preferredFiles) {
      if (cppSources[f]) {
        const lines = cppSources[f].split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(`"${methodName}"`)) {
            return { file: `web-port/engine/${f}`, line: i + 1, snippet: line.trim() };
          }
        }
      }
    }
    // Search all files
    for (const [f, content] of Object.entries(cppSources)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(`"${methodName}"`)) {
          return { file: `web-port/engine/${f}`, line: i + 1, snippet: line.trim() };
        }
      }
    }
    return null;
  }

  // 4. Introspect live WASM engine
  console.log('Loading live WASM engine...');
  const { engine, evaluate } = await loadEngine(1, { diagnosticBootstrap: false, configure: false });

  // Introspect all methods
  const lua = `
    local res = {}

    local function inspectObj(name, obj)
      local methods = {}
      local src = obj
      if type(obj) == "userdata" then
        local mt = getmetatable(obj)
        if mt and type(mt.__index) == "table" then src = mt.__index end
      end
      if type(src) == "table" then
        for k, v in pairs(src) do
          if type(v) == "function" then
            local info = debug.getinfo(v)
            table.insert(methods, {
              name = k,
              what = info and info.what or "unknown",
              source = info and info.source or "unknown",
              linedefined = info and info.linedefined or -1
            })
          end
        end
      end
      return { type = type(obj), methods = methods }
    end

    res.TheSim = inspectObj("TheSim", _G.TheSim)
    res.TheNet = inspectObj("TheNet", _G.TheNet)
    res.TheShard = inspectObj("TheShard", _G.TheShard)
    res.TheInputProxy = inspectObj("TheInputProxy", _G.TheInputProxy)
    res.TheInventory = inspectObj("TheInventory", _G.TheInventory)
    res.TheSystemService = inspectObj("TheSystemService", _G.TheSystemService)
    res.TheGameService = inspectObj("TheGameService", _G.TheGameService)
    res.TheHaptics = inspectObj("TheHaptics", _G.TheHaptics)
    res.TileGroupManager = inspectObj("TileGroupManager", _G.TileGroupManager)
    res.Entity = inspectObj("Entity", _G.Entity)

    local reg = debug.getregistry()
    res.metatables = {}
    for k, v in pairs(reg) do
      if type(k) == "string" and k:match("^dst%..*") then
        local methods = {}
        local idx = v.__index
        local src = type(idx) == "table" and idx or v
        for mk, mv in pairs(src) do
          if type(mv) == "function" then
            local info = debug.getinfo(mv)
            table.insert(methods, {
              name = mk,
              what = info and info.what or "unknown",
              source = info and info.source or "unknown",
              linedefined = info and info.linedefined or -1
            })
          end
        end
        res.metatables[k] = methods
      end
    end

    return require("json").encode(res)
  `;

  const liveState = JSON.parse(evaluate(lua));
  console.log('Live WASM introspection done.');

  return { steamAnalysis, steamGlobals, scriptFiles, findScriptCallSite, cppSources, findCppMethod, liveState };
}

main().catch(console.error);

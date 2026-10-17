import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { loadEngine } from './load-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WEB_PORT = path.resolve(__dirname, '..');
const SCRIPTS_ZIP_PATH = path.join(REPO_ROOT, 'data/databundles/scripts.zip');

async function main() {
  console.log('Loading native binary analysis...');
  const steamAnalysis = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'analysis/output/dontstarve_steam_x64.json'), 'utf8'));
  const steamGlobals = JSON.parse(fs.readFileSync(path.join(WEB_PORT, 'output/dontstarve_steam_x64-globals.json'), 'utf8'));

  console.log('Scanning scripts.zip for method calls...');
  const scriptsZipBytes = fs.readFileSync(SCRIPTS_ZIP_PATH);
  const unzipped = unzipSync(new Uint8Array(scriptsZipBytes));
  const scriptFiles = {};
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith('.lua')) {
      scriptFiles[name] = new TextDecoder('utf-8', { fatal: false }).decode(data);
    }
  }
  console.log(`Loaded ${Object.keys(scriptFiles).length} Lua script files from scripts.zip.`);

  // Function to find call sites in scripts.zip
  function findCallSites(patternRegex, max = 5) {
    const results = [];
    for (const [filePath, content] of Object.entries(scriptFiles)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (patternRegex.test(line)) {
          results.push({
            file: filePath,
            line: i + 1,
            snippet: line.trim()
          });
          if (results.length >= max) return results;
        }
      }
    }
    return results;
  }

  console.log('Parsing C++ engine sources...');
  const engineDir = path.join(WEB_PORT, 'engine');
  const cppFiles = fs.readdirSync(engineDir).filter(f => f.endsWith('.cpp'));
  const cppSources = {};
  for (const f of cppFiles) {
    cppSources[f] = fs.readFileSync(path.join(engineDir, f), 'utf8');
  }

  // Helper to locate function in C++ sources
  function findCppDefinition(funcName, cppFile) {
    if (cppFile && cppSources[cppFile]) {
      const lines = cppSources[cppFile].split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`int ${funcName}(`) || lines[i].includes(`void ${funcName}(`)) {
          return { file: `web-port/engine/${cppFile}`, line: i + 1, snippet: lines[i].trim() };
        }
      }
    }
    // Search across all files
    for (const [f, content] of Object.entries(cppSources)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`int ${funcName}(`) || lines[i].includes(`void ${funcName}(`)) {
          return { file: `web-port/engine/${f}`, line: i + 1, snippet: lines[i].trim() };
        }
      }
    }
    return null;
  }

  console.log('Introspecting live WASM engine...');
  const { engine, evaluate } = await loadEngine(1, { diagnosticBootstrap: false, configure: false });

  // Introspect live Lua
  const luaCode = `
    local res = {
      globals = {},
      metatables = {},
      standalone = {}
    }

    local targetGlobals = {
      "TheSim", "TheNet", "TheShard", "TheInput", "TheInputProxy", "TheFrontEnd",
      "TheSystemService", "TheItems", "TheInventory", "TheGameService", "TheHaptics",
      "TileGroupManager", "Entity", "WorldSim", "WorldSimActual", "MapGenSim",
      "RawImgui", "ShadeRenderer", "ManifestManager", "ItemServerProxy"
    }

    for _, name in ipairs(targetGlobals) do
      local val = _G[name]
      if val ~= nil then
        local methods = {}
        local src = val
        if type(val) == "userdata" then
          local mt = getmetatable(val)
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
        res.globals[name] = { type = type(val), methods = methods }
      else
        res.globals[name] = { type = "nil", methods = {} }
      end
    end

    local reg = debug.getregistry()
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

    local standaloneNames = {
      "createTable", "VisitURL", "anglediff", "hash", "smallhash", "utf8char",
      "utf8strlen", "utf8substr", "utf8strtoupper", "utf8strtolower", "stringidsorter",
      "toarray", "toarrayornil", "walltime", "kleiloadlua", "kleifileexists",
      "kleiregistermods", "requireeventfile", "perlin", "string_search_subwords",
      "getminimumradius", "getrealtime"
    }
    for _, name in ipairs(standaloneNames) do
      local val = _G[name]
      if val ~= nil then
        local info = type(val) == "function" and debug.getinfo(val) or nil
        res.standalone[name] = {
          type = type(val),
          what = info and info.what or "unknown",
          source = info and info.source or "unknown"
        }
      else
        res.standalone[name] = { type = "nil" }
      end
    end

    return require("json").encode(res)
  `;

  const liveState = JSON.parse(evaluate(luaCode));
  console.log('Live engine introspection completed successfully.');

  // Save intermediate data
  fs.writeFileSync(path.join(REPO_ROOT, '.agents/teamwork/teamwork_preview_implementer_1/audit_raw_data.json'), JSON.stringify({
    liveState,
    standaloneCount: Object.keys(liveState.standalone).length,
    globalsCount: Object.keys(liveState.globals).length,
    metatablesCount: Object.keys(liveState.metatables).length
  }, null, 2));

  console.log('Done gathering raw data.');
}

main().catch(console.error);

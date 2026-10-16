import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import createEngine from '../public/generated/engine/engine.mjs';
import { Resources } from '../src/resources.mjs';
import { sessionParameters, configureSession } from '../src/session.mjs';
import { engineEvaluator } from '../src/evaluate.mjs';

export async function loadEngine(role = 1, {fullScripts = false, diagnosticBootstrap = true, resources = fullScripts, session = {}, configure = true} = {}) {
  const manifest = JSON.parse(await readFile(new URL('../public/generated/manifest.json', import.meta.url)));
  const wasm = await readFile(new URL('../public/generated/engine/engine.wasm', import.meta.url));
  if(createHash('sha256').update(wasm).digest('hex')!==manifest.engineWasmSha256)throw new Error('WASM/manifest mismatch; run tools/build.py');
  const engine = await createEngine({ wasmBinary: wasm, print: console.log, printErr: console.error });
  const packs = fullScripts ? manifest.packs : [manifest.packs.find(p => p.sha256 === manifest.bootPack)];
  for(const pack of packs) {
    const bytes=await readFile(new URL('../public/generated/' + pack.url, import.meta.url));
    if(createHash('sha256').update(bytes).digest('hex')!==pack.sha256)throw new Error('Script pack hash mismatch');
    const files=unzipSync(bytes);
    for (const [name, data] of Object.entries(files)) {
      const path = '/' + name;
      engine.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      engine.FS.writeFile(path, data);
    }
  }
  engine.FS.chdir('/');
  if (engine._dst_init(role)) throw new Error(engine.ccall('dst_result', 'string', [], []));
  let assets;
  if(resources){
    if(!manifest.resources)throw new Error('Prepare resources with tools/resources.py and rebuild');
    assets=await Resources.open(manifest.resources,async path=>new Uint8Array(await readFile(new URL('../public/generated/'+path,import.meta.url))));
    assets.install(engine);
  }
  const {evaluate,evaluateAsync}=engineEvaluator(engine);
  const boot = evaluate('return dofile("/compat/'+(diagnosticBootstrap?'bootstrap':'prelude')+'.lua")');
  const parameters=configure?configureSession(engine,sessionParameters(manifest,session),manifest):null;
  return { engine, evaluate, evaluateAsync, manifest, boot, assets, parameters };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { engine, evaluate, boot } = await loadEngine();
  console.log('Bootstrap:', boot);
  console.log('Scene:', evaluate('return dofile("/compat/diagnostic.lua")'));
  evaluate('WEB_PROBE.components.finiteuses:Use(5)');
  console.log('After Use(5):', evaluate('return _WEB_Snapshot()'));
  engine._dst_tick(30);
  console.log('After 30 ticks:', evaluate('return _WEB_Snapshot()'));
}

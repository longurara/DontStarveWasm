import { mkdir, writeFile } from 'node:fs/promises';
import { loadEngine } from './load-engine.mjs';

const {engine,evaluate,evaluateAsync,manifest}=await loadEngine(1,{fullScripts:true,diagnosticBootstrap:false});
let failure=null;
try{await evaluateAsync('return dofile("/scripts/main.lua")',100000000);}catch(error){failure=error.message;}
const mainEntryReturned=failure===null;let startInvoked=false,startReturned=false;
if(mainEntryReturned){
  startInvoked=true;
  try{await evaluateAsync('assert(type(Start)=="function","Native Start callback is missing");Start()',100000000);startReturned=true;}catch(error){failure=error.message;}
}
const report={gameBuild:manifest.gameBuild,contentHash:manifest.contentHash,mainEntryReturned,startInvoked,startReturned,fullBootstrapPassed:false,
  failedStage:failure?(mainEntryReturned?'Start':'main'):null,firstFailure:failure,
  worldGlobalPresent:evaluate('return tostring(rawget(_G,"TheWorld")~=nil)')==='true',
  profileStatistics:JSON.parse(evaluate('return require("json").encode_compliant(WebProfileStats.Inspect())')),
  note:'Runs unchanged main.lua in a clean Lua environment with every script pack available, then invokes the native Start callback if main returns. These steps alone do not prove world startup or playable gameplay.'};
await mkdir(new URL('../output/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/bootstrap-gap.json',import.meta.url),JSON.stringify(report,null,2));
engine._dst_close();
console.log(JSON.stringify(report,null,2));

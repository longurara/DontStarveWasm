// Runs the engine decoder, not the separately converted asset viewer. Keep
// this diagnostic independent of a future AnimState or GPU-ready assertion.
export async function animationProbe(engine:any,evaluations:any,role:string) {
  const evaluate=evaluations.evaluate;
  const before=JSON.parse(evaluate('return _WEB_Snapshot()'));
  if(before.kind!=='engine-diagnostic-v1')throw new Error('Animation probe requires the isolated diagnostic scene');
  const cacheBefore=JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect())'));
  if(cacheBefore.bundles!==0)throw new Error('Animation probe requires an empty decoded asset cache');
  if(JSON.parse(evaluate('return json.encode_compliant(WebFileAssets.Inspect())')).files!==0)throw new Error('Animation probe requires an empty FILE cache');
  if(JSON.parse(evaluate('return json.encode_compliant(WebAtlases.Inspect())')).atlases!==0)throw new Error('Animation probe requires an empty ATLAS cache');
  let acquired=false;
  let fileAcquired=false;
  const fetchResource=engine.fetchNativeResource,resourceRequests:string[]=[];
  engine.fetchNativeResource=async(path:string)=>{resourceRequests.push(path);return fetchResource(path);};
  try {
    evaluate('TheSim:RegisterPrefab("web_browser_file_probe",{{type="FILE",file="klump/strings/unused.txt"}},{})');
    const fileMarker=await evaluations.evaluateAsync('local marker=41;TheSim:LoadPrefabs({"web_browser_file_probe"});return marker+1');
    fileAcquired=true;
    if(fileMarker!=='42')throw new Error('Lua local state changed during FILE loading');
    if(role!=='client') {
      const marker=await evaluations.evaluateAsync(`
        TheSim:RegisterPrefab("web_browser_animation_probe",{
          {type="ANIM",file="anim/wilson.zip"},
          {type="ANIM",file="anim/player_basic.zip"},
          {type="ATLAS",file="images/global.xml"},
          {type="IMAGE",file="web_port/intentionally_absent.tex"}
        },{})
        local marker=41
        TheSim:LoadPrefabs({"web_browser_animation_probe"})
        return marker+1`);
      acquired=true;
      if(marker!=='42')throw new Error('Lua local state changed during resource loading');
    } else {
      const marker=await evaluations.evaluateAsync('local marker=41;WebAssets.Decode("anim/wilson.zip");WebAssets.Decode("anim/player_basic.zip");WebAtlases.Decode("images/global.xml");return marker+1');
      if(marker!=='42')throw new Error('Lua local state changed during resource loading');
    }
    const build=JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect("anim/wilson.zip"))'));
    const animation=JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect("anim/player_basic.zip"))'));
    const cache=JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect())'));
    const file=JSON.parse(evaluate('return json.encode_compliant(WebFileAssets.Inspect("klump/strings/unused.txt"))'));
    const atlas=JSON.parse(evaluate('return json.encode_compliant(WebAtlases.Inspect("images/global.xml"))'));
    const sourceFilesRemain=['anim/wilson.zip','anim/player_basic.zip','klump/strings/unused.txt','images/global.xml'].some(file=>engine.FS.analyzePath('/'+file).exists);
    return {build,animation,cache,file,atlas,resourceRequests,sourceFilesRemain,heapBytes:engine.HEAPU8.buffer.byteLength};
  } finally {
    engine.fetchNativeResource=fetchResource;
    if(acquired)evaluate('TheSim:UnloadPrefabs({"web_browser_animation_probe"})');
    if(fileAcquired)evaluate('TheSim:UnloadPrefabs({"web_browser_file_probe"})');
    for(const file of ['wilson.zip','player_basic.zip'])evaluate(`WebAssets.Release("anim/${file}")`);
    evaluate('WebAtlases.Release("images/global.xml")');
    const after=JSON.parse(evaluate('return _WEB_Snapshot()'));
    if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Animation probe changed diagnostic state');
    if(JSON.parse(evaluate('return json.encode_compliant(WebAssets.Inspect())')).retainedBytes!==0)throw new Error('Animation probe leaked decoded assets');
    if(JSON.parse(evaluate('return json.encode_compliant(WebFileAssets.Inspect())')).retainedBytes!==0)throw new Error('Animation probe leaked FILE assets');
    if(JSON.parse(evaluate('return json.encode_compliant(WebAtlases.Inspect())')).retainedBytes!==0)throw new Error('Animation probe leaked ATLAS assets');
  }
}

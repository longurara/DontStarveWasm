/** Real ATLAS ownership, native UV oracle and component lifetime in Workers. */
export async function mapLayerProbe(engine:any,evaluations:any,resources:any,role:string){
  const evaluate=evaluations.evaluate,before=evaluate('return _WEB_Snapshot()'),entities=engine._dst_entity_count();
  const stateBefore=evaluate('return json.encode_compliant(WebComponents.MapLayerManager())');
  const atlasesBefore=evaluate('return json.encode_compliant(WebAtlases.Inspect())');
  const physicsBefore=evaluate('return json.encode_compliant(WebPhysicsWaker.Inspect())');
  const radiusBefore=JSON.parse(physicsBefore).maxPhysicsRadius;
  let created=false,loaded=false;
  try{
    evaluate('WEB_LAYER_BROWSER=CreateEntity("layer_browser");WEB_LAYER_BROWSER.persists=false');created=true;
    evaluate('PhysicsWaker.SetMaxPhysicsRadius("1.23456789");assert(WebPhysicsWaker.Inspect().maxPhysicsRadius==1.2345678806304932 and not WebPhysicsWaker.Inspect().simulationReady)');
    if(role==='client'){
      evaluate('local ok,error=pcall(WEB_LAYER_BROWSER.entity.AddMapLayerManager,WEB_LAYER_BROWSER.entity);assert(not ok and string.find(error,"client MapLayerManager renderer",1,true))');
      return {role,rendererReady:false,rejected:true,physicsRadiusVerified:true};
    }
    const response=await fetch('/generated/preview/map-layer-provenance.json');if(!response.ok)throw new Error('Missing map layer oracle');
    const oracle=await response.json();if(!oracle.nativeVerified||oracle.cases.length!==2)throw new Error('Map layer oracle not verified against native');
    for(const row of oracle.cases)if(resources.index.files[row.path].sha256!==row.sourceSha256)throw new Error('Map layer source hash mismatch');
    evaluate('WEB_LAYER_BROWSER.entity:AddMapLayerManager();WEB_LAYER_BROWSER.MapLayerManager:SetSampleStyle(2);TheSim:RegisterPrefab("web_browser_map_atlases",{{type="ATLAS",file="levels/tiles/forest.xml"},{type="ATLAS",file="levels/tiles/grass.xml"}}, {})');
    await evaluations.evaluateAsync('TheSim:LoadPrefabs({"web_browser_map_atlases"})');loaded=true;
    const fetches=resources.stats.fetches;
    evaluate('for _,path in ipairs({"levels/tiles/forest.xml","levels/tiles/grass.xml"})do WEB_LAYER_BROWSER.MapLayerManager:CreateRenderLayer(65538.9,path,"unused.tex","unused_noise.tex")end');
    const state=JSON.parse(evaluate('return json.encode_compliant(WebComponents.MapLayerManager(WEB_LAYER_BROWSER.GUID))'));
    for(let i=0;i<oracle.cases.length;++i){const actual=state.layers[i],row=oracle.cases[i];
      for(const field of ['shapeCount','uvSha256'])if(actual[field]!==row[field])throw new Error('Map layer mismatch: '+field);
      if(JSON.stringify(actual.uvCounts)!==JSON.stringify(row.uvCounts)||actual.tileId!==2||actual.sampleStyle!==2||actual.textureHandle!==-1)throw new Error('Map layer data mismatch');
    }
    evaluate('WEB_LAYER_BROWSER.MapLayerManager:ReleaseRenderLayer(0);assert(WEB_LAYER_BROWSER.MapLayerManager:CreateRenderLayer(4,"levels/tiles/forest.xml","x","y")==0)');
    if(resources.stats.fetches!==fetches)throw new Error('Map registration fetched resources');
    evaluate('TheSim:UnloadPrefabs({"web_browser_map_atlases"})');loaded=false;
    const retained=JSON.parse(evaluate('return json.encode_compliant(WebComponents.MapLayerManager(WEB_LAYER_BROWSER.GUID))'));
    if(retained.layers[0].uvSha256!==state.layers[0].uvSha256)throw new Error('Map UVs lost after atlas release');
    return {role,rendererReady:false,uvVerified:true,physicsRadiusVerified:true,layers:state.layers.length,heapBytes:engine.HEAPU8.buffer.byteLength};
  }finally{
    if(loaded)evaluate('TheSim:UnloadPrefabs({"web_browser_map_atlases"})');
    if(created)evaluate('if WEB_LAYER_BROWSER:IsValid() then WEB_LAYER_BROWSER:Remove() end;WEB_LAYER_BROWSER=nil');
    evaluate(`PhysicsWaker.SetMaxPhysicsRadius(${radiusBefore})`);
    if(evaluate('return json.encode_compliant(WebPhysicsWaker.Inspect())')!==physicsBefore)throw new Error('Map probe changed radius setting');
    if(evaluate('return json.encode_compliant(WebComponents.MapLayerManager())')!==stateBefore||evaluate('return json.encode_compliant(WebAtlases.Inspect())')!==atlasesBefore)throw new Error('Map probe leaked resources');
    if(engine._dst_entity_count()!==entities||evaluate('return _WEB_Snapshot()')!==before)throw new Error('Map probe changed scene/tick');
  }
}

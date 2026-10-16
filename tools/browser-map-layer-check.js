async(page)=>{
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const runs=[];
  for(let i=0;i<2;++i){
    const results=await page.evaluate(()=>window.dstWorkbench.mapLayerTest());
    if(results.length!==3)throw new Error('Missing map-layer Worker');
    for(const result of results){
      if(result.rendererReady)throw new Error('Unsupported renderer readiness');
      if(!result.physicsRadiusVerified)throw new Error('Static radius setter not verified');
      if(result.role==='client'?!result.rejected:!result.uvVerified||result.layers!==2)throw new Error('Map layer state mismatch');
    }
    runs.push(results);
  }
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),runs};
}

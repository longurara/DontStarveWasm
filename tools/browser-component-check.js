async(page)=>{
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const runs=[];
  for(let i=0;i<2;++i){
    const results=await page.evaluate(()=>window.dstWorkbench.componentTest());
    if(results.length!==3)throw new Error('Missing component worker');
    for(const result of results){
      if(result.rendererReady||result.created!==(result.role!=='client'))throw new Error('Component readiness mismatch');
      if(!result.roadVerified)throw new Error('RoadManager component not verified');
      if(!result.envelopeVerified)throw new Error('EnvelopeManager component not verified');
      if(!result.postProcessorVerified)throw new Error('PostProcessor component not verified');
      if(!result.fontManagerVerified)throw new Error('FontManager component not verified');
      if(result.created&&(result.textureHandle!==-1||!result.retiredRejected))throw new Error('Dedicated component state mismatch');
    }
    runs.push(results);
  }
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),runs};
}

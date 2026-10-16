async(page)=>{
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const runs=[];
  for(let i=0;i<2;++i){
    const results=await page.evaluate(()=>window.dstWorkbench.uiTransformTest());
    if(results.length!==3)throw new Error('Missing UI-transform Worker');
    for(const result of results){
      if(!result.nativeLayoutVerified||!result.scissorDataVerified||!result.retiredVerified||result.rendererReady)throw new Error('UI data/readiness mismatch');
      if(JSON.stringify(result.viewport)!==JSON.stringify(result.role==='client'?[800,600]:[0,0]))throw new Error('UI viewport role mismatch');
    }
    runs.push(results);
  }
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),runs};
}

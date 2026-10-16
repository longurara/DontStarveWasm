async(page)=>{
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const result=await page.evaluate(()=>window.dstWorkbench.fontTest());
  if(result.results.length!==3||result.results.reduce((sum,row)=>sum+row.glyphs,0)!==44853||!result.exactPixels||!result.registryVerified||!result.fontManagerVerified||result.rendererReady||result.heapBytes>1024**3)throw new Error('Font coverage/readiness mismatch: '+JSON.stringify(result));
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),...result};
}

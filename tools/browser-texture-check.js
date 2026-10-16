async(page)=>{
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const result=await page.evaluate(()=>window.dstWorkbench.textureTest());
  if(result.results.length!==3||result.mips!==34||!result.exactPixels||result.rendererReady)throw new Error('KTEX coverage/readiness mismatch: '+JSON.stringify(result));
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),...result};
}

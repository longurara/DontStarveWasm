async(page)=>{
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const result=await page.evaluate(()=>window.dstWorkbench.shaderTest());
  if(result.failures.length)throw new Error(JSON.stringify(result.failures));
  if(result.results.length!==68||result.rendererReady)throw new Error('Shader catalog coverage/readiness mismatch');
  // Original PosUVColour.vs premultiplies DIFFUSE.rgb by DIFFUSE.a;
  // ui.ps multiplies that colour by the texture sample, including alpha.
  const sample=[128,64,192,128],diffuse=[.5,.75,.25,.5];
  const expected=sample.map((value,i)=>Math.round(value*diffuse[i]*(i===3?1:diffuse[3])));
  if(result.uiPixels?.length!==16||result.uiPixels.some((value,i)=>Math.abs(value-expected[i%4])>1))throw new Error('Native UI shader pixel mismatch: '+result.uiPixels);
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),compiled:result.results.length,uiPixels:result.uiPixels,webgl:result.webgl,rendererReady:result.rendererReady};
}

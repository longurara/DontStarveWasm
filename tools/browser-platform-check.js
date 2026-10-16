async (page) => {
  await page.reload();
  await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const mounted=await page.evaluate(()=>window.dstWorkbench.platformState());
  if(mounted.length!==3||mounted.some(state=>!state.storageAvailable||!state.storageEnabled||!state.autosaveEnabled))throw new Error('Mounted IDBFS is unavailable to Lua SystemService');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(async()=>!(await window.dstWorkbench.platformState()).find(state=>state.role==='client').focus);
  const blurred=await page.evaluate(()=>window.dstWorkbench.platformState());
  if(blurred.some(state=>state.role!=='client'&&!state.focus))throw new Error('Client focus contaminated shard state');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(async()=>(await window.dstWorkbench.platformState()).find(state=>state.role==='client').focus);
  await page.evaluate(()=>window.dstWorkbench.storageTest('aabbccddaabbccddaabbccddaabbccdd'));
  const committed=await page.evaluate(()=>window.dstWorkbench.platformState());
  if(committed.some(state=>!state.storageAvailable))throw new Error('Committed IDBFS not reflected in Lua');
  return {browser:await page.evaluate(()=>navigator.userAgent),mounted,blurred,committed};
}

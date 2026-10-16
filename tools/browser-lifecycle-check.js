async (page) => {
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const before=await page.evaluate(()=>window.dstWorkbench.state.snapshot);
  const results=await page.evaluate(()=>window.dstWorkbench.lifecycleTest());
  const expected=['event_wake','instance_wake','component_wake','event_sleep','instance_sleep','component_sleep','event_wake','instance_wake','component_wake'];
  if(results.length!==3)throw new Error('Missing lifecycle worker');
  for(const result of results){
    if(JSON.stringify(result.events.map(event=>event.name))!==JSON.stringify(expected))throw new Error('Native callback order differs');
    if(result.events[0].pending!==true||result.events[1].pending!==true||result.events[2].pending!==false)throw new Error('Initial sleepstatepending differs');
    if(result.events.some(event=>event.awake!==event.name.includes('wake')))throw new Error('Native awake state differs during callback');
    if(result.deferredAwake||!result.awake||result.pending||result.rotation!==0||result.tickAdvanced||result.spatialPolicyImplemented)throw new Error('Lifecycle state differs');
  }
  const after=await page.evaluate(()=>window.dstWorkbench.state.snapshot);
  if(after.tick!==before.tick||after.guid!==before.guid||after.uses!==before.uses)throw new Error('Probe modified diagnostic gameplay');
  return {browser:await page.evaluate(()=>navigator.userAgent),roles:results.map(result=>result.role),nativeCallbacksVerified:true,spatialPolicyImplemented:false};
}

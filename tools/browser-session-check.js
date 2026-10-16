async (page) => {
  await page.reload();
  await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const compatibility=await page.evaluate(()=>window.dstWorkbench.state.compatibility);
  const sessions=await page.evaluate(()=>window.dstWorkbench.sessionState());
  if(sessions.length!==3)throw new Error('Missing engine session');
  for(const session of sessions){
    for(const key of ['gameBuild','engineVersion','schemaVersion','contentHash'])if(session[key]!==compatibility[key])throw new Error('Worker session compatibility differs: '+key);
    if(!session.configured||session.gameMode!=='survival'||session.maxPlayers!==6||session.platformOnline||!session.offlineCluster||!session.serverDedicated||session.serverClientHosted)throw new Error('Invalid configured session');
    if(session.launches!==1||session.userId!==session.localUserId)throw new Error('Sim launch count or local identity binding mismatch');
    if(session.role==='client'?!/^WEB_[a-f0-9]{32}$/.test(session.userId):session.userId!=='')throw new Error('Player/shard identity mismatch');
  }
  let manifests=0;
  await page.route('**/generated/manifest.json',async route=>{
    const response=await route.fetch();const manifest=await response.json();
    if(++manifests===2)manifest.contentHash='0'.repeat(64);
    await route.fulfill({response,json:manifest});
  });
  try{
    await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Incompatible contentHash'}).waitFor();
    const failed=await page.evaluate(()=>window.dstWorkbench.state);
    if(failed.host||failed.snapshot)throw new Error('Mixed worker versions started simulation');
  }finally{await page.unroute('**/generated/manifest.json');}
  return {browser:await page.evaluate(()=>navigator.userAgent),sessions,mixedWorkerVersionsRejected:true};
}

async(page)=>{
  // A fresh context verifies concurrent first-use creation without modifying
  // any existing profile or checkpoint in the caller's browser context.
  const browser=page.context().browser();if(!browser)throw new Error('Isolated browser context unavailable');
  const context=await browser.newContext();
  try {
    const pages=await Promise.all([context.newPage(),context.newPage()]);
    const url=page.url();
    async function boot(target){
      await target.goto(url);
      await target.waitForFunction(()=>window.dstWorkbench);
      await target.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
      await target.waitForFunction(()=>window.dstWorkbench.state.workers===3&&window.dstWorkbench.state.snapshot);
      await target.evaluate(()=>window.dstWorkbench.pause());
      return target.evaluate(()=>window.dstWorkbench.sessionState());
    }
    const concurrent=await Promise.all(pages.map(boot));
    const id=concurrent[0].find(row=>row.role==='client').userId;
    if(!/^WEB_[a-f0-9]{32}$/.test(id))throw new Error('Invalid generated web identity');
    const verify=sessions=>{
      if(sessions.length!==3)throw new Error('Missing worker identity');
      for(const row of sessions){
        if(row.userId!==row.localUserId||row.launches!==1||row.userId!==(row.role==='client'?id:''))throw new Error('Identity changed or leaked to a shard');
      }
    };
    concurrent.forEach(verify);
    const reloaded=await boot(pages[0]);verify(reloaded);
    const compatibility=await pages[0].evaluate(()=>window.dstWorkbench.state.compatibility);
    // A malformed record must fail without replacing the old player key.
    const broken={schemaVersion:99,userId:id};
    async function record(target,value){return target.evaluate(async value=>{
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('dst-web-port',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction('meta',value?'readwrite':'readonly');const store=tx.objectStore('meta');let result;
        const request=value?store.put(value,'profile:local-identity:v1'):store.get('profile:local-identity:v1');
        request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error);
      });}finally{db.close();}
    },value);}
    await record(pages[0],broken);
    await pages[0].reload();await pages[0].waitForFunction(()=>window.dstWorkbench);
    await pages[0].getByRole('button',{name:'Khởi động WASM',exact:true}).click();
    await pages[0].getByRole('status').filter({hasText:'Invalid local identity record'}).waitFor();
    const failed=await pages[0].evaluate(()=>window.dstWorkbench.state);
    if(failed.host||failed.snapshot)throw new Error('Invalid identity started authoritative simulation');
    if(JSON.stringify(await record(pages[0],null))!==JSON.stringify(broken))throw new Error('Invalid identity record was overwritten');
    return {browser:await page.evaluate(()=>navigator.userAgent),compatibility,concurrentCreationVerified:true,reloadSurvived:true,corruptIdentityPreserved:true,shardIdentityEmpty:true,gameplayOwnershipImplemented:false};
  } finally {await context.close();}
}

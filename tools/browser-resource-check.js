async (page) => {
  async function boot(){
    await page.reload();
    await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
    await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3);
    await page.evaluate(() => window.dstWorkbench.pause());
  }
  await boot();
  const first = await page.evaluate(() => window.dstWorkbench.resourceTest());
  const second = await page.evaluate(() => window.dstWorkbench.resourceTest());
  for(const role of ['client','master','caves']){
    const a=first.find(value=>value.role===role),b=second.find(value=>value.role===role);
    if(!a||!b||a.bytes!==1398246||a.sha256!==b.sha256||a.indexed<10000||b.stats.fetches!==a.stats.fetches||b.stats.hits<=a.stats.hits) throw new Error('Resource streaming/cache failed');
    if(b.stats.cacheBytes>32*1024*1024)throw new Error('Resource cache exceeds its budget');
  }
  await boot();
  const restored=await page.evaluate(() => window.dstWorkbench.resourceTest());
  if(restored.some(value=>value.stats.fetches!==0||value.stats.diskHits<1))throw new Error('Resource disk cache did not survive reload');
  return { browser: await page.evaluate(() => navigator.userAgent), resources: second, diskCacheAfterReload: restored.map(r=>({role:r.role,...r.stats})) };
}

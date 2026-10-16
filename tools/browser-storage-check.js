async (page) => {
  const first = '1234567890abcdef1234567890abcdef';
  const second = 'fedcba0987654321fedcba0987654321';
  async function boot() {
    await page.reload();
    await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
    await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3);
    await page.evaluate(() => window.dstWorkbench.pause());
  }
  await boot();
  const written = await page.evaluate(token => window.dstWorkbench.storageTest(token), first);
  if(written.length !== 3 || written.some(r => r.after !== first)) throw new Error('WASM persistent write failed');
  await boot();
  const loaded = await page.evaluate(token => window.dstWorkbench.storageTest(token), second);
  if(loaded.length !== 3 || loaded.some(r => r.before !== first || r.after !== second)) throw new Error('IDBFS did not survive full page reload');
  return { browser: await page.evaluate(() => navigator.userAgent), reloadSurvived: true, roles: loaded.map(r => r.role) };
}

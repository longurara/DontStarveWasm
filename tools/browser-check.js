async (page) => {
  await page.reload();
  await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3, { timeout: 30000 });
  await page.evaluate(() => window.dstWorkbench.pause());
  await page.getByRole('button', { name: 'Use(5)', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench.state.snapshot.uses === 95);
  const saved = await page.evaluate(() => window.dstWorkbench.save());
  await page.getByRole('button', { name: 'Use(5)', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench.state.snapshot.uses === 90);
  await page.evaluate(() => window.dstWorkbench.restore());
  const state = await page.evaluate(() => window.dstWorkbench.state);
  if (state.snapshot.uses !== 95 || state.snapshot.tick !== saved.tick) throw new Error('Checkpoint round trip failed');
  const tests = await page.evaluate(() => window.dstWorkbench.selfTest());
  if (tests.length !== 3 || tests.some(s => !s.includes('verified'))) throw new Error('WASM worker checks failed');
  const log = await page.getByLabel('Runtime log').innerText();
  if (!log.includes('WebGL 2.0')) throw new Error('WebGL2 asset preview did not initialize');
  return { browser: await page.evaluate(() => navigator.userAgent), wasmWorkers: state.workers, checkpointUses: state.snapshot.uses, checkpointTick: state.snapshot.tick, checks: tests, webgl2: true };
}

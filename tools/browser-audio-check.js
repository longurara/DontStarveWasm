async (page) => {
  await page.reload();
  await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3);
  await page.evaluate(() => window.dstWorkbench.pause());
  await page.getByRole('button', { name: 'Thử sample âm thanh gốc', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench.audio?.pcmVerified);
  const audio=await page.evaluate(() => window.dstWorkbench.audio);
  if(audio.context!=='running'||audio.name!=='Pickup_item'||audio.channels!==1||audio.sampleRate!==32000) throw new Error('Native audio pipeline failed');
  return { browser: await page.evaluate(() => navigator.userAgent), audio };
}

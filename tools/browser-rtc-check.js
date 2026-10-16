async (page) => {
  await page.reload();
  await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3);
  await page.evaluate(() => window.dstWorkbench.pause());
  await page.getByRole('button', { name: 'Tạo phòng thử', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('invite').textContent.includes('.'));
  const invitation = await page.locator('#invite').innerText();
  const before = await page.evaluate(() => window.dstWorkbench.state.snapshot.uses);
  const guest = await page.context().newPage();
  try {
    await guest.goto(page.url());
    await guest.getByLabel('Mã mời').fill(invitation);
    await guest.getByRole('button', { name: 'Vào phòng thử', exact: true }).click();
    await guest.waitForFunction(() => window.dstWorkbench?.state.peers === 1 && window.dstWorkbench.state.snapshot, { timeout: 30000 });
    await guest.getByRole('button', { name: 'Use(5)', exact: true }).click();
    await page.waitForFunction(value => window.dstWorkbench.state.snapshot.uses === value, before - 5);
    await guest.waitForFunction(value => window.dstWorkbench.state.snapshot.uses === value, before - 5);
    return { transport: 'actual RTCDataChannel over loopback', hostWorkers: 3, guestWorkers: 1, peers: 1, hostUses: before - 5, guestUses: before - 5, turnVerified: false };
  } finally {
    await guest.close();
  }
}

async (page) => {
  await page.reload();
  await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3);
  await page.evaluate(() => window.dstWorkbench.pause());
  await page.getByRole('button', { name: 'Tạo phòng thử', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('invite').textContent.includes('.'));
  const invitation = await page.locator('#invite').innerText();
  const guests = [];
  try {
    for (let i = 0; i < 5; i++) {
      const guest = await page.context().newPage();
      guests.push(guest);
      await guest.goto(page.url());
      await guest.getByLabel('Mã mời').fill(invitation);
      await guest.getByRole('button', { name: 'Vào phòng thử', exact: true }).click();
      await guest.waitForFunction(() => window.dstWorkbench?.state.peers === 1 && window.dstWorkbench.state.snapshot);
      await guest.getByRole('button', { name: 'Use(5)', exact: true }).click();
      await page.waitForFunction(value => window.dstWorkbench.state.snapshot.uses === value, 100 - (i + 1) * 5);
    }
    for (const guest of guests) await guest.waitForFunction(() => window.dstWorkbench.state.snapshot.uses === 75);
    return { transport: 'RTCDataChannel loopback', players: 6, authoritativeUses: 75, synchronizedGuests: guests.length, internetAndTurnVerified: false };
  } finally {
    for (const guest of guests) await guest.close();
  }
}

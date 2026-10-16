async (page) => {
  await page.reload();
  await page.getByRole('button', { name: 'Khởi động WASM', exact: true }).click();
  await page.waitForFunction(() => window.dstWorkbench?.state.snapshot && window.dstWorkbench.state.workers === 3);
  await page.evaluate(() => window.dstWorkbench.pause());
  const canvas=page.getByLabel('Original Wilson animation preview');await canvas.click();
  await page.keyboard.down('w');await page.keyboard.down('Shift');
  await page.waitForFunction(async()=>{const state=await window.dstWorkbench.inputState();return state.w&&state.shift;});
  const held=await page.evaluate(()=>window.dstWorkbench.inputState());
  await page.getByRole('button', { name: 'Kiểm chứng runtime', exact: true }).focus();
  await page.waitForFunction(async()=>{const state=await window.dstWorkbench.inputState();return !state.w&&!state.shift;});
  await page.keyboard.up('w');await page.keyboard.up('Shift');
  const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.waitForFunction(async()=>(await window.dstWorkbench.inputState()).mouseLeft);
  const mouse=await page.evaluate(()=>window.dstWorkbench.inputState());await page.mouse.up();
  await page.waitForFunction(async()=>!(await window.dstWorkbench.inputState()).mouseLeft);
  return {browser:await page.evaluate(()=>navigator.userAgent),held,mouse,released:await page.evaluate(()=>window.dstWorkbench.inputState())};
}

async (page) => {
  await page.reload();await page.getByRole('button',{name:'Khởi động WASM',exact:true}).click();
  await page.waitForFunction(()=>window.dstWorkbench?.state.workers===3&&window.dstWorkbench.state.snapshot);
  await page.evaluate(()=>window.dstWorkbench.pause());
  const before=await page.evaluate(()=>window.dstWorkbench.state.snapshot);
  const runs=[];
  // Repeat to verify that unload/reload does not leave stale prefab ownership.
  for(let run=0;run<2;++run){
    const results=await page.evaluate(()=>window.dstWorkbench.animationTest());
    if(results.length!==3)throw new Error('Missing animation worker');
    for(const {role,build,animation,cache,file,atlas,resourceRequests,sourceFilesRemain,heapBytes} of results){
      if(file.bytes!==109||file.sha256!=='ee2050484874d4ad6e6bbbc7b27ec679367ce846a83738bdd07dd75b4067a501'||!file.terminated||file.references!==1)throw new Error('Native FILE resource differs');
      if(build.build!=='wilson'||build.symbols!==15||build.vertices!==3192||build.textures!==1)throw new Error('Native BILD metadata differs');
      if(build.vertexSha256!=='44678650d3462befd3241c553068302714eda9f9a16238fa12f2855746c1ac0e')throw new Error('Native BILD mesh differs');
      if(build.symbolFrameSha256!=='d9aba9d68891bf20527c8b367d15fff1244d13fc78960adfd0cbc2f651aff627')throw new Error('Native symbol frames differ');
      if(animation.frames!==97||animation.elements!==4043||animation.clips.length!==11)throw new Error('Native ANIM metadata differs');
      if(animation.elementSha256!=='82e85e08a8257c76c68dd340b76a4a69c86788d1821d7feef8f5c110732d73b3')throw new Error('Native ANIM elements differ');
      const frames={run_pre:4,run_loop:16,run_pst:8,corpse:2,corpse_hit:11};
      for(const clip of animation.clips)if(frames[clip.name]!==clip.frames||clip.rate!==30||clip.bank!==75779832)throw new Error('Native animation length differs');
      const refs=role==='client'?0:1;
      if(atlas.texture!=='images/global.tex'||atlas.uvSha256!=='c9579206d2039fca6d73720e4055938e68c9aebd38a1379e009f413c51d5ac0a'||atlas.elements.length!==2||atlas.references!==refs||atlas.rendererReady)throw new Error('Native ATLAS data differs');
      const expectedRequests=['anim/player_basic.zip','anim/wilson.zip','images/global.xml','klump/strings/unused.txt'];
      if(JSON.stringify([...resourceRequests].sort())!==JSON.stringify(expectedRequests))throw new Error('CPU resource probe fetched unexpected texture/source data');
      if(build.references!==refs||animation.references!==refs||cache.bundles!==2||cache.retainedBytes>cache.budget)throw new Error('Resource ownership/budget differs');
      if(sourceFilesRemain||heapBytes>1024**3||build.rendererReady||animation.rendererReady)throw new Error('Incorrect resource lifecycle/readiness');
    }
    runs.push(results.map(({role,cache,heapBytes})=>({role,retainedBytes:cache.retainedBytes,heapBytes})));
  }
  const after=await page.evaluate(()=>window.dstWorkbench.state.snapshot);
  if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Probe modified diagnostic gameplay');
  return {browser:await page.evaluate(()=>navigator.userAgent),compatibility:await page.evaluate(()=>window.dstWorkbench.state.compatibility),runs,engineDecoderVerified:true,gameplayRendererImplemented:false};
}

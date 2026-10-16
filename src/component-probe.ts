/** Tests native component ownership inside the isolated diagnostic scene. */
export function componentProbe(engine:any,evaluate:any,resources:any,role:string){
  const before=evaluate('return _WEB_Snapshot()'),entities=engine._dst_entity_count(),fetches=resources.stats.fetches;
  const postBefore=evaluate('return json.encode_compliant(WebComponents.PostProcessor())');
  const postEnabled=evaluate('return tostring(WebComponents.PostProcessor().enabled)');
  const fontsBefore=evaluate('return json.encode_compliant(WebFonts.Registry())');
  let created=false;
  try{
    evaluate('WEB_COMPONENT_BROWSER=CreateEntity("web_component_browser");WEB_COMPONENT_BROWSER.persists=false;WEB_COMPONENT_BROWSER.entity:AddTransform();WEB_COMPONENT_BROWSER.entity:SetCanSleep(false)');created=true;
    const result=JSON.parse(evaluate(`
      local entity=WEB_COMPONENT_BROWSER
      local result={rendererReady=false}
      local font=entity.entity:AddFontManager()
      local font2=entity.entity:AddFontManager()
      assert(type(font)=="userdata" and font~=font2 and entity.FontManager==font2)
      local state=WebComponents.FontManager(entity.GUID)
      assert(state.typeId==0xc0ce008f and state.sharedRegistry and not state.rendererReady)
      assert(WebFonts.Registry("web_component_font_missing")==nil)
      font:RegisterFont("web_port/missing_font.zip","web_component_font_missing",{})
      font2:RegisterFont("fonts/talkingfont.zip","WEB_COMPONENT_FONT_MISSING")
      assert(not WebFonts.Registry("web_component_font_missing").resolved)
      result.fontManagerVerified=true
      if TheNet:IsDedicated() then
        local first=entity.entity:AddShadowManager()
        local second=entity.entity:AddShadowManager()
        assert(type(first)=="userdata" and first~=second and entity.ShadowManager==second)
        local road=entity.entity:AddRoadManager()
        local road2=entity.entity:AddRoadManager()
        assert(type(road)=="userdata" and road~=road2 and entity.RoadManager==road2)
        road:AddControlPoint(999,888)
        road:BeginRoad()
        road2:AddControlPoint(0.1,-0.333333333333)
        road:SetStripWrapMode(2.75,9.8,-4.9)
        road:SetStripUVAnimStep(2,1.25,-3.5)
        road2:BeginRoad()
        local state=WebComponents.Road(entity.GUID)
        assert(state.typeId==0xdf2fd08d and state.roadIndex==1 and #state.points==2)
        assert(state.points[1][1]==999 and state.points[2][1]==0.10000000149011612)
        assert(state.strips[1][3].wrap[1]==9 and state.strips[1][3].wrap[2]==-4)
        assert(state.strips[1][3].uv[2]==-3.5 and state.strips[2][3].uv[2]==0)
        assert(not road:IsOnRoad(0.1,10,-0.333333333333) and not state.hasQuadTree)
        local ok,error=pcall(road.GenerateQuadTree,road)
        assert(not ok and string.find(error,"UNIMPLEMENTED_NATIVE",1,true))
        result.roadVerified=true
        local envelopes=entity.entity:AddEnvelopeManager()
        local envelopes2=entity.entity:AddEnvelopeManager()
        assert(type(envelopes)=="userdata" and envelopes~=envelopes2 and entity.EnvelopeManager==envelopes2)
        envelopes:AddColourEnvelope("web_colour",{{0,{1,0.5,0.1,0}},{1,{-1,2,1/255,127.5/255}}})
        envelopes2:AddVector2Envelope("web_vector",{{0,{0.1,-0.333333333333}},{1,{123.456789,-7.654321}}})
        envelopes:AddFloatEnvelope("web_empty",{})
        local ok,error=pcall(envelopes.AddFloatEnvelope,envelopes,"retail_bug",{{0,1}})
        assert(not ok)
        local state=WebComponents.Envelope(entity.GUID)
        assert(state.typeId==0x391ccfb0 and not state.consumerReady and #state.entries==3)
        assert(state.entries[1].pointBits=="00000000ff801a000000803f00ff0180")
        assert(state.entries[2].pointBits=="00000000cdcccc3dabaaaabe0000803fe0e9f64233f0f4c0")
        result.envelopeVerified=true
        local post=entity.entity:AddPostProcessor()
        local post2=entity.entity:AddPostProcessor()
        assert(type(post)=="userdata" and post~=post2 and entity.PostProcessor==post2)
        local id=post:AddUniformVariable("web_post_four",4)
        assert(id==2612513786)
        post2:SetUniformVariable(id,4,5,6,7)
        post:SetUniformVariable(id,nil,0.1,{},"-123.456789")
        post2:SetPostProcessingEnabled(false)
        local s0=post:AddTextureSampler("images/shadow.tex")
        local s1=post2:AddTextureSampler("images/shadow.tex")
        assert(s0==0 and s1==1)
        post:SetTextureSamplerState(s0,2.9)
        post2:SetTextureSamplerFilter(s0,1.9,2.1,3.9)
        post:SetTextureSamplerState(s1,4294967297)
        local state=WebComponents.PostProcessor(entity.GUID)
        assert(state.typeId==0xf1424772 and not state.rendererReady and not state.enabled)
        assert(state.uniforms[1].valueBits=="00008040cdcccc3d0000c040e0e9f6c2")
        assert(state.samplers[1].textureHandle==-1 and state.samplers[1].wrap==2 and state.samplers[1].minFilter==1)
        assert(state.samplers[2].wrap==-2147483648 and state.samplers[2].mipFilter==3)
        local ok,error=pcall(post.AddSamplerEffect,post)
        assert(not ok and string.find(error,"UNIMPLEMENTED_NATIVE",1,true))
        post:SetPostProcessingEnabled(${postEnabled})
        result.postProcessorVerified=true
        first:SetTexture("web_port/missing_shadow.tex")
        entity.entity:CallPrefabConstructionComplete()
        local state=WebComponents.Inspect(entity.GUID)
        assert(state.typeId==0x4a610c8d and state.textureHandle==-1 and not state.rendererReady)
        result.created=true;result.textureHandle=state.textureHandle
        local ok,error=pcall(first.GenerateStaticShadows,first)
        assert(not ok and string.find(error,"UNIMPLEMENTED_NATIVE",1,true))
        entity:Remove()
        local ok,error=pcall(entity.entity.AddShadowManager,entity.entity)
        assert(not ok and string.find(error,"removed entity",1,true))
        local ok,error=pcall(first.SetTexture,first,"images/shadow.tex")
        assert(not ok and string.find(error,"owner is removed",1,true))
        local ok,error=pcall(road.BeginRoad,road)
        assert(not ok and string.find(error,"owner is removed",1,true))
        local ok,error=pcall(envelopes.AddColourEnvelope,envelopes,"stale",{})
        assert(not ok and string.find(error,"owner is removed",1,true))
        local ok,error=pcall(post.SetPostProcessingEnabled,post,true)
        assert(not ok and string.find(error,"owner is removed",1,true))
        result.retiredRejected=true
      else
        local ok,error=pcall(entity.entity.AddShadowManager,entity.entity)
        assert(not ok and string.find(error,"client ShadowManager renderer",1,true))
        local ok,error=pcall(entity.entity.AddRoadManager,entity.entity)
        assert(not ok and string.find(error,"client RoadManager renderer",1,true))
        local ok,error=pcall(entity.entity.AddEnvelopeManager,entity.entity)
        assert(not ok and string.find(error,"client EnvelopeManager consumer",1,true))
        local ok,error=pcall(entity.entity.AddPostProcessor,entity.entity)
        assert(not ok and string.find(error,"client PostProcessor render graph",1,true))
        result.created=false
        result.roadVerified=true
        result.envelopeVerified=true
        result.postProcessorVerified=true
        entity:Remove()
      end
      assert(WebComponents.Inspect().shadowManagers==0)
      local roads=WebComponents.Road()
      assert(roads.roadManagers==0 and roads.totalPoints==0 and roads.totalRoads==0)
      local envelopes=WebComponents.Envelope()
      assert(envelopes.managers==0 and envelopes.totalEntries==0 and envelopes.totalPoints==0)
      local post=WebComponents.PostProcessor()
      assert(post.managers==0 and post.uniformCount==0 and post.samplerCount==0)
      assert(WebComponents.FontManager().fontManagers==0)
      assert(WebFonts.Registry("web_component_font_missing")~=nil)
      TheSim:UnloadFont("web_component_font_missing")
      local ok,error=pcall(font.RegisterFont,font,"x","y")
      assert(not ok and string.find(error,"owner is removed",1,true))
      return json.encode_compliant(result)
    `));
    if(resources.stats.fetches!==fetches)throw new Error('Component state probe fetched a resource');
    return {role,...result,heapBytes:engine.HEAPU8.buffer.byteLength};
  }finally{
    if(created)evaluate(`if WEB_COMPONENT_BROWSER and WEB_COMPONENT_BROWSER:IsValid() then if WEB_COMPONENT_BROWSER.PostProcessor then WEB_COMPONENT_BROWSER.PostProcessor:SetPostProcessingEnabled(${postEnabled}) end;WEB_COMPONENT_BROWSER:Remove() end;WEB_COMPONENT_BROWSER=nil`);
    if(engine._dst_entity_count()!==entities||evaluate('return _WEB_Snapshot()')!==before)throw new Error('Component probe changed diagnostic scene/tick');
    if(evaluate('return json.encode_compliant(WebComponents.PostProcessor())')!==postBefore)throw new Error('Component probe changed shared PostProcessor state');
    evaluate('TheSim:UnloadFont("web_component_font_missing")');
    if(evaluate('return json.encode_compliant(WebFonts.Registry())')!==fontsBefore)throw new Error('Component probe changed font aliases');
  }
}

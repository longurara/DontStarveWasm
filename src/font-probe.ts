import {AssetPreview} from './asset-preview';
import {texturePixels} from './texture-probe';
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))).map(value=>value.toString(16).padStart(2,'0')).join('');
export async function fontProbe(engine:any,evaluations:any,resources:any,preview:AssetPreview){
  const evaluate=evaluations.evaluate,gl=preview.context,textures=preview.textures;
  const before=evaluate('return _WEB_Snapshot()'),cacheBefore=evaluate('return json.encode_compliant(WebTextures.Inspect())'),fontBefore=evaluate('return json.encode_compliant(WebFonts.Inspect())'),registryBefore=evaluate('return json.encode_compliant(WebFonts.Registry())');
  const gpuBefore={bytes:textures.bytes,count:textures.textures.size};let peakGpuBytes=textures.bytes;
  const entitiesBefore=engine._dst_entity_count();let managerCreated=false;
  const response=await fetch('/generated/preview/font-provenance.json');if(!response.ok)throw new Error('Missing independent FONT oracle');
  const catalog=await response.json(),results=[],loaded:string[]=[];
  try{
    for(const [i,row] of catalog.cases.filter((row:any)=>row.rgbaSha256).entries()){
      if(resources.index.files[row.path].sha256!==row.sourceSha256)throw new Error('Font source/index mismatch');
      const name='web_font_probe_'+i;
      await evaluations.evaluateAsync(`TheSim:RegisterPrefab("${name}",{{type="FONT",file=${JSON.stringify(row.path)}}},{});TheSim:LoadPrefabs({"${name}"})`);loaded.push(name);
      evaluate(`TheSim:LoadFont(${JSON.stringify(row.path)},"web_browser_font_${i}",${i===0})`);
      const font=JSON.parse(evaluate(`return json.encode_compliant(WebFonts.Inspect(${JSON.stringify(row.path)}))`));
      for(const field of ['sourceSha256','textureSha256','glyphSha256','kerningSha256','glyphs','kernings','material','lineHeight','base','width','height','outline'])if(font[field]!==row[field])throw new Error(row.path+' metadata mismatch: '+field);
      if(!font.textureReady||font.rendererReady)throw new Error('Font texture/world readiness mismatch');
      const textureInfo=JSON.parse(evaluate(`return json.encode_compliant(WebTextures.Inspect(${JSON.stringify(font.textureKey)}))`)),texture=textures.get(textureInfo.id);
      if(!texture?.complete)throw new Error('Font texture resource missing');
      const digest=await sha(texturePixels(gl,texture.texture,0,row.width,row.height));if(digest!==row.rgbaSha256)throw new Error('Original font RGBA/channel mismatch: '+row.path);
      peakGpuBytes=Math.max(peakGpuBytes,textures.bytes);results.push({path:row.path,glyphs:font.glyphs,kernings:font.kernings,material:font.material,rgbaSha256:digest});
    }
    const fetches=resources.stats.fetches;
    evaluate('WEB_FONT_BROWSER_MANAGER=CreateEntity("font_browser_manager");WEB_FONT_BROWSER_MANAGER.persists=false;WEB_FONT_BROWSER_MANAGER.entity:AddFontManager()');managerCreated=true;
    evaluate(`
      local manager=WEB_FONT_BROWSER_MANAGER.FontManager
      manager:RegisterFont("fonts/bellefair50.zip","web_browser_manager_font",false)
      assert(not WebFonts.Inspect("fonts/bellefair50.zip").colourEnabled)
      manager:RegisterFont("fonts/talkingfont.zip","WEB_BROWSER_MANAGER_FONT",{})
      assert(WebFonts.Registry("web_browser_manager_font").path=="fonts/bellefair50.zip")
      assert(WebFonts.Inspect("fonts/bellefair50.zip").references==1)
      WEB_FONT_BROWSER_MANAGER:Remove()
      assert(WebFonts.Registry("web_browser_manager_font").resolved and WebComponents.FontManager().fontManagers==0)
      TheSim:LoadFont("web_port/missing_font.zip","web_browser_missing")
      TheSim:LoadFont("fonts/talkingfont.zip","WEB_BROWSER_MISSING")
      assert(not WebFonts.Registry("web_browser_missing").resolved)
      TheSim:LoadFont("fonts/fallback_full_packed.zip","WEB_BROWSER_FONT_2")
      assert(WebFonts.Registry("web_browser_font_2").path=="fonts/talkingfont.zip")
      TheSim:AdjustFontAdvance("web_browser_font_2",-2)
      TheSim:SetupFontFallbacks("web_browser_font_2",{"web_browser_font_0","web_browser_font_1","web_browser_font_0"})
      TheSim:SetupFontFallbacks("web_browser_font_2",{})
      local font=WebFonts.Inspect("fonts/talkingfont.zip")
      assert(font.advance==-2 and font.references==1 and font.colourEnabled)
      assert(#font.fallbacks==2 and font.fallbacks[1]=="fonts/bellefair50.zip" and font.fallbacks[2]=="fonts/fallback_full_packed.zip")
      assert(not WebFonts.Inspect("fonts/bellefair50.zip").colourEnabled)
      TheSim:UnloadFont("web_browser_font_0")
      assert(WebFonts.Registry("web_browser_font_0")==nil and WebFonts.Inspect("fonts/bellefair50.zip")==nil)
      assert(#WebFonts.Inspect("fonts/talkingfont.zip").fallbacks==1)
    `);
    if(resources.stats.fetches!==fetches)throw new Error('Font alias operation fetched a resource');
    return {results,exactPixels:true,registryVerified:true,fontManagerVerified:true,peakGpuBytes,heapBytes:engine.HEAPU8.buffer.byteLength,rendererReady:false};
  }finally{
    if(managerCreated)evaluate('if WEB_FONT_BROWSER_MANAGER:IsValid() then WEB_FONT_BROWSER_MANAGER:Remove() end;WEB_FONT_BROWSER_MANAGER=nil');
    for(const name of loaded.reverse())evaluate(`TheSim:UnloadPrefabs({"${name}"})`);
    evaluate('TheSim:UnloadFont("web_browser_missing")');
    if(textures.bytes!==gpuBefore.bytes||textures.textures.size!==gpuBefore.count||evaluate('return json.encode_compliant(WebTextures.Inspect())')!==cacheBefore||evaluate('return json.encode_compliant(WebFonts.Inspect())')!==fontBefore||evaluate('return json.encode_compliant(WebFonts.Registry())')!==registryBefore)throw new Error('Font probe leaked resources');
    if(evaluate('return _WEB_Snapshot()')!==before)throw new Error('Font probe changed diagnostic scene/tick');preview.draw(engine._dst_tick_count());
    if(engine._dst_entity_count()!==entitiesBefore)throw new Error('Font probe leaked manager entity');
  }
}

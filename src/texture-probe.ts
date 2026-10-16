import {AssetPreview} from './asset-preview';
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))).map(value=>value.toString(16).padStart(2,'0')).join('');
export function texturePixels(gl:WebGL2RenderingContext,texture:WebGLTexture,level:number,width:number,height:number){
  const previous={read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),buffer:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)};
  const parameters=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS],saved=parameters.map(parameter=>gl.getParameter(parameter));
  const fb=gl.createFramebuffer();
  try{
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('KTEX readback framebuffer incomplete');
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);[1,0,0,0].forEach((value,i)=>gl.pixelStorei(parameters[i],value));
    const bytes=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('KTEX readback error '+error);return bytes;
  }finally{
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous.read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,previous.draw);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,previous.buffer);
    parameters.forEach((parameter,i)=>gl.pixelStorei(parameter,saved[i]));gl.deleteFramebuffer(fb);
  }
}
export async function textureProbe(engine:any,evaluations:any,resources:any,preview:AssetPreview){
  const evaluate=evaluations.evaluate,gl=preview.context,textures=preview.textures;
  const before=evaluate('return _WEB_Snapshot()'),cacheBefore=evaluate('return json.encode_compliant(WebTextures.Inspect())');
  const gpuBefore={bytes:textures.bytes,count:textures.textures.size};
  const response=await fetch('/generated/preview/texture-provenance.json');if(!response.ok)throw new Error('Missing independent KTEX pixel oracle');
  const catalog=await response.json(),results=[],loaded:string[]=[];
  const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE3);
  const previous={texture:gl.getParameter(gl.TEXTURE_BINDING_2D),buffer:gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)};
  const parameters=[gl.UNPACK_ALIGNMENT,gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS],saved=parameters.map(parameter=>gl.getParameter(parameter));
  const canary=gl.createTexture(),unpack=gl.createBuffer();
  try{
    gl.bindTexture(gl.TEXTURE_2D,canary);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpack);gl.bufferData(gl.PIXEL_UNPACK_BUFFER,512,gl.STATIC_DRAW);
    [8,true,true,7,2,1].forEach((value,i)=>gl.pixelStorei(parameters[i],value));
    for(const [i,row] of catalog.cases.entries()){
      if(!row.path.includes('#')){
        if(resources.index.files[row.path].sha256!==row.sha256)throw new Error('KTEX catalog/source index mismatch');
        const name='web_texture_probe_'+i,atlas=row.path.replace(/\.tex$/,'.xml'),dynamic=i===2;
        await evaluations.evaluateAsync(`TheSim:RegisterPrefab("${name}",{{type="${dynamic?'DYNAMIC_ATLAS':'ATLAS'}",file=${JSON.stringify(atlas)}}},{});TheSim:LoadPrefabs({"${name}"})`);loaded.push(name);
        evaluate(`assert(TheSim:AtlasContains(${JSON.stringify(atlas)},WebAtlases.Inspect(${JSON.stringify(atlas)}).elements[1].id))`);
        if(dynamic){
          const deferred=JSON.parse(evaluate(`return json.encode_compliant(WebAtlases.Inspect(${JSON.stringify(atlas)}))`));
          if(deferred.textureLoaded||deferred.textureReady)throw new Error('DYNAMIC_ATLAS uploaded texture eagerly');
          await evaluations.evaluateAsync(`WebAtlases.BindTexture(${JSON.stringify(atlas)})`);
        }
      }
      const value=JSON.parse(evaluate(`return json.encode_compliant(WebTextures.Inspect(${JSON.stringify(row.path)}))`));
      if(value.sourceSha256!==row.sha256||!value.textureReady)throw new Error('Original KTEX GPU resource missing');
      const texture=textures.get(value.id);if(!texture?.complete)throw new Error('Texture registry mismatch');
      for(const [level,mip] of row.mips.entries()){
        const digest=await sha(texturePixels(gl,texture.texture,level,mip.width,mip.height));
        if(digest!==mip.rgbaSha256)throw new Error(row.path+' mip '+level+' differs from independent RGBA oracle');
      }
      results.push({path:row.path,mips:row.mips.length,codec:row.codec});
    }
    if(gl.getParameter(gl.ACTIVE_TEXTURE)!==gl.TEXTURE3||gl.getParameter(gl.TEXTURE_BINDING_2D)!==canary||gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)!==unpack||parameters.some((parameter,i)=>gl.getParameter(parameter)!==[8,true,true,7,2,1][i]))throw new Error('Texture upload changed caller GL state');
    return {results,mips:results.reduce((sum,row)=>sum+row.mips,0),exactPixels:true,gpuBytes:textures.bytes,rendererReady:false};
  }finally{
    for(const name of loaded.reverse())evaluate(`TheSim:UnloadPrefabs({"${name}"})`);
    gl.bindTexture(gl.TEXTURE_2D,previous.texture);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,previous.buffer);parameters.forEach((parameter,i)=>gl.pixelStorei(parameter,saved[i]));gl.activeTexture(active);gl.deleteTexture(canary);gl.deleteBuffer(unpack);
    if(textures.bytes!==gpuBefore.bytes||textures.textures.size!==gpuBefore.count||evaluate('return json.encode_compliant(WebTextures.Inspect())')!==cacheBefore)throw new Error('Texture probe leaked CPU/GPU resources');
    if(evaluate('return _WEB_Snapshot()')!==before)throw new Error('Texture probe changed diagnostic scene/tick');preview.draw(engine._dst_tick_count());
  }
}

/** Bounded WebGL2 storage fed by the WASM KTEX decoder, one mip at a time. */
export class NativeTextures {
  constructor(gl,{budget=256*1024*1024}={}){this.gl=gl;this.budget=budget;this.bytes=0;this.textures=new Map();}
  ready(){return !this.gl.isContextLost();}
  get(id){return this.textures.get(id>>>0);}
  has(id){const value=this.get(id);return !!value?.complete&&this.ready()&&this.gl.isTexture(value.texture);}
  begin(id,width,height,levels){
    id=id>>>0;const gl=this.gl;if(!this.ready())throw new Error('WebGL texture context is lost');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||height>gl.getParameter(gl.MAX_TEXTURE_SIZE)||!Number.isInteger(levels)||levels<1||levels>20)throw new Error('Invalid WebGL texture dimensions/mips');
    this.release(id);let bytes=0,w=width,h=height;
    for(let i=0;i<levels;++i){bytes+=w*h*4;w=Math.max(1,w>>1);h=Math.max(1,h>>1);}
    if(bytes>this.budget-this.bytes)throw new Error('WebGL texture cache exceeds GPU byte budget');
    const texture=gl.createTexture();if(!texture)throw new Error('Cannot allocate WebGL texture');
    const value={texture,width,height,levels,bytes,received:new Set(),complete:false};this.textures.set(id,value);this.bytes+=bytes;
  }
  upload(id,level,width,height,pixels){
    const value=this.get(id),gl=this.gl;
    if(!value||value.complete||!this.ready()||!Number.isInteger(level)||level<0||level>=value.levels||value.received.has(level)||width!==Math.max(1,value.width>>level)||height!==Math.max(1,value.height>>level)||pixels.byteLength!==width*height*4)throw new Error('Invalid WebGL texture mip upload');
    const previous={texture:gl.getParameter(gl.TEXTURE_BINDING_2D),buffer:gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)};
    const parameters=[gl.UNPACK_ALIGNMENT,gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS];
    const saved=parameters.map(parameter=>gl.getParameter(parameter));
    try{
      gl.bindTexture(gl.TEXTURE_2D,value.texture);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
      [1,false,false,gl.NONE,0,0,0].forEach((setting,i)=>gl.pixelStorei(parameters[i],setting));
      gl.texImage2D(gl.TEXTURE_2D,level,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('WebGL texture upload error '+error);
      value.received.add(level);
    }finally{parameters.forEach((parameter,i)=>gl.pixelStorei(parameter,saved[i]));gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,previous.buffer);gl.bindTexture(gl.TEXTURE_2D,previous.texture);}
  }
  finish(id){
    const value=this.get(id),gl=this.gl;
    if(!value||value.received.size!==value.levels||!this.ready())throw new Error('Incomplete WebGL texture');
    const previous=gl.getParameter(gl.TEXTURE_BINDING_2D);
    try{
      gl.bindTexture(gl.TEXTURE_2D,value.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,value.levels-1);
      // Resource upload is ready; native sampler-state selection by material
      // remains separate. The diagnostic mesh viewer uses linear filtering.
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('WebGL texture finalization error '+error);
      value.complete=true;
    }finally{gl.bindTexture(gl.TEXTURE_2D,previous);}
  }
  release(id){id=id>>>0;const value=this.get(id);if(value){this.gl.deleteTexture(value.texture);this.bytes-=value.bytes;this.textures.delete(id);}}
  clear(){for(const id of this.textures.keys())this.release(id);}
  install(engine){
    engine.nativeTextureBackendReady=()=>this.ready();engine.hasNativeTexture=id=>this.has(id);
    engine.beginNativeTexture=(...args)=>this.begin(...args);engine.uploadNativeTexture=(...args)=>this.upload(...args);
    engine.finishNativeTexture=id=>this.finish(id);engine.releaseNativeTexture=id=>this.release(id);
  }
}

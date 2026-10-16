// Desktop GLSL sources remain unchanged in KSH. This adapter performs the
// GLSL ES 3.00 spelling/precision changes required by the WebGL2 backend.
export function webglShaderSource(source,stage){
  if(!['vertex','fragment'].includes(stage)||typeof source!=='string'||source.length>2*1024*1024)throw new Error('Invalid native shader stage');
  if(source.endsWith('\0'))source=source.slice(0,-1);
  if(source.includes('\0'))throw new Error('Embedded NUL in shader source');
  if(/^\s*#version\b/m.test(source))throw new Error('Unsupported source GLSL version');
  source=source.replace(/\r\n?/g,'\n').replace(/\bprecision\s+(?:lowp|mediump|highp)\s+(?:float|int)\s*;/g,'');
  const replacements={attribute:'in',varying:stage==='vertex'?'out':'in',texture2D:'texture',gl_FragColor:'dst_FragColor'};
  source=source.replace(/\b(?:attribute|varying|texture2D|gl_FragColor)\b/g,value=>replacements[value]);
  return '#version 300 es\nprecision highp float;\nprecision highp int;\n'+(stage==='fragment'?'out vec4 dst_FragColor;\n':'')+'#line 1\n'+source;
}

export class NativeShaderPrograms {
  constructor(gl){this.gl=gl;this.programs=new Map();}
  ready(){return !this.gl.isContextLost();}
  compile(id,vertex,fragment,path,fallbackRequested=false){
    id=id>>>0;const gl=this.gl;if(!this.ready())throw new Error('WebGL context is lost');
    const cached=this.programs.get(id);if(cached&&gl.isProgram(cached.program))return cached;
    this.programs.delete(id);
    const shaders=[];let program=null;
    try{
      for(const [stage,source] of [['vertex',vertex],['fragment',fragment]]){
        const shader=gl.createShader(stage==='vertex'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);
        if(!shader)throw new Error('Cannot allocate native '+stage+' shader');shaders.push(shader);
        gl.shaderSource(shader,webglShaderSource(source,stage));gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(path+' '+stage+': '+gl.getShaderInfoLog(shader));
      }
      program=gl.createProgram();if(!program)throw new Error('Cannot allocate native shader program');
      for(const shader of shaders)gl.attachShader(program,shader);
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(path+' link: '+gl.getProgramInfoLog(program));
      const uniforms=[],attributes=[];
      for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);++i){
        const value=gl.getActiveUniform(program,i);uniforms.push({name:value.name,size:value.size,type:value.type,location:gl.getUniformLocation(program,value.name)});
      }
      for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);++i){
        const value=gl.getActiveAttrib(program,i);attributes.push({name:value.name,size:value.size,type:value.type,location:gl.getAttribLocation(program,value.name)});
      }
      const previous=gl.getParameter(gl.CURRENT_PROGRAM);
      try{
        gl.useProgram(program);let unit=0;
        for(const uniform of uniforms)if(uniform.type===gl.SAMPLER_2D){
          if(unit+uniform.size>gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS))throw new Error('Native shader requires too many texture units');
          gl.uniform1iv(uniform.location,Int32Array.from({length:uniform.size},()=>unit++));
        }
      }finally{gl.useProgram(previous);}
      const value={program,uniforms,attributes,path};this.programs.set(id,value);return value;
    }catch(error){
      if(program)gl.deleteProgram(program);
      if(fallbackRequested)throw new Error(String(error)+'; native fallback selection is not implemented');throw error;
    }finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  get(id){return this.programs.get(id>>>0);}
  release(id){id=id>>>0;const value=this.programs.get(id);if(value){this.gl.deleteProgram(value.program);this.programs.delete(id);}}
  clear(){for(const id of this.programs.keys())this.release(id);}
  install(engine){
    engine.nativeShaderBackendReady=()=>this.ready();
    engine.compileNativeShader=(...args)=>this.compile(...args);
    engine.releaseNativeShader=id=>this.release(id);
  }
}

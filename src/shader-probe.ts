import {AssetPreview} from './asset-preview';

function uiPixels(gl:WebGL2RenderingContext,program:WebGLProgram){
  const previous={program:gl.getParameter(gl.CURRENT_PROGRAM),fb:gl.getParameter(gl.FRAMEBUFFER_BINDING),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),viewport:gl.getParameter(gl.VIEWPORT),active:gl.getParameter(gl.ACTIVE_TEXTURE),blend:gl.isEnabled(gl.BLEND),dither:gl.isEnabled(gl.DITHER)};
  gl.activeTexture(gl.TEXTURE0);const previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
  const vao=gl.createVertexArray(),buffer=gl.createBuffer(),sample=gl.createTexture(),target=gl.createTexture(),fb=gl.createFramebuffer();
  try{
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.bindTexture(gl.TEXTURE_2D,target);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Native UI pixel target incomplete');
    gl.bindTexture(gl.TEXTURE_2D,sample);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,64,192,128]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,-1,0,-1,1,0,-1,1,0,1,-1,0,1,1,0]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'POSITION'),uv=gl.getAttribLocation(program,'TEXCOORD0'),colour=gl.getAttribLocation(program,'DIFFUSE');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);gl.disableVertexAttribArray(uv);gl.vertexAttrib2f(uv,.5,.5);gl.disableVertexAttribArray(colour);gl.vertexAttrib4f(colour,.5,.75,.25,.5);
    gl.useProgram(program);gl.uniformMatrix4fv(gl.getUniformLocation(program,'MatrixPVW'),false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));gl.uniform1i(gl.getUniformLocation(program,'SAMPLER[0]'),0);
    gl.viewport(0,0,2,2);gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,6);
    const pixels=new Uint8Array(16);gl.readPixels(0,0,2,2,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('Native UI draw produced GL error');
    return Array.from(pixels);
  }finally{
    gl.bindFramebuffer(gl.FRAMEBUFFER,previous.fb);gl.bindVertexArray(previous.vao);gl.bindBuffer(gl.ARRAY_BUFFER,previous.buffer);gl.bindTexture(gl.TEXTURE_2D,previousTexture);gl.activeTexture(previous.active);gl.useProgram(previous.program);gl.viewport(previous.viewport[0],previous.viewport[1],previous.viewport[2],previous.viewport[3]);
    previous.blend?gl.enable(gl.BLEND):gl.disable(gl.BLEND);previous.dither?gl.enable(gl.DITHER):gl.disable(gl.DITHER);
    gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteTexture(sample);gl.deleteTexture(target);gl.deleteFramebuffer(fb);
  }
}

export async function shaderProbe(engine:any,evaluations:any,resources:any,preview:AssetPreview){
  const evaluate=evaluations.evaluate,gl=preview.context,programs=preview.shaders;
  const before=JSON.parse(evaluate('return _WEB_Snapshot()'));
  if(before.kind!=='engine-diagnostic-v1')throw new Error('Shader probe requires isolated diagnostic scene');
  const cacheBefore=JSON.parse(evaluate('return json.encode_compliant(WebShaders.Inspect())'));
  const gpuBefore=programs.programs.size,results=[],failures=[];let uiPixelResult:number[]|null=null;
  const paths=Object.keys(resources.index.files).filter(path=>path.endsWith('.ksh')).sort();
  try{
    for(const [i,path] of paths.entries()){
      const name='web_shader_probe_'+i;let loaded=false;
      try{
        await evaluations.evaluateAsync(`TheSim:RegisterPrefab("${name}",{{type="SHADER",file=${JSON.stringify(path)}}},{});TheSim:LoadPrefabs({"${name}"})`);loaded=true;
        const shader=JSON.parse(evaluate(`return json.encode_compliant(WebShaders.Inspect(${JSON.stringify(path)}))`));
        if(shader.sourceSha256!==resources.index.files[path].sha256||!shader.programReady)throw new Error('Shader source/compiled state mismatch');
        const id=Number(evaluate(`return hash(${JSON.stringify(path)})`)),program=programs.get(id);
        if(!program)throw new Error('Native shader GPU resource missing');
        for(const active of program.uniforms){
          const base=active.name.replace(/\[0\]$/,'');const native=shader.uniforms.find((value:any)=>value.name===base||value.alias===base);
          const expected:any={0:gl.FLOAT,2:gl.FLOAT_VEC2,3:gl.FLOAT_VEC3,4:gl.FLOAT_VEC4,20:gl.FLOAT_MAT4,43:gl.SAMPLER_2D};
          if(!native||active.type!==expected[native.kind]||active.size>native.count)throw new Error('KSH/GPU uniform reflection mismatch: '+active.name);
        }
        if(shader.name==='ui')uiPixelResult=uiPixels(gl,program.program);
        results.push({path,uniforms:program.uniforms.length,attributes:program.attributes.length});
      }catch(error){failures.push({path,error:String(error)});}
      finally{if(loaded)evaluate(`TheSim:UnloadPrefabs({"${name}"})`);}
    }
    return {results,failures,uiPixels:uiPixelResult,webgl:gl.getParameter(gl.VERSION),rendererReady:false};
  }finally{
    preview.draw(engine._dst_tick_count());
    const cacheAfter=JSON.parse(evaluate('return json.encode_compliant(WebShaders.Inspect())'));
    if(JSON.stringify(cacheAfter)!==JSON.stringify(cacheBefore)||programs.programs.size!==gpuBefore)throw new Error('Native shader probe leaked resource leases');
    if(JSON.stringify(JSON.parse(evaluate('return _WEB_Snapshot()')))!==JSON.stringify(before))throw new Error('Shader probe changed diagnostic scene');
  }
}

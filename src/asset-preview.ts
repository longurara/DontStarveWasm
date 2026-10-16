/** Original BILD/ANIM mesh viewer, not the game renderer or a player prefab. */
import {NativeShaderPrograms} from './shader-programs.mjs';
import {NativeTextures} from './texture-programs.mjs';
export class AssetPreview {
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  readonly shaders: NativeShaderPrograms;
  readonly textures: NativeTextures;
  private buffer: WebGLBuffer;
  private model: any;
  private motion: any;
  private animation: any;
  private texture!: WebGLTexture;

  constructor(private canvas: OffscreenCanvas,private engine:any,private evaluations:any) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.shaders=new NativeShaderPrograms(gl);this.shaders.install(engine);
    this.textures=new NativeTextures(gl);this.textures.install(engine);
    this.buffer=gl.createBuffer()!;
  }
  get context(){return this.gl;}
  async load() {
    await this.evaluations.evaluateAsync('TheSim:RegisterPrefab("web_asset_preview_shader",{{type="SHADER",file="shaders/ui.ksh"}},{});TheSim:LoadPrefabs({"web_asset_preview_shader"})');
    const id=Number(this.evaluations.evaluate('return hash("shaders/ui.ksh")'));
    const native=this.shaders.get(id);if(!native)throw new Error('Native UI program was not compiled');this.program=native.program;
    const [model,motion]=await Promise.all(['/generated/preview/wilson.json','/generated/preview/player_basic.json'].map(async url=>{
      const response=await fetch(url);if(!response.ok)throw new Error('Run tools/assets.py first');return response.json();
    }));
    this.model=model;this.motion=motion;
    this.animation=motion.animations.find((a:any)=>a.name==='run_loop'&&a.facing===5);
    if(!this.animation)throw new Error('Missing original run_loop animation');
    let image:any;
    try{
      image=JSON.parse(await this.evaluations.evaluateAsync(`WebAssets.Decode("anim/wilson.zip");return json.encode_compliant(WebTextures.UploadAnimation("anim/wilson.zip",${JSON.stringify(model.atlases[0])}))`));
    }finally{this.evaluations.evaluate('WebAssets.Release("anim/wilson.zip")');}
    const texture=this.textures.get(image.id);if(!texture?.complete)throw new Error('Original KTEX was not uploaded');this.texture=texture.texture;
    const gl=this.gl;
    this.draw(0);
    return {symbols:Object.keys(model.symbols).length,animations:motion.animations.length,webgl:gl.getParameter(gl.VERSION),shader:'shaders/ui.ksh',texture:'WASM KTEX',textureSha256:image.sourceSha256};
  }
  draw(tick:number) {
    if(!this.animation)return;
    const gl=this.gl;
    const frame=this.animation.frames[Math.floor(tick*this.animation.rate/30)%this.animation.frames.length];
    const geometry:number[]=[];
    const hidden=new Set(['arm_carry','swap_object','swap_hat','hat','hat_hair']);
    for(const item of [...frame.elements].sort((a:any,b:any)=>b.depth-a.depth)){
      const symbol=this.model.symbols[item.symbol];if(!symbol||hidden.has(symbol.name?.toLowerCase()))continue;
      const symbolFrame=symbol.frames.find((f:any)=>item.frame>=f.frame&&item.frame<f.frame+f.duration);
      if(!symbolFrame)continue;
      const [a,b,c,d,tx,ty]=item.matrix;
      for(let i=symbolFrame.offset;i<symbolFrame.offset+symbolFrame.count;i++){
        const [x,y,_z,u,v,atlas]=this.model.vertices[i];
        if(Math.round(atlas)!==0)throw new Error('Multiple atlas preview is not implemented');
        const scale=1.1;
        geometry.push(this.canvas.width*.5+(a*x+b*y+tx)*scale,this.canvas.height*.74+(c*x+d*y+ty)*scale,u,v);
      }
    }
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(.065,.075,.065,1);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geometry),gl.DYNAMIC_DRAW);
    for(const [name,offset] of [['POSITION',0],['TEXCOORD0',8]] as const){
      const location=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,16,offset);
    }
    const colour=gl.getAttribLocation(this.program,'DIFFUSE');gl.disableVertexAttribArray(colour);gl.vertexAttrib4f(colour,1,1,1,1);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'MatrixPVW'),false,new Float32Array([2/this.canvas.width,0,0,0,0,-2/this.canvas.height,0,0,0,0,1,0,-1,1,0,1]));
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(gl.getUniformLocation(this.program,'SAMPLER[0]'),0);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES,0,geometry.length/4);
  }
}

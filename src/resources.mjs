import { unzipSync } from 'fflate';
import { safeAssetPath } from './protocol.mjs';

export async function sha256(bytes) {
  const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
const hashPattern=/^[a-f0-9]{64}$/;
const safePath=name=>{
  safeAssetPath(name);
  if(name.includes(':')||/[\x00-\x1f]/.test(name)||name.split('/').some(part=>!part))throw new Error('Unsafe resource path');
  return name;
};

export class Resources {
  constructor(index,read,{budget=32*1024*1024,cache=null}={}) {
    if(index.gameBuild!=='756039'||index.schemaVersion!==1||index.encoding!=='native-assets-v1')throw new Error('Incompatible resource index');
    if(!Number.isSafeInteger(budget)||budget<8*1024*1024)throw new Error('Resource cache budget must fit one pack');
    if(!index.files||!index.chunks||!index.packs||Object.keys(index.files).length>50000)throw new Error('Invalid resource index');
    this.index=index;this.readPack=read;this.budget=budget;this.disk=cache;this.cache=new Map();this.inflight=new Map();
    this.stats={fetches:0,hits:0,diskHits:0,cacheBytes:0,evictions:0,cacheWriteFailures:0};
    for(const [path,file] of Object.entries(index.files)){
      safePath(path);
      if(!hashPattern.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>128*1024*1024||!Array.isArray(file.chunks))throw new Error('Invalid resource entry: '+path);
      let bytes=0;
      for(const key of file.chunks){
        const chunk=index.chunks[key],pack=chunk&&index.packs[chunk.pack];
        if(!hashPattern.test(key)||!chunk||!hashPattern.test(chunk.pack)||!pack||chunk.key!==key+'.bin'||!Number.isSafeInteger(chunk.bytes)||chunk.bytes<1||chunk.bytes>1024*1024)throw new Error('Invalid resource chunk');
        if(!Number.isSafeInteger(pack.bytes)||pack.bytes<1||pack.bytes>10*1024*1024||!Number.isSafeInteger(pack.expandedBytes)||pack.expandedBytes>8*1024*1024||pack.expandedBytes<chunk.bytes)throw new Error('Invalid resource pack');
        safePath(pack.url);bytes+=chunk.bytes;
      }
      if(bytes!==file.bytes)throw new Error('Resource chunk length mismatch');
    }
  }
  static async open(reference,read,options={}){
    if(reference?.gameBuild!=='756039'||reference.schemaVersion!==1||!hashPattern.test(reference.sha256)||reference.bytes>32*1024*1024)throw new Error('Incompatible resource reference');
    const bytes=await read(safePath(reference.url));
    if(bytes.length!==reference.bytes||await sha256(bytes)!==reference.sha256)throw new Error('Resource index hash mismatch');
    return new Resources(JSON.parse(new TextDecoder().decode(bytes)),read,options);
  }
  exists(path){safePath(path);return Object.hasOwn(this.index.files,path);}
  install(engine){
    const listing=Object.entries(this.index.files).map(([path,file])=>file.bytes+'\t'+path+'\n').join('');
    const bytes=new TextEncoder().encode(listing+'\0'),ptr=engine._malloc(bytes.length);
    if(!ptr)throw new Error('Cannot allocate resource index');
    try{
      engine.HEAPU8.set(bytes,ptr);const count=engine._dst_index_assets(ptr);
      if(count!==Object.keys(this.index.files).length)throw new Error(engine.ccall('dst_result','string',[],[]));
    }finally{engine._free(ptr);}
    engine.fetchNativeResource=path=>this.materialize(engine,path);
  }
  async pack(hash){
    const cached=this.cache.get(hash);
    if(cached){this.cache.delete(hash);this.cache.set(hash,cached);++this.stats.hits;return cached.files;}
    if(this.inflight.has(hash))return this.inflight.get(hash);
    const work=this.loadPack(hash);this.inflight.set(hash,work);
    try{return await work;}finally{this.inflight.delete(hash);}
  }
  async loadPack(hash){
    const entry=this.index.packs[hash];if(!entry)throw new Error('Unknown resource pack');
    let bytes;
    if(this.disk){
      try{
        const response=await this.disk.match('/generated/'+entry.url);
        if(response){const candidate=new Uint8Array(await response.arrayBuffer());
          if(candidate.length===entry.bytes&&await sha256(candidate)===hash){bytes=candidate;++this.stats.diskHits;}
          else await this.disk.delete('/generated/'+entry.url);
        }
      }catch{++this.stats.cacheWriteFailures;}
    }
    if(!bytes){
      bytes=await this.readPack(entry.url);++this.stats.fetches;
      if(bytes.length!==entry.bytes||await sha256(bytes)!==hash)throw new Error('Resource pack hash mismatch');
      if(this.disk)try{await this.disk.put('/generated/'+entry.url,new Response(Uint8Array.from(bytes).buffer));}catch{++this.stats.cacheWriteFailures;}
    }
    const files=unzipSync(bytes);let size=0;
    for(const [name,data] of Object.entries(files)){
      const key=name.slice(0,-4),chunk=this.index.chunks[key];
      if(!chunk||chunk.key!==name||chunk.pack!==hash||data.length!==chunk.bytes||await sha256(data)!==key)throw new Error('Resource chunk integrity mismatch');
      size+=data.length;
    }
    if(size!==entry.expandedBytes||Object.keys(files).length!==entry.entries)throw new Error('Resource pack layout mismatch');
    while(this.stats.cacheBytes+size>this.budget&&this.cache.size){
      const oldest=this.cache.keys().next().value;this.stats.cacheBytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);++this.stats.evictions;
    }
    this.cache.set(hash,{files,bytes:size});this.stats.cacheBytes+=size;
    return files;
  }
  async read(path){
    if(!this.exists(path))throw new Error('Resource does not exist: '+path);
    const file=this.index.files[path],result=new Uint8Array(file.bytes);let offset=0;
    for(const key of file.chunks){
      const chunk=this.index.chunks[key],pack=await this.pack(chunk.pack);
      result.set(pack[chunk.key],offset);offset+=chunk.bytes;
    }
    if(await sha256(result)!==file.sha256)throw new Error('Resource file hash mismatch');
    return result;
  }
  async materialize(engine,path){
    const bytes=await this.read(path);const slash=path.lastIndexOf('/');if(slash>=0)engine.FS.mkdirTree('/'+path.slice(0,slash));
    const temporary='/'+path+'.download.pending';
    try{engine.FS.writeFile(temporary,bytes);engine.FS.rename(temporary,'/'+path);}
    catch(error){try{engine.FS.unlink(temporary);}catch{}throw error;}
    return bytes;
  }
}

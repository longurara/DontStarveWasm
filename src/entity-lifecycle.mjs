// Authoritative decisions from the engine's spatial policy. This adapter does
// not compute interest, camera ranges, simulation islands or native physics.
export function applyEntitySleep(engine, decisions) {
  if(!Array.isArray(decisions)||decisions.length>100000)throw new Error('Invalid entity sleep decisions');
  const pairs=new Uint32Array(decisions.length*2);
  for(let i=0;i<decisions.length;++i){
    const entry=decisions[i];
    if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<1||entry[0]>0xffffffff||typeof entry[1]!=='boolean')throw new Error('Invalid entity sleep decision');
    pairs[i*2]=entry[0];pairs[i*2+1]=entry[1]?1:0;
  }
  const pointer=engine._malloc(pairs.byteLength||4);
  if(!pointer)throw new Error('Cannot allocate entity sleep decisions');
  try{
    engine.HEAPU8.set(new Uint8Array(pairs.buffer),pointer);
    if(engine._dst_apply_entity_sleep(pointer,decisions.length))throw new Error(engine.ccall('dst_result','string',[],[]));
  }finally{engine._free(pointer);}
}

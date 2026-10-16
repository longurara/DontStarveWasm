import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEngine } from '../tools/load-engine.mjs';

test('WASM FLAC decoder reproduces native PCM for every converted Wilson sample',async t=>{
  let bank;
  try{bank=JSON.parse(await readFile(new URL('../public/generated/audio/banks/wilson.json',import.meta.url)));}
  catch{t.skip('Run tools/fmod_samples.py --bank wilson.fsb');return;}
  const {engine}=await loadEngine(0);t.after(()=>engine._dst_close());
  assert.equal(bank.samples.length,125);
  for(const sample of bank.samples){
    const encoded=await readFile(new URL('../public/generated/'+sample.url,import.meta.url));
    assert.equal(createHash('sha256').update(encoded).digest('hex'),sample.sha256);
    const ptr=engine._malloc(encoded.length);engine.HEAPU8.set(encoded,ptr);
    try{
      assert.equal(engine._dst_audio_decode(ptr,encoded.length),0,engine.ccall('dst_audio_result','string',[],[]));
      const meta=JSON.parse(engine.ccall('dst_audio_result','string',[],[]));
      for(const key of ['channels','sampleRate','frames','pcmBytes'])assert.equal(meta[key],sample[key],sample.name+' '+key);
      const pcm=engine.HEAPU8.slice(engine._dst_audio_pcm(),engine._dst_audio_pcm()+meta.pcmBytes);
      assert.equal(createHash('sha256').update(pcm).digest('hex'),sample.pcmSha256,sample.name);
      if(sample.index===0){
        assert.equal(engine._dst_audio_decode(ptr,encoded.length-8),1,'truncated native sample must fail');
        assert.equal(engine._dst_audio_samples(),0);
      }
    }finally{engine._free(ptr);engine._dst_audio_release();}
    assert.equal(engine._dst_audio_samples(),0);
  }
});

test('FLAC decoder rejects malformed streams and clears output on failure',async t=>{
  const {engine}=await loadEngine(0);t.after(()=>engine._dst_close());
  const ptr=engine._malloc(128);
  try{
    for(const data of [new Uint8Array(128),new TextEncoder().encode('fLaC'),new Uint8Array([102,76,97,67,...new Uint8Array(124)])]){
      engine.HEAPU8.set(data,ptr);
      assert.equal(engine._dst_audio_decode(ptr,data.length),1);
      assert.equal(engine._dst_audio_samples(),0);assert.equal(engine._dst_audio_pcm(),0);
    }
  }finally{engine._free(ptr);engine._dst_audio_release();}
});

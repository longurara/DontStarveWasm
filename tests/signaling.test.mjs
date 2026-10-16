import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../tools/signaling.mjs';

const compatibility={gameBuild:'756039',engineVersion:'0.1.0',schemaVersion:1,contentHash:'a'.repeat(64)};
async function server(t){
  const service=createSignalingServer();await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>service.close());return `ws://127.0.0.1:${service.server.address().port}/signal`;
}
async function client(t,url){
  const ws=new WebSocket(url);const messages=[];const waiters=[];
  ws.on('message',raw=>{const data=JSON.parse(raw.toString());const index=waiters.findIndex(w=>w.type===data.type);
    if(index>=0){const waiter=waiters.splice(index,1)[0];clearTimeout(waiter.timeout);waiter.resolve(data);}else messages.push(data);});
  await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject);});
  t.after(()=>ws.terminate());
  return {ws,send:message=>ws.send(JSON.stringify(message)),read:type=>{
    const index=messages.findIndex(m=>m.type===type);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{const waiter={type,resolve,timeout:setTimeout(()=>reject(new Error('Missing '+type)),2000)};waiters.push(waiter);});
  }};
}
test('signaling admits six players, rejects seventh, and relays only within room',async t=>{
  const url=await server(t);const host=await client(t,url);const welcome=await host.read('welcome');
  host.send({type:'create',compatibility});const invite=await host.read('created');
  const guests=[];
  for(let i=0;i<5;i++){
    const guest=await client(t,url);const info=await guest.read('welcome');guest.send({type:'join',...invite,compatibility,type:'join'});
    await guest.read('joined');await host.read('peer-joined');guests.push({guest,id:info.peerId});
  }
  const rejected=await client(t,url);rejected.send({...invite,type:'join',compatibility});assert.match((await rejected.read('error')).error,/six players/);
  guests[0].guest.send({type:'relay',to:guests[1].id,payload:{candidate:'test'}});assert.match((await guests[0].guest.read('error')).error,/target host/);
  guests[0].guest.send({type:'relay',to:welcome.peerId,payload:{description:'test'}});assert.equal((await host.read('relay')).from,guests[0].id);
});
test('signaling rejects wrong invitation and mismatched game data',async t=>{
  const url=await server(t);const host=await client(t,url);host.send({type:'create',compatibility});const invite=await host.read('created');
  const guest=await client(t,url);guest.send({...invite,type:'join',token:'wrong',compatibility});assert.match((await guest.read('error')).error,/invitation/);
  guest.send({...invite,type:'join',compatibility:{...compatibility,contentHash:'b'.repeat(64)}});assert.match((await guest.read('error')).error,/contentHash/);
});

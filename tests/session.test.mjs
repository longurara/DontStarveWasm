import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';
import {decodeNativeEnvelope} from '../src/native-save.mjs';
import {sessionParameters,configureSession,validateSessionParameters} from '../src/session.mjs';

test('active server metadata and separate game-mode defaults agree with the isolated native session',async t=>{
  const path='output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_session_trace';
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const capture=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  const key=Object.keys(capture.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),capture.fixtureSha256[key]);
  const reference=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  const {engine,evaluate,parameters}=await loadEngine(1,{session:{serverName:'WASM reference fixtures',lanOnly:true}});t.after(()=>engine._dst_close());
  evaluate('json=require("json")');
  assert.equal(evaluate('return type(TheNet)'),reference.proxyType);
  assert.equal(evaluate('return type(getmetatable(TheNet).__index)'),reference.indexType);
  for(const [method,values] of Object.entries(reference.active))assert.deepEqual(JSON.parse(evaluate(`return json.encode_compliant({pcall(TheNet.${method},TheNet)})`)),values,method);
  const values=['endless','  WiLDERneSS  ',' abc \t\nxyz ','a\x00b','é Foo','',' SURVIVAL ','LAVAArena','quAgmiRe'];
  for(const row of reference.changes.GameMode){
    const value=values[row.index-1];
    // Lua string literals support decimal byte escapes, unlike JSON \uXXXX.
    const literal='"'+[...Buffer.from(value)].map(byte=>'\\'+String(byte).padStart(3,'0')).join('')+'"';
    assert.equal(evaluate(`TheNet:SetDefaultGameMode(${literal});return TheNet:GetDefaultGameMode()`),row.value);
    assert.equal(evaluate('return TheNet:GetServerGameMode()'),row.activeMode);
  }
  assert.deepEqual(JSON.parse(evaluate('return json.encode_compliant(WebSession.Inspect())')),{...parameters,configured:true});
  assert.throws(()=>evaluate('TheNet:StartServer()'),/UNIMPLEMENTED_NATIVE/,'metadata does not claim to start gameplay networking');
});

test('session configuration rejects mixed builds, oversized rooms and unsupported services before committing',async t=>{
  const {engine,evaluate,manifest}=await loadEngine(1,{configure:false});t.after(()=>engine._dst_close());
  assert.throws(()=>evaluate('return TheNet:GetServerGameMode()'),/must be configured/);
  const valid=sessionParameters(manifest);
  const bad=[{gameBuild:'1'},{engineVersion:'9'},{schemaVersion:2},{contentHash:'0'.repeat(64)},
    {maxPlayers:0},{maxPlayers:7},{maxPlayers:2.5},{maxPlayers:'6'},{pvp:1},{gameMode:'unknown'},
    {serverName:'a\0b'},{serverDescription:'x'.repeat(4097)},{friendsOnly:true},{platformOnline:true},
    {offlineCluster:false},{serverDedicated:false},{serverClientHosted:true},{typo:true}];
  bad.push(...[null,1,false,'KU_native_account','WEB_'+'a'.repeat(31),'WEB_'+'A'.repeat(32),'WEB_'+'a'.repeat(32)+'\0'].map(localUserId=>({localUserId})));
  for(const change of bad){
    assert.throws(()=>validateSessionParameters({...valid,...change},manifest));
    const status=engine.ccall('dst_configure_session','number',['string','string'],[JSON.stringify({...valid,...change}),manifest.contentHash]);
    assert.notEqual(status,0,JSON.stringify(change));
    assert.equal(evaluate('return tostring(WebSession.Inspect().configured)'),'false','invalid settings must not partially commit');
  }
  for(const value of ['not json','null','[]'])assert.notEqual(engine.ccall('dst_configure_session','number',['string','string'],[value,manifest.contentHash]),0);
  configureSession(engine,valid,manifest);
  assert.equal(evaluate('return TheNet:GetServerGameMode()'),'survival');
  assert.throws(()=>configureSession(engine,valid,manifest),/already configured/);
  assert.equal(evaluate('return TheNet:GetServerMaxPlayers()'),'6');
  evaluate('WEB_ROLE="client"');assert.equal(evaluate('return tostring(TheNet:IsDedicated())'),'true','native role is not controlled by mutable Lua globals');
  const client=await loadEngine(0);t.after(()=>client.engine._dst_close());
  assert.equal(client.evaluate('return tostring(TheNet:IsDedicated())'),'false');
  assert.equal(client.evaluate('return tostring(TheNet:GetServerIsDedicated())'),'true','client refers to the separate authoritative shard worker');
});

test('offline shard identity matches native; client uses an immutable web player key without impersonating native accounts',async t=>{
  const path='output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_net_identity_trace';
  const bytes=await readFile(new URL('../'+path,import.meta.url));
  const report=JSON.parse(await readFile(new URL('../output/native-reference/attempt.json',import.meta.url)));
  assert.equal(report.oracleComplete,true);
  const key=Object.keys(report.fixtureSha256).find(key=>key.replaceAll('\\','/')===path);
  assert.ok(key);assert.equal(createHash('sha256').update(bytes).digest('hex'),report.fixtureSha256[key]);
  const native=JSON.parse(new TextDecoder().decode(decodeNativeEnvelope(bytes)));
  assert.deepEqual(native.calls,[[''],[''],['']]);
  const source=await readFile(new URL('../tools/native_trace.lua',import.meta.url),'utf8');
  const block=source.split('-- NET_IDENTITY_ORACLE_BEGIN')[1].split('-- NET_IDENTITY_ORACLE_END')[0];
  for(const role of [1,2]){
    const {engine,evaluate,manifest}=await loadEngine(role,{configure:false});t.after(()=>engine._dst_close());
    assert.throws(()=>evaluate('return TheNet:GetUserID()'),/must be configured/);
    const player=sessionParameters(manifest,{localUserId:'WEB_'+'1'.repeat(32)});
    assert.throws(()=>configureSession(engine,player,manifest),/shard has no local player/);
    assert.equal(evaluate('return tostring(WebSession.Inspect().configured)'),'false');
    configureSession(engine,sessionParameters(manifest),manifest);evaluate('json=require("json")');
    assert.deepEqual(JSON.parse(evaluate(block+'\nreturn json.encode_compliant(net_identity_trace)')),native);
  }
  const userId='WEB_00112233445566778899aabbccddeeff';
  const {engine,evaluate,manifest}=await loadEngine(0,{configure:false});t.after(()=>engine._dst_close());
  const player=sessionParameters(manifest,{localUserId:userId});
  for(const localUserId of [undefined,null,5,'KU_native','WEB_'+'f'.repeat(33),'WEB_'+'F'.repeat(32)]){
    const status=engine.ccall('dst_configure_session','number',['string','string'],[JSON.stringify({...player,localUserId}),manifest.contentHash]);
    assert.notEqual(status,0);assert.equal(evaluate('return tostring(WebSession.Inspect().configured)'),'false');
  }
  configureSession(engine,player,manifest);
  assert.equal(evaluate('return TheNet:GetUserID(nil,false,{})'),userId);
  assert.throws(()=>configureSession(engine,sessionParameters(manifest,{localUserId:'WEB_'+'2'.repeat(32)}),manifest),/already configured/);
  assert.equal(evaluate('return TheNet:GetUserID()'),userId);
});

test('browser JSON Unicode and escapes survive the WASM session boundary; malformed packets cannot commit',async t=>{
  const {engine,evaluate,manifest}=await loadEngine(1,{configure:false});t.after(()=>engine._dst_close());
  const valid=sessionParameters(manifest,{serverName:'Việt 🌿',serverDescription:'quote " slash \\ line\n\t\b\f\r\x01'});
  const encoded=JSON.stringify(valid);
  const raw=encoded.replace('Việt 🌿','Vi\\u1ec7t \\ud83c\\udf3f');
  for(const invalid of [encoded.slice(0,-1)+',"maxPlayers":6}',encoded+'false',encoded.slice(0,-1)+',}',
    encoded.replace('"maxPlayers":6','"maxPlayers":06'),encoded.replace('"maxPlayers":6','"maxPlayers":1e309'),
    encoded.replace('"maxPlayers":6','"maxPlayers":NaN'),encoded.replace('"maxPlayers":6','"maxPlayers":6.'),
    encoded.replace('Việt 🌿','\\ud800'),encoded.replace('Việt 🌿','\\udc00'),encoded.replace('Việt 🌿','\\x41'),
    encoded.replace('Việt 🌿','raw\nline'),encoded.replace('Việt 🌿','\\u0000')]){
    assert.notEqual(engine.ccall('dst_configure_session','number',['string','string'],[invalid,manifest.contentHash]),0,invalid);
    assert.equal(evaluate('return tostring(WebSession.Inspect().configured)'),'false');
  }
  assert.throws(()=>sessionParameters(manifest,{serverName:'\ud800'}),/Invalid session/);
  // Bypass JS string encoding to exercise invalid UTF8 at the C boundary.
  const packet=Buffer.from(encoded);packet[packet.indexOf(Buffer.from('Việt'))]=0xc0;
  const pointer=engine._malloc(packet.length+1),hash=engine._malloc(65);
  try{
    engine.HEAPU8.set(packet,pointer);engine.HEAPU8[pointer+packet.length]=0;
    engine.HEAPU8.set(Buffer.from(manifest.contentHash+'\0'),hash);
    assert.notEqual(engine._dst_configure_session(pointer,hash),0);
  }finally{engine._free(pointer);engine._free(hash);}
  assert.equal(engine.ccall('dst_configure_session','number',['string','string'],[raw,manifest.contentHash]),0);
  assert.equal(evaluate('return TheNet:GetServerName()'),valid.serverName);
  assert.equal(evaluate('return TheNet:GetServerDescription()'),valid.serverDescription);
});

import { assertCompatibility, MAX_PLAYERS } from './protocol.mjs';

const fields=['gameBuild','engineVersion','schemaVersion','contentHash','gameMode','serverName','serverDescription','serverIntention','maxPlayers','pvp','friendsOnly','lanOnly','platformOnline','offlineCluster','serverDedicated','serverClientHosted','localUserId'];
export function sessionParameters(manifest, options={}) {
  const value={gameBuild:manifest.gameBuild,engineVersion:manifest.engineVersion,schemaVersion:manifest.schemaVersion,contentHash:manifest.contentHash,
    gameMode:'survival',serverName:'DST Web',serverDescription:'',serverIntention:'',maxPlayers:MAX_PLAYERS,pvp:false,friendsOnly:false,
    lanOnly:false,platformOnline:false,offlineCluster:true,serverDedicated:true,serverClientHosted:false,localUserId:'',...options};
  return validateSessionParameters(value,manifest);
}
export function validateSessionParameters(value, expected) {
  assertCompatibility(value,expected);
  if(!value||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('Unknown session parameter');
  if(!/^[a-f0-9]{64}$/.test(value.contentHash))throw new Error('Invalid session content hash');
  const limits={gameMode:128,serverName:1024,serverDescription:4096,serverIntention:128};
  for(const [key,limit] of Object.entries(limits)){
    const text=value[key];
    if(typeof text!=='string'||text.includes('\0')||[...text].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff)||new TextEncoder().encode(text).length>limit)throw new Error('Invalid session '+key);
  }
  if(!['survival','endless','wilderness','lavaarena','quagmire'].includes(value.gameMode))throw new Error('Unsupported session gameMode');
  if(!Number.isInteger(value.maxPlayers)||value.maxPlayers<1||value.maxPlayers>MAX_PLAYERS)throw new Error('Session supports one to six players');
  for(const key of ['pvp','friendsOnly','lanOnly','platformOnline','offlineCluster','serverDedicated','serverClientHosted'])if(typeof value[key]!=='boolean')throw new Error('Invalid session '+key);
  // Internet WebRTC does not require native Steam/Klei account online mode.
  if(value.platformOnline||!value.offlineCluster||value.friendsOnly)throw new Error('Native account/friends services are not implemented');
  if(!value.serverDedicated||value.serverClientHosted)throw new Error('Session requires separate authoritative shard workers');
  if(typeof value.localUserId!=='string'||value.localUserId!==''&&!/^WEB_[a-f0-9]{32}$/.test(value.localUserId))throw new Error('Invalid session localUserId');
  return Object.freeze({...value});
}
export function configureSession(engine, value, expected) {
  const checked=validateSessionParameters(value,expected);
  const status=engine.ccall('dst_configure_session','number',['string','string'],[JSON.stringify(checked),expected.contentHash]);
  if(status)throw new Error(engine.ccall('dst_result','string',[],[]));
  return checked;
}

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.zip': 'application/zip' };
const equal = (a, b) => {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
};
function validateCompatibility(value) {
  if(value?.gameBuild!=='756039'||value?.engineVersion!=='0.1.0'||value?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(value?.contentHash??''))throw new Error('Invalid build compatibility');
}

export function createSignalingServer({ root = resolve(project, 'dist'), iceServers = [], allowedOrigin } = {}) {
  const rooms = new Map();
  const sockets = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.url === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ status: 'ok', rooms: rooms.size })); return; }
    if (request.url === '/ice-config') { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ iceServers })); return; }
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405);response.end();return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(resolve(root) + sep)) { response.writeHead(403);response.end();return; }
      if (!(await stat(path)).isFile()) throw new Error('Not a file');
      const data = await readFile(path);
      const immutable=/\/[a-f0-9]{64}\.(zip|json|flac|bin)$/.test(pathname);
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Length': data.length,
        'Cache-Control': immutable?'public, max-age=31536000, immutable':'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404);response.end('Not found'); }
  });
  const wss = new WebSocketServer({ server, path: '/signal', maxPayload: 64 * 1024 });
  function send(ws, message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
  wss.on('connection', (ws, request) => {
    if (allowedOrigin && request.headers.origin !== allowedOrigin) { ws.close(1008, 'Origin rejected'); return; }
    const peerId = randomBytes(12).toString('hex');
    const client = { ws, peerId, roomId: null, messages: 0, window: Date.now(), alive: true };
    sockets.set(peerId, client);
    ws.on('pong', () => { client.alive = true; });
    send(ws, { type: 'welcome', peerId });
    ws.on('message', raw => {
      try {
        if (Date.now() - client.window > 1000) { client.window = Date.now(); client.messages = 0; }
        if (++client.messages > 100) throw new Error('Signaling rate limit');
        const data = JSON.parse(raw.toString());
        if (data.type === 'create') {
          validateCompatibility(data.compatibility);
          if (client.roomId || rooms.size >= 100) throw new Error('Cannot create room');
          const roomId = randomBytes(4).toString('hex'); const token = randomBytes(24).toString('hex');
          rooms.set(roomId, { host: peerId, token, peers: new Set([peerId]), compatibility: data.compatibility });
          client.roomId = roomId;
          send(ws, { type: 'created', roomId, token, hostId: peerId });
        } else if (data.type === 'join') {
          validateCompatibility(data.compatibility);
          if (client.roomId) throw new Error('Already in a room');
          const room = rooms.get(data.roomId);
          if (!room || !equal(room.token, data.token)) throw new Error('Invalid invitation');
          if (room.peers.size >= 6) throw new Error('Room has six players');
          for (const key of ['gameBuild', 'engineVersion', 'schemaVersion', 'contentHash']) if (room.compatibility?.[key] !== data.compatibility?.[key]) throw new Error('Incompatible ' + key);
          room.peers.add(peerId);client.roomId=data.roomId;
          send(ws, { type: 'joined', roomId: data.roomId, hostId: room.host });
          send(sockets.get(room.host).ws, { type: 'peer-joined', peerId });
        } else if (data.type === 'relay') {
          const room = rooms.get(client.roomId);
          if (!room || !room.peers.has(data.to) || data.to === peerId) throw new Error('Invalid relay target');
          if (peerId !== room.host && data.to !== room.host) throw new Error('Guest relay must target host');
          send(sockets.get(data.to).ws, { type: 'relay', from: peerId, payload: data.payload });
        } else throw new Error('Unknown signaling message');
      } catch (error) { send(ws, { type: 'error', error: error.message }); }
    });
    ws.on('close', () => {
      sockets.delete(peerId);
      const room=rooms.get(client.roomId); if (!room) return;
      room.peers.delete(peerId);
      if (room.host === peerId) {
        rooms.delete(client.roomId);
        for (const id of room.peers) { const guest=sockets.get(id); if(guest){send(guest.ws,{type:'host-left'});guest.ws.close(1000,'Host left');} }
      } else { const host=sockets.get(room.host); if(host)send(host.ws,{type:'peer-left',peerId}); }
    });
    ws.on('error', () => {});
  });
  const heartbeat=setInterval(() => {
    for(const client of sockets.values()) {
      if(!client.alive) {client.ws.terminate();continue;}
      client.alive=false;client.ws.ping();
    }
  },15000);
  heartbeat.unref();
  server.on('close',()=>{clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();wss.close();});
  return { server, rooms, close: async () => {for(const ws of wss.clients)ws.terminate(); await new Promise(resolve=>server.close(resolve));} };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const iceServers=JSON.parse(process.env.DST_ICE_SERVERS ?? '[]');
  const {server}=createSignalingServer({iceServers,allowedOrigin:process.env.DST_ALLOWED_ORIGIN});
  const port=Number(process.env.PORT ?? 8787);
  server.listen(port,process.env.HOST ?? '127.0.0.1',()=>console.log(`Static site + signaling: http://127.0.0.1:${port}. Game simulation runs in the host browser.`));
}

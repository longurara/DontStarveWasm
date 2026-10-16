import { assertCompatibility } from './protocol.mjs';

export class Room {
  private socket!: WebSocket;
  private peers = new Map<string, { pc: RTCPeerConnection; reliable?: RTCDataChannel; motion?: RTCDataChannel; candidates: RTCIceCandidateInit[] }>();
  private hostId = '';
  private selfId = '';
  private closed = false;
  isHost = false;
  compatibility: any;
  onMessage?: (peer: string, data: any) => void;
  onStatus?: (text: string) => void;
  onInvite?: (invite: string) => void;
  onHostLeft?: () => void;
  onPeerLeft?: (peer: string) => void;

  async connect(url: string, iceServers: RTCIceServer[], compatibility: any, invitation?: string) {
    this.compatibility = compatibility;
    this.isHost = !invitation;
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = () => reject(new Error('Cannot connect signaling service'));
    });
    this.socket.onmessage = event => void this.signal(JSON.parse(event.data), iceServers).catch(error => this.onStatus?.(String(error)));
    this.socket.onclose = () => { if(!this.closed)this.onStatus?.('Signaling disconnected'); };
    if (invitation) {
      const [roomId, token] = invitation.trim().split('.');
      if (!/^[a-f0-9]{8}$/.test(roomId) || !/^[a-f0-9]{48}$/.test(token)) throw new Error('Invalid invitation format');
      this.sendSignal({ type: 'join', roomId, token, compatibility });
    } else this.sendSignal({ type: 'create', compatibility });
  }
  private sendSignal(message: any) { this.socket.send(JSON.stringify(message)); }
  private attach(peerId: string, channel: RTCDataChannel) {
    const peer = this.peers.get(peerId)!;
    if (channel.label === 'reliable') peer.reliable = channel;
    else if (channel.label === 'motion') peer.motion = channel;
    else { channel.close(); return; }
    channel.onopen = () => {
      this.onStatus?.(`WebRTC connected: ${peerId}`);
      if(channel.label==='reliable')channel.send(JSON.stringify({type:'hello',compatibility:this.compatibility}));
    };
    channel.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 65536) throw new Error('Invalid peer message size');
        const data=JSON.parse(event.data);
        if(data.type==='hello') {assertCompatibility(data.compatibility,this.compatibility);this.onMessage?.(peerId,data);return;}
        this.onMessage?.(peerId,data);
      } catch (error) { this.onStatus?.(`Peer rejected: ${String(error)}`); }
    };
  }
  private makePeer(peerId: string, iceServers: RTCIceServer[]) {
    const pc=new RTCPeerConnection({iceServers});
    const peer={pc,candidates:[] as RTCIceCandidateInit[]} as {pc:RTCPeerConnection;reliable?:RTCDataChannel;motion?:RTCDataChannel;candidates:RTCIceCandidateInit[]};
    this.peers.set(peerId,peer);
    pc.onicecandidate=event=>{if(event.candidate)this.sendSignal({type:'relay',to:peerId,payload:{candidate:event.candidate.toJSON()}});};
    pc.ondatachannel=event=>this.attach(peerId,event.channel);
    pc.onconnectionstatechange=()=>{
      this.onStatus?.(`${peerId}: ${pc.connectionState}`);
      if(pc.connectionState==='failed'||pc.connectionState==='closed') {this.peers.delete(peerId);this.onPeerLeft?.(peerId);}
    };
    return peer;
  }
  private async signal(data:any,iceServers:RTCIceServer[]) {
    if(data.type==='welcome'){this.selfId=data.peerId;return;}
    if(data.type==='error')throw new Error(data.error);
    if(data.type==='created'){this.hostId=data.hostId;this.onInvite?.(`${data.roomId}.${data.token}`);return;}
    if(data.type==='joined'){this.hostId=data.hostId;this.onStatus?.('Waiting for host offer');return;}
    if(data.type==='host-left'){this.onHostLeft?.();this.close();return;}
    if(data.type==='peer-left'){this.peers.get(data.peerId)?.pc.close();this.peers.delete(data.peerId);this.onPeerLeft?.(data.peerId);return;}
    if(data.type==='peer-joined'){
      const peer=this.makePeer(data.peerId,iceServers);
      this.attach(data.peerId,peer.pc.createDataChannel('reliable',{ordered:true}));
      this.attach(data.peerId,peer.pc.createDataChannel('motion',{ordered:false,maxRetransmits:0}));
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.sendSignal({type:'relay',to:data.peerId,payload:{description:peer.pc.localDescription}});return;
    }
    if(data.type==='relay'){
      const peer=this.peers.get(data.from)??this.makePeer(data.from,iceServers);
      if(data.payload.description){
        await peer.pc.setRemoteDescription(data.payload.description);
        for(const candidate of peer.candidates)await peer.pc.addIceCandidate(candidate);
        peer.candidates=[];
        if(data.payload.description.type==='offer'){
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this.sendSignal({type:'relay',to:data.from,payload:{description:peer.pc.localDescription}});
        }
      }else if(data.payload.candidate){
        if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(data.payload.candidate);
        else peer.candidates.push(data.payload.candidate);
      }
    }
  }
  send(peerId:string,message:any) {
    const channel=this.peers.get(peerId)?.reliable;
    if(channel?.readyState!=='open')return false;
    if(channel.bufferedAmount>256*1024)return false;
    channel.send(JSON.stringify(message));return true;
  }
  sendHost(message:any){return this.send(this.hostId,message);}
  broadcast(message:any){for(const id of this.peers.keys())this.send(id,message);}
  get connectedPeers(){return [...this.peers.values()].filter(p=>p.reliable?.readyState==='open').length;}
  close(){this.closed=true;for(const p of this.peers.values())p.pc.close();this.peers.clear();this.socket?.close();}
}

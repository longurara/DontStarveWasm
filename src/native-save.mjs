import { unzlibSync, zlibSync } from 'fflate';
const LIMIT=8*1024*1024;

function adler32(bytes) {
  let a=1,b=0;
  for(let i=0;i<bytes.length;i++){a=(a+bytes[i])%65521;b=(b+a)%65521;}
  return ((b<<16)|a)>>>0;
}

/** Encode a Uint8Array payload into Klei's native `KLEI     1D` (zlib+base64) or `KLEI     1 ` envelope. */
export function encodeNativeEnvelope(input, compress = true) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input ?? ''));
  if (bytes.length === 0 || bytes.length > LIMIT) throw new Error('Save payload must be between 1 byte and 8 MiB');
  if (!compress) {
    const header = new TextEncoder().encode('KLEI     1 ');
    const out = new Uint8Array(header.length + bytes.length);
    out.set(header, 0);
    out.set(bytes, header.length);
    return out;
  }
  const compressed = zlibSync(bytes);
  const packet = new Uint8Array(16 + compressed.length);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  view.setUint32(0, 1, true);
  view.setUint32(4, 16, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, compressed.length, true);
  packet.set(compressed, 16);
  let binary = '';
  for (let i = 0; i < packet.length; i++) binary += String.fromCharCode(packet[i]);
  const b64 = btoa(binary);
  return new TextEncoder().encode('KLEI     1D' + b64);
}

/** KLEI%6d%c envelope as produced by the native persistent-string API. */
export function decodeNativeEnvelope(input) {
  if(!(input instanceof Uint8Array)||input.length===0||input.length>LIMIT)throw new Error('Save must be between 1 byte and 8 MiB');
  let data=input;
  while(data.length&&data[data.length-1]===0)data=data.subarray(0,data.length-1);
  if(new TextDecoder().decode(data.subarray(0,4))!=='KLEI')return data;
  if(data.length<11)throw new Error('Truncated KLEI envelope');
  if(new TextDecoder().decode(data.subarray(4,10)).trim()!=='1')throw new Error('Unsupported KLEI envelope version');
  if(data[10]===32)return data.subarray(11);
  if(data[10]!==68)throw new Error('Unsupported KLEI encoding');
  const encoded=new TextDecoder().decode(data.subarray(11));
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4!==0)throw new Error('Invalid encoded save');
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  if(bytes.length<22)throw new Error('Truncated compressed save');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const version=view.getUint32(0,true),offset=view.getUint32(4,true),size=view.getUint32(8,true),compressed=view.getUint32(12,true);
  if(version!==1||offset!==16||size===0||size>LIMIT||compressed!==bytes.length-offset)throw new Error('Invalid compressed save header');
  const output=unzlibSync(bytes.subarray(offset),{out:new Uint8Array(size)});
  const expected=view.getUint32(bytes.length-4,false);
  if(output.length!==size||adler32(output)!==expected)throw new Error('Save checksum mismatch');
  return output;
}

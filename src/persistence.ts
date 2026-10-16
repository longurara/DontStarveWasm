import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { validateCheckpoint } from './protocol.mjs';

export class Checkpoints {
  private db!: IDBDatabase;
  async open() {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dst-web-port', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('checkpoints', { keyPath: 'id' });
        request.result.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }
  async commit(checkpoint: any, expected: any) {
    validateCheckpoint(checkpoint, expected);
    const id = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db.transaction(['checkpoints', 'meta'], 'readwrite');
      transaction.objectStore('checkpoints').put({ ...checkpoint, id, savedAt: Date.now() });
      transaction.objectStore('meta').put(id, 'latest');
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Checkpoint transaction aborted'));
    });
    return id;
  }
  async localIdentity(): Promise<string> {
    // A read/write transaction serializes first-use creation across tabs.
    // This is a local player key, not an authenticated remote peer identity.
    return new Promise<string>((resolve,reject)=>{
      const transaction=this.db.transaction('meta','readwrite');
      const store=transaction.objectStore('meta');
      const request=store.get('profile:local-identity:v1');
      let identity='';let failure:unknown;
      request.onsuccess=()=>{
        const record=request.result;
        if(record===undefined){
          try {
            const bytes=crypto.getRandomValues(new Uint8Array(16));
            identity='WEB_'+Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
            store.put({schemaVersion:1,userId:identity},'profile:local-identity:v1');
          } catch(error){failure=error;transaction.abort();}
        } else if(record?.schemaVersion===1&&typeof record.userId==='string'&&/^WEB_[a-f0-9]{32}$/.test(record.userId)){
          identity=record.userId;
        } else {
          failure=new Error('Invalid local identity record; preserve browser data for recovery');transaction.abort();
        }
      };
      transaction.oncomplete=()=>resolve(identity);
      transaction.onabort=transaction.onerror=()=>reject(failure??transaction.error??new Error('Local identity transaction aborted'));
    });
  }
  async latest() {
    return new Promise<any>((resolve, reject) => {
      const transaction = this.db.transaction(['checkpoints', 'meta']);
      const latest = transaction.objectStore('meta').get('latest');
      latest.onsuccess = () => {
        if (!latest.result) { resolve(null); return; }
        const value = transaction.objectStore('checkpoints').get(latest.result);
        value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
      };
      latest.onerror = () => reject(latest.error);
    });
  }
  async list() {
    return new Promise<any[]>((resolve, reject) => {
      const request = this.db.transaction('checkpoints').objectStore('checkpoints').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.savedAt - a.savedAt));
      request.onerror = () => reject(request.error);
    });
  }
  export(value: any) { return zipSync({ 'checkpoint.json': strToU8(JSON.stringify(value)) }); }
  import(data: Uint8Array, expected: any) {
    if (data.length > 8 * 1024 * 1024) throw new Error('Diagnostic backup exceeds 8 MiB');
    const files = unzipSync(data, { filter: file => file.name === 'checkpoint.json' && file.originalSize <= 8 * 1024 * 1024 });
    if (!files['checkpoint.json']) throw new Error('Native DST saves are not supported yet; expected a diagnostic backup');
    return validateCheckpoint(JSON.parse(strFromU8(files['checkpoint.json'])), expected);
  }
}

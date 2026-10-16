export type Role = 'client' | 'master' | 'caves';
export interface Snapshot {
  kind: string; role: Role; tick: number; guid: number; uses: number;
  position: number[]; rotation: number; events: { tick: number; percent: number }[];
}

export class EngineWorker {
  private worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
  private counter = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  onLog?: (message: string) => void;
  onPlatform?: (state: { cursorVisible: boolean }) => void;

  constructor(public role: Role) {
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'log') { this.onLog?.(data.text); return; }
      if (data.type === 'platform') { this.onPlatform?.(data); return; }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timeout); this.pending.delete(data.id);
      data.ok ? pending.resolve(data.result) : pending.reject(new Error(data.error));
    };
    this.worker.onerror = event => this.fail(new Error(event.message));
  }
  request(type: string, payload: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<any> {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.role}: ${type} timed out`)); }, 30000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ ...payload, type, id, role: this.role }, transfer);
    });
  }
  private fail(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
  }
  close() { this.worker.terminate(); this.fail(new Error('Worker closed')); }
}

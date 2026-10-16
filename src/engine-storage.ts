// Each WASM instance owns its mount and IndexedDB namespace. Never mount a
// shared root: syncfs reconciles a whole mount and would delete other shards.
export async function mountEngineStorage(engine: any, role: string) {
  if (!['client', 'master', 'caves'].includes(role)) throw new Error('Invalid storage role');
  const root = '/persistent/' + role;
  engine.FS.mkdirTree(root);
  engine.FS.mount(engine.IDBFS, {}, root);
  const sync = (populate: boolean) => new Promise<void>((resolve, reject) => {
    engine.FS.syncfs(populate, (error: unknown) => error ? reject(error) : resolve());
  });
  await sync(true);
  return async function drain() {
    // Native Lua callbacks run synchronously against MEMFS. A Worker response
    // additionally waits for durable browser storage. Failed commits stay dirty
    // so a later explicit request can retry instead of silently losing writes.
    for (let generation = 0; engine._dst_io_pending(); ++generation) {
      if (generation === 64) throw new Error('Persistent callback chain exceeds 64 generations');
      let failure: unknown;
      if (engine._dst_io_pending() & 2) {
        try { await sync(false); engine._dst_platform_storage(1); }
        catch (error) { engine._dst_platform_storage(0); failure = error; }
      }
      const status = engine._dst_complete_io(failure ? 0 : 1);
      if (status) throw new Error(engine.ccall('dst_result', 'string', [], []));
      if (failure) throw new Error('IndexedDB flush failed: ' + String(failure));
    }
  };
}

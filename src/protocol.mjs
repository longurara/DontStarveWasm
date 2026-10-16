export const GAME_BUILD = '756039';
export const ENGINE_VERSION = '0.1.0';
export const SCHEMA_VERSION = 1;
export const SNAPSHOT_KIND = 'engine-diagnostic-v1';
export const MAX_PLAYERS = 6;

export function assertCompatibility(actual, expected) {
  for (const field of ['gameBuild', 'engineVersion', 'schemaVersion', 'contentHash']) {
    if (actual?.[field] !== expected?.[field]) throw new Error(`Incompatible ${field}`);
  }
}

export function validateCheckpoint(value, expected) {
  assertCompatibility(value, expected);
  if (value.kind !== 'diagnostic-checkpoint-v1') throw new Error('Not a diagnostic checkpoint; native DST import is not implemented');
  if (!Number.isSafeInteger(value.tick) || value.tick < 0) throw new Error('Invalid checkpoint tick');
  for (const role of ['master', 'caves']) {
    const snapshot = value.shards?.[role];
    if (!snapshot || snapshot.kind !== SNAPSHOT_KIND || snapshot.role !== role || snapshot.tick !== value.tick) throw new Error(`Invalid ${role} snapshot`);
    if (!Number.isFinite(snapshot.uses) || snapshot.uses < 0 || snapshot.uses > 100) throw new Error('Invalid component state');
    if (!Array.isArray(snapshot.position) || snapshot.position.length !== 3 || !snapshot.position.every(Number.isFinite) || !Number.isFinite(snapshot.rotation)) throw new Error('Invalid transform');
    if (!Array.isArray(snapshot.events) || snapshot.events.length > 10000) throw new Error('Invalid event list');
    if (!/^[a-f0-9]{16}$/.test(snapshot.rngState)) throw new Error('Invalid RNG checkpoint state');
  }
  return value;
}

export function validateCommand(command) {
  if (!command || !Number.isSafeInteger(command.sequence) || command.sequence < 0) throw new Error('Invalid command sequence');
  if (command.type !== 'consume' || !Number.isInteger(command.amount) || command.amount < 1 || command.amount > 10) throw new Error('Unsupported diagnostic command');
  return command;
}

export function safeAssetPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.')) throw new Error('Unsafe asset path');
  return path;
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class InMemorySnapshotStore {
  #snapshots = new Map();

  async load(streamId) {
    const found = this.#snapshots.get(streamId);
    return found ? structuredClone(found) : null;
  }

  async save(streamId, version, state) {
    this.#snapshots.set(streamId, { version, state: structuredClone(state) });
  }
}

export class FileSnapshotStore {
  #dir;

  constructor(dir) {
    this.#dir = dir;
  }

  #path(streamId) {
    return join(this.#dir, `${encodeURIComponent(streamId)}.json`);
  }

  async load(streamId) {
    try {
      return JSON.parse(await readFile(this.#path(streamId), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT' || err instanceof SyntaxError) return null;
      throw err;
    }
  }

  async save(streamId, version, state) {
    await mkdir(this.#dir, { recursive: true });
    const target = this.#path(streamId);
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify({ version, state }));
    await rename(temp, target);
  }
}

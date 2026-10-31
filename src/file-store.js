import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ANY_VERSION, EventStore, checkExpected, toRecords } from './store.js';

export class FileStore extends EventStore {
  #file;
  #dir;
  #now;
  #cache = null;
  #queue = Promise.resolve();

  constructor(dir, { now = () => new Date().toISOString() } = {}) {
    super();
    this.#dir = dir;
    this.#file = join(dir, 'events.jsonl');
    this.#now = now;
  }

  async #load() {
    if (this.#cache) return this.#cache;
    let text = '';
    try {
      text = await readFile(this.#file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const log = [];
    const streams = new Map();
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        break;
      }
      log.push(record);
      const list = streams.get(record.streamId) ?? [];
      list.push(record);
      streams.set(record.streamId, list);
    }
    this.#cache = { log, streams };
    return this.#cache;
  }

  #serial(task) {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => {});
    return run;
  }

  append(streamId, events, expectedVersion = ANY_VERSION) {
    return this.#serial(async () => {
      const state = await this.#load();
      const stream = state.streams.get(streamId) ?? [];
      checkExpected(streamId, expectedVersion, stream.length);
      if (events.length === 0) return [];
      const records = toRecords(streamId, events, stream.length, state.log.length, this.#now);
      await mkdir(this.#dir, { recursive: true });
      await appendFile(this.#file, records.map((r) => JSON.stringify(r) + '\n').join(''));
      state.streams.set(streamId, stream.concat(records));
      state.log.push(...records);
      return structuredClone(records);
    });
  }

  readStream(streamId, fromVersion = 0) {
    return this.#serial(async () => {
      const state = await this.#load();
      const stream = state.streams.get(streamId) ?? [];
      return structuredClone(stream.filter((r) => r.version > fromVersion));
    });
  }

  readAll(fromPosition = 0) {
    return this.#serial(async () => {
      const state = await this.#load();
      return structuredClone(state.log.filter((r) => r.position > fromPosition));
    });
  }
}

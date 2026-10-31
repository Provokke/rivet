import { ConcurrencyError } from './errors.js';

export const ANY_VERSION = -1;

export function checkExpected(streamId, expected, actual) {
  if (expected !== ANY_VERSION && expected !== actual) {
    throw new ConcurrencyError(streamId, expected, actual);
  }
}

export function toRecords(streamId, events, startVersion, startPosition, now) {
  return events.map((event, i) => ({
    streamId,
    version: startVersion + i + 1,
    position: startPosition + i + 1,
    type: event.type,
    data: event.data === undefined ? {} : structuredClone(event.data),
    meta: event.meta === undefined ? {} : structuredClone(event.meta),
    timestamp: now()
  }));
}

export class EventStore {
  async append(streamId, events, expectedVersion = ANY_VERSION) {
    throw new Error('append is not implemented');
  }

  async readStream(streamId, fromVersion = 0) {
    throw new Error('readStream is not implemented');
  }

  async readAll(fromPosition = 0) {
    throw new Error('readAll is not implemented');
  }
}

export class InMemoryStore extends EventStore {
  #streams = new Map();
  #log = [];
  #now;

  constructor({ now = () => new Date().toISOString() } = {}) {
    super();
    this.#now = now;
  }

  async append(streamId, events, expectedVersion = ANY_VERSION) {
    const stream = this.#streams.get(streamId) ?? [];
    checkExpected(streamId, expectedVersion, stream.length);
    if (events.length === 0) return [];
    const records = toRecords(streamId, events, stream.length, this.#log.length, this.#now);
    this.#streams.set(streamId, stream.concat(records));
    this.#log.push(...records);
    return structuredClone(records);
  }

  async readStream(streamId, fromVersion = 0) {
    const stream = this.#streams.get(streamId) ?? [];
    return structuredClone(stream.filter((r) => r.version > fromVersion));
  }

  async readAll(fromPosition = 0) {
    return structuredClone(this.#log.filter((r) => r.position > fromPosition));
  }
}

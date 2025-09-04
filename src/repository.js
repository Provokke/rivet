import { ConcurrencyError } from './errors.js';

export class Repository {
  #store;
  #aggregate;
  #snapshots;
  #snapshotEvery;
  #retries;

  constructor(store, aggregate, { snapshots = null, snapshotEvery = 50, retries = 3 } = {}) {
    this.#store = store;
    this.#aggregate = aggregate;
    this.#snapshots = snapshots;
    this.#snapshotEvery = snapshotEvery;
    this.#retries = retries;
  }

  streamId(id) {
    return `${this.#aggregate.name}-${id}`;
  }

  async load(id) {
    const streamId = this.streamId(id);
    let state = this.#aggregate.initialState();
    let version = 0;
    let snapshotVersion = 0;
    if (this.#snapshots) {
      const snap = await this.#snapshots.load(streamId);
      if (snap) {
        state = snap.state;
        version = snap.version;
        snapshotVersion = snap.version;
      }
    }
    const records = await this.#store.readStream(streamId, version);
    state = this.#aggregate.replay(records, state);
    if (records.length > 0) version = records[records.length - 1].version;
    return { id, state, version, snapshotVersion };
  }

  async #attempt(id, commandName, input, context) {
    const loaded = await this.load(id);
    const pending = this.#aggregate.decide(loaded.state, commandName, input, context);
    if (pending.length === 0) return { ...loaded, events: [] };
    const records = await this.#store.append(this.streamId(id), pending, loaded.version);
    const state = this.#aggregate.preview(loaded.state, pending);
    const version = records[records.length - 1].version;
    if (this.#snapshots && version - loaded.snapshotVersion >= this.#snapshotEvery) {
      await this.#snapshots.save(this.streamId(id), version, state);
    }
    return { id, state, version, events: records };
  }

  async execute(id, commandName, input, context = {}) {
    let attempt = 0;
    for (;;) {
      try {
        return await this.#attempt(id, commandName, input, context);
      } catch (err) {
        if (!(err instanceof ConcurrencyError) || attempt >= this.#retries) throw err;
        attempt += 1;
      }
    }
  }
}

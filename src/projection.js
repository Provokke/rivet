export function defineProjection({ name, initialState, handlers = {} }) {
  const make = typeof initialState === 'function' ? initialState : () => structuredClone(initialState ?? {});
  return { name, initialState: make, handlers };
}

export class ProjectionRunner {
  #store;
  #projection;
  #state;
  #position = 0;
  #listeners = new Set();

  constructor(store, projection, { state, position = 0 } = {}) {
    this.#store = store;
    this.#projection = projection;
    this.#state = state === undefined ? projection.initialState() : structuredClone(state);
    this.#position = position;
  }

  get state() {
    return this.#state;
  }

  get position() {
    return this.#position;
  }

  checkpoint() {
    return { position: this.#position, state: structuredClone(this.#state) };
  }

  onUpdate(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async catchUp() {
    const records = await this.#store.readAll(this.#position);
    let applied = 0;
    for (const record of records) {
      const handler = this.#projection.handlers[record.type];
      if (handler) {
        const next = handler(this.#state, record.data, record);
        if (next !== undefined) this.#state = next;
        applied += 1;
      }
      this.#position = record.position;
    }
    if (records.length > 0) {
      for (const listener of this.#listeners) listener(this.#state, this.#position);
    }
    return applied;
  }

  async rebuild() {
    this.#state = this.#projection.initialState();
    this.#position = 0;
    return this.catchUp();
  }
}

<div align="center">

# rivet

A tiny event-sourcing library for Node. Aggregates, event stores, snapshots and projections, with no dependencies and about 400 lines of source.

![License](https://img.shields.io/badge/LICENSE-MIT-blue?style=for-the-badge)  ![Language](https://img.shields.io/badge/JAVASCRIPT-f7df1e?style=for-the-badge&logo=javascript&logoColor=white)  ![Tests](https://img.shields.io/badge/TESTS-40-brightgreen?style=for-the-badge)

Refer to [LICENSE](LICENSE) for the legal bits.

</div>

## What's in it

- **Aggregates** are plain objects: command handlers decide which events happen, event handlers fold them into state. A command returns one event, an array, or nothing, and throwing rejects it without writing anything.
- **Event stores** share one small interface (`append`, `readStream`, `readAll`) with optimistic concurrency via an expected version.
  - `InMemoryStore` for tests.
  - `FileStore`, an append-only JSON Lines log that survives restarts, ignores a torn last line and serialises writes.
- **Repository** loads an aggregate, runs a command, appends the new events and retries when another writer got in first.
- **Snapshots** so long-lived aggregates load from saved state instead of replaying everything. Memory and file snapshot stores are included.
- **Projections** fold the global log into read models, resume from a checkpoint and can be rebuilt from scratch.

```js
const account = defineAggregate({
  name: 'account',
  initialState: () => ({ balance: 0 }),
  commands: {
    deposit(state, { amount }) {
      if (amount <= 0) throw new Error('amount must be positive');
      return { type: 'deposited', data: { amount } };
    }
  },
  events: {
    deposited: (state, { amount }) => ({ ...state, balance: state.balance + amount })
  }
});
```

## 🏗️ Architecture

```
 Repository ── load() ──► SnapshotStore (optional)
     │                         │ version + state
     │ execute(id, cmd, input) ▼
     │            replay events after snapshot
     ▼
 Aggregate.decide() ──► events ──► EventStore.append(stream, events, expectedVersion)
                                        ├─ InMemoryStore
                                        └─ FileStore  (events.jsonl)
                                              │ readAll(position)
                                              ▼
                                      ProjectionRunner ──► read model + checkpoint
```

- `src/aggregate.js` holds `defineAggregate`: replay, decide and preview.
- `src/store.js` and `src/file-store.js` hold the store interface and its two implementations. Every record has a per-stream `version` and a global `position`.
- `src/repository.js` is the load, decide, append loop with retry on `ConcurrencyError` and a snapshot every N events.
- `src/snapshot.js` holds the two snapshot stores. The file one writes to a temp file and renames, so a crash never leaves half a snapshot.
- `src/projection.js` holds `defineProjection` and `ProjectionRunner` with `catchUp`, `rebuild`, `checkpoint` and update listeners.

## 🚀 Quick start

Needs Node 18 or newer. The package is ESM only and has nothing to install.

```
npm test
```

A quick taste:

```js
const store = new InMemoryStore();
const repo = new Repository(store, account);

await repo.execute('alice', 'deposit', { amount: 25 });
const result = await repo.execute('alice', 'deposit', { amount: 10 });
console.log(result.state, result.version);

const totals = defineProjection({
  name: 'totals',
  initialState: { deposited: 0 },
  handlers: { deposited: (s, { amount }) => ({ deposited: s.deposited + amount }) }
});
const runner = new ProjectionRunner(store, totals);
await runner.catchUp();
console.log(runner.state);
```

Which prints:

```
{ balance: 35 } 2
{ deposited: 35 }
```

Swap in `new FileStore('./data')` to persist, and pass `snapshots: new FileSnapshotStore('./snapshots')` to the repository to use snapshots.

## 🧪 Testing

40 tests, all passing:

- Stores (17): the same contract run against both stores (append and read, read from a version, wrong expected version, global ordering, returned copies, empty append, concurrent appends where only one wins), plus file-store restart, torn last line and line format.
- Repository and snapshots (10): command round trips, rejected commands, retry on conflict, retry limit, snapshot cadence, snapshot state matching full replay, file snapshot round trip and corrupt file handling.
- Projections (7): cross-stream folding, incremental catch up, checkpoint resume, rebuild, listeners, mutating handlers, checkpoint copies.
- Aggregates (6): replay, fresh initial state, event validation, context passing.


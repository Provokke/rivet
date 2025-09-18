import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Repository,
  InMemoryStore,
  InMemorySnapshotStore,
  FileSnapshotStore,
  ConcurrencyError,
  UnknownCommandError,
  UnknownEventError
} from '../src/index.js';
import { account } from '../support/fixtures.js';

test('executes commands and rebuilds state from events', async () => {
  const repo = new Repository(new InMemoryStore(), account);
  await repo.execute('1', 'open', { owner: 'sam' });
  await repo.execute('1', 'deposit', { amount: 50 });
  const result = await repo.execute('1', 'withdraw', { amount: 20 });
  assert.equal(result.version, 3);
  assert.equal(result.state.balance, 30);
  const loaded = await repo.load('1');
  assert.deepEqual(loaded.state, { open: true, owner: 'sam', balance: 30 });
  assert.equal(loaded.version, 3);
});

test('a rejected command writes nothing', async () => {
  const store = new InMemoryStore();
  const repo = new Repository(store, account);
  await repo.execute('1', 'open', { owner: 'sam' });
  await assert.rejects(() => repo.execute('1', 'withdraw', { amount: 10 }), /insufficient/);
  assert.equal((await store.readStream('account-1')).length, 1);
});

test('commands that return nothing produce no events', async () => {
  const repo = new Repository(new InMemoryStore(), account);
  const result = await repo.execute('1', 'noop', {});
  assert.deepEqual(result.events, []);
  assert.equal(result.version, 0);
});

test('unknown commands and events are errors', async () => {
  const repo = new Repository(new InMemoryStore(), account);
  await assert.rejects(() => repo.execute('1', 'missing', {}), UnknownCommandError);
  await assert.rejects(() => repo.execute('1', 'bogus', {}), UnknownEventError);
});

test('streams are namespaced by aggregate name', () => {
  const repo = new Repository(new InMemoryStore(), account);
  assert.equal(repo.streamId('42'), 'account-42');
});

test('retries when another writer gets in first', async () => {
  const store = new InMemoryStore();
  const repo = new Repository(store, account);
  await repo.execute('1', 'open', { owner: 'sam' });
  const realAppend = store.append.bind(store);
  let interfered = false;
  store.append = async (streamId, events, expected) => {
    if (!interfered) {
      interfered = true;
      await realAppend(streamId, [{ type: 'deposited', data: { amount: 5 } }], expected);
    }
    return realAppend(streamId, events, expected);
  };
  const result = await repo.execute('1', 'deposit', { amount: 10 });
  assert.equal(result.state.balance, 15);
  assert.equal(result.version, 3);
});

test('gives up after the retry limit', async () => {
  const store = new InMemoryStore();
  const repo = new Repository(store, account, { retries: 2 });
  let calls = 0;
  store.append = async (streamId) => {
    calls += 1;
    throw new ConcurrencyError(streamId, 0, 1);
  };
  await assert.rejects(() => repo.execute('1', 'open', { owner: 'a' }), ConcurrencyError);
  assert.equal(calls, 3);
});

test('writes a snapshot every N events and loads from it', async () => {
  const store = new InMemoryStore();
  const snapshots = new InMemorySnapshotStore();
  const repo = new Repository(store, account, { snapshots, snapshotEvery: 3 });
  await repo.execute('1', 'open', { owner: 'sam' });
  await repo.execute('1', 'deposit', { amount: 1 });
  assert.equal(await snapshots.load('account-1'), null);
  await repo.execute('1', 'deposit', { amount: 1 });
  const snap = await snapshots.load('account-1');
  assert.equal(snap.version, 3);
  assert.equal(snap.state.balance, 2);
  await repo.execute('1', 'deposit', { amount: 1 });
  const readFrom = [];
  const realRead = store.readStream.bind(store);
  store.readStream = async (id, from) => {
    readFrom.push(from);
    return realRead(id, from);
  };
  const loaded = await repo.load('1');
  assert.deepEqual(readFrom, [3]);
  assert.equal(loaded.state.balance, 3);
  assert.equal(loaded.version, 4);
});

test('state from a snapshot matches state from a full replay', async () => {
  const store = new InMemoryStore();
  const snapshots = new InMemorySnapshotStore();
  const withSnap = new Repository(store, account, { snapshots, snapshotEvery: 2 });
  await withSnap.execute('1', 'open', { owner: 'sam' });
  for (let i = 0; i < 7; i += 1) await withSnap.execute('1', 'deposit', { amount: i + 1 });
  const plain = new Repository(store, account);
  assert.deepEqual((await withSnap.load('1')).state, (await plain.load('1')).state);
});

test('file snapshot store round trips and tolerates missing or corrupt files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rivet-snap-'));
  try {
    const snaps = new FileSnapshotStore(dir);
    assert.equal(await snaps.load('account/1'), null);
    await snaps.save('account/1', 4, { balance: 9 });
    assert.deepEqual(await snaps.load('account/1'), { version: 4, state: { balance: 9 } });
    await writeFile(join(dir, `${encodeURIComponent('bad')}.json`), '{oops');
    assert.equal(await snaps.load('bad'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


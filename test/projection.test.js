import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore, Repository, defineProjection, ProjectionRunner } from '../src/index.js';
import { account } from '../support/fixtures.js';

const totals = defineProjection({
  name: 'totals',
  initialState: () => ({ deposits: 0, accounts: 0 }),
  handlers: {
    opened: (state) => ({ ...state, accounts: state.accounts + 1 }),
    deposited: (state, { amount }) => ({ ...state, deposits: state.deposits + amount })
  }
});

async function seeded() {
  const store = new InMemoryStore();
  const repo = new Repository(store, account);
  await repo.execute('1', 'open', { owner: 'a' });
  await repo.execute('2', 'open', { owner: 'b' });
  await repo.execute('1', 'deposit', { amount: 10 });
  await repo.execute('2', 'deposit', { amount: 5 });
  await repo.execute('2', 'withdraw', { amount: 1 });
  return { store, repo };
}

test('folds events across streams into a read model', async () => {
  const { store } = await seeded();
  const runner = new ProjectionRunner(store, totals);
  const applied = await runner.catchUp();
  assert.equal(applied, 4);
  assert.deepEqual(runner.state, { deposits: 15, accounts: 2 });
  assert.equal(runner.position, 5);
});

test('only processes new events on later catch ups', async () => {
  const { store, repo } = await seeded();
  const runner = new ProjectionRunner(store, totals);
  await runner.catchUp();
  assert.equal(await runner.catchUp(), 0);
  await repo.execute('1', 'deposit', { amount: 100 });
  assert.equal(await runner.catchUp(), 1);
  assert.equal(runner.state.deposits, 115);
});

test('resumes from a checkpoint', async () => {
  const { store, repo } = await seeded();
  const first = new ProjectionRunner(store, totals);
  await first.catchUp();
  const saved = first.checkpoint();
  await repo.execute('1', 'deposit', { amount: 1 });
  const second = new ProjectionRunner(store, totals, saved);
  assert.equal(await second.catchUp(), 1);
  assert.equal(second.state.deposits, 16);
});

test('rebuild replays from the beginning', async () => {
  const { store } = await seeded();
  const runner = new ProjectionRunner(store, totals);
  await runner.catchUp();
  const applied = await runner.rebuild();
  assert.equal(applied, 4);
  assert.deepEqual(runner.state, { deposits: 15, accounts: 2 });
});

test('notifies listeners when something changed and supports unsubscribe', async () => {
  const { store, repo } = await seeded();
  const runner = new ProjectionRunner(store, totals);
  const seen = [];
  const off = runner.onUpdate((_state, position) => seen.push(position));
  await runner.catchUp();
  await runner.catchUp();
  assert.deepEqual(seen, [5]);
  off();
  await repo.execute('1', 'deposit', { amount: 1 });
  await runner.catchUp();
  assert.deepEqual(seen, [5]);
});

test('handlers may mutate and return nothing', async () => {
  const store = new InMemoryStore();
  await store.append('s', [{ type: 'tick' }, { type: 'tick' }]);
  const counter = defineProjection({
    name: 'counter',
    initialState: { n: 0 },
    handlers: {
      tick(state) {
        state.n += 1;
      }
    }
  });
  const runner = new ProjectionRunner(store, counter);
  await runner.catchUp();
  assert.equal(runner.state.n, 2);
});

test('the checkpoint is a copy', async () => {
  const { store } = await seeded();
  const runner = new ProjectionRunner(store, totals);
  await runner.catchUp();
  const saved = runner.checkpoint();
  saved.state.deposits = 0;
  assert.equal(runner.state.deposits, 15);
});

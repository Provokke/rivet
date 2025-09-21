import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineAggregate, UnknownCommandError, UnknownEventError } from '../src/index.js';
import { account } from '../support/fixtures.js';

test('replay folds records into state', () => {
  const state = account.replay([
    { type: 'opened', data: { owner: 'a' } },
    { type: 'deposited', data: { amount: 7 } }
  ]);
  assert.deepEqual(state, { open: true, owner: 'a', balance: 7 });
});

test('initial state is fresh each time', () => {
  const a = account.initialState();
  a.balance = 99;
  assert.equal(account.initialState().balance, 0);
});

test('plain object initial state is cloned', () => {
  const counter = defineAggregate({ name: 'c', initialState: { n: 0 }, events: { inc: (s) => ({ n: s.n + 1 }) } });
  assert.equal(counter.apply(counter.initialState(), { type: 'inc' }).n, 1);
  assert.equal(counter.initialState().n, 0);
});

test('decide validates event types and normalises output', () => {
  const state = account.replay([{ type: 'opened', data: { owner: 'a' } }]);
  const [event] = account.decide(state, 'deposit', { amount: 3 });
  assert.deepEqual(event, { type: 'deposited', data: { amount: 3 }, meta: {} });
  assert.throws(() => account.decide(state, 'nope', {}), UnknownCommandError);
  assert.throws(() => account.decide(state, 'bogus', {}), UnknownEventError);
});

test('replay rejects unknown event types', () => {
  assert.throws(() => account.replay([{ type: 'mystery', data: {} }]), UnknownEventError);
});

test('commands receive a context', () => {
  const agg = defineAggregate({
    name: 'ctx',
    commands: { stamp: (_s, _i, ctx) => ({ type: 'stamped', data: { by: ctx.user } }) },
    events: { stamped: (s, d) => ({ ...s, by: d.by }) }
  });
  const [event] = agg.decide({}, 'stamp', {}, { user: 'ada' });
  assert.equal(event.data.by, 'ada');
});


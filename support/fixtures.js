import { defineAggregate } from '../src/index.js';

export const account = defineAggregate({
  name: 'account',
  initialState: () => ({ open: false, balance: 0 }),
  commands: {
    open(state, { owner }) {
      if (state.open) throw new Error('already open');
      return { type: 'opened', data: { owner } };
    },
    deposit(state, { amount }) {
      if (!state.open) throw new Error('not open');
      if (amount <= 0) throw new Error('amount must be positive');
      return { type: 'deposited', data: { amount } };
    },
    withdraw(state, { amount }) {
      if (state.balance < amount) throw new Error('insufficient funds');
      return { type: 'withdrawn', data: { amount } };
    },
    noop() {
      return [];
    },
    bogus() {
      return { type: 'nonsense' };
    }
  },
  events: {
    opened: (state, { owner }) => ({ ...state, open: true, owner }),
    deposited: (state, { amount }) => ({ ...state, balance: state.balance + amount }),
    withdrawn: (state, { amount }) => ({ ...state, balance: state.balance - amount })
  }
});

import { UnknownCommandError, UnknownEventError } from './errors.js';

export function defineAggregate({ name, initialState, commands = {}, events = {} }) {
  const make = typeof initialState === 'function' ? initialState : () => structuredClone(initialState ?? {});

  function apply(state, record) {
    const handler = events[record.type];
    if (!handler) throw new UnknownEventError(record.type);
    const next = handler(state, record.data, record);
    return next === undefined ? state : next;
  }

  function replay(records, from = make()) {
    return records.reduce(apply, from);
  }

  function decide(state, commandName, input, context = {}) {
    const command = commands[commandName];
    if (!command) throw new UnknownCommandError(commandName);
    const result = command(state, input, context);
    if (result === undefined || result === null) return [];
    const list = Array.isArray(result) ? result : [result];
    return list.map((event) => {
      if (typeof event.type !== 'string' || !(event.type in events)) {
        throw new UnknownEventError(event.type);
      }
      return { type: event.type, data: event.data ?? {}, meta: event.meta ?? {} };
    });
  }

  function preview(state, pending) {
    return pending.reduce((s, event) => apply(s, { type: event.type, data: event.data }), state);
  }

  return { name, initialState: make, apply, replay, decide, preview };
}


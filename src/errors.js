export class ConcurrencyError extends Error {
  constructor(streamId, expected, actual) {
    super(`stream "${streamId}" is at version ${actual}, expected ${expected}`);
    this.name = 'ConcurrencyError';
    this.streamId = streamId;
    this.expected = expected;
    this.actual = actual;
  }
}

export class UnknownCommandError extends Error {
  constructor(name) {
    super(`unknown command "${name}"`);
    this.name = 'UnknownCommandError';
    this.command = name;
  }
}

export class UnknownEventError extends Error {
  constructor(type) {
    super(`no handler for event type "${type}"`);
    this.name = 'UnknownEventError';
    this.eventType = type;
  }
}

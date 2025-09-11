import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore, FileStore, ConcurrencyError } from '../src/index.js';

const fixedNow = () => '2026-01-01T00:00:00.000Z';
const dirs = [];

after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'rivet-'));
  dirs.push(dir);
  return dir;
}

function contract(label, make) {
  test(`${label}: appends and reads a stream`, async () => {
    const store = await make();
    const written = await store.append('a', [{ type: 'x', data: { n: 1 } }, { type: 'y' }], 0);
    assert.deepEqual(written.map((r) => r.version), [1, 2]);
    assert.deepEqual(written.map((r) => r.position), [1, 2]);
    const read = await store.readStream('a');
    assert.equal(read.length, 2);
    assert.deepEqual(read[0].data, { n: 1 });
    assert.deepEqual(read[1].data, {});
  });

  test(`${label}: reads from a version`, async () => {
    const store = await make();
    await store.append('a', [{ type: 'x' }, { type: 'y' }, { type: 'z' }]);
    const tail = await store.readStream('a', 1);
    assert.deepEqual(tail.map((r) => r.type), ['y', 'z']);
  });

  test(`${label}: rejects a wrong expected version`, async () => {
    const store = await make();
    await store.append('a', [{ type: 'x' }], 0);
    await assert.rejects(() => store.append('a', [{ type: 'y' }], 0), ConcurrencyError);
    await assert.rejects(
      () => store.append('a', [{ type: 'y' }], 5),
      (err) => err.actual === 1 && err.expected === 5
    );
  });

  test(`${label}: readAll is ordered across streams`, async () => {
    const store = await make();
    await store.append('a', [{ type: 'a1' }]);
    await store.append('b', [{ type: 'b1' }]);
    await store.append('a', [{ type: 'a2' }]);
    const all = await store.readAll();
    assert.deepEqual(all.map((r) => r.type), ['a1', 'b1', 'a2']);
    assert.deepEqual(all.map((r) => r.position), [1, 2, 3]);
    const after = await store.readAll(2);
    assert.deepEqual(after.map((r) => r.type), ['a2']);
  });

  test(`${label}: returned records are copies`, async () => {
    const store = await make();
    await store.append('a', [{ type: 'x', data: { list: [1] } }]);
    const first = await store.readStream('a');
    first[0].data.list.push(2);
    const second = await store.readStream('a');
    assert.deepEqual(second[0].data.list, [1]);
  });

  test(`${label}: empty append is a no-op`, async () => {
    const store = await make();
    assert.deepEqual(await store.append('a', [], 0), []);
    assert.deepEqual(await store.readStream('a'), []);
  });

  test(`${label}: concurrent appends with the same expected version let one win`, async () => {
    const store = await make();
    const results = await Promise.allSettled([
      store.append('a', [{ type: 'x' }], 0),
      store.append('a', [{ type: 'y' }], 0),
      store.append('a', [{ type: 'z' }], 0)
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await store.readStream('a')).length, 1);
  });
}

contract('memory store', () => new InMemoryStore({ now: fixedNow }));
contract('file store', async () => new FileStore(await tempDir(), { now: fixedNow }));

test('file store survives a restart and keeps positions', async () => {
  const dir = await tempDir();
  const first = new FileStore(dir, { now: fixedNow });
  await first.append('a', [{ type: 'x', data: { n: 1 } }, { type: 'y' }], 0);
  const second = new FileStore(dir, { now: fixedNow });
  assert.equal((await second.readStream('a')).length, 2);
  const more = await second.append('b', [{ type: 'z' }], 0);
  assert.equal(more[0].position, 3);
  await assert.rejects(() => second.append('a', [{ type: 'w' }], 1), ConcurrencyError);
});

test('file store ignores a torn final line', async () => {
  const dir = await tempDir();
  await new FileStore(dir).append('a', [{ type: 'x' }], 0);
  await appendFile(join(dir, 'events.jsonl'), '{"streamId":"a","vers');
  assert.equal((await new FileStore(dir).readStream('a')).length, 1);
});

test('file store writes one json line per event', async () => {
  const dir = await tempDir();
  await new FileStore(dir, { now: fixedNow }).append('a', [{ type: 'x' }, { type: 'y' }]);
  const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).timestamp, '2026-01-01T00:00:00.000Z');
});

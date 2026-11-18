import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemberCartSync, applyCartOperation, cartPatch } from '../../src/services/memberCart.js';
import { removePurchasedItems } from '../../src/services/cartStorage.js';

const item = (id, qty = 1) => ({ id, variantId: '', qty });
class Storage {
  data = new Map();
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i]; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, v); }
  removeItem(k) { this.data.delete(k); }
}
function server(initial = []) {
  let items = initial, fail = false, loseResponse = false;
  const seen = new Set();
  return {
    get items() { return items; },
    set items(value) { items = value; },
    set fail(value) { fail = value; },
    set loseResponse(value) { loseResponse = value; },
    async rpc(name, params) {
      assert.equal(name, 'sync_my_cart');
      if (fail) return { error: new Error('offline') };
      if (params.p_operation_id && !seen.has(params.p_operation_id)) {
        items = applyCartOperation(items, { mode: params.p_mode, items: params.p_items });
        seen.add(params.p_operation_id);
      }
      if (loseResponse) { loseResponse = false; return { error: new Error('response lost') }; }
      return { data: { items } };
    },
  };
}
const settle = async sync => { while (sync.busy) await new Promise(resolve => setTimeout(resolve, 1)); };
function client(storage, backend, uid = 'member-a') {
  let snapshot;
  const sync = new MemberCartSync({ uid, storage, rpc: backend.rpc,
    onChange: (items, error) => { snapshot = { items, error }; } });
  return { sync, get snapshot() { return snapshot; } };
}

test('guest merge is union/max; same specification is never added twice', () => {
  assert.deepEqual(applyCartOperation([item(1, 3)], { mode: 'merge', items: [item(1, 2), item(2)] }), [item(1, 3), item(2)]);
  assert.deepEqual(cartPatch([{ ...item(1), price: 99 }], [{ ...item(1), price: 100 }]), []);
});

test('checkout subtracts only purchased quantities and specifications', () => {
  assert.deepEqual(removePurchasedItems([item(1, 3), { ...item(1), variantId: 'large' }, item(2)], [item(1, 2)]),
    [item(1), { ...item(1), variantId: 'large' }, item(2)]);
});

test('offline updates persist per member and replay on reload without price data', async () => {
  const storage = new Storage(), backend = server([item(2)]);
  backend.fail = true;
  const a = client(storage, backend);
  a.sync.update([{ ...item(1, 3), price: 1, nameZh: 'local' }]);
  await settle(a.sync);
  assert.ok(a.snapshot.error);
  assert.doesNotMatch([...storage.data.values()].join(''), /price|nameZh/);
  a.sync.stop();
  assert.deepEqual(client(storage, backend, 'member-b').sync.items, []);
  const restored = client(storage, backend);
  assert.deepEqual(restored.sync.items, [item(1, 3)]);
  backend.fail = false;
  await restored.sync.refresh();
  assert.deepEqual(backend.items, [item(2), item(1, 3)]);
  assert.equal(restored.sync.pending().length, 0);
});

test('lost response retry is deduplicated; another device additions survive removal', async () => {
  const storage = new Storage(), backend = server([item(1)]);
  const a = client(storage, backend);
  await a.sync.refresh();
  backend.loseResponse = true;
  a.sync.enqueue([item(2)], 'merge');
  await settle(a.sync);
  assert.equal(a.sync.pending().length, 1);
  backend.items = [...backend.items, item(3)];
  await a.sync.refresh();
  assert.deepEqual(backend.items, [item(1), item(2), item(3)]);
  a.sync.update(previous => previous.filter(i => i.id !== 1));
  await settle(a.sync);
  assert.deepEqual(backend.items, [item(2), item(3)]);
});

test('changes while read is in flight overlay server state and are subsequently saved', async () => {
  const storage = new Storage(), backend = server([item(2)]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = client(storage, { rpc: async (...args) => { await gate; return backend.rpc(...args); } });
  const loading = a.sync.refresh();
  a.sync.update([item(1)]);
  release();
  await loading;
  assert.deepEqual(backend.items, [item(2), item(1)]);
  assert.equal(a.sync.pending().length, 0);
});

test('late response cannot replace another account state; shared tabs keep independent operations', async () => {
  const storage = new Storage(), backend = server();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = client(storage, { rpc: async (...args) => { await gate; return backend.rpc(...args); } });
  a.sync.enqueue([item(1)]);
  a.sync.stop();
  const b = client(storage, backend, 'member-b');
  await b.sync.refresh();
  release();
  await settle(a.sync);
  assert.deepEqual(b.snapshot.items, []);
  const tab = client(storage, backend);
  tab.sync.enqueue([item(2)]);
  await settle(tab.sync);
  assert.deepEqual(backend.items, [item(1), item(2)]);
});

test('a delayed response cannot replace a newer server revision saved by another tab', async () => {
  const storage = new Storage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = client(storage, { rpc: async () => { await gate; return { data: { items: [item(1)], revision: 1 } }; } });
  const reading = a.sync.refresh();
  storage.setItem(`${a.sync.prefix}cache`, JSON.stringify({ items: [item(2)], revision: 2 }));
  release();
  await reading;
  assert.deepEqual(a.snapshot.items.map(i => i.id), [2]);
  assert.equal(JSON.parse(storage.getItem(`${a.sync.prefix}cache`)).revision, 2);
});

test('adding before the first restore merges rather than reducing an unseen quantity', async () => {
  const storage = new Storage(), backend = server([item(1, 7)]);
  const a = client(storage, backend);
  a.sync.update([item(1)]);
  await settle(a.sync);
  assert.deepEqual(backend.items, [item(1, 7)]);
});

test('checkout consumes current server quantities once even after a lost response', async () => {
  const storage = new Storage(), backend = server([item(1)]);
  const a = client(storage, backend);
  await a.sync.refresh();
  backend.items = [item(1, 4), item(2)];
  backend.loseResponse = true;
  a.sync.enqueue([item(1)], 'consume');
  await settle(a.sync);
  await a.sync.refresh();
  assert.deepEqual(backend.items, [item(1, 3), item(2)]);
});

test('a failed initial restore still merges unseen items after connection recovers', async () => {
  const storage = new Storage(), backend = server([item(1, 7)]);
  backend.fail = true;
  const a = client(storage, backend);
  await a.sync.refresh();
  a.sync.update([item(1)]);
  await settle(a.sync);
  backend.fail = false;
  await a.sync.refresh();
  assert.deepEqual(backend.items, [item(1, 7)]);
});

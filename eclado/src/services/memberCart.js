import { cartItems, cartItemKey } from './cartStorage.js';

export const memberCartPrefix = uid => `eclado_member_cart_v1:${uid}:`;

export function applyCartOperation(items, operation) {
  const result = new Map(cartItems(items).map(item => [cartItemKey(item), item]));
  for (const item of operation.items) {
    const key = cartItemKey(item);
    const old = result.get(key);
    if (operation.mode === 'consume') {
      if (old && old.qty > item.qty) result.set(key, { ...old, qty: old.qty - item.qty });
      else result.delete(key);
    } else if (operation.mode === 'merge' && old) {
      result.set(key, { ...item, qty: Math.max(old.qty, item.qty),
        recommendationOnly: old.recommendationOnly === true && item.recommendationOnly === true });
    } else if (item.qty === 0) result.delete(key);
    else result.set(key, item);
  }
  return cartItems([...result.values()]);
}

export function cartPatch(previous, next) {
  const before = new Map(cartItems(previous).map(item => [cartItemKey(item), item]));
  const after = new Map(cartItems(next).map(item => [cartItemKey(item), item]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(key => {
    const old = before.get(key), item = after.get(key);
    if (JSON.stringify(old) === JSON.stringify(item)) return [];
    return [item || { ...old, qty: 0 }];
  });
}

// Each pending operation has its own storage entry, so tabs cannot erase each
// other's offline queue. The server serializes operations and deduplicates retries.
export class MemberCartSync {
  constructor({ uid, storage, rpc, onChange, uuid = () => crypto.randomUUID() }) {
    Object.assign(this, { uid, storage, rpc, onChange, uuid });
    this.prefix = memberCartPrefix(uid);
    this.base = this.read(`${this.prefix}cache`, { items: [], revision: 0 });
    this.items = this.overlay(this.base.items);
    this.stopped = false;
    this.busy = false;
    this.loaded = false;
    this.restored = false;
    this.error = '';
  }
  read(key, fallback) {
    try { return JSON.parse(this.storage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  pending() {
    const entries = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(`${this.prefix}op:`)) {
        const value = this.read(key, null);
        if (value) entries.push(value);
      }
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  overlay(items) { return this.pending().reduce(applyCartOperation, cartItems(items)); }
  publish(items, error = this.error) {
    if (this.stopped) return;
    // Keep hydrated product data until the catalog reconciliation runs again.
    const rich = new Map(this.items.map(item => [cartItemKey(item), item]));
    this.items = items.map(item => ({ ...rich.get(cartItemKey(item)), ...item,
      recommendationOnly: item.recommendationOnly === true }));
    this.error = error;
    this.onChange(this.items, error);
  }
  enqueue(items, mode = 'patch') {
    if (!items.length || this.stopped) return;
    const createdAt = Math.max(Date.now(), ...this.pending().map(op => op.createdAt + 1));
    const operation = { id: this.uuid(), mode, items, createdAt };
    // Throw on storage failure: callers must keep the guest cart / current state.
    this.storage.setItem(`${this.prefix}op:${operation.id}`, JSON.stringify(operation));
    this.publish(applyCartOperation(this.items, operation));
    void this.refresh();
  }
  update(updater) {
    if (this.stopped) return;
    const next = typeof updater === 'function' ? updater(this.items) : updater;
    const patch = cartPatch(this.items, next);
    if (patch.length) {
      if (!this.restored) {
        // A click before initial restore must not reduce an unseen server item.
        const known = new Set(cartItems(this.items).map(cartItemKey));
        this.enqueue(patch.filter(item => !known.has(cartItemKey(item)) && item.qty > 0), 'merge');
        this.enqueue(patch.filter(item => known.has(cartItemKey(item))));
      } else this.enqueue(patch);
    }
    this.items = next;
    this.onChange(next, this.error);
  }
  async refresh() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      // Even an empty queue reads the current server cart (focus / polling).
      do {
        const operation = this.pending()[0];
        const { data, error } = await this.rpc('sync_my_cart', {
          p_member_id: this.uid,
          p_operation_id: operation?.id || null,
          p_mode: operation?.mode || 'patch',
          p_items: operation?.items || [],
        });
        if (error) throw error;
        if (this.stopped) return;
        if (!Array.isArray(data?.items)) throw new Error('Invalid cart response');
        this.loaded = true;
        this.restored = true;
        if (operation) this.storage.removeItem(`${this.prefix}op:${operation.id}`);
        const shared = this.read(`${this.prefix}cache`, { items: [], revision: 0 });
        const incoming = { items: cartItems(data.items), revision: Number(data.revision || 0) };
        // Another tab may have already acknowledged a newer server revision.
        this.base = [incoming, shared, this.base].reduce((latest, candidate) => (
          candidate.revision > latest.revision ? candidate : latest
        ));
        const cache = JSON.stringify(this.base);
        if (this.storage.getItem(`${this.prefix}cache`) !== cache) this.storage.setItem(`${this.prefix}cache`, cache);
        this.publish(this.overlay(this.base.items), '');
      } while (this.pending().length && !this.stopped);
    } catch (error) {
      this.loaded = true;
      this.publish(this.items, '購物車尚未同步，請保持此瀏覽器資料；連線恢復後會自動重試。');
    } finally { this.busy = false; }
  }
  stop() { this.stopped = true; }
}

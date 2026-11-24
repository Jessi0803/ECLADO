import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareCheckoutRequest, getCheckoutRequest, clearCheckoutRequest, isDefiniteOrderRejection } from '../../src/services/checkoutRequest.js';

const values = new Map();
globalThis.sessionStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};

test('submission capability survives module reload without storing form data', async () => {
  const first = prepareCheckoutRequest('reload-member');
  assert.deepEqual(prepareCheckoutRequest('reload-member'), first);
  assert.match(first.secret, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(first).sort(), ['key', 'owner', 'secret']);
  const reloaded = await import('../../src/services/checkoutRequest.js?reload-test');
  assert.deepEqual(reloaded.getCheckoutRequest('reload-member'), first);
});

test('guest and account switches use separate keys; completing one does not discard another', () => {
  const guest = prepareCheckoutRequest(null), a = prepareCheckoutRequest('account-a'), b = prepareCheckoutRequest('account-b');
  assert.equal(new Set([guest.key, a.key, b.key]).size, 3);
  clearCheckoutRequest('account-a');
  assert.equal(getCheckoutRequest('account-a'), null);
  assert.deepEqual(getCheckoutRequest('account-b'), b);
  assert.deepEqual(getCheckoutRequest(null), guest);
  assert.notEqual(prepareCheckoutRequest('account-a').key, a.key);
});

test('blocked or silently dropped storage prevents a new submission capability', () => {
  const original = sessionStorage.setItem;
  try {
    sessionStorage.setItem = () => { throw new Error('blocked'); };
    assert.throws(() => prepareCheckoutRequest('blocked'), /無法保存/);
    assert.equal(getCheckoutRequest('blocked'), null);
    sessionStorage.setItem = () => {};
    assert.throws(() => prepareCheckoutRequest('silently-dropped'), /無法保存/);
  } finally { sessionStorage.setItem = original; }
});

test('a temporary read failure keeps the in-flight capability in memory', () => {
  const request = prepareCheckoutRequest('temporary-read-error');
  const original = sessionStorage.getItem;
  try {
    sessionStorage.getItem = () => { throw new Error('blocked'); };
    assert.deepEqual(getCheckoutRequest('temporary-read-error'), request);
  } finally { sessionStorage.getItem = original; }
});

test('invalid or other-identity saved capabilities are not adopted', () => {
  values.set('eclado_order_request_v1:malformed', '{bad json');
  assert.equal(getCheckoutRequest('malformed'), null);
  values.set('eclado_order_request_v1:mismatch', JSON.stringify(prepareCheckoutRequest('other-member')));
  assert.equal(getCheckoutRequest('mismatch'), null);
});

test('transport failures and existing-request conflicts remain unresolved', () => {
  for (const error of [new TypeError('Failed to fetch'), { code: '' }, { code: '42501' }, { code: '55000' }]) {
    assert.equal(isDefiniteOrderRejection(error), false);
  }
  for (const code of ['40001', '22023', 'PGRST202']) assert.equal(isDefiniteOrderRejection({ code }), true);
});

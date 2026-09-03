import { expect, test } from '@playwright/test';
import { normalizeMember, orderBelongsToMember } from '../src/admin/domain/mappers.js';

test('會員消費總額只計入已付款及後續履約狀態', () => {
  const member = normalizeMember(
    {
      id: 'member-1',
      email: 'member@example.com',
      name: '測試會員',
      role: 'consumer',
      created_at: '2026-08-01T00:00:00Z',
    },
    [
      { id: 'paid', user_id: 'member-1', email: 'member@example.com', status: 'paid', total: 1000 },
      { id: 'delivered', user_id: 'member-1', email: 'member@example.com', status: 'delivered', total: 2000 },
      { id: 'cancelled', user_id: 'member-1', email: 'member@example.com', status: 'cancelled', total: 3000 },
      { id: 'unpaid', user_id: 'member-1', email: 'member@example.com', status: 'unpaid', total: 4000 },
      { id: 'other-member', user_id: 'member-2', email: 'other@example.com', status: 'paid', total: 5000 },
    ],
  );

  expect(member.orders).toBe(4);
  expect(member.total).toBe(3000);
});

test('會員訂單只依 user_id 歸戶，不使用相同 Email 的訪客訂單', () => {
  const profile = {
    id: 'member-1',
    email: 'member@example.com',
    name: '測試會員',
    role: 'consumer',
    created_at: '2026-08-01T00:00:00Z',
  };
  const memberOrder = {
    id: 'member-order', user_id: 'member-1', email: 'different@example.com', status: 'paid', total: 1200,
  };
  const guestOrder = {
    id: 'guest-order', user_id: null, email: 'member@example.com', status: 'paid', total: 2500,
  };

  const member = normalizeMember(profile, [memberOrder, guestOrder]);

  expect(orderBelongsToMember(memberOrder, profile.id)).toBe(true);
  expect(orderBelongsToMember(guestOrder, profile.id)).toBe(false);
  expect(member.orders).toBe(1);
  expect(member.total).toBe(1200);
});

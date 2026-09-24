-- ECLADO permanent member shopping credit — phase 1 foundation.
--
-- This migration creates an account summary, append-only ledger and one
-- mutable order reservation state per order. It deliberately does not alter
-- checkout or order lifecycle functions yet; those integrations are added in
-- the next phase after this foundation has been deployed and verified.

begin;

-- Shopping credit carries monetary value, so it has a permission separate
-- from ordinary member editing. Both full administrator roles receive it.
alter table public.backoffice_role_permissions
  drop constraint if exists backoffice_role_permissions_permission_check;
alter table public.backoffice_role_permissions
  add constraint backoffice_role_permissions_permission_check check (permission in (
    'catalog.read', 'catalog.write',
    'orders.read', 'orders.write',
    'members.read', 'members.write',
    'promotions.manage', 'procurement.manage',
    'analytics.read', 'audit_logs.read', 'notifications.send',
    'backorders.manage', 'inventory_counts.manage', 'shopping_credit.manage'
  ));

insert into public.backoffice_role_permissions (role, permission) values
  ('super_admin', 'shopping_credit.manage'),
  ('admin', 'shopping_credit.manage')
on conflict do nothing;

-- Fast current-state projection. The ledger remains the accounting source of
-- truth; these balances may only be changed by the transactional functions in
-- this migration and later order-lifecycle integrations.
create table if not exists public.shopping_credit_accounts (
  user_id uuid primary key,
  available_balance bigint not null default 0 check (available_balance >= 0),
  reserved_balance bigint not null default 0 check (reserved_balance >= 0),
  status text not null default 'active' check (status in ('active', 'deletion_pending')),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The member UUID is intentionally retained without a cascading foreign key.
-- A deleted member's zero-balance accounting history must remain auditable,
-- while no name, email, phone or other profile PII is copied into this table.
create table if not exists public.shopping_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  event_type text not null check (event_type in (
    'grant', 'debit', 'reserve', 'consume', 'release', 'refund'
  )),
  amount bigint not null check (amount > 0),
  available_delta bigint not null,
  reserved_delta bigint not null,
  available_balance_after bigint not null check (available_balance_after >= 0),
  reserved_balance_after bigint not null check (reserved_balance_after >= 0),
  order_id text,
  reason_code text not null check (length(btrim(reason_code)) between 1 and 80),
  internal_note text check (internal_note is null or length(internal_note) <= 500),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  request_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (request_id),
  check (
    (event_type in ('grant', 'refund') and available_delta = amount and reserved_delta = 0)
    or (event_type = 'debit' and available_delta = -amount and reserved_delta = 0)
    or (event_type = 'reserve' and available_delta = -amount and reserved_delta = amount)
    or (event_type = 'consume' and available_delta = 0 and reserved_delta = -amount)
    or (event_type = 'release' and available_delta = amount and reserved_delta = -amount)
  )
);

create index if not exists shopping_credit_ledger_user_created_idx
  on public.shopping_credit_ledger (user_id, created_at desc, id desc);
create index if not exists shopping_credit_ledger_order_idx
  on public.shopping_credit_ledger (order_id, created_at, id)
  where order_id is not null;
create unique index if not exists shopping_credit_ledger_order_event_unique_idx
  on public.shopping_credit_ledger (order_id, event_type)
  where order_id is not null and event_type in ('reserve', 'consume', 'release', 'refund');

-- One order owns at most one shopping-credit reservation. This row is the
-- current lifecycle projection; every transition also appends a ledger event.
create table if not exists public.shopping_credit_order_reservations (
  order_id text primary key,
  user_id uuid not null,
  amount bigint not null check (amount > 0),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released', 'refunded')),
  version bigint not null default 0 check (version >= 0),
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'reserved' and consumed_at is null and released_at is null and refunded_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null and refunded_at is null)
    or (status = 'released' and released_at is not null and consumed_at is null and refunded_at is null)
    or (status = 'refunded' and consumed_at is not null and refunded_at is not null and released_at is null)
  )
);

create index if not exists shopping_credit_reservations_user_status_idx
  on public.shopping_credit_order_reservations (user_id, status, updated_at desc);

alter table public.shopping_credit_accounts enable row level security;
alter table public.shopping_credit_ledger enable row level security;
alter table public.shopping_credit_order_reservations enable row level security;
revoke all on table public.shopping_credit_accounts from anon, authenticated;
revoke all on table public.shopping_credit_ledger from anon, authenticated;
revoke all on table public.shopping_credit_order_reservations from anon, authenticated;

-- Accounting rows are immutable even to service-role table writes. Corrections
-- are compensating ledger entries, never edits or deletes.
create or replace function public.prevent_shopping_credit_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Shopping credit ledger is append-only' using errcode = '42501';
end;
$$;

revoke all on function public.prevent_shopping_credit_ledger_mutation() from public;
drop trigger if exists trg_prevent_shopping_credit_ledger_mutation on public.shopping_credit_ledger;
create trigger trg_prevent_shopping_credit_ledger_mutation
  before update or delete on public.shopping_credit_ledger
  for each row execute function public.prevent_shopping_credit_ledger_mutation();

-- The relationship between an order and its original credit amount never
-- changes. Only lifecycle state/timestamps/version are mutable.
create or replace function public.protect_shopping_credit_reservation_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id is distinct from old.order_id
    or new.user_id is distinct from old.user_id
    or new.amount is distinct from old.amount
    or new.reserved_at is distinct from old.reserved_at
  then
    raise exception 'Shopping credit reservation identity is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_shopping_credit_reservation_identity() from public;
drop trigger if exists trg_protect_shopping_credit_reservation_identity on public.shopping_credit_order_reservations;
create trigger trg_protect_shopping_credit_reservation_identity
  before update on public.shopping_credit_order_reservations
  for each row execute function public.protect_shopping_credit_reservation_identity();

-- Backoffice manual grants/debits. A caller-generated request UUID makes a
-- retried click or HTTP request idempotent. The account row serializes all
-- concurrent changes for one member.
create or replace function public.adjust_member_shopping_credit(
  p_user_id uuid,
  p_direction text,
  p_amount bigint,
  p_reason_code text,
  p_internal_note text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_direction text := lower(btrim(coalesce(p_direction, '')));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  normalized_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  target_account public.shopping_credit_accounts%rowtype;
  existing_entry public.shopping_credit_ledger%rowtype;
  next_available bigint;
  event_name text;
  actor_admin_role text;
  result jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if normalized_direction not in ('grant', 'debit') then
    raise exception 'Invalid shopping credit direction' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Shopping credit amount must be a positive integer' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'Shopping credit request ID is required' using errcode = '22023';
  end if;
  if normalized_direction = 'grant' and normalized_reason not in (
    'customer_service_compensation', 'campaign_grant', 'order_return_adjustment',
    'wrong_account_correction', 'other'
  ) then
    raise exception 'Invalid shopping credit grant reason' using errcode = '22023';
  end if;
  if normalized_direction = 'debit' and normalized_reason not in (
    'wrong_account_correction', 'eligibility_revocation',
    'order_return_adjustment', 'other'
  ) then
    raise exception 'Invalid shopping credit debit reason' using errcode = '22023';
  end if;
  if normalized_reason = 'other' and normalized_note is null then
    raise exception 'A note is required for the other reason' using errcode = '22023';
  end if;
  if normalized_note is not null and length(normalized_note) > 500 then
    raise exception 'Shopping credit note is too long' using errcode = '22023';
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id
  for update;

  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is locked for deletion'
      using errcode = '55000';
  end if;

  -- Recheck after acquiring the account lock so simultaneous retries cannot
  -- both pass an earlier request lookup.
  select entry.* into existing_entry
  from public.shopping_credit_ledger entry
  where entry.request_id = p_request_id;

  if found then
    event_name := normalized_direction;
    if existing_entry.user_id <> p_user_id
      or existing_entry.event_type <> event_name
      or existing_entry.amount <> p_amount
      or existing_entry.reason_code <> normalized_reason
      or existing_entry.internal_note is distinct from normalized_note
    then
      raise exception 'Shopping credit request ID was reused with different data'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'entry_id', existing_entry.id,
      'user_id', existing_entry.user_id,
      'available_balance', existing_entry.available_balance_after,
      'reserved_balance', existing_entry.reserved_balance_after
    );
  end if;

  next_available := case normalized_direction
    when 'grant' then target_account.available_balance + p_amount
    else target_account.available_balance - p_amount
  end;
  if next_available < 0 then
    raise exception 'Insufficient available shopping credit' using errcode = '22003';
  end if;

  update public.shopping_credit_accounts
  set available_balance = next_available,
      version = version + 1,
      updated_at = now()
  where user_id = p_user_id;

  select role into actor_admin_role
  from public.admin_users
  where user_id = auth.uid() and active is true;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    reason_code, internal_note, actor_user_id, actor_email, actor_role, request_id
  ) values (
    p_user_id, normalized_direction, p_amount,
    case when normalized_direction = 'grant' then p_amount else -p_amount end,
    0, next_available, target_account.reserved_balance,
    normalized_reason, normalized_note, auth.uid(),
    nullif(auth.jwt() ->> 'email', ''), actor_admin_role, p_request_id
  )
  returning jsonb_build_object(
    'ok', true,
    'already_processed', false,
    'entry_id', id,
    'user_id', user_id,
    'available_balance', available_balance_after,
    'reserved_balance', reserved_balance_after
  ) into result;

  return result;
end;
$$;

revoke all on function public.adjust_member_shopping_credit(uuid,text,bigint,text,text,uuid) from public, anon;
grant execute on function public.adjust_member_shopping_credit(uuid,text,bigint,text,text,uuid) to authenticated;

-- Member-safe view: no administrator identity or internal note is returned.
create or replace function public.get_my_shopping_credit()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then
    jsonb_build_object('available_balance', 0, 'entries', '[]'::jsonb)
  else jsonb_build_object(
    'available_balance', coalesce((
      select account.available_balance
      from public.shopping_credit_accounts account
      where account.user_id = auth.uid() and account.status = 'active'
    ), 0),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.created_at desc, history.id desc)
      from (
        select entry.id, entry.event_type, entry.amount,
          entry.available_delta, entry.reserved_delta,
          entry.available_balance_after, entry.reason_code,
          entry.order_id, entry.created_at
        from public.shopping_credit_ledger entry
        where entry.user_id = auth.uid()
        order by entry.created_at desc, entry.id desc
        limit 100
      ) history
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_my_shopping_credit() from public, anon;
grant execute on function public.get_my_shopping_credit() to authenticated;

-- Backoffice view includes internal notes and actor snapshots for auditing.
create or replace function public.get_member_shopping_credit(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'available_balance', coalesce((
      select account.available_balance from public.shopping_credit_accounts account
      where account.user_id = p_user_id
    ), 0),
    'reserved_balance', coalesce((
      select account.reserved_balance from public.shopping_credit_accounts account
      where account.user_id = p_user_id
    ), 0),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.created_at desc, history.id desc)
      from (
        select entry.id, entry.event_type, entry.amount,
          entry.available_delta, entry.reserved_delta,
          entry.available_balance_after, entry.reserved_balance_after,
          entry.reason_code, entry.internal_note, entry.order_id,
          entry.actor_user_id, entry.actor_email, entry.actor_role,
          entry.request_id, entry.created_at
        from public.shopping_credit_ledger entry
        where entry.user_id = p_user_id
        order by entry.created_at desc, entry.id desc
        limit 100
      ) history
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_member_shopping_credit(uuid) from public, anon;
grant execute on function public.get_member_shopping_credit(uuid) to authenticated;

-- Read-only reconciliation for administrators. Both deltas must equal the
-- current account projection; any mismatch indicates an invariant violation.
create or replace function public.reconcile_member_shopping_credit(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account_available bigint := 0;
  account_reserved bigint := 0;
  ledger_available bigint := 0;
  ledger_reserved bigint := 0;
begin
  if auth.uid() is null or not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode = '42501';
  end if;

  select coalesce(max(account.available_balance), 0), coalesce(max(account.reserved_balance), 0)
  into account_available, account_reserved
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id;

  select coalesce(sum(entry.available_delta), 0), coalesce(sum(entry.reserved_delta), 0)
  into ledger_available, ledger_reserved
  from public.shopping_credit_ledger entry
  where entry.user_id = p_user_id;

  return jsonb_build_object(
    'user_id', p_user_id,
    'account_available', account_available,
    'ledger_available', ledger_available,
    'account_reserved', account_reserved,
    'ledger_reserved', ledger_reserved,
    'matches', account_available = ledger_available and account_reserved = ledger_reserved
  );
end;
$$;

revoke all on function public.reconcile_member_shopping_credit(uuid) from public, anon;
grant execute on function public.reconcile_member_shopping_credit(uuid) to authenticated;

-- Private lifecycle primitives used by the next checkout/payment integration.
-- They are installed now so their invariants can be reviewed independently.
create or replace function public.reserve_order_shopping_credit(
  p_user_id uuid,
  p_order_id text,
  p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  target_account public.shopping_credit_accounts%rowtype;
  existing_reservation public.shopping_credit_order_reservations%rowtype;
  next_available bigint;
  next_reserved bigint;
begin
  if p_user_id is null or normalized_order_id = '' or p_amount is null or p_amount <= 0 then
    raise exception 'Invalid shopping credit reservation' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.orders target_order
    where target_order.id = normalized_order_id
      and target_order.user_id = p_user_id
  ) then
    raise exception 'Shopping credit order does not belong to the member'
      using errcode = '42501';
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id
  for update;

  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is unavailable' using errcode = '55000';
  end if;

  select reservation.* into existing_reservation
  from public.shopping_credit_order_reservations reservation
  where reservation.order_id = normalized_order_id
  for update;

  if found then
    if existing_reservation.user_id = p_user_id
      and existing_reservation.amount = p_amount
      and existing_reservation.status in ('reserved', 'consumed')
    then
      return jsonb_build_object(
        'ok', true, 'already_processed', true,
        'order_id', existing_reservation.order_id,
        'status', existing_reservation.status,
        'amount', existing_reservation.amount
      );
    end if;
    raise exception 'Order shopping credit reservation conflicts with existing data'
      using errcode = '23505';
  end if;

  if target_account.available_balance < p_amount then
    raise exception 'Insufficient available shopping credit' using errcode = '22003';
  end if;

  next_available := target_account.available_balance - p_amount;
  next_reserved := target_account.reserved_balance + p_amount;

  update public.shopping_credit_accounts
  set available_balance = next_available,
      reserved_balance = next_reserved,
      version = version + 1,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.shopping_credit_order_reservations (order_id, user_id, amount)
  values (normalized_order_id, p_user_id, p_amount);

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    p_user_id, 'reserve', p_amount, -p_amount, p_amount,
    next_available, next_reserved,
    normalized_order_id, 'order_checkout',
    jsonb_build_object('source', 'order_creation')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'status', 'reserved', 'amount', p_amount,
    'available_balance', next_available, 'reserved_balance', next_reserved
  );
end;
$$;

create or replace function public.consume_order_shopping_credit(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  reservation public.shopping_credit_order_reservations%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  next_reserved bigint;
begin
  select held.* into reservation
  from public.shopping_credit_order_reservations held
  where held.order_id = normalized_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', 0);
  end if;
  if reservation.status = 'consumed' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', reservation.amount);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Shopping credit reservation is not consumable' using errcode = '55000';
  end if;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = reservation.user_id
  for update;

  if target_account.reserved_balance < reservation.amount then
    raise exception 'Shopping credit reserved balance is inconsistent' using errcode = '23514';
  end if;
  next_reserved := target_account.reserved_balance - reservation.amount;

  update public.shopping_credit_accounts
  set reserved_balance = next_reserved, version = version + 1, updated_at = now()
  where user_id = reservation.user_id;

  update public.shopping_credit_order_reservations
  set status = 'consumed', consumed_at = now(), updated_at = now(), version = version + 1
  where order_id = normalized_order_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    reservation.user_id, 'consume', reservation.amount, 0, -reservation.amount,
    target_account.available_balance, next_reserved,
    normalized_order_id, 'payment_success',
    jsonb_build_object('source', 'payment_confirmation')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'amount', reservation.amount,
    'available_balance', target_account.available_balance,
    'reserved_balance', next_reserved
  );
end;
$$;

create or replace function public.release_order_shopping_credit(
  p_order_id text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  reservation public.shopping_credit_order_reservations%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  next_available bigint;
  next_reserved bigint;
begin
  if normalized_reason not in ('order_cancelled', 'order_expired', 'payment_failed') then
    raise exception 'Invalid shopping credit release reason' using errcode = '22023';
  end if;

  select held.* into reservation
  from public.shopping_credit_order_reservations held
  where held.order_id = normalized_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', 0);
  end if;
  if reservation.status = 'released' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', reservation.amount);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Shopping credit reservation is not releasable' using errcode = '55000';
  end if;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = reservation.user_id
  for update;

  if target_account.reserved_balance < reservation.amount then
    raise exception 'Shopping credit reserved balance is inconsistent' using errcode = '23514';
  end if;
  next_available := target_account.available_balance + reservation.amount;
  next_reserved := target_account.reserved_balance - reservation.amount;

  update public.shopping_credit_accounts
  set available_balance = next_available, reserved_balance = next_reserved,
      version = version + 1, updated_at = now()
  where user_id = reservation.user_id;

  update public.shopping_credit_order_reservations
  set status = 'released', released_at = now(), updated_at = now(), version = version + 1
  where order_id = normalized_order_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    reservation.user_id, 'release', reservation.amount, reservation.amount, -reservation.amount,
    next_available, next_reserved, normalized_order_id, normalized_reason,
    jsonb_build_object('source', 'order_lifecycle')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'amount', reservation.amount,
    'available_balance', next_available, 'reserved_balance', next_reserved
  );
end;
$$;

create or replace function public.refund_order_shopping_credit(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  reservation public.shopping_credit_order_reservations%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  next_available bigint;
begin
  select held.* into reservation
  from public.shopping_credit_order_reservations held
  where held.order_id = normalized_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', 0);
  end if;
  if reservation.status = 'refunded' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', reservation.amount);
  end if;
  if reservation.status <> 'consumed' then
    raise exception 'Shopping credit use is not refundable' using errcode = '55000';
  end if;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = reservation.user_id
  for update;
  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is unavailable' using errcode = '55000';
  end if;
  next_available := target_account.available_balance + reservation.amount;

  update public.shopping_credit_accounts
  set available_balance = next_available, version = version + 1, updated_at = now()
  where user_id = reservation.user_id;

  update public.shopping_credit_order_reservations
  set status = 'refunded', refunded_at = now(), updated_at = now(), version = version + 1
  where order_id = normalized_order_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    reservation.user_id, 'refund', reservation.amount, reservation.amount, 0,
    next_available, target_account.reserved_balance,
    normalized_order_id, 'order_cancelled',
    jsonb_build_object('source', 'paid_order_cancellation')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'amount', reservation.amount,
    'available_balance', next_available,
    'reserved_balance', target_account.reserved_balance
  );
end;
$$;

revoke all on function public.reserve_order_shopping_credit(uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.consume_order_shopping_credit(text) from public, anon, authenticated;
revoke all on function public.release_order_shopping_credit(text,text) from public, anon, authenticated;
revoke all on function public.refund_order_shopping_credit(text) from public, anon, authenticated;

-- Lock an account before the external Auth deletion call. Once locked, no
-- grant, debit or checkout reservation can race into the deletion window.
create or replace function public.prepare_member_shopping_credit_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.shopping_credit_accounts%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id
  for update;

  if target_account.available_balance <> 0 or target_account.reserved_balance <> 0 then
    raise exception 'Member still has available or reserved shopping credit'
      using errcode = '55000';
  end if;

  update public.shopping_credit_accounts
  set status = 'deletion_pending', version = version + 1, updated_at = now()
  where user_id = p_user_id and status <> 'deletion_pending';

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'locked', true);
end;
$$;

create or replace function public.cancel_member_shopping_credit_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  update public.shopping_credit_accounts
  set status = 'active', version = version + 1, updated_at = now()
  where user_id = p_user_id and status = 'deletion_pending';

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'locked', false);
end;
$$;

revoke all on function public.prepare_member_shopping_credit_deletion(uuid) from public, anon;
revoke all on function public.cancel_member_shopping_credit_deletion(uuid) from public, anon;
grant execute on function public.prepare_member_shopping_credit_deletion(uuid) to authenticated;
grant execute on function public.cancel_member_shopping_credit_deletion(uuid) to authenticated;

comment on table public.shopping_credit_accounts is
  'Fast shopping-credit balance projection. All writes must be paired with append-only ledger entries.';
comment on table public.shopping_credit_ledger is
  'Permanent append-only shopping-credit accounting events without copied member PII.';
comment on table public.shopping_credit_order_reservations is
  'One current shopping-credit lifecycle projection per order; history remains in the ledger.';

commit;

notify pgrst, 'reload schema';

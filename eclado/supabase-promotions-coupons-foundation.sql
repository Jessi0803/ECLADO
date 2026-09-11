-- ECLADO promotions, coupons and gifts — batch 1 foundation
--
-- Additive schema only. This migration intentionally does not change the
-- current promotion evaluator or checkout result. Apply after:
--   supabase-backoffice-permissions.sql
--   supabase-promotions.sql
--   supabase-product-publication-status.sql
--   supabase-order-inventory-allocation.sql
--   supabase-admin-audit-logs.sql

begin;

-- --------------------------------------------------------------------------
-- Product lifecycle: reserve gift_only for products that can only be inserted
-- into an order by the future authoritative promotion engine.
-- --------------------------------------------------------------------------

alter table public.products
  drop constraint if exists products_publication_status_check;

alter table public.products
  add constraint products_publication_status_check
  check (publication_status in ('draft', 'active', 'event_only', 'gift_only', 'archived'));

create or replace function public.set_product_publication_status(
  p_product_id integer,
  p_publication_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_backoffice_permission('catalog.write') then
    raise exception 'Catalog write access required' using errcode = '42501';
  end if;
  if p_publication_status not in ('draft', 'active', 'event_only', 'gift_only', 'archived') then
    raise exception 'Invalid publication status' using errcode = '22023';
  end if;
  update public.products
  set publication_status = p_publication_status
  where id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_product_publication_status(integer, text) from public;
grant execute on function public.set_product_publication_status(integer, text) to authenticated;

comment on column public.products.publication_status is
  'Product lifecycle: draft, active, event_only, gift_only (promotion engine only), or archived.';

-- --------------------------------------------------------------------------
-- Promotions become atomic benefit rules. Existing rows stay legacy_discount
-- so the current checkout continues to behave exactly as before in batch 1.
-- --------------------------------------------------------------------------

alter table public.promotions
  add column if not exists benefit_type text not null default 'legacy_discount',
  add column if not exists activation_type text not null default 'automatic',
  add column if not exists threshold_value numeric,
  add column if not exists threshold_type text not null default 'amount',
  add column if not exists threshold_basis text,
  add column if not exists gift_variant_id bigint references public.product_variants(id) on delete restrict,
  add column if not exists gift_quantity integer,
  add column if not exists repeat_mode text not null default 'once',
  add column if not exists exclusive_group text,
  add column if not exists priority integer not null default 100,
  add column if not exists archived_at timestamptz;

alter table public.promotions
  drop constraint if exists promotions_benefit_type_check,
  drop constraint if exists promotions_activation_type_check,
  drop constraint if exists promotions_threshold_value_check,
  drop constraint if exists promotions_threshold_type_check,
  drop constraint if exists promotions_threshold_basis_check,
  drop constraint if exists promotions_gift_configuration_check,
  drop constraint if exists promotions_repeat_mode_check;

-- Existing discount activities used monetary thresholds before this column
-- existed. Keep them as amount-based and infer the two gift types explicitly.
update public.promotions
set threshold_type = case
  when benefit_type = 'quantity_gift' then 'quantity'
  when benefit_type = 'amount_gift' then 'amount'
  else coalesce(threshold_type, 'amount')
end;

alter table public.promotions
  add constraint promotions_benefit_type_check check (
    benefit_type in (
      'legacy_discount',
      'percentage_discount',
      'fixed_discount',
      'amount_gift',
      'quantity_gift'
    )
  ),
  add constraint promotions_activation_type_check check (
    activation_type in ('automatic', 'coupon_only')
  ),
  add constraint promotions_threshold_value_check check (
    threshold_value is null or threshold_value > 0
  ),
  add constraint promotions_threshold_type_check check (
    threshold_type in ('amount', 'quantity')
    and (benefit_type <> 'amount_gift' or threshold_type = 'amount')
    and (benefit_type <> 'quantity_gift' or threshold_type = 'quantity')
  ),
  add constraint promotions_threshold_basis_check check (
    threshold_basis is null
    or threshold_basis in ('before_bundle_discount', 'after_bundle_discount')
  ),
  add constraint promotions_gift_configuration_check check (
    (
      benefit_type in ('amount_gift', 'quantity_gift')
      and threshold_value is not null
      and gift_variant_id is not null
      and gift_quantity is not null
      and gift_quantity > 0
    )
    or (
      benefit_type not in ('amount_gift', 'quantity_gift')
      and gift_variant_id is null
      and gift_quantity is null
    )
  ),
  add constraint promotions_repeat_mode_check check (
    repeat_mode in ('once', 'repeat')
  );

create index if not exists promotions_activation_live_idx
  on public.promotions (activation_type, active, start_at, end_at)
  where archived_at is null;

create index if not exists promotions_gift_variant_idx
  on public.promotions (gift_variant_id)
  where gift_variant_id is not null and archived_at is null;

comment on column public.promotions.benefit_type is
  'One atomic benefit per promotion. legacy_discount preserves the pre-coupon evaluator until batch 2.';
comment on column public.promotions.activation_type is
  'automatic applies without a code; coupon_only can only be reached through coupon_promotions.';

-- --------------------------------------------------------------------------
-- Scope rows distinguish the merchandise that qualifies from the merchandise
-- that actually receives a price benefit.
-- --------------------------------------------------------------------------

create table if not exists public.promotion_scopes (
  id bigint generated always as identity primary key,
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  scope_role text not null check (scope_role in ('qualification', 'benefit')),
  target_type text not null check (
    target_type in ('all_regular', 'all_sellable', 'product', 'variant', 'category', 'series')
  ),
  product_id integer references public.products(id) on delete restrict,
  product_variant_id bigint references public.product_variants(id) on delete restrict,
  target_value text,
  mode text not null default 'include' check (mode in ('include', 'exclude')),
  created_at timestamptz not null default now(),
  constraint promotion_scopes_target_check check (
    (target_type in ('all_regular', 'all_sellable') and product_id is null and product_variant_id is null and target_value is null)
    or (target_type = 'product' and product_id is not null and product_variant_id is null and target_value is null)
    or (target_type = 'variant' and product_id is null and product_variant_id is not null and target_value is null)
    or (target_type in ('category', 'series') and product_id is null and product_variant_id is null and nullif(btrim(target_value), '') is not null)
  )
);

create index if not exists promotion_scopes_promotion_idx
  on public.promotion_scopes (promotion_id, scope_role, mode);
create unique index if not exists promotion_scopes_unique_target_idx
  on public.promotion_scopes (
    promotion_id,
    scope_role,
    target_type,
    coalesce(product_id, 0),
    coalesce(product_variant_id, 0),
    coalesce(target_value, ''),
    mode
  );

comment on table public.promotion_scopes is
  'Included and excluded qualification/benefit targets. all_regular means active products; all_sellable also includes event_only products. Neither includes gift_only products.';

-- --------------------------------------------------------------------------
-- One coupon campaign owns one normalized code in version 1.
-- --------------------------------------------------------------------------

create table if not exists public.coupon_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(btrim(name), '') is not null),
  description text,
  code text not null,
  code_normalized text not null,
  start_at timestamptz,
  end_at timestamptz,
  active boolean not null default true,
  total_usage_limit integer check (total_usage_limit is null or total_usage_limit > 0),
  per_member_limit integer check (per_member_limit is null or per_member_limit > 0),
  audience_roles text[] not null default array['consumer', 'pro', 'instructor', 'distributor']::text[],
  allow_guest boolean not null default true,
  stacking_policy text not null default 'allow_auto_gifts' check (
    stacking_policy in ('coupon_only', 'allow_auto_gifts', 'allow_all')
  ),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint coupon_campaigns_period_check check (
    start_at is null or end_at is null or start_at < end_at
  ),
  constraint coupon_campaigns_audience_check check (
    cardinality(audience_roles) > 0
    and audience_roles <@ array['consumer', 'pro', 'instructor', 'distributor']::text[]
  )
);

create or replace function public.normalize_coupon_campaign_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := btrim(new.code);
  new.code_normalized := upper(new.code);
  if new.code_normalized = '' then
    raise exception 'Coupon code is required' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.normalize_coupon_campaign_code() from public;

drop trigger if exists trg_coupon_campaigns_normalize_code on public.coupon_campaigns;
create trigger trg_coupon_campaigns_normalize_code
  before insert or update on public.coupon_campaigns
  for each row execute function public.normalize_coupon_campaign_code();

create unique index if not exists coupon_campaigns_code_unique_idx
  on public.coupon_campaigns (code_normalized);
create index if not exists coupon_campaigns_live_idx
  on public.coupon_campaigns (active, start_at, end_at)
  where archived_at is null;

comment on table public.coupon_campaigns is
  'Coupon bundle header. Version 1 stores exactly one normalized code per campaign and is never publicly selectable.';

-- --------------------------------------------------------------------------
-- Coupon bundles reference one or more coupon-only atomic promotions.
-- --------------------------------------------------------------------------

create table if not exists public.coupon_promotions (
  id bigint generated always as identity primary key,
  coupon_campaign_id uuid not null references public.coupon_campaigns(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (coupon_campaign_id, promotion_id)
);

create index if not exists coupon_promotions_campaign_order_idx
  on public.coupon_promotions (coupon_campaign_id, sort_order, id);
create index if not exists coupon_promotions_promotion_idx
  on public.coupon_promotions (promotion_id, coupon_campaign_id);

create or replace function public.validate_coupon_promotion_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.promotions promotion
    where promotion.id = new.promotion_id
      and promotion.activation_type = 'coupon_only'
      and promotion.archived_at is null
  ) then
    raise exception 'Coupon campaigns can only include active coupon-only promotion definitions'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_coupon_promotion_link() from public;

drop trigger if exists trg_coupon_promotions_validate on public.coupon_promotions;
create trigger trg_coupon_promotions_validate
  before insert or update on public.coupon_promotions
  for each row execute function public.validate_coupon_promotion_link();

comment on table public.coupon_promotions is
  'Ordered links from one coupon campaign to reusable coupon-only atomic promotions.';

-- --------------------------------------------------------------------------
-- Coupon usage lifecycle. Future security-definer pricing functions write
-- these rows; the browser never does.
-- --------------------------------------------------------------------------

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_campaign_id uuid not null references public.coupon_campaigns(id) on delete restrict,
  order_id text not null references public.orders(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  guest_identity_hash text,
  status text not null check (status in ('reserved', 'redeemed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  unique (coupon_campaign_id, order_id),
  constraint coupon_redemptions_identity_check check (
    user_id is not null or nullif(guest_identity_hash, '') is not null
  ),
  constraint coupon_redemptions_lifecycle_check check (
    (status = 'reserved' and redeemed_at is null and released_at is null)
    or (status = 'redeemed' and redeemed_at is not null and released_at is null)
    or (status = 'released' and released_at is not null)
  )
);

create index if not exists coupon_redemptions_campaign_status_idx
  on public.coupon_redemptions (coupon_campaign_id, status, expires_at);
create index if not exists coupon_redemptions_user_usage_idx
  on public.coupon_redemptions (coupon_campaign_id, user_id, status)
  where user_id is not null;
create index if not exists coupon_redemptions_guest_usage_idx
  on public.coupon_redemptions (coupon_campaign_id, guest_identity_hash, status)
  where guest_identity_hash is not null;

comment on table public.coupon_redemptions is
  'Transactional coupon quota lifecycle: reserved at order creation, redeemed on payment, released on cancellation or expiry.';

-- --------------------------------------------------------------------------
-- Gift stock reservations prevent unpaid orders from over-promising a gift.
-- --------------------------------------------------------------------------

create table if not exists public.promotion_gift_reservations (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  coupon_campaign_id uuid references public.coupon_campaigns(id) on delete restrict,
  product_variant_id bigint not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null check (status in ('reserved', 'consumed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  unique (order_id, promotion_id, product_variant_id),
  constraint promotion_gift_reservations_lifecycle_check check (
    (status = 'reserved' and consumed_at is null and released_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status = 'released' and released_at is not null)
  )
);

create index if not exists promotion_gift_reservations_variant_status_idx
  on public.promotion_gift_reservations (product_variant_id, status, expires_at);
create index if not exists promotion_gift_reservations_order_idx
  on public.promotion_gift_reservations (order_id, status);

comment on table public.promotion_gift_reservations is
  'Temporary claim on an existing product variant used as a promotional gift. Gift backorders are not allowed.';

-- --------------------------------------------------------------------------
-- Immutable, normalized order-level records for every applied benefit.
-- --------------------------------------------------------------------------

create table if not exists public.order_adjustments (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  promotion_id uuid references public.promotions(id) on delete restrict,
  coupon_campaign_id uuid references public.coupon_campaigns(id) on delete restrict,
  adjustment_type text not null check (
    adjustment_type in (
      'percentage_discount',
      'fixed_discount',
      'amount_gift',
      'quantity_gift',
      'free_shipping'
    )
  ),
  name_snapshot text not null,
  qualification_snapshot jsonb not null default '{}'::jsonb,
  amount numeric not null default 0 check (amount >= 0),
  gift_product_id integer references public.products(id) on delete restrict,
  gift_variant_id bigint references public.product_variants(id) on delete restrict,
  gift_quantity integer,
  sort_order integer not null default 0 check (sort_order >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_adjustments_gift_check check (
    (
      adjustment_type in ('amount_gift', 'quantity_gift')
      and gift_product_id is not null
      and gift_variant_id is not null
      and gift_quantity is not null
      and gift_quantity > 0
      and amount = 0
    )
    or (
      adjustment_type not in ('amount_gift', 'quantity_gift')
      and gift_product_id is null
      and gift_variant_id is null
      and gift_quantity is null
    )
  )
);

create index if not exists order_adjustments_order_idx
  on public.order_adjustments (order_id, sort_order, id);
create index if not exists order_adjustments_promotion_idx
  on public.order_adjustments (promotion_id, created_at);
create index if not exists order_adjustments_coupon_idx
  on public.order_adjustments (coupon_campaign_id, created_at)
  where coupon_campaign_id is not null;

create or replace function public.prevent_order_adjustment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Order adjustments are immutable' using errcode = '42501';
end;
$$;

revoke all on function public.prevent_order_adjustment_mutation() from public;

drop trigger if exists trg_prevent_order_adjustment_mutation on public.order_adjustments;
create trigger trg_prevent_order_adjustment_mutation
  before update or delete on public.order_adjustments
  for each row execute function public.prevent_order_adjustment_mutation();

comment on table public.order_adjustments is
  'Immutable normalized snapshot of every discount, gift and shipping benefit applied to an order.';

-- --------------------------------------------------------------------------
-- Order summaries and inventory allocation markers remain backwards
-- compatible. Every existing row receives merchandise as its line type.
-- --------------------------------------------------------------------------

alter table public.orders
  add column if not exists coupon_campaign_id uuid references public.coupon_campaigns(id) on delete restrict,
  add column if not exists coupon_name text,
  add column if not exists coupon_code_mask text;

alter table public.order_inventory_allocations
  add column if not exists line_type text not null default 'merchandise',
  add column if not exists promotion_id uuid references public.promotions(id) on delete restrict,
  add column if not exists coupon_campaign_id uuid references public.coupon_campaigns(id) on delete restrict;

alter table public.order_inventory_allocations
  drop constraint if exists order_inventory_allocations_line_type_check,
  drop constraint if exists order_inventory_allocations_source_check;

alter table public.order_inventory_allocations
  add constraint order_inventory_allocations_line_type_check
    check (line_type in ('merchandise', 'gift')),
  add constraint order_inventory_allocations_source_check
    check (source in ('payment_allocation', 'legacy_snapshot', 'promotion_gift'));

create index if not exists order_inventory_allocations_line_type_idx
  on public.order_inventory_allocations (order_id, line_type, item_index);

create or replace function public.protect_order_pricing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.items is distinct from old.items
    or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount
    or new.type is distinct from old.type
    or new.promotion_id is distinct from old.promotion_id
    or new.promotion_name is distinct from old.promotion_name
    or new.coupon_campaign_id is distinct from old.coupon_campaign_id
    or new.coupon_name is distinct from old.coupon_name
    or new.coupon_code_mask is distinct from old.coupon_code_mask
    or new.pricing_snapshot is distinct from old.pricing_snapshot
  then
    raise exception 'Order pricing snapshot is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_order_pricing_snapshot on public.orders;
create trigger trg_protect_order_pricing_snapshot
  before update on public.orders
  for each row execute function public.protect_order_pricing_snapshot();

-- --------------------------------------------------------------------------
-- RLS: configuration is managed by promotions.manage. Transaction tables are
-- readable by order administrators but writable only by future trusted RPCs.
-- --------------------------------------------------------------------------

alter table public.promotion_scopes enable row level security;
alter table public.coupon_campaigns enable row level security;
alter table public.coupon_promotions enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.promotion_gift_reservations enable row level security;
alter table public.order_adjustments enable row level security;

revoke all on table public.promotion_scopes from anon, authenticated;
revoke all on table public.coupon_campaigns from anon, authenticated;
revoke all on table public.coupon_promotions from anon, authenticated;
revoke all on table public.coupon_redemptions from anon, authenticated;
revoke all on table public.promotion_gift_reservations from anon, authenticated;
revoke all on table public.order_adjustments from anon, authenticated;

grant select, insert, update, delete on table
  public.promotion_scopes,
  public.coupon_campaigns,
  public.coupon_promotions
to authenticated;

grant select on table
  public.coupon_redemptions,
  public.promotion_gift_reservations,
  public.order_adjustments
to authenticated;

grant usage, select on sequence public.promotion_scopes_id_seq to authenticated;
grant usage, select on sequence public.coupon_promotions_id_seq to authenticated;

drop policy if exists "promotion_scopes_manage" on public.promotion_scopes;
create policy "promotion_scopes_manage"
  on public.promotion_scopes for all to authenticated
  using (public.has_backoffice_permission('promotions.manage'))
  with check (public.has_backoffice_permission('promotions.manage'));

drop policy if exists "coupon_campaigns_manage" on public.coupon_campaigns;
create policy "coupon_campaigns_manage"
  on public.coupon_campaigns for all to authenticated
  using (public.has_backoffice_permission('promotions.manage'))
  with check (public.has_backoffice_permission('promotions.manage'));

drop policy if exists "coupon_promotions_manage" on public.coupon_promotions;
create policy "coupon_promotions_manage"
  on public.coupon_promotions for all to authenticated
  using (public.has_backoffice_permission('promotions.manage'))
  with check (public.has_backoffice_permission('promotions.manage'));

drop policy if exists "coupon_redemptions_select_orders" on public.coupon_redemptions;
create policy "coupon_redemptions_select_orders"
  on public.coupon_redemptions for select to authenticated
  using (public.has_backoffice_permission('orders.read'));

drop policy if exists "promotion_gift_reservations_select_orders" on public.promotion_gift_reservations;
create policy "promotion_gift_reservations_select_orders"
  on public.promotion_gift_reservations for select to authenticated
  using (public.has_backoffice_permission('orders.read'));

drop policy if exists "order_adjustments_select_orders" on public.order_adjustments;
create policy "order_adjustments_select_orders"
  on public.order_adjustments for select to authenticated
  using (public.has_backoffice_permission('orders.read'));

-- --------------------------------------------------------------------------
-- Sanitized audit events for the three new administrator-managed tables.
-- Coupon codes are deliberately excluded from audit payloads.
-- --------------------------------------------------------------------------

create or replace function public.capture_promotion_configuration_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_admin_role text;
  source_row jsonb;
  before_projection jsonb;
  after_projection jsonb;
  entity_id text;
begin
  if actor_id is null or not public.has_backoffice_permission('promotions.manage') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select role into actor_admin_role
  from public.admin_users
  where user_id = actor_id and active is true;

  if tg_table_name = 'coupon_campaigns' then
    before_projection := case when tg_op = 'INSERT' then null else jsonb_strip_nulls(jsonb_build_object(
      'id', to_jsonb(old) -> 'id',
      'name', to_jsonb(old) -> 'name',
      'start_at', to_jsonb(old) -> 'start_at',
      'end_at', to_jsonb(old) -> 'end_at',
      'active', to_jsonb(old) -> 'active',
      'total_usage_limit', to_jsonb(old) -> 'total_usage_limit',
      'per_member_limit', to_jsonb(old) -> 'per_member_limit',
      'audience_roles', to_jsonb(old) -> 'audience_roles',
      'allow_guest', to_jsonb(old) -> 'allow_guest',
      'stacking_policy', to_jsonb(old) -> 'stacking_policy',
      'archived_at', to_jsonb(old) -> 'archived_at'
    )) end;
    after_projection := case when tg_op = 'DELETE' then null else jsonb_strip_nulls(jsonb_build_object(
      'id', to_jsonb(new) -> 'id',
      'name', to_jsonb(new) -> 'name',
      'start_at', to_jsonb(new) -> 'start_at',
      'end_at', to_jsonb(new) -> 'end_at',
      'active', to_jsonb(new) -> 'active',
      'total_usage_limit', to_jsonb(new) -> 'total_usage_limit',
      'per_member_limit', to_jsonb(new) -> 'per_member_limit',
      'audience_roles', to_jsonb(new) -> 'audience_roles',
      'allow_guest', to_jsonb(new) -> 'allow_guest',
      'stacking_policy', to_jsonb(new) -> 'stacking_policy',
      'archived_at', to_jsonb(new) -> 'archived_at'
    )) end;
  else
    before_projection := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    after_projection := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  end if;

  if tg_op = 'UPDATE' and before_projection is not distinct from after_projection then
    return new;
  end if;

  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_id := coalesce(source_row ->> 'id', 'unknown');

  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_admin_role,
    'admin',
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    entity_id,
    before_projection,
    after_projection,
    jsonb_build_object('source', 'promotion_foundation_trigger')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.capture_promotion_configuration_audit() from public;

drop trigger if exists trg_audit_promotion_scopes on public.promotion_scopes;
create trigger trg_audit_promotion_scopes
  after insert or update or delete on public.promotion_scopes
  for each row execute function public.capture_promotion_configuration_audit();

drop trigger if exists trg_audit_coupon_campaigns on public.coupon_campaigns;
create trigger trg_audit_coupon_campaigns
  after insert or update or delete on public.coupon_campaigns
  for each row execute function public.capture_promotion_configuration_audit();

drop trigger if exists trg_audit_coupon_promotions on public.coupon_promotions;
create trigger trg_audit_coupon_promotions
  after insert or update or delete on public.coupon_promotions
  for each row execute function public.capture_promotion_configuration_audit();

commit;

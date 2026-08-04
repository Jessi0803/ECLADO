-- ============================================================================
-- ECLADO 新 Supabase 專案完整初始化 SQL
-- 在新的 Supabase 專案 SQL Editor 執行一次
-- ============================================================================
-- 會建立：
--   public.profiles   會員資料
--   public.products   商品與庫存
--   public.orders     訂單資料
--   public.promotions 活動資料
--   public.professional_applications 美容師專業申請
--
-- 注意：
--   1) Auth 使用者在 auth.users，不是 public 表。若要保留會員密碼，
--      請用 Supabase 備份/CLI 搬 auth schema，不要只匯 profiles。
--   2) 前台使用 anon key 讀取公開資料；後台必須以 Supabase Auth 管理員登入。
-- ============================================================================

create extension if not exists pgcrypto;

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 會員資料
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  name text,
  phone text,
  line_user_id text unique,
  role text not null default 'consumer'
    check (role in ('consumer', 'pro', 'instructor', 'distributor', 'pending')),
  cert text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auth 註冊後自動補 profiles。前端也會 upsert，一起保留以提高容錯。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone',
    'consumer'
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(public.profiles.name, excluded.name),
    phone = coalesce(public.profiles.phone, excluded.phone),
    role = coalesce(public.profiles.role, excluded.role),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 商品與庫存
create sequence if not exists public.products_id_seq as integer;

create table if not exists public.products (
  id integer primary key default nextval('public.products_id_seq'::regclass),
  asset_key uuid not null default gen_random_uuid(),
  name text not null,
  name_zh text not null,
  subtitle text,
  category text not null,
  size text,
  price numeric not null default 0,
  pro_price numeric not null default 0,
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 3 check (min_stock >= 0),
  is_pro_only boolean not null default false,
  image_url text,
  description text,
  skin_type text,
  ingredients text,
  features jsonb not null default '[]'::jsonb,
  image_urls jsonb not null default '[]'::jsonb,
  variants jsonb not null default '[]'::jsonb,
  product_list_image_scale numeric,
  source_folder_name text,
  imported_from_drive boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists subtitle text;
alter table public.products add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists product_list_image_scale numeric;
alter table public.products add column if not exists source_folder_name text;
alter table public.products add column if not exists imported_from_drive boolean not null default false;
alter table public.products add column if not exists asset_key uuid default gen_random_uuid();
update public.products set asset_key = gen_random_uuid() where asset_key is null;
alter table public.products alter column asset_key set default gen_random_uuid();
alter table public.products alter column asset_key set not null;
alter table public.products alter column id set default nextval('public.products_id_seq'::regclass);
alter sequence public.products_id_seq owned by public.products.id;
create unique index if not exists products_asset_key_unique on public.products(asset_key);
select setval(
  'public.products_id_seq'::regclass,
  greatest(coalesce((select max(id) from public.products), 0) + 1, 1),
  false
);

-- 訂單資料
create table if not exists public.orders (
  id text primary key,
  member text,
  type text not null default 'consumer'
    check (type in ('consumer', 'pro', 'instructor', 'distributor', 'pending')),
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  subtotal numeric,
  discount numeric not null default 0,
  status text not null default 'awaiting_confirm'
    check (status in ('awaiting_confirm', 'unpaid', 'paid', 'preparing', 'shipped', 'delivered', 'returned', 'cancelled')),
  date text,
  address text,
  phone text,
  email text,
  note text,
  transfer_last5 text,
  tracking text,
  shipping_carrier text,
  shipped_at timestamptz,
  shipment_notification_sent_at timestamptz,
  shipment_notification_channel text
    check (shipment_notification_channel is null or shipment_notification_channel in ('line', 'email')),
  shipment_notification_error text,
  user_id uuid references auth.users(id) on delete set null,
  payment_reminded_at timestamptz,
  payment_second_reminded_at timestamptz,
  payment_due_at timestamptz not null default (now() + interval '48 hours'),
  pricing_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.set_order_shipment_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    new.shipped_at := coalesce(new.shipped_at, now());
    if new.tracking is not null and btrim(new.tracking) <> '' then
      new.shipping_carrier := coalesce(new.shipping_carrier, 'sf_express');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_shipment_metadata on public.orders;
create trigger trg_orders_shipment_metadata
  before update of status, tracking on public.orders
  for each row execute function public.set_order_shipment_metadata();

create index if not exists idx_orders_unpaid_payment_reminder
  on public.orders (status, created_at)
  where status in ('awaiting_confirm', 'unpaid')
    and (payment_reminded_at is null or payment_second_reminded_at is null);

create index if not exists idx_orders_unpaid_payment_due
  on public.orders (payment_due_at)
  where status in ('awaiting_confirm', 'unpaid');

-- 活動資料
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  product_ids integer[] not null default '{}',
  discount_rate numeric not null default 0.95,
  discount_amount numeric not null default 1000,
  discount_order text not null default 'rate_then_amount'
    check (discount_order in ('rate_then_amount', 'amount_then_rate')),
  start_at timestamptz,
  end_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_promotions_updated_at on public.promotions;
create trigger trg_promotions_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

alter table public.orders
  add column if not exists promotion_id uuid references public.promotions(id) on delete set null,
  add column if not exists promotion_name text;

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
    or new.promotion_name is distinct from old.promotion_name
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

comment on column public.orders.pricing_snapshot is
  'Immutable versioned snapshot of authoritative item prices, promotion formula, shipping and total.';

create or replace function public.calculate_order_shipping(p_items jsonb)
returns numeric
language sql
immutable
strict
set search_path = public
as $$
  select case
    when jsonb_array_length(p_items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(p_items) item
        where (item ->> 'product_id')::integer <> 9
      )
    then 0::numeric
    else 120::numeric
  end;
$$;

revoke all on function public.calculate_order_shipping(jsonb) from public;

comment on function public.calculate_order_shipping(jsonb) is
  'Authoritative shipping rule v1: carts containing only product 9 are free; all other carts cost TWD 120.';

-- 美容師專業會員申請
create table if not exists public.professional_applications (
  id uuid primary key default gen_random_uuid(),
  studio_name text not null,
  contact_name text not null,
  phone text not null,
  address text not null,
  social_media text not null,
  certificate text not null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'standalone'
    check (source in ('registration', 'standalone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_professional_applications_status
  on public.professional_applications (status, created_at desc);

drop trigger if exists trg_professional_applications_updated_at on public.professional_applications;
create trigger trg_professional_applications_updated_at
  before update on public.professional_applications
  for each row execute function public.set_updated_at();

-- 管理員權限由登入 JWT 的 email 在資料庫端判定，不能信任前端畫面。
create or replace function public.is_eclado_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any(array[
    'baby90522@gmail.com',
    'ecladotaiwan@gmail.com',
    'k0919933386@gmail.com',
    'line.u6f71cfa36c3fb2188f54396a5cb58882@ecladotaiwan.com'
  ]);
$$;

revoke all on function public.is_eclado_admin() from public;
grant execute on function public.is_eclado_admin() to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.promotions enable row level security;
alter table public.professional_applications enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_insert_all" on public.profiles;
drop policy if exists "profiles_update_all" on public.profiles;
drop policy if exists "profiles_delete_all" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "profiles_select_admin"
  on public.profiles for select to authenticated
  using (public.is_eclado_admin());

drop policy if exists "products_select_all" on public.products;
drop policy if exists "products_insert_all" on public.products;
drop policy if exists "products_update_all" on public.products;
drop policy if exists "products_delete_all" on public.products;
drop policy if exists "products_select_active" on public.products;
drop policy if exists "products_select_admin" on public.products;
drop policy if exists "products_insert_admin" on public.products;
drop policy if exists "products_update_admin" on public.products;
create policy "products_select_active"
  on public.products for select to anon, authenticated
  using (active is true);
create policy "products_select_admin"
  on public.products for select to authenticated
  using (public.is_eclado_admin());
create policy "products_insert_admin"
  on public.products for insert to authenticated
  with check (public.is_eclado_admin());
create policy "products_update_admin"
  on public.products for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

drop policy if exists "orders_select_all" on public.orders;
drop policy if exists "orders_insert_all" on public.orders;
drop policy if exists "orders_update_all" on public.orders;
drop policy if exists "orders_delete_all" on public.orders;
drop policy if exists "orders_select_own" on public.orders;
drop policy if exists "orders_select_admin" on public.orders;
drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_select_own"
  on public.orders for select to authenticated
  using (user_id = auth.uid());
create policy "orders_select_admin"
  on public.orders for select to authenticated
  using (public.is_eclado_admin());
create policy "orders_update_admin"
  on public.orders for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

drop policy if exists "promotions_select_all" on public.promotions;
drop policy if exists "promotions_select_live" on public.promotions;
drop policy if exists "promotions_select_admin" on public.promotions;
create policy "promotions_select_live"
  on public.promotions for select
  to anon, authenticated
  using (
    active = true
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at > now())
  );

create policy "promotions_select_admin"
  on public.promotions for select
  to authenticated
  using (public.is_eclado_admin());

drop policy if exists "promotions_insert_auth" on public.promotions;
drop policy if exists "promotions_insert_all" on public.promotions;
drop policy if exists "promotions_insert_admin" on public.promotions;
create policy "promotions_insert_admin"
  on public.promotions for insert
  to authenticated
  with check (public.is_eclado_admin());

drop policy if exists "promotions_update_auth" on public.promotions;
drop policy if exists "promotions_update_all" on public.promotions;
drop policy if exists "promotions_update_admin" on public.promotions;
create policy "promotions_update_admin"
  on public.promotions for update
  to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

drop policy if exists "promotions_delete_auth" on public.promotions;
drop policy if exists "promotions_delete_all" on public.promotions;
drop policy if exists "promotions_delete_admin" on public.promotions;
create policy "promotions_delete_admin"
  on public.promotions for delete
  to authenticated
  using (public.is_eclado_admin());

drop policy if exists "professional_applications_select_all" on public.professional_applications;
drop policy if exists "professional_applications_insert_all" on public.professional_applications;
drop policy if exists "professional_applications_update_all" on public.professional_applications;
drop policy if exists "professional_applications_delete_all" on public.professional_applications;
drop policy if exists "professional_applications_select_own" on public.professional_applications;
drop policy if exists "professional_applications_select_admin" on public.professional_applications;
drop policy if exists "professional_applications_update_admin" on public.professional_applications;
create policy "professional_applications_select_own"
  on public.professional_applications for select to authenticated
  using (user_id = auth.uid());
create policy "professional_applications_select_admin"
  on public.professional_applications for select to authenticated
  using (public.is_eclado_admin());
create policy "professional_applications_update_admin"
  on public.professional_applications for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

-- Realtime：如果已加入 publication，第二次執行可能會提示已存在，可忽略。
do $$
begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.promotions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.professional_applications;
exception when duplicate_object then null;
end $$;

-- 庫存扣補：付款後到出貨完成都占用可用現貨庫存；預購數量不讓庫存扣成負數。
create or replace function public.order_consumes_inventory(order_status text)
returns boolean
language sql
immutable
as $$
  select order_status in ('paid', 'preparing', 'shipped', 'delivered');
$$;

create or replace function public.adjust_inventory_for_order(order_items jsonb, direction integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  product_id integer;
  item_qty integer;
  stock_at_order integer;
  stock_qty integer;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    return;
  end if;

  for item in
    select * from jsonb_array_elements(order_items)
  loop
    product_id := nullif(item.value ->> 'id', '')::integer;
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    stock_at_order := greatest(coalesce(nullif(item.value ->> 'stock_at_order', '')::integer, item_qty), 0);
    stock_qty := least(item_qty, stock_at_order);

    if product_id is null or item_qty <= 0 then
      continue;
    end if;

    update public.products
    set stock = greatest(0, stock + (direction * stock_qty))
    where id = product_id;

    if not found then
      raise exception 'Product % not found', product_id;
    end if;
  end loop;
end;
$$;

create or replace function public.sync_inventory_for_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if public.order_consumes_inventory(old.status) and not public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(old.items, 1);
    elsif not public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    elsif public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) and old.items is distinct from new.items then
      perform public.adjust_inventory_for_order(old.items, 1);
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_inventory_sync on public.orders;
create trigger trg_orders_inventory_sync
  after insert or update of status, items on public.orders
  for each row
  execute function public.sync_inventory_for_order();

-- ============================================================================
-- 執行完成後，請到 Table Editor 確認 profiles / products / orders / promotions 已建立。
-- ============================================================================

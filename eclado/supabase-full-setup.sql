-- ============================================================================
-- ECLADO 新 Supabase 專案完整初始化 SQL
-- 在新的 Supabase 專案 SQL Editor 執行一次
-- ============================================================================
-- 會建立：
--   public.profiles   會員資料
--   public.products   商品與庫存
--   public.orders     訂單資料
--   public.promotions 活動資料
--
-- 注意：
--   1) Auth 使用者在 auth.users，不是 public 表。若要保留會員密碼，
--      請用 Supabase 備份/CLI 搬 auth schema，不要只匯 profiles。
--   2) 目前前台與 admin.html 都使用 anon key 直接讀寫資料，所以 RLS
--      依照現有網站行為開放。之後若後台改成正式登入，建議再收緊 policy。
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
    coalesce(new.raw_user_meta_data ->> 'role', 'consumer')
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
create table if not exists public.products (
  id integer primary key,
  name text not null,
  name_zh text not null,
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
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

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
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- 活動資料
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  product_ids integer[] not null default '{}',
  discount_rate numeric not null default 0.95,
  discount_amount numeric not null default 1000,
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

-- RLS：依照目前網站架構開放 anon 讀寫
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.promotions enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_insert_all" on public.profiles;
create policy "profiles_insert_all"
  on public.profiles for insert
  with check (true);

drop policy if exists "profiles_update_all" on public.profiles;
create policy "profiles_update_all"
  on public.profiles for update
  using (true) with check (true);

drop policy if exists "products_select_all" on public.products;
create policy "products_select_all"
  on public.products for select
  using (true);

drop policy if exists "products_insert_all" on public.products;
create policy "products_insert_all"
  on public.products for insert
  with check (true);

drop policy if exists "products_update_all" on public.products;
create policy "products_update_all"
  on public.products for update
  using (true) with check (true);

drop policy if exists "orders_select_all" on public.orders;
create policy "orders_select_all"
  on public.orders for select
  using (true);

drop policy if exists "orders_insert_all" on public.orders;
create policy "orders_insert_all"
  on public.orders for insert
  with check (true);

drop policy if exists "orders_update_all" on public.orders;
create policy "orders_update_all"
  on public.orders for update
  using (true) with check (true);

drop policy if exists "promotions_select_all" on public.promotions;
create policy "promotions_select_all"
  on public.promotions for select
  using (true);

drop policy if exists "promotions_insert_auth" on public.promotions;
drop policy if exists "promotions_insert_all" on public.promotions;
create policy "promotions_insert_all"
  on public.promotions for insert
  with check (true);

drop policy if exists "promotions_update_auth" on public.promotions;
drop policy if exists "promotions_update_all" on public.promotions;
create policy "promotions_update_all"
  on public.promotions for update
  using (true) with check (true);

drop policy if exists "promotions_delete_auth" on public.promotions;
drop policy if exists "promotions_delete_all" on public.promotions;
create policy "promotions_delete_all"
  on public.promotions for delete
  using (true);

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

-- 庫存扣補：建立訂單扣庫存，取消 / 退貨補回庫存。
create or replace function public.order_reserves_inventory(order_status text)
returns boolean
language sql
immutable
as $$
  select order_status in ('awaiting_confirm', 'paid', 'preparing', 'shipped', 'delivered');
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
  current_stock integer;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    return;
  end if;

  for item in
    select * from jsonb_array_elements(order_items)
  loop
    product_id := nullif(item.value ->> 'id', '')::integer;
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);

    if product_id is null or item_qty <= 0 then
      continue;
    end if;

    if direction < 0 then
      select stock into current_stock
      from public.products
      where id = product_id
      for update;

      if current_stock is null then
        raise exception 'Product % not found', product_id;
      end if;

      if current_stock < item_qty then
        raise exception 'Insufficient stock for product %, requested %, available %', product_id, item_qty, current_stock;
      end if;
    end if;

    update public.products
    set stock = stock + (direction * item_qty)
    where id = product_id;
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
    if public.order_reserves_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if public.order_reserves_inventory(old.status) and not public.order_reserves_inventory(new.status) then
      perform public.adjust_inventory_for_order(old.items, 1);
    elsif not public.order_reserves_inventory(old.status) and public.order_reserves_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    elsif public.order_reserves_inventory(old.status) and public.order_reserves_inventory(new.status) and old.items is distinct from new.items then
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

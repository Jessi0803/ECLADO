-- ECLADO warehouse-wide inventory counts.
--
-- A count freezes its product/variant scope at creation time. Draft item edits
-- use optimistic row versions. Completion is atomic and immutable: the saved
-- variance is applied to the then-current ledger, so legitimate sales and
-- receipts after count creation are preserved.

begin;

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
  ('super_admin', 'inventory_counts.manage'),
  ('admin', 'inventory_counts.manage')
on conflict do nothing;

create table if not exists public.inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'completed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  completed_by uuid references auth.users(id) on delete set null,
  completed_by_email text,
  completed_at timestamptz,
  check (
    (status = 'draft' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

-- Only one warehouse-wide count may be open, otherwise two frozen snapshots
-- could apply overlapping variances to the same inventory ledger.
create unique index if not exists inventory_count_sessions_one_draft_idx
  on public.inventory_count_sessions ((status)) where status = 'draft';

create table if not exists public.inventory_count_items (
  id bigserial primary key,
  session_id uuid not null references public.inventory_count_sessions(id) on delete restrict,
  product_id integer not null references public.products(id) on delete restrict,
  product_variant_id bigint not null references public.product_variants(id) on delete restrict,
  inventory_type text not null check (inventory_type in ('sale', 'gift')),
  product_name text not null,
  variant_name text not null,
  sku text not null,
  publication_status text not null,
  system_stock_snapshot integer not null check (system_stock_snapshot >= 0),
  onsite_allocated_snapshot integer not null default 0 check (onsite_allocated_snapshot >= 0),
  expected_physical_snapshot integer not null check (expected_physical_snapshot >= 0),
  actual_quantity integer check (actual_quantity is null or actual_quantity >= 0),
  variance integer,
  version integer not null default 0 check (version >= 0),
  counted_by uuid references auth.users(id) on delete set null,
  counted_by_email text,
  counted_at timestamptz,
  applied_delta integer,
  ledger_quantity_after integer check (ledger_quantity_after is null or ledger_quantity_after >= 0),
  shortage_quantity integer not null default 0 check (shortage_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, product_variant_id, inventory_type),
  check (
    (actual_quantity is null and variance is null and counted_at is null)
    or (actual_quantity is not null and variance = actual_quantity - expected_physical_snapshot and counted_at is not null)
  )
);

create index if not exists inventory_count_items_session_idx
  on public.inventory_count_items (session_id, id);
create index if not exists inventory_count_items_variant_idx
  on public.inventory_count_items (product_variant_id, inventory_type);

-- Records shortages caused by a completed count. Merchandise shortages are
-- also reflected in order_inventory_allocations.backorder_qty. Gift shortages
-- stay here because normal checkout intentionally does not allow gift backorders.
create table if not exists public.inventory_count_shortages (
  id bigserial primary key,
  count_item_id bigint not null references public.inventory_count_items(id) on delete restrict,
  allocation_id bigint references public.order_inventory_allocations(id) on delete restrict,
  order_id text references public.orders(id) on delete restrict,
  product_variant_id bigint not null references public.product_variants(id) on delete restrict,
  inventory_type text not null check (inventory_type in ('sale', 'gift')),
  quantity integer not null check (quantity > 0),
  resolved_quantity integer not null default 0 check (resolved_quantity >= 0 and resolved_quantity <= quantity),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  note text not null default ''
);

alter table public.inventory_count_shortages
  add column if not exists resolved_quantity integer not null default 0;
alter table public.inventory_count_shortages
  drop constraint if exists inventory_count_shortages_resolved_quantity_check;
alter table public.inventory_count_shortages
  add constraint inventory_count_shortages_resolved_quantity_check
  check (resolved_quantity >= 0 and resolved_quantity <= quantity);

create index if not exists inventory_count_shortages_pending_idx
  on public.inventory_count_shortages (inventory_type, product_variant_id, created_at, id)
  where status = 'pending';
create index if not exists inventory_count_shortages_order_idx
  on public.inventory_count_shortages (order_id, status);

alter table public.inventory_count_sessions enable row level security;
alter table public.inventory_count_items enable row level security;
alter table public.inventory_count_shortages enable row level security;
revoke all on table public.inventory_count_sessions from anon, authenticated;
revoke all on table public.inventory_count_items from anon, authenticated;
revoke all on table public.inventory_count_shortages from anon, authenticated;

create or replace function public.create_inventory_count(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_session_id uuid;
  normalized_name text := trim(coalesce(p_name, ''));
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  if normalized_name = '' then
    raise exception '請輸入盤點名稱' using errcode = '22023';
  end if;

  insert into public.inventory_count_sessions (name, created_by, created_by_email)
  values (normalized_name, auth.uid(), coalesce(auth.jwt() ->> 'email', ''))
  returning id into new_session_id;

  -- All retained product variants are part of a warehouse-wide count,
  -- including draft/archived and zero-stock rows. Gift stock gets a separate
  -- count item only where that inventory pool is enabled.
  insert into public.inventory_count_items (
    session_id, product_id, product_variant_id, inventory_type,
    product_name, variant_name, sku, publication_status,
    system_stock_snapshot, onsite_allocated_snapshot, expected_physical_snapshot
  )
  select
    new_session_id, product.id, variant.id, 'sale',
    product.name_zh, variant.size, variant.sku, product.publication_status,
    variant.stock, coalesce(onsite.quantity, 0), variant.stock + coalesce(onsite.quantity, 0)
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  left join lateral (
    select sum(allocation.stock_deducted_qty)::integer as quantity
    from public.order_inventory_allocations allocation
    join public.orders target_order on target_order.id = allocation.order_id
    where allocation.product_variant_id = variant.id
      and coalesce(allocation.line_type, 'merchandise') = 'merchandise'
      and allocation.state <> 'released'
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
  ) onsite on true
  where product.publication_status <> 'gift_only'
  order by product.id, variant.sort_order, variant.id;

  insert into public.inventory_count_items (
    session_id, product_id, product_variant_id, inventory_type,
    product_name, variant_name, sku, publication_status,
    system_stock_snapshot, onsite_allocated_snapshot, expected_physical_snapshot
  )
  select
    new_session_id, product.id, variant.id, 'gift',
    product.name_zh, variant.size, variant.sku, product.publication_status,
    variant.gift_stock, coalesce(onsite.quantity, 0), variant.gift_stock + coalesce(onsite.quantity, 0)
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  left join lateral (
    select sum(allocation.stock_deducted_qty)::integer as quantity
    from public.order_inventory_allocations allocation
    join public.orders target_order on target_order.id = allocation.order_id
    where allocation.product_variant_id = variant.id
      and allocation.line_type = 'gift'
      and allocation.state <> 'released'
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
  ) onsite on true
  where variant.gift_enabled is true
  order by product.id, variant.sort_order, variant.id;

  return new_session_id;
exception
  when unique_violation then
    raise exception '目前已有進行中的盤點單，請先完成後再建立新的盤點' using errcode = '23505';
end;
$$;

create or replace function public.update_inventory_count_item(
  p_item_id bigint,
  p_actual_quantity integer,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_item public.inventory_count_items;
  target_status text;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  if p_actual_quantity is not null and p_actual_quantity < 0 then
    raise exception '實際數量不可小於 0' using errcode = '22023';
  end if;

  -- Serialize item saves with completion. Different items can still be saved
  -- concurrently because they only share a non-exclusive lock on the session.
  select session.status into target_status
  from public.inventory_count_sessions session
  join public.inventory_count_items item on item.session_id = session.id
  where item.id = p_item_id
  for share of session;
  if not found then raise exception '找不到盤點項目' using errcode = 'P0002'; end if;
  if target_status <> 'draft' then
    raise exception '盤點單已完成，無法修改' using errcode = '55000';
  end if;

  update public.inventory_count_items item
  set actual_quantity = p_actual_quantity,
      variance = case when p_actual_quantity is null then null else p_actual_quantity - item.expected_physical_snapshot end,
      counted_by = case when p_actual_quantity is null then null else auth.uid() end,
      counted_by_email = case when p_actual_quantity is null then null else coalesce(auth.jwt() ->> 'email', '') end,
      counted_at = case when p_actual_quantity is null then null else now() end,
      version = item.version + 1,
      updated_at = now()
  from public.inventory_count_sessions session
  where item.id = p_item_id
    and item.session_id = session.id
    and session.status = 'draft'
    and item.version = p_expected_version
  returning item.* into updated_item;

  if not found then
    if exists (
      select 1 from public.inventory_count_items item
      join public.inventory_count_sessions session on session.id = item.session_id
      where item.id = p_item_id and session.status = 'completed'
    ) then
      raise exception '盤點單已完成，無法修改' using errcode = '55000';
    end if;
    raise exception '此項目已被其他工作階段更新，請重新載入最新數量' using errcode = '40001';
  end if;

  return to_jsonb(updated_item);
end;
$$;

create or replace function public.close_inventory_count_shortages_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status
    and new.status not in ('paid', 'preparing', 'ready_for_pickup') then
    with pending_gift as (
      select shortage.allocation_id,
        sum(shortage.quantity - shortage.resolved_quantity)::integer as quantity
      from public.inventory_count_shortages shortage
      where shortage.order_id = new.id
        and shortage.inventory_type = 'gift'
        and shortage.status = 'pending'
      group by shortage.allocation_id
    )
    update public.order_inventory_allocations allocation
    set closed_backorder_qty = allocation.closed_backorder_qty + pending_gift.quantity,
        state = 'closed',
        closed_at = now(),
        updated_at = now()
    from pending_gift
    where allocation.id = pending_gift.allocation_id;

    update public.inventory_count_shortages
    set status = 'closed',
        resolved_by = auth.uid(),
        resolved_at = now(),
        note = '訂單狀態變更為 ' || new.status || '，停止待處理'
    where order_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.close_inventory_count_shortages_on_order_status() from public;
drop trigger if exists trg_close_inventory_count_shortages_on_order_status on public.orders;
create trigger trg_close_inventory_count_shortages_on_order_status
after update of status on public.orders
for each row execute function public.close_inventory_count_shortages_on_order_status();

create or replace function public.complete_inventory_count(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_session public.inventory_count_sessions;
  item public.inventory_count_items;
  allocation record;
  current_quantity integer;
  next_quantity integer;
  remaining_shortage integer;
  take_quantity integer;
  assigned_shortage integer;
  completed_items integer := 0;
  shortage_total integer := 0;
  is_super_admin boolean;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;

  select session.* into target_session
  from public.inventory_count_sessions session
  where session.id = p_session_id
  for update;
  if not found then raise exception '找不到盤點單' using errcode = 'P0002'; end if;
  if target_session.status <> 'draft' then
    raise exception '盤點單已完成' using errcode = '55000';
  end if;

  select exists (
    select 1 from public.admin_users admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
      and admin_user.role = 'super_admin'
  ) into is_super_admin;
  if target_session.created_by <> auth.uid() and not is_super_admin then
    raise exception '只有盤點建立者或最高管理員可以完成盤點' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.inventory_count_items
    where session_id = p_session_id and actual_quantity is null
  ) then
    raise exception '仍有尚未盤點的項目，無法完成盤點' using errcode = '22023';
  end if;

  -- Lock every frozen item and its live variant in deterministic order.
  perform 1 from public.inventory_count_items
  where session_id = p_session_id order by product_variant_id, inventory_type for update;
  perform 1 from public.product_variants variant
  where variant.id in (
    select distinct product_variant_id from public.inventory_count_items where session_id = p_session_id
  ) order by variant.id for update;

  for item in
    select * from public.inventory_count_items
    where session_id = p_session_id
    order by product_variant_id, inventory_type, id
    for update
  loop
    select case when item.inventory_type = 'gift' then variant.gift_stock else variant.stock end
    into current_quantity
    from public.product_variants variant where variant.id = item.product_variant_id;

    next_quantity := current_quantity + item.variance;
    remaining_shortage := greatest(-next_quantity, 0);
    assigned_shortage := 0;
    next_quantity := greatest(next_quantity, 0);

    if item.inventory_type = 'gift' then
      update public.product_variants set gift_stock = next_quantity where id = item.product_variant_id;
    else
      update public.product_variants set stock = next_quantity where id = item.product_variant_id;
      perform public.sync_product_stock_mirror(item.product_id);
    end if;

    -- A count shortage consumes free stock first. Any remaining shortage means
    -- physically onsite order allocations are no longer fulfillable. Remove
    -- allocation from newest orders first so older paid orders keep priority.
    if remaining_shortage > 0 then
      for allocation in
        select inventory_allocation.*
        from public.order_inventory_allocations inventory_allocation
        join public.orders target_order on target_order.id = inventory_allocation.order_id
        where inventory_allocation.product_variant_id = item.product_variant_id
          and inventory_allocation.line_type = case when item.inventory_type = 'gift' then 'gift' else 'merchandise' end
          and inventory_allocation.stock_deducted_qty > 0
          and inventory_allocation.state <> 'released'
          and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
        order by inventory_allocation.priority_at desc, inventory_allocation.id desc
        for update of inventory_allocation
      loop
        exit when remaining_shortage = 0;
        take_quantity := least(remaining_shortage, allocation.stock_deducted_qty, allocation.allocated_qty);
        if take_quantity <= 0 then continue; end if;

        if item.inventory_type = 'sale' then
          update public.order_inventory_allocations
          set allocated_qty = allocated_qty - take_quantity,
              stock_deducted_qty = stock_deducted_qty - take_quantity,
              backorder_qty = backorder_qty + take_quantity,
              state = case when allocated_qty - take_quantity = 0 then 'backordered' else 'partial' end,
              updated_at = now()
          where id = allocation.id;
        else
          update public.order_inventory_allocations
          set allocated_qty = allocated_qty - take_quantity,
              stock_deducted_qty = stock_deducted_qty - take_quantity,
              state = case when allocated_qty - take_quantity = 0 then 'backordered' else 'partial' end,
              updated_at = now()
          where id = allocation.id;
        end if;

        insert into public.inventory_count_shortages (
          count_item_id, allocation_id, order_id, product_variant_id,
          inventory_type, quantity, status, created_by, resolved_by, resolved_at,
          note
        ) values (
          item.id, allocation.id, allocation.order_id, item.product_variant_id,
          item.inventory_type, take_quantity,
          case when item.inventory_type = 'sale' then 'resolved' else 'pending' end,
          auth.uid(),
          case when item.inventory_type = 'sale' then auth.uid() else null end,
          case when item.inventory_type = 'sale' then now() else null end,
          case when item.inventory_type = 'sale' then '已同步至一般商品待補數量' else '等待補足贈品庫存' end
        );
        remaining_shortage := remaining_shortage - take_quantity;
        assigned_shortage := assigned_shortage + take_quantity;
      end loop;

      if remaining_shortage > 0 then
        insert into public.inventory_count_shortages (
          count_item_id, product_variant_id, inventory_type, quantity,
          resolved_quantity, status, created_by, resolved_by, resolved_at, note
        ) values (
          item.id, item.product_variant_id, item.inventory_type, remaining_shortage,
          remaining_shortage, 'closed', auth.uid(), auth.uid(), now(),
          '完成盤點時已無可對應的現場訂單配置，保留為盤點差異紀錄'
        );
      end if;
    end if;

    update public.inventory_count_items
    set applied_delta = item.variance,
        ledger_quantity_after = next_quantity,
        shortage_quantity = assigned_shortage + remaining_shortage,
        updated_at = now()
    where id = item.id;

    completed_items := completed_items + 1;
    shortage_total := shortage_total + assigned_shortage + remaining_shortage;
  end loop;

  update public.inventory_count_sessions
  set status = 'completed',
      completed_by = auth.uid(),
      completed_by_email = coalesce(auth.jwt() ->> 'email', ''),
      completed_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'completed_items', completed_items,
    'shortage_quantity', shortage_total
  );
end;
$$;

create or replace function public.delete_draft_inventory_count(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_session public.inventory_count_sessions;
  is_super_admin boolean;
  item_count integer;
  counted_count integer;
  actor_role text;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;

  select session.* into target_session
  from public.inventory_count_sessions session
  where session.id = p_session_id
  for update;
  if not found then raise exception '找不到盤點單，可能已被刪除' using errcode = 'P0002'; end if;
  if target_session.status <> 'draft' then
    raise exception '已完成的盤點單不可刪除' using errcode = '55000';
  end if;

  select exists (
    select 1 from public.admin_users admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
      and admin_user.role = 'super_admin'
  ) into is_super_admin;
  if target_session.created_by <> auth.uid() and not is_super_admin then
    raise exception '只有盤點建立者或最高管理員可以刪除草稿' using errcode = '42501';
  end if;

  select count(*)::integer,
    count(*) filter (where actual_quantity is not null)::integer
  into item_count, counted_count
  from public.inventory_count_items where session_id = p_session_id;
  select role into actor_role from public.admin_users
  where user_id = auth.uid() and active is true;

  insert into public.audit_logs (
    actor_user_id, actor_email, actor_role, actor_type,
    action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), actor_role, 'admin',
    'inventory_count_sessions.delete_draft', 'inventory_count_sessions', p_session_id::text,
    jsonb_build_object(
      'name', target_session.name,
      'created_at', target_session.created_at,
      'item_count', item_count,
      'counted_count', counted_count,
      'source', 'inventory_count_rpc'
    )
  );

  delete from public.inventory_count_items where session_id = p_session_id;
  delete from public.inventory_count_sessions where id = p_session_id;
end;
$$;

create or replace function public.get_inventory_count_gift_shortages()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('backorders.manage')
    and not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory shortage authorization required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', variant.id,
    'product_id', variant.product_id,
    'sku', variant.sku,
    'product_name', product.name_zh,
    'variant_name', variant.size,
    'available_stock', variant.gift_stock,
    'total_shortage_qty', summary.total_shortage_qty,
    'order_count', summary.order_count,
    'orders', summary.orders
  ) order by summary.oldest_priority_at, variant.id), '[]'::jsonb)
  into payload
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  join lateral (
    select sum(shortage.quantity - shortage.resolved_quantity)::integer as total_shortage_qty,
      count(distinct shortage.order_id)::integer as order_count,
      min(allocation.priority_at) as oldest_priority_at,
      jsonb_agg(jsonb_build_object(
        'shortage_id', shortage.id,
        'order_id', shortage.order_id,
        'order_status', target_order.status,
        'shortage_qty', shortage.quantity - shortage.resolved_quantity,
        'priority_at', allocation.priority_at
      ) order by allocation.priority_at, allocation.id) as orders
    from public.inventory_count_shortages shortage
    join public.order_inventory_allocations allocation on allocation.id = shortage.allocation_id
    join public.orders target_order on target_order.id = shortage.order_id
    where shortage.product_variant_id = variant.id
      and shortage.inventory_type = 'gift'
      and shortage.status = 'pending'
      and shortage.resolved_quantity < shortage.quantity
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
  ) summary on summary.total_shortage_qty > 0;
  return payload;
end;
$$;

create or replace function public.allocate_inventory_count_gift_shortages(p_variant_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  variant_row public.product_variants;
  shortage record;
  available_quantity integer;
  assign_quantity integer;
  allocated_total integer := 0;
  affected_orders text[] := array[]::text[];
begin
  if not public.has_backoffice_permission('backorders.manage')
    and not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory shortage authorization required' using errcode = '42501';
  end if;

  select * into variant_row from public.product_variants
  where id = p_variant_id for update;
  if not found then raise exception '找不到贈品規格' using errcode = 'P0002'; end if;
  available_quantity := variant_row.gift_stock;

  for shortage in
    select shortage_record.*, allocation.requested_qty, allocation.allocated_qty,
      allocation.id as target_allocation_id
    from public.inventory_count_shortages shortage_record
    join public.order_inventory_allocations allocation on allocation.id = shortage_record.allocation_id
    join public.orders target_order on target_order.id = shortage_record.order_id
    where shortage_record.product_variant_id = p_variant_id
      and shortage_record.inventory_type = 'gift'
      and shortage_record.status = 'pending'
      and shortage_record.resolved_quantity < shortage_record.quantity
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
    order by allocation.priority_at, allocation.id, shortage_record.id
    for update of shortage_record, allocation
  loop
    exit when available_quantity <= 0;
    assign_quantity := least(available_quantity, shortage.quantity - shortage.resolved_quantity);
    if assign_quantity <= 0 then continue; end if;

    update public.product_variants
    set gift_stock = gift_stock - assign_quantity
    where id = p_variant_id;
    update public.order_inventory_allocations
    set allocated_qty = allocated_qty + assign_quantity,
        stock_deducted_qty = stock_deducted_qty + assign_quantity,
        state = case when allocated_qty + assign_quantity >= requested_qty then 'allocated' else 'partial' end,
        last_allocated_at = now(),
        updated_at = now()
    where id = shortage.target_allocation_id;
    update public.inventory_count_shortages
    set resolved_quantity = resolved_quantity + assign_quantity,
        status = case when resolved_quantity + assign_quantity >= quantity then 'resolved' else 'pending' end,
        resolved_by = case when resolved_quantity + assign_quantity >= quantity then auth.uid() else resolved_by end,
        resolved_at = case when resolved_quantity + assign_quantity >= quantity then now() else resolved_at end,
        note = case when resolved_quantity + assign_quantity >= quantity then '贈品庫存已補回訂單' else note end
    where id = shortage.id;

    available_quantity := available_quantity - assign_quantity;
    allocated_total := allocated_total + assign_quantity;
    if not shortage.order_id = any(affected_orders) then
      affected_orders := array_append(affected_orders, shortage.order_id);
    end if;
  end loop;

  return jsonb_build_object(
    'allocated_qty', allocated_total,
    'affected_orders', to_jsonb(affected_orders),
    'remaining_gift_stock', available_quantity
  );
end;
$$;

create or replace function public.get_inventory_count_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.created_at desc), '[]'::jsonb)
  into payload
  from (
    select session.id, session.name, session.status, session.created_by,
      session.created_by_email, session.created_at, session.completed_by_email, session.completed_at,
      count(item.id)::integer as total_count,
      count(item.id) filter (where item.actual_quantity is null)::integer as uncounted_count,
      count(item.id) filter (where item.variance > 0)::integer as gain_count,
      count(item.id) filter (where item.variance < 0)::integer as loss_count,
      coalesce(sum(item.shortage_quantity), 0)::integer as shortage_quantity
    from public.inventory_count_sessions session
    left join public.inventory_count_items item on item.session_id = session.id
    group by session.id
  ) summary;
  return payload;
end;
$$;

create or replace function public.get_inventory_count_detail(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'session', to_jsonb(session),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.product_name, item.variant_name, item.inventory_type, item.id)
      from public.inventory_count_items item where item.session_id = session.id
    ), '[]'::jsonb),
    'shortages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shortage.id, 'count_item_id', shortage.count_item_id,
        'order_id', shortage.order_id, 'inventory_type', shortage.inventory_type,
        'quantity', shortage.quantity, 'resolved_quantity', shortage.resolved_quantity,
        'status', shortage.status,
        'created_at', shortage.created_at
      ) order by shortage.created_at, shortage.id)
      from public.inventory_count_shortages shortage
      join public.inventory_count_items count_item on count_item.id = shortage.count_item_id
      where count_item.session_id = session.id
    ), '[]'::jsonb)
  ) into payload
  from public.inventory_count_sessions session
  where session.id = p_session_id;
  if payload is null then raise exception '找不到盤點單' using errcode = 'P0002'; end if;
  return payload;
end;
$$;

revoke all on function public.create_inventory_count(text) from public, anon;
revoke all on function public.update_inventory_count_item(bigint, integer, integer) from public, anon;
revoke all on function public.complete_inventory_count(uuid) from public, anon;
revoke all on function public.delete_draft_inventory_count(uuid) from public, anon;
revoke all on function public.get_inventory_count_sessions() from public, anon;
revoke all on function public.get_inventory_count_detail(uuid) from public, anon;
revoke all on function public.get_inventory_count_gift_shortages() from public, anon;
revoke all on function public.allocate_inventory_count_gift_shortages(bigint) from public, anon;
grant execute on function public.create_inventory_count(text) to authenticated;
grant execute on function public.update_inventory_count_item(bigint, integer, integer) to authenticated;
grant execute on function public.complete_inventory_count(uuid) to authenticated;
grant execute on function public.delete_draft_inventory_count(uuid) to authenticated;
grant execute on function public.get_inventory_count_sessions() to authenticated;
grant execute on function public.get_inventory_count_detail(uuid) to authenticated;
grant execute on function public.get_inventory_count_gift_shortages() to authenticated;
grant execute on function public.allocate_inventory_count_gift_shortages(bigint) to authenticated;

comment on table public.inventory_count_sessions is
  'Immutable-after-completion warehouse-wide physical inventory count sessions.';
comment on table public.inventory_count_items is
  'Frozen sale/gift inventory snapshots with optimistic row versions and applied variances.';
comment on table public.inventory_count_shortages is
  'Order shortages discovered by a physical count; gift entries are exceptional follow-up work.';

commit;

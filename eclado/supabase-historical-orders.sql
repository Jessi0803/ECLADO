-- ECLADO historical manual orders.
-- Run after the current order, product-variant, backoffice-permission,
-- inventory-allocation and admin-audit migrations.
--
-- Historical orders are immutable records of already-completed offline sales.
-- They intentionally do not create payments, inventory allocations, shipping,
-- invoices, promotions, gifts, shopping-credit events or notifications.

begin;

alter table public.orders
  add column if not exists order_source text not null default 'online',
  add column if not exists transaction_date date;

update public.orders
set order_source = 'online'
where order_source is null;

alter table public.orders
  drop constraint if exists orders_order_source_check;
alter table public.orders
  add constraint orders_order_source_check
  check (order_source in ('online', 'historical_manual'));

create index if not exists orders_member_source_transaction_date_idx
  on public.orders (user_id, order_source, transaction_date desc, created_at desc);

comment on column public.orders.order_source is
  'online for storefront transactions; historical_manual for backoffice-only historical records.';
comment on column public.orders.transaction_date is
  'Actual historical transaction date. created_at remains the immutable system audit timestamp.';

create table if not exists public.order_admin_notes (
  order_id text primary key references public.orders(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_admin_notes enable row level security;
revoke all on table public.order_admin_notes from anon, authenticated;

comment on table public.order_admin_notes is
  'Backoffice-only notes for orders. These notes are never exposed through the member order row.';

create or replace function public.protect_historical_order_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.order_source = 'historical_manual' then
      raise exception 'Historical orders cannot be permanently deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.order_source = 'historical_manual'
      and coalesce(current_setting('app.eclado_historical_order_write', true), '0') <> '1'
    then
      raise exception 'Historical orders must be created through the backoffice RPC'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.order_source is distinct from old.order_source then
    raise exception 'Order source is immutable' using errcode = '55000';
  end if;

  if old.order_source = 'historical_manual'
    and new.status is distinct from old.status
    and not (
      old.status = 'delivered'
      and new.status = 'cancelled'
      and coalesce(current_setting('app.eclado_historical_order_cancel', true), '0') = '1'
    )
  then
    raise exception 'Historical order status is immutable outside the cancellation workflow'
      using errcode = '55000';
  end if;

  if old.order_source = 'historical_manual' and (
    new.items is distinct from old.items
    or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount
    or new.date is distinct from old.date
    or new.transaction_date is distinct from old.transaction_date
    or new.user_id is distinct from old.user_id
    or new.member is distinct from old.member
    or new.type is distinct from old.type
    or new.address is distinct from old.address
    or new.phone is distinct from old.phone
    or new.email is distinct from old.email
    or new.note is distinct from old.note
    or new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.fulfillment_method is distinct from old.fulfillment_method
    or new.invoice_type is distinct from old.invoice_type
    or new.invoice_company_name is distinct from old.invoice_company_name
    or new.invoice_tax_id is distinct from old.invoice_tax_id
    or new.invoice_number is distinct from old.invoice_number
    or new.shopping_credit_amount is distinct from old.shopping_credit_amount
    or new.payment_amount is distinct from old.payment_amount
    or new.paid_at is distinct from old.paid_at
  ) then
    raise exception 'Historical order snapshots are immutable' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_historical_order_identity() from public, anon, authenticated;
drop trigger if exists trg_protect_historical_order_identity on public.orders;
create trigger trg_protect_historical_order_identity
  before insert or update or delete on public.orders
  for each row execute function public.protect_historical_order_identity();

-- A delivered online order consumes stock. A historical record must not.
-- Keep the existing inventory function intact and narrow only its trigger scope.
drop trigger if exists trg_orders_inventory_allocation_sync on public.orders;
create trigger trg_orders_inventory_allocation_sync
  before insert or update of status, items on public.orders
  for each row
  when (new.order_source <> 'historical_manual')
  execute function public.sync_inventory_allocation_for_order();

-- Historical records were completed before this system existed and therefore
-- must not receive a synthetic paid_at timestamp.
drop trigger if exists trg_orders_first_paid_at on public.orders;
create trigger trg_orders_first_paid_at
  before insert or update of status on public.orders
  for each row
  when (new.order_source <> 'historical_manual')
  execute function public.set_order_first_paid_at();

-- Backoffice historical imports must not consume the storefront order-create
-- rate limit. Permission and validation remain authoritative in the RPC below.
drop trigger if exists trg_orders_creation_rate_limit on public.orders;
create trigger trg_orders_creation_rate_limit
  before insert on public.orders
  for each row
  when (new.order_source <> 'historical_manual')
  execute function public.enforce_order_creation_rate_limit();

create or replace function public.create_historical_order(
  p_member_id uuid,
  p_transaction_date date,
  p_items jsonb,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_member public.profiles%rowtype;
  requested_item jsonb;
  product_row public.products%rowtype;
  variant_row public.product_variants%rowtype;
  quantity integer;
  historical_unit_price numeric;
  historical_items jsonb := '[]'::jsonb;
  subtotal_amount numeric := 0;
  order_id text;
  clean_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
  created_order public.orders%rowtype;
  today_taipei date := (now() at time zone 'Asia/Taipei')::date;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write access required' using errcode = '42501';
  end if;

  select * into target_member
  from public.profiles profile
  where profile.id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_transaction_date is null or p_transaction_date > today_taipei then
    raise exception 'Historical transaction date must not be in the future'
      using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one historical order item is required'
      using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Historical order note is too long' using errcode = '22001';
  end if;

  for requested_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(requested_item ->> 'variant_id', '') !~ '^[0-9]+$' then
      raise exception 'A valid product variant is required' using errcode = '22023';
    end if;
    quantity := case
      when coalesce(requested_item ->> 'qty', '') ~ '^[0-9]+$'
        then (requested_item ->> 'qty')::integer
      else 0
    end;
    if quantity <= 0 then
      raise exception 'Historical order quantity must be greater than zero'
        using errcode = '22023';
    end if;
    begin
      historical_unit_price := (requested_item ->> 'unit_price')::numeric;
    exception when invalid_text_representation then
      historical_unit_price := null;
    end;
    if historical_unit_price is null or historical_unit_price < 0 then
      raise exception 'Historical unit price must be zero or greater'
        using errcode = '22023';
    end if;

    select variant.* into variant_row
    from public.product_variants variant
    where variant.id = (requested_item ->> 'variant_id')::bigint;
    if not found then
      raise exception 'Product variant not found' using errcode = 'P0002';
    end if;
    select product.* into product_row
    from public.products product
    where product.id = variant_row.product_id;
    if not found then
      raise exception 'Product not found' using errcode = 'P0002';
    end if;

    subtotal_amount := subtotal_amount + historical_unit_price * quantity;
    historical_items := historical_items || jsonb_build_array(jsonb_build_object(
      'id', product_row.id,
      'product_id', product_row.id,
      'publication_status', coalesce(product_row.publication_status, case when product_row.active then 'active' else 'archived' end),
      'variant_id', variant_row.id,
      'sku', variant_row.sku,
      'name', product_row.name_zh,
      'nameZh', product_row.name_zh,
      'name_en', product_row.name,
      'size', variant_row.size,
      'image_storage_path', (
        select image.storage_path
        from public.product_images image
        where image.product_id = product_row.id and image.active = true
        order by image.is_primary desc, image.sort_order, image.id
        limit 1
      ),
      'img', product_row.image_url,
      'qty', quantity,
      'list_price', historical_unit_price,
      'price', historical_unit_price,
      'unit_price', historical_unit_price,
      'line_total', historical_unit_price * quantity,
      'is_custom_order', variant_row.is_custom_order,
      'historical_manual', true,
      'fulfillment_type', 'historical',
      'fulfillment', '歷史訂單'
    ));
  end loop;

  order_id := 'ECL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  perform set_config('app.eclado_historical_order_write', '1', true);
  insert into public.orders (
    id, member, type, items, total, subtotal, discount, status, date,
    address, phone, email, note, user_id, pricing_snapshot,
    fulfillment_method, order_source, transaction_date,
    shopping_credit_amount, payment_amount
  ) values (
    order_id,
    coalesce(nullif(btrim(target_member.name), ''), split_part(target_member.email, '@', 1), '會員'),
    coalesce(target_member.role, 'consumer'),
    historical_items,
    subtotal_amount,
    subtotal_amount,
    0,
    'delivered',
    to_char(p_transaction_date, 'YYYY-MM-DD'),
    coalesce(target_member.studio_address, ''),
    coalesce(nullif(target_member.studio_phone, ''), target_member.phone, ''),
    coalesce(target_member.email, ''),
    '',
    target_member.id,
    jsonb_build_object(
      'version', 1,
      'engine', 'historical_manual_v1',
      'calculated_at', clock_timestamp(),
      'currency', 'TWD',
      'member_role', coalesce(target_member.role, 'consumer'),
      'items', historical_items,
      'subtotal', subtotal_amount,
      'discount', 0,
      'final_subtotal', subtotal_amount,
      'shipping', 0,
      'total', subtotal_amount,
      'order_source', 'historical_manual',
      'transaction_date', p_transaction_date
    ),
    'delivery',
    'historical_manual',
    p_transaction_date,
    0,
    subtotal_amount
  )
  returning * into created_order;
  perform set_config('app.eclado_historical_order_write', '0', true);

  if clean_note is not null then
    insert into public.order_admin_notes (order_id, note, created_by)
    values (created_order.id, clean_note, auth.uid());
  end if;

  return to_jsonb(created_order) || jsonb_build_object('admin_note', clean_note);
end;
$$;

revoke all on function public.create_historical_order(uuid, date, jsonb, text) from public, anon;
grant execute on function public.create_historical_order(uuid, date, jsonb, text) to authenticated;

create or replace function public.cancel_historical_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write access required' using errcode = '42501';
  end if;

  select * into target_order
  from public.orders target
  where target.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if target_order.order_source <> 'historical_manual' then
    raise exception 'Only historical orders can use this cancellation workflow'
      using errcode = '22023';
  end if;
  if target_order.status = 'cancelled' then
    return jsonb_build_object(
      'order_id', target_order.id,
      'status', target_order.status,
      'cancelled', true,
      'already_cancelled', true
    );
  end if;
  if target_order.status <> 'delivered' then
    raise exception 'Only completed historical orders can be cancelled'
      using errcode = '22023';
  end if;

  perform set_config('app.eclado_historical_order_cancel', '1', true);
  update public.orders
  set status = 'cancelled'
  where id = target_order.id;
  perform set_config('app.eclado_historical_order_cancel', '0', true);

  return jsonb_build_object(
    'order_id', target_order.id,
    'status', 'cancelled',
    'cancelled', true,
    'already_cancelled', false
  );
end;
$$;

revoke all on function public.cancel_historical_order(text) from public, anon;
grant execute on function public.cancel_historical_order(text) to authenticated;

comment on function public.cancel_historical_order(text) is
  'Voids one completed historical order while preserving its immutable snapshot and audit trail.';

create or replace function public.get_admin_order_notes()
returns table(order_id text, note text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.read') then
    raise exception 'Order read access required' using errcode = '42501';
  end if;
  return query
  select target.order_id, target.note, target.created_at
  from public.order_admin_notes target;
end;
$$;

revoke all on function public.get_admin_order_notes() from public, anon;
grant execute on function public.get_admin_order_notes() to authenticated;

-- Public popularity is an operational metric, so historical records are
-- deliberately excluded even though they use a completed order status.
create or replace function public.get_public_sales_stats()
returns table(product_id integer, sold_qty bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (item.value ->> 'product_id')::integer as product_id,
    sum(greatest(coalesce(nullif(item.value ->> 'qty', '')::integer, 1), 1))::bigint as sold_qty
  from public.orders orders
  cross join lateral jsonb_array_elements(orders.items) item(value)
  where orders.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and orders.order_source <> 'historical_manual'
    and coalesce(item.value ->> 'product_id', '') ~ '^[0-9]+$'
    and coalesce(item.value ->> 'is_custom_order', 'false') <> 'true'
  group by (item.value ->> 'product_id')::integer;
$$;

revoke all on function public.get_public_sales_stats() from public;
grant execute on function public.get_public_sales_stats() to anon, authenticated;

comment on function public.create_historical_order(uuid, date, jsonb, text) is
  'Atomically creates one completed historical order snapshot without replaying operational order side effects.';

notify pgrst, 'reload schema';

commit;

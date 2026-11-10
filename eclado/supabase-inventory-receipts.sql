-- Apply after the catalog save, inventory allocation, procurement and audit migrations.
begin;

alter table public.product_variants add column if not exists unit_weight_g numeric(12, 3)
  check (unit_weight_g > 0 and unit_weight_g < 'Infinity'::numeric);

create or replace function public.checked_catalog_stock(p_current integer, p_next integer, p_expected text)
returns integer language plpgsql set search_path = '' as $$
begin
  if p_current is distinct from p_next and p_current is distinct from p_expected::integer then
    raise exception '庫存已變動，請重新開啟商品後再調整庫存。' using errcode = '40001';
  end if;
  return p_next;
end;
$$;
revoke all on function public.checked_catalog_stock(integer,integer,text) from public, anon, authenticated;

-- Extend the installed catalog RPC in place, preserving subsequent pricing changes.
do $migration$
declare
  definition text := pg_get_functiondef('public.save_product_with_variants(jsonb,jsonb)'::regprocedure);
begin
  if strpos(definition, 'unit_weight_g = case') > 0 then return; end if;
  if strpos(definition, 'stock = normalized_stock,') = 0
    or strpos(definition, 'is_default, is_custom_order, procurement_unit_cost_usd,') = 0
    or strpos(definition, 'normalized_default, normalized_custom_order, normalized_procurement_unit_cost,') = 0
  then
    raise exception 'Catalog save definition differs from the expected version';
  end if;
  definition := replace(definition, 'stock = normalized_stock,', $stock$
        stock = case
          when normalized_publication_status = 'gift_only' then
            public.checked_catalog_stock(stock, 0, variant_input ->> 'expected_stock')
          when not (variant_input ? 'expected_stock') then stock
          when normalized_stock = (variant_input ->> 'expected_stock')::integer then stock
          else public.checked_catalog_stock(stock, normalized_stock, variant_input ->> 'expected_stock')
        end,
        unit_weight_g = case when can_manage_procurement_cost and variant_input ? 'unit_weight_g'
          then (variant_input ->> 'unit_weight_g')::numeric else unit_weight_g end,$stock$);
  definition := replace(definition, 'is_default, is_custom_order, procurement_unit_cost_usd,',
    'is_default, is_custom_order, procurement_unit_cost_usd, unit_weight_g,');
  definition := replace(definition, 'normalized_default, normalized_custom_order, normalized_procurement_unit_cost,',
    $weight$normalized_default, normalized_custom_order, normalized_procurement_unit_cost,
        case when can_manage_procurement_cost then (variant_input ->> 'unit_weight_g')::numeric end,$weight$);
  execute definition;
end
$migration$;

create table if not exists public.inventory_receipts (
  id uuid primary key,
  receipt_no bigint generated always as identity unique,
  received_on date not null,
  exchange_rate numeric(12, 6) not null check (exchange_rate > 0 and exchange_rate < 'Infinity'::numeric),
  payment_fee_twd numeric(14, 2) not null,
  customs_twd numeric(14, 2) not null,
  freight_twd numeric(14, 2) not null,
  version integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  posted_by uuid,
  posted_at timestamptz,
  check ((posted_by is null) = (posted_at is null)),
  check (payment_fee_twd between 0 and 999999999999.99),
  check (customs_twd between 0 and 999999999999.99),
  check (freight_twd between 0 and 999999999999.99)
);

alter table public.inventory_receipts
  add column if not exists purchase_order_id bigint references public.purchase_orders(id),
  add column if not exists preview_ready boolean not null default true,
  alter column exchange_rate drop not null;

create unique index if not exists inventory_receipts_open_purchase_idx
  on public.inventory_receipts (purchase_order_id) where posted_at is null and purchase_order_id is not null;
create index if not exists inventory_receipts_posted_purchase_idx
  on public.inventory_receipts (purchase_order_id) where posted_at is not null and purchase_order_id is not null;

create table if not exists public.inventory_receipt_items (
  receipt_id uuid not null references public.inventory_receipts(id),
  variant_id bigint not null references public.product_variants(id),
  sku text not null,
  product_name text not null,
  variant_name text not null,
  quantity integer not null check (quantity > 0),
  unit_cost_usd numeric(14, 4) not null check (unit_cost_usd between 0 and 9999999999.9999),
  unit_weight_g numeric(12, 3) not null check (unit_weight_g > 0 and unit_weight_g < 'Infinity'::numeric),
  goods_twd numeric not null,
  payment_fee_twd numeric not null,
  customs_twd numeric not null,
  freight_twd numeric not null,
  total_twd numeric generated always as (goods_twd + payment_fee_twd + customs_twd + freight_twd) stored,
  unit_cost_twd numeric generated always as (round((goods_twd + payment_fee_twd + customs_twd + freight_twd) / quantity, 6)) stored,
  primary key (receipt_id, variant_id)
);

create index if not exists inventory_receipts_received_on_idx
  on public.inventory_receipts (received_on desc, receipt_no desc);
create index if not exists inventory_receipt_items_variant_idx
  on public.inventory_receipt_items (variant_id);

alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_items enable row level security;
revoke all on public.inventory_receipts, public.inventory_receipt_items from public, anon, authenticated;

create or replace function public.inventory_purchase_receiving_lines(p_purchase_order_id bigint)
returns table (
  variant_id text, sku text, product_name text, variant_name text, ordered_quantity integer,
  received_quantity bigint, quantity bigint, unit_cost_usd numeric, unit_weight_g numeric
)
language sql stable set search_path = '' as $$
  with received as (
    select line.variant_id, sum(line.quantity) as quantity
    from public.inventory_receipts receipt
    join public.inventory_receipt_items line on line.receipt_id = receipt.id
    where receipt.purchase_order_id = p_purchase_order_id and receipt.posted_at is not null
    group by line.variant_id
  )
  select item.product_variant_id::text, item.product_sku, coalesce(item.name_zh, product.name_zh),
    coalesce(item.specification, variant.size), item.quantity, coalesce(received.quantity, 0),
    greatest(item.quantity - coalesce(received.quantity, 0), 0), item.unit_cost, variant.unit_weight_g
  from public.purchase_order_items item
  join public.product_variants variant on variant.id = item.product_variant_id
  join public.products product on product.id = variant.product_id
  left join received on received.variant_id = item.product_variant_id
  where item.purchase_order_id = p_purchase_order_id
  order by item.sort_order, item.id;
$$;
revoke all on function public.inventory_purchase_receiving_lines(bigint) from public, anon, authenticated;

create or replace function public.get_purchase_receiving_progress(p_purchase_order_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'complete', count(*) > 0 and coalesce(bool_and(line.quantity = 0), false),
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', line.variant_id, 'sku', line.sku, 'product_name', line.product_name,
        'variant_name', line.variant_name, 'ordered_quantity', line.ordered_quantity,
        'received_quantity', line.received_quantity, 'remaining_quantity', line.quantity
      ) order by line.sku, line.variant_id), '[]')
    )
    from public.inventory_purchase_receiving_lines(p_purchase_order_id) line
  );
end;
$$;
revoke all on function public.get_purchase_receiving_progress(bigint) from public, anon, authenticated;
grant execute on function public.get_purchase_receiving_progress(bigint) to authenticated;

create or replace function public.get_inventory_receipts(p_receipt_id uuid default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;
  if p_receipt_id is not null then
    return (
      select to_jsonb(receipt) || jsonb_build_object(
        'receipt_no', receipt.receipt_no::text,
        'total_twd', (select sum(item.total_twd) from public.inventory_receipt_items item where item.receipt_id = receipt.id),
        'purchase_order_no', purchase.po_number,
        'source_items', case when receipt.purchase_order_id is not null and receipt.posted_at is null then
          coalesce((select jsonb_agg(to_jsonb(line)) from public.inventory_purchase_receiving_lines(receipt.purchase_order_id) line), '[]')
        end,
        'items', case when receipt.preview_ready then
          coalesce((select jsonb_agg(to_jsonb(item) || jsonb_build_object('variant_id', item.variant_id::text)
            order by item.variant_id) from public.inventory_receipt_items item where item.receipt_id = receipt.id), '[]')
        else coalesce((select jsonb_agg(to_jsonb(line)) from public.inventory_purchase_receiving_lines(receipt.purchase_order_id) line
          where line.quantity > 0), '[]') end
      )
      from public.inventory_receipts receipt
      left join public.purchase_orders purchase on purchase.id = receipt.purchase_order_id
      where receipt.id = p_receipt_id
    );
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(summary) order by summary.received_on desc, summary.receipt_no desc)
    from (
      select receipt.id, receipt.received_on, receipt.receipt_no, receipt.posted_at,
        (select sum(item.total_twd) from public.inventory_receipt_items item where item.receipt_id = receipt.id) as total_twd
      from public.inventory_receipts receipt
      order by receipt.received_on desc, receipt.receipt_no desc
      limit 26 offset greatest(p_offset, 0)
    ) summary
  ), '[]');
end;
$$;

create or replace function public.open_purchase_inventory_receipt(p_purchase_order_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  purchase_status text;
  draft_id uuid;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;
  -- Serialize opening a draft for the same purchase order.
  select status into purchase_status from public.purchase_orders where id = p_purchase_order_id for update;
  if not found or purchase_status not in ('ordered', 'shipping', 'received') then
    raise exception '請先將叫貨單標記為已下單。' using errcode = '22023';
  end if;

  select id into draft_id from public.inventory_receipts
    where purchase_order_id = p_purchase_order_id and posted_at is null;
  if found then return public.get_inventory_receipts(draft_id); end if;

  if not exists (select 1 from public.inventory_purchase_receiving_lines(p_purchase_order_id) where quantity > 0) then
    raise exception '這張叫貨單已全部入庫。' using errcode = '22023';
  end if;
  insert into public.inventory_receipts (
    id, purchase_order_id, received_on, exchange_rate, payment_fee_twd, customs_twd, freight_twd,
    version, preview_ready, created_by
  ) values (
    gen_random_uuid(), p_purchase_order_id, (now() at time zone 'Asia/Taipei')::date, null, 0, 0, 0, 1, false, auth.uid()
  ) returning id into draft_id;
  return public.get_inventory_receipts(draft_id);
end;
$$;
revoke all on function public.open_purchase_inventory_receipt(bigint) from public, anon, authenticated;
grant execute on function public.open_purchase_inventory_receipt(bigint) to authenticated;

create or replace function public.search_inventory_receipt_variants(p_query text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(result) order by result.product_name, result.sku, result.variant_id)
    from (
      select variant.id::text as variant_id, product.name_zh as product_name, variant.sku,
        variant.size as variant_name, variant.unit_weight_g, variant.procurement_unit_cost_usd as unit_cost_usd
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.active and product.publication_status <> 'gift_only'
        and strpos(lower(concat_ws(' ', variant.sku, product.name, product.name_zh, variant.size)), lower(trim(p_query))) > 0
      order by product.name_zh, variant.sku, variant.id
      limit 50
    ) result
  ), '[]');
end;
$$;

create or replace function public.save_inventory_receipt(
  p_id uuid, p_version integer, p_received_on date, p_exchange_rate numeric,
  p_payment_fee_twd numeric, p_customs_twd numeric, p_freight_twd numeric, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt public.inventory_receipts%rowtype;
  input_count integer;
  saved_count integer;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;
  if p_id is null or p_version is null or p_version < 0 or p_received_on is null or not isfinite(p_received_on)
    or p_exchange_rate is null or not (p_exchange_rate > 0 and p_exchange_rate < 1000000)
    or round(p_exchange_rate, 6) <> p_exchange_rate
    or p_payment_fee_twd is null or p_customs_twd is null or p_freight_twd is null
    or not (p_payment_fee_twd between 0 and 999999999999.99 and p_customs_twd between 0 and 999999999999.99
      and p_freight_twd between 0 and 999999999999.99)
    or round(p_payment_fee_twd, 2) <> p_payment_fee_twd or round(p_customs_twd, 2) <> p_customs_twd
    or round(p_freight_twd, 2) <> p_freight_twd
    or jsonb_typeof(p_items) is distinct from 'array'
  then
    raise exception '請檢查入庫日期、付款匯率與各項費用。' using errcode = '22023';
  end if;
  input_count := jsonb_array_length(p_items);
  if input_count not between 1 and 200 then
    raise exception '每張入庫單須包含 1 至 200 項商品規格。' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(variant_id bigint, quantity integer, unit_cost_usd numeric, unit_weight_g numeric)
    where variant_id is null or quantity is null or quantity <= 0
      or unit_cost_usd is null or not (unit_cost_usd between 0 and 9999999999.9999)
      or round(unit_cost_usd, 4) <> unit_cost_usd
      or unit_weight_g is null or not (unit_weight_g > 0 and unit_weight_g <= 999999999.999)
      or round(unit_weight_g, 3) <> unit_weight_g
  ) then
    raise exception '商品數量須為正整數，重量須大於零，USD 單價須為非負數。' using errcode = '22023';
  end if;
  if (select count(distinct (item ->> 'variant_id')::bigint) from jsonb_array_elements(p_items) item) <> input_count then
    raise exception '同一張入庫單不可重複選擇商品規格。' using errcode = '22023';
  end if;

  if p_version = 0 then
    insert into public.inventory_receipts (id, received_on, exchange_rate, payment_fee_twd, customs_twd, freight_twd, version, created_by)
    values (p_id, p_received_on, p_exchange_rate, p_payment_fee_twd, p_customs_twd, p_freight_twd, 1, auth.uid())
    on conflict (id) do nothing returning * into receipt;
    if not found then
      if exists (select 1 from public.inventory_receipts where id = p_id and created_by = auth.uid()) then
        return public.get_inventory_receipts(p_id);
      end if;
      raise exception '單據已存在，請重新開啟。' using errcode = '40001';
    end if;
  else
    update public.inventory_receipts set received_on = p_received_on, exchange_rate = p_exchange_rate,
      payment_fee_twd = p_payment_fee_twd, customs_twd = p_customs_twd, freight_twd = p_freight_twd, preview_ready = true, version = version + 1
    where id = p_id and version = p_version and posted_at is null returning * into receipt;
    if not found then
      raise exception '入庫單已更新或已入庫，請重新開啟。' using errcode = '40001';
    end if;
    delete from public.inventory_receipt_items where receipt_id = p_id;
  end if;

  if receipt.purchase_order_id is not null and exists (
    select 1 from jsonb_to_recordset(p_items) as item(variant_id bigint, quantity integer)
    left join public.inventory_purchase_receiving_lines(receipt.purchase_order_id) source
      on source.variant_id = item.variant_id::text
    where source.variant_id is null or item.quantity > source.quantity
  ) then
    raise exception '本次實收須為叫貨單商品，且不可超過剩餘未入庫數量。' using errcode = '22023';
  end if;

  -- Allocate each fee independently in cents using rounded cumulative shares.
  -- Subtracting consecutive shares guarantees an exact total and nonnegative lines.
  with lines as (
    select variant.id, variant.sku, product.name_zh, variant.size, item.quantity, item.unit_cost_usd, item.unit_weight_g,
      item.quantity * item.unit_weight_g as weight
    from jsonb_to_recordset(p_items) as item(variant_id bigint, quantity integer, unit_cost_usd numeric, unit_weight_g numeric)
    join public.product_variants variant on variant.id = item.variant_id
    join public.products product on product.id = variant.product_id
    where variant.active and product.publication_status <> 'gift_only'
  ), weights as (
    select lines.*, sum(weight) over (order by id) as cumulative_weight, sum(weight) over () as total_weight from lines
  )
  insert into public.inventory_receipt_items (receipt_id, variant_id, sku, product_name, variant_name,
    quantity, unit_cost_usd, unit_weight_g, goods_twd, payment_fee_twd, customs_twd, freight_twd)
  select p_id, id, sku, name_zh, size, quantity, unit_cost_usd, unit_weight_g,
    round(quantity * unit_cost_usd * p_exchange_rate, 2),
    round(p_payment_fee_twd * cumulative_weight / total_weight, 2) - round(p_payment_fee_twd * (cumulative_weight - weight) / total_weight, 2),
    round(p_customs_twd * cumulative_weight / total_weight, 2) - round(p_customs_twd * (cumulative_weight - weight) / total_weight, 2),
    round(p_freight_twd * cumulative_weight / total_weight, 2) - round(p_freight_twd * (cumulative_weight - weight) / total_weight, 2)
  from weights order by id;
  get diagnostics saved_count = row_count;
  if saved_count <> input_count then
    raise exception '部分商品規格已停用或無法入一般庫存，請重新選擇。' using errcode = '22023';
  end if;
  return public.get_inventory_receipts(p_id);
end;
$$;

create or replace function public.post_inventory_receipt(p_id uuid, p_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt public.inventory_receipts%rowtype;
  target_product_id integer;
  actor_role text;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;
  select * into receipt from public.inventory_receipts where id = p_id for update;
  if not found then raise exception '找不到入庫單。' using errcode = 'P0002'; end if;
  if receipt.posted_at is not null then return public.get_inventory_receipts(p_id); end if;
  if not receipt.preview_ready or receipt.version is distinct from p_version then
    raise exception '入庫單已更新，請重新預覽。' using errcode = '40001';
  end if;

  if receipt.purchase_order_id is not null and exists (
    select 1 from public.inventory_receipt_items item
    left join public.inventory_purchase_receiving_lines(receipt.purchase_order_id) source
      on source.variant_id = item.variant_id::text
    where item.receipt_id = p_id and (source.variant_id is null or item.quantity > source.quantity)
  ) then
    raise exception '本次實收超過叫貨單剩餘量，請更新草稿。' using errcode = '22023';
  end if;

  perform 1 from public.product_variants variant join public.inventory_receipt_items item on item.variant_id = variant.id
    where item.receipt_id = p_id order by variant.id for update of variant;
  if not found then raise exception '入庫單沒有商品明細。' using errcode = '22023'; end if;

  -- Match order allocation's variant-first locking. A catalog editor may
  -- already hold the product row, so fail promptly instead of waiting in a cycle.
  perform 1 from public.products product where product.id in (
    select variant.product_id from public.inventory_receipt_items item
    join public.product_variants variant on variant.id = item.variant_id where item.receipt_id = p_id
  ) order by product.id for no key update nowait;
  if exists (
    select 1 from public.inventory_receipt_items item join public.product_variants variant on variant.id = item.variant_id
    join public.products product on product.id = variant.product_id
    where item.receipt_id = p_id and (not variant.active or product.publication_status = 'gift_only')
  ) then
    raise exception '部分商品已停用或無法入一般庫存，請更新草稿。' using errcode = '22023';
  end if;

  -- Only the first successful receipt supplies a missing catalog weight.
  update public.product_variants variant set
    stock = variant.stock + item.quantity,
    unit_weight_g = coalesce(variant.unit_weight_g, item.unit_weight_g)
  from public.inventory_receipt_items item where item.receipt_id = p_id and variant.id = item.variant_id;
  for target_product_id in
    select distinct variant.product_id from public.inventory_receipt_items item
    join public.product_variants variant on variant.id = item.variant_id where item.receipt_id = p_id order by variant.product_id
  loop
    perform public.sync_product_stock_mirror(target_product_id);
  end loop;

  update public.inventory_receipts set posted_by = auth.uid(), posted_at = now() where id = p_id;
  select role into actor_role from public.admin_users where user_id = auth.uid() and active;
  insert into public.audit_logs (actor_user_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    values (auth.uid(), actor_role, 'admin', 'inventory_receipts.post', 'inventory_receipts', p_id::text,
      jsonb_build_object('receipt_no', receipt.receipt_no));
  return public.get_inventory_receipts(p_id);
end;
$$;

revoke all on function public.get_inventory_receipts(uuid,integer),
  public.search_inventory_receipt_variants(text),
  public.save_inventory_receipt(uuid,integer,date,numeric,numeric,numeric,numeric,jsonb),
  public.post_inventory_receipt(uuid,integer) from public, anon, authenticated;
grant execute on function public.get_inventory_receipts(uuid,integer),
  public.search_inventory_receipt_variants(text),
  public.save_inventory_receipt(uuid,integer,date,numeric,numeric,numeric,numeric,jsonb),
  public.post_inventory_receipt(uuid,integer) to authenticated;

notify pgrst, 'reload schema';

commit;

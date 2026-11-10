-- Apply after inventory receipts, inventory counts, shipment metadata and system audit logs.
-- No order trigger is added. The cost worker reads committed fulfillment records.
begin;

create table if not exists public.product_cost_cutover (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null,
  started_by uuid not null
);

alter table public.product_cost_cutover add column if not exists processed_through timestamptz;

create table if not exists public.product_cost_events (
  event_key text primary key,
  kind text not null check (kind in ('opening','receipt','shipment','count','manual','return')),
  occurred_at timestamptz not null,
  variant_id bigint,
  order_id text,
  line_index integer,
  quantity integer not null check (quantity <> 0),
  unit_cost_twd numeric check (unit_cost_twd >= 0 and unit_cost_twd < 'Infinity'::numeric),
  evidence text,
  actor_id uuid,
  processed_at timestamptz,
  exception text
);
create index if not exists product_cost_events_pending_idx on public.product_cost_events (occurred_at, event_key)
  where processed_at is null;
create index if not exists product_cost_events_processed_variant_idx
  on public.product_cost_events (variant_id, occurred_at desc)
  where processed_at is not null and exception is distinct from 'late_event';
create index if not exists product_cost_events_period_idx on public.product_cost_events (occurred_at, kind);
create index if not exists product_cost_events_order_idx on public.product_cost_events (order_id, line_index, kind);

create table if not exists public.product_cost_layers (
  id bigint generated always as identity primary key,
  source_key text not null references public.product_cost_events(event_key),
  variant_id bigint not null,
  occurred_at timestamptz not null,
  original_quantity integer not null check (original_quantity > 0),
  remaining_quantity integer not null check (remaining_quantity between 0 and original_quantity),
  unit_cost_twd numeric,
  estimated boolean not null default false
);
create index if not exists product_cost_layers_available_idx on public.product_cost_layers (variant_id, occurred_at, id)
  where remaining_quantity > 0;

create table if not exists public.product_cost_entries (
  id bigint generated always as identity primary key,
  event_key text not null references public.product_cost_events(event_key),
  layer_id bigint references public.product_cost_layers(id),
  reversed_entry_id bigint references public.product_cost_entries(id),
  quantity integer not null check (quantity > 0),
  unit_cost_twd numeric,
  estimated boolean not null default false,
  reason text check (reason in ('unknown_cost','layer_shortage','unmapped_variant','late_event'))
);
create index if not exists product_cost_entries_event_idx on public.product_cost_entries (event_key);
create index if not exists product_cost_entries_reverse_idx on public.product_cost_entries (reversed_entry_id)
  where reversed_entry_id is not null;

create table if not exists public.product_cost_estimates (
  entry_id bigint primary key references public.product_cost_entries(id),
  unit_cost_twd numeric(20,6) not null check (unit_cost_twd >= 0),
  evidence text not null,
  reference_receipt_id uuid references public.inventory_receipts(id),
  reference_receipt_no bigint,
  reference_received_on date,
  reference_unit_cost_twd numeric,
  approved_by uuid not null,
  approved_at timestamptz not null default clock_timestamp()
);
alter table public.product_cost_estimates
  drop constraint if exists product_cost_estimates_evidence_check;
alter table public.product_cost_estimates
  add constraint product_cost_estimates_evidence_check check (length(trim(evidence)) <= 500);
alter table public.product_cost_estimates enable row level security;
revoke all on public.product_cost_estimates from public, anon, authenticated, service_role;

create or replace function public.product_cost_estimate_reference(p_variant_id bigint, p_shipped_at timestamptz)
returns table(receipt_id uuid, receipt_no bigint, received_on date, unit_cost_twd numeric)
language sql stable set search_path = '' as $$
  select r.id, r.receipt_no, r.received_on, i.unit_cost_twd
  from public.inventory_receipt_items i join public.inventory_receipts r on r.id = i.receipt_id
  where i.variant_id = p_variant_id and r.posted_at <= p_shipped_at
  order by r.posted_at desc, r.receipt_no desc
  limit 1;
$$;
revoke all on function public.product_cost_estimate_reference(bigint,timestamptz) from public, anon, authenticated, service_role;

create or replace function public.approve_product_cost_estimate(p_entry_id bigint, p_unit_cost_twd numeric, p_evidence text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target record;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage')
    or not public.has_backoffice_permission('analytics.read') then
    raise exception '沒有估列成本核准權限。' using errcode = '42501';
  end if;
  if p_unit_cost_twd is null or not (p_unit_cost_twd >= 0 and p_unit_cost_twd < 100000000000000)
    or p_unit_cost_twd <> round(p_unit_cost_twd,6)
    or length(trim(p_evidence)) > 500 then
    raise exception '請輸入有效的台幣單位成本，核准依據最多 500 字。' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(19416, 2026);

  select event.order_id, event.line_index, event.variant_id, event.occurred_at into target
  from public.product_cost_entries entry
  join public.product_cost_events event on event.event_key = entry.event_key
  where entry.id = p_entry_id and event.kind = 'shipment' and event.variant_id is not null
    and event.processed_at is not null and entry.reason in ('layer_shortage','unknown_cost')
    and entry.unit_cost_twd is null;
  if not found then
    raise exception '找不到可核准的待確認出貨成本。' using errcode = '22023';
  end if;
  if exists (select 1 from public.product_cost_estimates where entry_id = p_entry_id) then
    raise exception '這筆成本已核准，請重新載入報表。' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.product_cost_events
    where order_id = target.order_id and line_index = target.line_index and kind = 'return'
  ) then
    raise exception '此品項已有退貨成本紀錄，請先人工對帳。' using errcode = '22023';
  end if;
  insert into public.product_cost_estimates (entry_id, unit_cost_twd, evidence, reference_receipt_id,
    reference_receipt_no, reference_received_on, reference_unit_cost_twd, approved_by)
  select p_entry_id, p_unit_cost_twd, coalesce(trim(p_evidence), ''), ref.receipt_id,
    ref.receipt_no, ref.received_on, ref.unit_cost_twd, auth.uid()
  from (select 1) placeholder
  left join lateral public.product_cost_estimate_reference(target.variant_id, target.occurred_at) ref on true;
end;
$$;
revoke all on function public.approve_product_cost_estimate(bigint,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.approve_product_cost_estimate(bigint,numeric,text) to authenticated;

alter table public.product_cost_cutover enable row level security;
alter table public.product_cost_events enable row level security;
alter table public.product_cost_layers enable row level security;
alter table public.product_cost_entries enable row level security;
revoke all on public.product_cost_cutover, public.product_cost_events, public.product_cost_layers, public.product_cost_entries
  from public, anon, authenticated, service_role;

-- Start once, after a reconciled count. Any opening units without supplied evidence stay unknown.
create or replace function public.start_product_costs(p_opening jsonb, p_excluded_variant_ids bigint[])
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有成本管理權限。' using errcode = '42501';
  end if;
  if jsonb_typeof(p_opening) is distinct from 'array' then
    raise exception '期初成本必須是清單。' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(19416, 2026);
  if exists (select 1 from public.product_cost_cutover) then
    raise exception '已建立期初成本。' using errcode = '55000';
  end if;
  -- Lock source writes briefly for a single consistent opening boundary.
  lock table public.orders, public.inventory_receipts, public.inventory_count_sessions, public.product_variants
    in share mode nowait;
  if p_excluded_variant_ids is null or exists (
    select 1 from unnest(p_excluded_variant_ids) as excluded(id)
    where not exists (select 1 from public.product_variants v where v.id = excluded.id)
  ) then
    raise exception '期初排除清單包含無效的商品規格。' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_opening) input(variant_id bigint)
    where input.variant_id = any(p_excluded_variant_ids)
  ) then
    raise exception '排除的商品規格不可同時提供期初成本。' using errcode = '22023';
  end if;
  cutoff := clock_timestamp();
  insert into public.product_cost_cutover (started_at, started_by) values (cutoff, auth.uid());

  with held as (
    select a.product_variant_id, sum(a.stock_deducted_qty)::integer as quantity
    from public.order_inventory_allocations a join public.orders o on o.id = a.order_id
    where a.line_type = 'merchandise' and a.state <> 'released' and a.stock_deducted_qty > 0
      and o.status in ('unpaid','awaiting_confirm','paid','preparing','ready_for_pickup')
      and o.order_source is distinct from 'historical_manual'
    group by a.product_variant_id
  ), physical as (
    select v.id, v.stock + coalesce(held.quantity,0) as quantity
    from public.product_variants v left join held on held.product_variant_id = v.id
    where not (v.id = any(p_excluded_variant_ids))
  ), provided as (
    select layer.ordinal, input.*
    from jsonb_array_elements(p_opening) with ordinality layer(value, ordinal)
    cross join lateral jsonb_to_record(layer.value) input(variant_id bigint, quantity integer, unit_cost_twd numeric, evidence text)
  ), requested as (
    select variant_id, sum(quantity) as quantity from provided group by variant_id
  )
  insert into public.product_cost_events (event_key, kind, occurred_at, variant_id, quantity, unit_cost_twd, evidence, actor_id)
  select 'opening:' || lpad(provided.ordinal::text, 12, '0'), 'opening', cutoff, physical.id, provided.quantity,
    provided.unit_cost_twd, nullif(trim(provided.evidence), ''), auth.uid()
  from provided left join physical on physical.id = provided.variant_id
  union all
  select 'opening:unknown:' || physical.id, 'opening', cutoff, physical.id, physical.quantity - coalesce(requested.quantity,0),
    null, '未提供期初成本', auth.uid()
  from physical left join requested on requested.variant_id = physical.id
  where physical.quantity > coalesce(requested.quantity,0);

  if exists (
    select 1 from jsonb_to_recordset(p_opening) input(variant_id bigint, quantity integer, unit_cost_twd numeric, evidence text)
    where input.quantity is null or input.quantity <= 0 or input.variant_id is null
      or not exists (select 1 from public.product_variants v where v.id = input.variant_id)
      or input.unit_cost_twd is null or nullif(trim(input.evidence), '') is null
  ) or exists (
    select 1 from (
      select input.variant_id, sum(input.quantity) as quantity
      from jsonb_to_recordset(p_opening) input(variant_id bigint, quantity integer) group by input.variant_id
    ) requested
    join public.product_variants v on v.id = requested.variant_id
    where requested.quantity > v.stock + coalesce((
      select sum(a.stock_deducted_qty) from public.order_inventory_allocations a join public.orders o on o.id = a.order_id
      where a.product_variant_id = v.id and a.line_type = 'merchandise' and a.state <> 'released'
        and o.status in ('unpaid','awaiting_confirm','paid','preparing','ready_for_pickup')
        and o.order_source is distinct from 'historical_manual'
    ),0)
  ) then
    raise exception '期初件數須符合現場庫存，已知成本須附依據。' using errcode = '22023';
  end if;
  return cutoff;
end;
$$;

create or replace function public.start_product_costs(p_opening jsonb default '[]')
returns timestamptz language sql set search_path = '' as $$
  select public.start_product_costs(p_opening, '{}'::bigint[]);
$$;

-- Scope stock adjustments to the catalog RPC, not order reservations or receipts.
create or replace function public.capture_manual_product_cost_adjustment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  delta integer := new.stock - case when tg_op = 'UPDATE' then old.stock else 0 end;
begin
  if current_setting('app.product_cost_catalog_write', true) = '1' and delta <> 0
    and exists (select 1 from public.product_cost_cutover)
  then
    insert into public.product_cost_events (event_key, kind, occurred_at, variant_id, quantity, actor_id, evidence)
    values ('manual:' || gen_random_uuid(), 'manual', clock_timestamp(), new.id, delta, auth.uid(), '商品管理調整庫存');
  end if;
  return new;
end;
$$;
revoke all on function public.capture_manual_product_cost_adjustment() from public, anon, authenticated;
drop trigger if exists trg_product_cost_catalog_adjustment on public.product_variants;
create trigger trg_product_cost_catalog_adjustment
  after insert or update of stock on public.product_variants
  for each row execute function public.capture_manual_product_cost_adjustment();

do $migration$
declare
  definition text := pg_get_functiondef('public.save_product_with_variants(jsonb,jsonb)'::regprocedure);
  start_marker text := '-- Allow existing variants to exchange SKU values without transient conflicts.';
  end_marker text := '-- Transitional compatibility: legacy readers receive the same default and';
begin
  if strpos(definition, 'app.product_cost_catalog_write') > 0 then return; end if;
  if strpos(definition, start_marker) = 0 or strpos(definition, end_marker) = 0 then
    raise exception 'Expected catalog save markers missing; product cost migration aborted';
  end if;
  definition := replace(definition, start_marker,
    E'perform set_config(''app.product_cost_catalog_write'', ''1'', true);\n  ' || start_marker);
  definition := replace(definition, end_marker,
    E'perform set_config(''app.product_cost_catalog_write'', ''0'', true);\n  ' || end_marker);
  execute definition;
end;
$migration$;

-- Orders remain independent from costs. The worker reads first committed fulfillment
-- from the existing audit trail, plus shipment metadata as a fallback for delivery.
create or replace function public.collect_product_cost_events(p_start timestamptz, p_until timestamptz)
returns void language sql set search_path = '' as $$
  with first_delivery as (
    select audit.entity_id as order_id, min(audit.created_at) as occurred_at
    from public.audit_logs audit join public.orders o on o.id = audit.entity_id
    where audit.entity_type = 'orders' and audit.created_at < p_until
      and (case when o.fulfillment_method = 'onsite_pickup'
        then audit.after_data ->> 'status' = 'picked_up'
        else audit.after_data ->> 'status' in ('shipped','delivered') end)
      and (case when o.fulfillment_method = 'onsite_pickup'
        then audit.before_data ->> 'status' is distinct from 'picked_up'
        else coalesce(audit.before_data ->> 'status','') not in ('shipped','delivered') end)
    group by audit.entity_id
  ), fulfilled as (
    select o.id, o.items, least(first_delivery.occurred_at,
      case when o.fulfillment_method is distinct from 'onsite_pickup' and o.status in ('shipped','delivered','returned','cancelled') then o.shipped_at end) as occurred_at
    from public.orders o left join first_delivery on first_delivery.order_id = o.id
    where o.order_source is distinct from 'historical_manual'
      and (first_delivery.order_id is not null or (o.fulfillment_method is distinct from 'onsite_pickup' and o.shipped_at is not null))
  )
  insert into public.product_cost_events (event_key, kind, occurred_at, variant_id, order_id, line_index, quantity, unit_cost_twd, evidence)
  select 'receipt:' || r.id || ':' || i.variant_id, 'receipt', r.posted_at, i.variant_id, null, null,
    i.quantity, i.unit_cost_twd, null
  from public.inventory_receipts r join public.inventory_receipt_items i on i.receipt_id = r.id
  where r.posted_at >= p_start and r.posted_at < p_until
  union all
  select 'shipment:' || o.id || ':' || item.position, 'shipment', o.occurred_at,
    coalesce(case when item.value ->> 'variant_id' ~ '^[0-9]{1,18}$' then (item.value ->> 'variant_id')::bigint end,
      allocation.product_variant_id),
    o.id, (item.position - 1)::integer,
    -(item.value ->> 'qty')::integer, null, null
  from fulfilled o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) with ordinality item(value, position)
  left join public.order_inventory_allocations allocation on allocation.order_id = o.id
    and allocation.item_index = item.position - 1 and allocation.line_type = 'merchandise'
  where o.occurred_at >= p_start and o.occurred_at < p_until
    and coalesce(item.value ->> 'line_type','') <> 'gift'
    and coalesce(item.value ->> 'is_gift','false') <> 'true'
    and case when item.value ->> 'qty' ~ '^[0-9]{1,9}$' then (item.value ->> 'qty')::integer > 0 else false end
  union all
  select 'count:' || i.id, 'count', s.completed_at, i.product_variant_id, null, null,
    i.applied_delta + coalesce(unmatched.quantity,0), null, null
  from public.inventory_count_sessions s join public.inventory_count_items i on i.session_id = s.id
  left join lateral (
    select sum(shortage.quantity)::integer as quantity from public.inventory_count_shortages shortage
    where shortage.count_item_id = i.id and shortage.allocation_id is null
  ) unmatched on true
  where s.status = 'completed' and s.completed_at >= p_start and s.completed_at < p_until
    and i.inventory_type = 'sale' and i.applied_delta + coalesce(unmatched.quantity,0) <> 0
  on conflict (event_key) do nothing;
$$;
revoke all on function public.collect_product_cost_events(timestamptz,timestamptz) from public, anon, authenticated;

-- Record only physically received, resellable returns. The cost entry reverses the
-- original sale allocation and does not write to the storefront stock balance.
create or replace function public.record_product_cost_return(
  p_key uuid, p_order_id text, p_line_index integer, p_quantity integer, p_evidence text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sale public.product_cost_events%rowtype;
  existing public.product_cost_events%rowtype;
  already_returned bigint;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有成本管理權限。' using errcode = '42501';
  end if;
  if p_key is null or p_quantity is null or p_quantity <= 0 or nullif(trim(p_evidence),'') is null then
    raise exception '請提供可再售退回數量及依據。' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(19416, 2026);
  select * into existing from public.product_cost_events where event_key = 'return:' || p_key;
  if found then
    if (existing.order_id, existing.line_index, existing.quantity, existing.evidence)
      is distinct from (p_order_id, p_line_index, p_quantity, trim(p_evidence)) then
      raise exception '退貨紀錄鍵已用於不同資料。' using errcode = '22023';
    end if;
    return;
  end if;
  select * into sale from public.product_cost_events
    where kind = 'shipment' and order_id = p_order_id and line_index = p_line_index and processed_at is not null;
  if not found or sale.variant_id is null then
    raise exception '找不到已結算且可對應規格的原出貨品項。' using errcode = '22023';
  end if;
  select coalesce(sum(quantity),0) into already_returned from public.product_cost_events
    where kind = 'return' and order_id = p_order_id and line_index = p_line_index;
  if already_returned + p_quantity > abs(sale.quantity) then
    raise exception '退回數量超過原出貨剩餘可退數量。' using errcode = '22023';
  end if;
  insert into public.product_cost_events (event_key, kind, occurred_at, variant_id, order_id, line_index, quantity, evidence, actor_id)
  values ('return:' || p_key, 'return', clock_timestamp(), sale.variant_id, p_order_id, p_line_index, p_quantity, trim(p_evidence), auth.uid());
end;
$$;

create or replace function public.run_product_costs(p_limit integer default 250, p_until timestamptz default now() - interval '1 minute')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz;
  event public.product_cost_events%rowtype;
  layer public.product_cost_layers%rowtype;
  original record;
  remaining integer;
  taken integer;
  processed integer := 0;
  unit_cost numeric;
  estimated boolean;
  last_time timestamptz;
  issue text;
begin
  if p_limit is null or p_limit not between 1 and 5000 or p_until is null or p_until > clock_timestamp() then
    raise exception '背景成本處理範圍不正確。' using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(19416, 2026) then return 0; end if;
  select started_at into cutoff from public.product_cost_cutover;
  if cutoff is null or p_until <= cutoff then return 0; end if;
  perform public.collect_product_cost_events(cutoff, p_until);
  for event in select * from public.product_cost_events
    where processed_at is null and occurred_at < p_until
    order by occurred_at, case kind when 'opening' then 0 when 'receipt' then 1 when 'shipment' then 3 else 2 end, event_key
    limit p_limit
  loop
    remaining := abs(event.quantity);
    issue := null;
    select max(occurred_at) into last_time from public.product_cost_events
      where variant_id = event.variant_id and processed_at is not null and exception is distinct from 'late_event';
    if event.variant_id is null then
      issue := 'unmapped_variant';
    elsif event.occurred_at < last_time then
      issue := 'late_event';
    elsif event.kind = 'return' then
      -- Reverse the last consumed part first when only part of an order line returns.
      for original in
        select entry.id, coalesce(estimate.unit_cost_twd, entry.unit_cost_twd) as unit_cost_twd,
          (estimate.entry_id is not null or entry.estimated) as estimated, entry.quantity - coalesce((
          select sum(r.quantity) from public.product_cost_entries r where r.reversed_entry_id = entry.id
        ),0) as returnable
        from public.product_cost_entries entry join public.product_cost_events sale on sale.event_key = entry.event_key
        left join public.product_cost_estimates estimate on estimate.entry_id = entry.id
        where sale.kind = 'shipment' and sale.order_id = event.order_id and sale.line_index = event.line_index
        order by entry.id desc
      loop
        taken := least(remaining, original.returnable);
        if taken <= 0 then continue; end if;
        insert into public.product_cost_entries (event_key, reversed_entry_id, quantity, unit_cost_twd, estimated, reason)
        values (event.event_key, original.id, taken, original.unit_cost_twd, original.estimated,
          case when original.unit_cost_twd is null then 'unknown_cost' end);
        insert into public.product_cost_layers (source_key, variant_id, occurred_at, original_quantity, remaining_quantity, unit_cost_twd, estimated)
        values (event.event_key, event.variant_id, event.occurred_at, taken, taken, original.unit_cost_twd, original.estimated);
        remaining := remaining - taken;
        exit when remaining = 0;
      end loop;
    elsif event.quantity > 0 then
      unit_cost := event.unit_cost_twd;
      estimated := false;
      if event.kind in ('count','manual') then
        select i.unit_cost_twd into unit_cost from public.inventory_receipt_items i
          join public.inventory_receipts r on r.id = i.receipt_id
          where i.variant_id = event.variant_id and r.posted_at <= event.occurred_at
          order by r.posted_at desc, r.receipt_no desc limit 1;
        estimated := unit_cost is not null;
      end if;
      insert into public.product_cost_layers (source_key, variant_id, occurred_at, original_quantity, remaining_quantity, unit_cost_twd, estimated)
      values (event.event_key, event.variant_id, event.occurred_at, remaining, remaining, unit_cost, estimated);
      remaining := 0;
    else
      -- Sales consume oldest costs. Negative inventory adjustments consume newest costs.
      for layer in select * from public.product_cost_layers
        where variant_id = event.variant_id and remaining_quantity > 0 and occurred_at <= event.occurred_at
        order by case when event.kind = 'shipment' then occurred_at end,
          case when event.kind = 'shipment' then id end,
          occurred_at desc, id desc
      loop
        taken := least(remaining, layer.remaining_quantity);
        update public.product_cost_layers set remaining_quantity = remaining_quantity - taken where id = layer.id;
        insert into public.product_cost_entries (event_key, layer_id, quantity, unit_cost_twd, estimated, reason)
        values (event.event_key, layer.id, taken, layer.unit_cost_twd, layer.estimated,
          case when layer.unit_cost_twd is null then 'unknown_cost' end);
        remaining := remaining - taken;
        exit when remaining = 0;
      end loop;
    end if;
    if remaining > 0 then
      issue := coalesce(issue, 'layer_shortage');
      insert into public.product_cost_entries (event_key, quantity, reason) values (event.event_key, remaining, issue);
    end if;
    update public.product_cost_events set processed_at = clock_timestamp(), exception = issue where event_key = event.event_key;
    processed := processed + 1;
  end loop;
  if not exists (select 1 from public.product_cost_events where processed_at is null and occurred_at < p_until) then
    update public.product_cost_cutover set processed_through = greatest(processed_through, p_until);
  end if;
  return processed;
end;
$$;

create or replace function public.get_product_cost_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cutoff public.product_cost_cutover%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('analytics.read') then
    raise exception '沒有營運成本查詢權限。' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to < p_from
    or p_to - p_from > 366 then
    raise exception '請選擇一年以內的日期區間。' using errcode = '22023';
  end if;
  select * into cutoff from public.product_cost_cutover;
  return (
    with period as (
      select event.*, e.id as entry_id, e.quantity as entry_quantity,
        coalesce(estimate.unit_cost_twd, e.unit_cost_twd) as entry_cost,
        (estimate.entry_id is not null or e.estimated) as estimated,
        case when estimate.entry_id is null then e.reason end as reason,
        estimate.approved_at, estimate.evidence as approval_evidence, estimate.reference_receipt_no
      from public.product_cost_events event left join public.product_cost_entries e on e.event_key = event.event_key
      left join public.product_cost_estimates estimate on estimate.entry_id = e.id
      where event.kind in ('shipment','return')
        and event.occurred_at >= (p_from::timestamp at time zone 'Asia/Taipei')
        and event.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Taipei')
    )
    select jsonb_build_object(
      'started_at', cutoff.started_at,
      'processed_through', cutoff.processed_through,
      'shipment_cost', coalesce(sum(entry_quantity * entry_cost) filter (where kind = 'shipment'),0),
      'return_cost', coalesce(sum(entry_quantity * entry_cost) filter (where kind = 'return'),0),
      'estimated_cost', coalesce(sum(case when kind = 'return' then -1 else 1 end * entry_quantity * entry_cost)
        filter (where estimated),0),
      'pending_quantity', coalesce(sum(case when processed_at is null then abs(quantity)
        when reason is not null then entry_quantity else 0 end),0),
      'pending_orders', count(distinct order_id) filter (where processed_at is null or reason is not null),
      'shortage_quantity', coalesce(sum(entry_quantity) filter (where reason = 'layer_shortage'),0),
      'unknown_quantity', coalesce(sum(entry_quantity) filter (where reason = 'unknown_cost'),0),
      'pending_items', coalesce((
        select jsonb_agg(to_jsonb(issue) order by issue.occurred_at, issue.order_id, issue.line_index, issue.entry_id)
        from (
          select pending.*, ref.receipt_no::text as reference_receipt_no, ref.received_on as reference_received_on,
            ref.unit_cost_twd as suggested_unit_cost_twd
          from (
            select occurred_at, order_id, line_index, kind, variant_id, entry_id::text as entry_id,
              coalesce(reason, 'processing') as reason, coalesce(entry_quantity, abs(quantity)) as quantity,
              coalesce(kind = 'shipment' and variant_id is not null and reason in ('layer_shortage','unknown_cost'), false) as can_estimate
            from period where processed_at is null or reason is not null
            order by occurred_at, order_id, line_index, period.entry_id limit 50
          ) pending
          left join lateral public.product_cost_estimate_reference(pending.variant_id, pending.occurred_at) ref
            on pending.can_estimate
        ) issue
      ), '[]'),
      'approved_items', coalesce((
        select jsonb_agg(to_jsonb(approved) order by approved.approved_at desc, approved.entry_id)
        from (
          select entry_id::text, order_id, line_index, entry_quantity as quantity, entry_cost as unit_cost_twd,
            approval_evidence as evidence, approved_at, reference_receipt_no::text
          from period where approved_at is not null order by approved_at desc, period.entry_id limit 50
        ) approved
      ), '[]')
    )
    from period
  );
end;
$$;

revoke all on function public.start_product_costs(jsonb), public.start_product_costs(jsonb,bigint[]),
  public.record_product_cost_return(uuid,text,integer,integer,text),
  public.run_product_costs(integer,timestamptz), public.get_product_cost_summary(date,date) from public, anon, authenticated, service_role;
grant execute on function public.start_product_costs(jsonb), public.start_product_costs(jsonb,bigint[]),
  public.record_product_cost_return(uuid,text,integer,integer,text),
  public.get_product_cost_summary(date,date) to authenticated;
grant execute on function public.run_product_costs(integer,timestamptz) to service_role;
notify pgrst, 'reload schema';

commit;

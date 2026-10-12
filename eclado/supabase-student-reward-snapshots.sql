-- Phase 2A only: immutable private snapshots. No Ledger, wallet or status events.
-- Requires 1B + 1C. Isolation first; no production installation authorization.
begin;
do $$
begin
  if to_regprocedure('public.student_pricing_multiplier(uuid)') is null
    or to_regprocedure('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)') is null
    or to_regprocedure('public.create_assisted_order(uuid,jsonb)') is null then
    raise exception 'Current 1B/1C and order creators are required';
  end if;
end $$;

-- Durable identifiers, deliberately no Auth/profile/product cascade and no PII.
-- No order FK: existing order deletion behavior is not changed by this phase;
-- a snapshot survives deletion and can still be reconciled by its order ID.
create table if not exists public.student_reward_snapshots (
  order_id text primary key,
  schema_version integer not null default 1 check(schema_version=1),
  order_source text not null check(order_source in ('online','admin_assisted')),
  student_id uuid not null,
  instructor_id uuid not null,
  binding_id uuid not null,
  student_price_type text not null check(student_price_type in ('student_1','student_2')),
  student_multiplier numeric not null check(student_multiplier>0 and student_multiplier<=1),
  student_settings_version bigint not null,
  instructor_settings_version bigint not null,
  feature_version bigint not null,
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
  total_reward bigint not null check(total_reward>=0),
  created_at timestamptz not null default now(),
  check(student_id<>instructor_id)
);
create index if not exists student_reward_instructor_order_idx
  on public.student_reward_snapshots(instructor_id,created_at,order_id);
alter table public.student_reward_snapshots enable row level security;
revoke all on public.student_reward_snapshots from public,anon,authenticated,service_role;

create or replace function public.reject_student_reward_snapshot_changes()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Order reward snapshots are immutable' using errcode='42501';
end $$;
drop trigger if exists trg_student_reward_snapshot_immutable on public.student_reward_snapshots;
create trigger trg_student_reward_snapshot_immutable before update or delete
  on public.student_reward_snapshots for each row
  execute function public.reject_student_reward_snapshot_changes();

-- Capture qualification before quote. Profile lock order matches the 1B writers.
-- No client-set GUC or public RPC can inject this context.
create or replace function public.capture_student_reward_context(
  p_student_id uuid,p_items jsonb,p_source text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  initial_binding public.instructor_student_bindings%rowtype;
  binding public.instructor_student_bindings%rowtype;
  settings public.student_pricing_settings%rowtype;
  teacher_settings public.instructor_student_settings%rowtype;
  feature public.student_pricing_feature_settings%rowtype;
  multiplier numeric; instructor_default numeric; captured_items jsonb;
begin
  if p_student_id is null then return null; end if;
  -- Hold OFF/ON stable until creation commits, even if an operator toggles it.
  select * into feature from public.student_pricing_feature_settings where singleton for share;
  if not coalesce(feature.enabled,false) then return null; end if;
  select * into initial_binding from public.instructor_student_bindings
    where student_id=p_student_id and ended_at is null;
  -- Auth DELETE locks its parent row before cascading into profiles. Take the
  -- same parent-first order, or a later orders FK check could deadlock while
  -- creation holds profiles and DELETE holds auth.users.
  perform 1 from auth.users where id in(p_student_id,initial_binding.instructor_id)
    order by id for key share;
  perform 1 from public.profiles where id in(p_student_id,initial_binding.instructor_id)
    order by id for share;
  select * into binding from public.instructor_student_bindings
    where student_id=p_student_id and ended_at is null for share;
  if binding.id is distinct from initial_binding.id then
    raise exception '師生關係已變動，請重新報價' using errcode='40001';
  end if;
  if binding.id is null then return null; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='pro')
    or not exists(select 1 from public.profiles where id=binding.instructor_id and role='instructor') then
    return null;
  end if;
  select * into teacher_settings from public.instructor_student_settings
    where instructor_id=binding.instructor_id for share;
  if teacher_settings.student_price_type is null then return null; end if;
  select * into settings from public.student_pricing_settings where singleton for share;
  perform 1 from public.membership_tiers where role in('pro','instructor') order by role for share;
  if not exists(select 1 from public.membership_tiers where role='pro' and active) then return null; end if;
  multiplier:=case teacher_settings.student_price_type when 'student_1' then settings.student_1 else settings.student_2 end;
  select professional_price_multiplier into instructor_default from public.membership_tiers where role='instructor' and active;
  instructor_default:=coalesce(instructor_default,0.70);
  -- One MVCC statement captures variant/product prices for every requested line.
  -- Do not lock catalog rows here: inventory already locks variants and mirrors
  -- product stock. Additional price locks would invert that established order.
  select jsonb_agg(jsonb_build_object(
      'input_index',n,'product_id',p.id,'variant_id',v.id,'qty',(entry->>'qty')::integer,
      'price_mode',case when p_source='online' then 'AUTO' else coalesce(entry->>'price_mode','MANUAL') end,
      'student_unit_price',public.assisted_auto_unit_price(p_student_id,'pro',p,v,multiplier),
      'instructor_multiplier',public.resolve_product_price_multiplier(p,'instructor',instructor_default),
      'instructor_unit_price',round(case when p.instructor_price_multiplier=1 then v.pro_price
        else coalesce(nullif(v.pro_price,0),v.price) end
        *public.resolve_product_price_multiplier(p,'instructor',instructor_default))) order by n)
    into captured_items from jsonb_array_elements(p_items) with ordinality input(entry,n)
    join public.products p on p.id=(entry->>'product_id')::integer
    join lateral(select variant.* from public.product_variants variant where variant.product_id=p.id and variant.active
      and (case when nullif(btrim(entry->>'variant_id'),'') is null then variant.is_default
        else variant.id::text=btrim(entry->>'variant_id') or variant.sku=btrim(entry->>'variant_id') or variant.size=btrim(entry->>'variant_id') end)
      order by variant.is_default desc,variant.sort_order,variant.id limit 1) v on true;
  if jsonb_array_length(coalesce(captured_items,'[]'::jsonb))<>jsonb_array_length(p_items) then
    raise exception '商品已變動，請重新报價' using errcode='40001';
  end if;
  return jsonb_build_object('student_id',p_student_id,'instructor_id',binding.instructor_id,
    'binding_id',binding.id,'student_price_type',teacher_settings.student_price_type,
    'student_multiplier',multiplier,'student_settings_version',settings.version,
    'instructor_settings_version',teacher_settings.version,'feature_version',feature.version,'items',captured_items);
end $$;

create or replace function public.calculate_student_reward_line(p_basis numeric,p_instructor numeric,p_qty integer)
returns bigint language plpgsql immutable set search_path='' as $$
begin
  if p_basis is null or p_instructor is null or p_qty is null or p_basis<0 or p_instructor<0
    or p_basis<>round(p_basis) or p_instructor<>round(p_instructor) or p_qty<1 then
    raise exception 'Invalid reward price basis' using errcode='22023';
  end if;
  return (greatest(0,p_basis-p_instructor)*p_qty)::bigint;
end $$;

-- Called only by existing privileged creators, after their complete reservations.
-- Uses canonical persisted sale prices and frozen pre-quote comparison prices.
create or replace function public.persist_student_reward_snapshot(p_order_id text,p_context jsonb)
returns void language plpgsql volatile security definer set search_path='' as $$
declare target public.orders%rowtype; sale record; basis jsonb; lines jsonb:='[]';
  merchandise_index integer:=0; amount bigint; total bigint:=0; qty integer; unit_price numeric;
begin
  if p_context is null then return; end if;
  select * into target from public.orders where id=p_order_id;
  if not found or target.user_id is distinct from (p_context->>'student_id')::uuid
    or target.type is distinct from 'pro' or target.order_source not in('online','admin_assisted') then
    raise exception 'Invalid reward order identity' using errcode='22023';
  end if;
  for sale in select value as item,ordinality as line_index from jsonb_array_elements(target.items) with ordinality loop
    if coalesce(sale.item->>'line_type','merchandise')='gift' or coalesce((sale.item->>'is_gift')::boolean,false) then continue; end if;
    if coalesce(sale.item->>'line_type','merchandise')<>'merchandise' then continue; end if;
    basis:=p_context->'items'->merchandise_index; merchandise_index:=merchandise_index+1;
    qty:=(sale.item->>'qty')::integer; unit_price:=(sale.item->>'unit_price')::numeric;
    if basis is null or (basis->>'product_id')::integer<>coalesce(sale.item->>'product_id',sale.item->>'id')::integer
      or (basis->>'variant_id')::bigint<>(sale.item->>'variant_id')::bigint
      or qty is distinct from (basis->>'qty')::integer then
      raise exception '商品已變動，請重新報價' using errcode='40001';
    end if;
    if basis->>'price_mode'='AUTO' and unit_price is distinct from (basis->>'student_unit_price')::numeric then
      raise exception '商品價格已變動，請重新報價' using errcode='40001';
    end if;
    amount:=public.calculate_student_reward_line(unit_price,(basis->>'instructor_unit_price')::numeric,qty);
    total:=total+amount;
    lines:=lines||jsonb_build_array(jsonb_build_object('line_index',sale.line_index,
      'product_id',basis->'product_id','variant_id',basis->'variant_id','qty',qty,'price_mode',basis->'price_mode',
      'student_unit_price',basis->'student_unit_price','basis_unit_price',unit_price,
      'instructor_multiplier',basis->'instructor_multiplier','instructor_unit_price',basis->'instructor_unit_price','reward',amount));
  end loop;
  if merchandise_index<>jsonb_array_length(p_context->'items') then
    raise exception 'Reward merchandise mismatch' using errcode='40001';
  end if;
  if merchandise_index=0 then return; end if;
  insert into public.student_reward_snapshots(order_id,order_source,student_id,instructor_id,binding_id,
    student_price_type,student_multiplier,student_settings_version,instructor_settings_version,feature_version,items,total_reward)
  values(p_order_id,target.order_source,(p_context->>'student_id')::uuid,(p_context->>'instructor_id')::uuid,
    (p_context->>'binding_id')::uuid,p_context->>'student_price_type',(p_context->>'student_multiplier')::numeric,
    (p_context->>'student_settings_version')::bigint,(p_context->>'instructor_settings_version')::bigint,
    (p_context->>'feature_version')::bigint,lines,total);
end $$;

-- Every storefront overload funnels through the private discount creator.
-- Assisted recovery returns before context capture; it never re-snapshots history.
do $migration$
declare definition text; marker text;
begin
  definition:=pg_get_functiondef('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  if position('public.persist_student_reward_snapshot' in definition)=0 then
    marker:='  quote_result := public.quote_order_pricing(p_items, normalized_fulfillment, normalized_code, p_email);';
    if position(marker in definition)=0 or position('  return quote_result || jsonb_build_object(' in definition)=0
      or position('  quote_result jsonb;' in definition)=0 then raise exception 'Storefront creator differs'; end if;
    definition:=replace(definition,'  quote_result jsonb;','  quote_result jsonb; reward_context jsonb;');
    definition:=replace(definition,marker,'  reward_context:=public.capture_student_reward_context(current_user_id,p_items,''online'');'||E'\n'||marker);
    definition:=replace(definition,'  return quote_result || jsonb_build_object(',
      '  perform public.persist_student_reward_snapshot(order_id,reward_context);'||E'\n'||'  return quote_result || jsonb_build_object(');
    execute definition;
  end if;
  definition:=pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure);
  if position('public.persist_student_reward_snapshot' in definition)=0 then
    marker:=$q$  if nullif(btrim(p_payload->>'coupon_code'),'') is not null then$q$;
    if position(marker in definition)=0 or position('  suggested_price numeric;' in definition)=0
      or position('  return jsonb_build_object(''order_id'',created_order_id,' in definition)=0 then
      raise exception 'Assisted creator differs'; end if;
    definition:=replace(definition,'  suggested_price numeric;','  reward_context jsonb; suggested_price numeric;');
    definition:=replace(definition,marker,$q$  reward_context:=public.capture_student_reward_context(member_id,p_payload->'items','admin_assisted');$q$||E'\n'||marker);
    definition:=replace(definition,'  return jsonb_build_object(''order_id'',created_order_id,',
      '  perform public.persist_student_reward_snapshot(created_order_id,reward_context);'||E'\n'||'  return jsonb_build_object(''order_id'',created_order_id,');
    execute definition;
  end if;
end $migration$;
revoke all on function public.capture_student_reward_context(uuid,jsonb,text),
  public.calculate_student_reward_line(numeric,numeric,integer),public.persist_student_reward_snapshot(text,jsonb),
  public.reject_student_reward_snapshot_changes() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;

-- Phase 1C only. Apply to isolation first. Production requires separate approval.
-- Does not enable student pricing, create reward snapshots, or alter payment ACLs.
begin;
do $$
begin
  if to_regprocedure('public.instructor_student_context(uuid)') is null
    or to_regprocedure('public.resolve_product_price_multiplier(public.products,text,numeric)') is null
    or to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint)') is null then
    raise exception '1B and current member/credit pricing are required';
  end if;
end;
$$;
create table if not exists public.student_pricing_feature_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  version bigint not null default 0 check(version>=0),
  updated_at timestamptz not null default now()
);
insert into public.student_pricing_feature_settings(singleton) values(true) on conflict do nothing;
alter table public.student_pricing_feature_settings enable row level security;
revoke all on public.student_pricing_feature_settings from public,anon,authenticated;

-- Internal-only: derives identity/eligibility from 1B; never trusts client folds.
create or replace function public.student_pricing_multiplier(p_user_id uuid)
returns numeric language sql stable security definer set search_path='' as $$
  select case when feature.enabled and coalesce((context.data->>'student_pricing_eligible')::boolean,false)
    then case context.data->>'student_price_type' when 'student_1' then settings.student_1
      when 'student_2' then settings.student_2 end end
  from public.student_pricing_feature_settings feature
  cross join public.student_pricing_settings settings
  cross join lateral (select public.instructor_student_context(p_user_id) as data) context
  where feature.singleton and settings.singleton
    and exists(select 1 from public.membership_tiers where role='pro' and active);
$$;

-- Shared amount calculation, after existing professional rounding, before benefits.
create or replace function public.apply_student_price(p_base numeric,p_multiplier numeric)
returns numeric language sql immutable set search_path='' as $$
  select case when p_multiplier is null then p_base else round(p_base*p_multiplier) end;
$$;

-- Matches the existing assisted creator's suggested price, including its legacy
-- instructor fallback. Do not silently repair that independent legacy behavior.
create or replace function public.assisted_auto_unit_price(
  p_customer_id uuid,p_role text,p_product public.products,p_variant public.product_variants,p_student_multiplier numeric)
returns numeric language sql stable security definer set search_path='' as $$
  select public.apply_student_price(case when p_role='consumer' then p_variant.price else
    round((case when (p_role='instructor' and p_product.instructor_price_multiplier=1)
      or(p_role='distributor' and p_product.distributor_price_multiplier=1)
      or(p_role='staff' and p_product.staff_price_multiplier=1)
      or(p_role='pro' and p_product.instructor_price_multiplier=1
        and p_product.distributor_price_multiplier=1 and p_product.staff_price_multiplier=1)
      then coalesce(p_variant.pro_price,0) else coalesce(nullif(p_variant.pro_price,0),p_variant.price) end)
      *public.resolve_product_price_multiplier(p_product,p_role,
        coalesce((select professional_price_multiplier from public.membership_tiers where role=p_role and active),1))) end,
    case when p_role='pro' then p_student_multiplier end);
$$;

-- Storefront receives only its own student unit prices, not instructor comparison
-- prices or other members' qualification. Missing 1C remains distinguishable from OFF.
create or replace function public.get_my_student_product_prices()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare multiplier numeric; prices jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('enabled',false,'prices','[]'::jsonb); end if;
  multiplier:=public.student_pricing_multiplier(auth.uid());
  if multiplier is null then return jsonb_build_object('enabled',false,'prices','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'variant_id',v.id,
    'unit_price',public.assisted_auto_unit_price(auth.uid(),'pro',p,v,multiplier)) order by p.id,v.id),'[]'::jsonb)
    into prices from public.products p join public.product_variants v on v.product_id=p.id
    where p.publication_status in('active','event_only') and v.active;
  return jsonb_build_object('enabled',true,'prices',prices);
end;
$$;

-- Confirmation uses public sale prices only, no reward/instructor snapshots.
create or replace function public.student_price_confirmation(p_quote jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('subtotal',p_quote->'subtotal','discount',p_quote->'discount',
    'shipping',p_quote->'shipping','total',p_quote->'total',
    'items',(select jsonb_agg(jsonb_build_object('product_id',coalesce(x->'product_id',x->'id'),
      'variant_id',x->'variant_id','qty',x->'qty','unit_price',x->'unit_price',
      'line_type',coalesce(x->>'line_type','merchandise')) order by n)
      from jsonb_array_elements(p_quote->'items') with ordinality as lines(x,n)));
$$;

-- Existing creation/credit/gift/inventory code remains the sole creator. A changed
-- price/benefit rejects the complete transaction before any payment API is called.
create or replace function public.create_order_with_pricing(
  p_items jsonb,p_member text,p_address text,p_phone text,p_email text,p_note text,
  p_payment_method text,p_fulfillment_method text,p_coupon_code text,
  p_invoice_type text,p_invoice_company_name text,p_invoice_tax_id text,
  p_shopping_credit_amount bigint,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_expected_quote is null or jsonb_typeof(p_expected_quote)<>'object' then
    raise exception '請重新取得並確認報價' using errcode='22023';
  end if;
  result:=public.create_order_with_pricing(p_items,p_member,p_address,p_phone,p_email,p_note,
    p_payment_method,p_fulfillment_method,p_coupon_code,p_invoice_type,p_invoice_company_name,
    p_invoice_tax_id,p_shopping_credit_amount);
  if public.student_price_confirmation(result) is distinct from public.student_price_confirmation(p_expected_quote) then
    raise exception '商品、優惠或運費已變動，請重新報價並確認。' using errcode='40001';
  end if;
  return result;
end;
$$;
revoke all on function public.student_price_confirmation(jsonb),
  public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb) to anon,authenticated;

-- Guarded additive patch, preserving complete current wrappers and all benefits.
do $migration$
declare definition text; marker text;
begin
  definition:=pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure);
  if position('public.apply_student_price' in definition)=0 then
    marker:='    if requested_item.value ? ''expected_unit_price''';
    if position(marker in definition)=0 then raise exception 'Base quote differs: student migration aborted'; end if;
    if position('  current_user_id uuid := auth.uid();' in definition)=0 then raise exception 'Base identity source differs'; end if;
    definition:=replace(definition,'  current_user_id uuid := auth.uid();',
      '  current_user_id uuid := auth.uid(); student_multiplier numeric := public.student_pricing_multiplier(auth.uid());');
    definition:=replace(definition,marker,$patch$
    if member_role='pro' then
      unit_price:=public.apply_student_price(unit_price,student_multiplier);
    end if;
$patch$||marker);
    execute definition;
  end if;
  -- Old assisted requests already supplied manual unit_price: retain it exactly.
  definition:=pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure);
  if position('public.assisted_auto_unit_price' in definition)=0 then
    marker:='    all_custom:=all_custom and coalesce(variant.is_custom_order,false);';
    if position(marker in definition)=0 then raise exception 'Assisted quote differs'; end if;
    definition:=replace(definition,marker,$patch$
    if entry ? 'price_mode' and entry->>'price_mode' not in ('AUTO','MANUAL') then
      raise exception 'Invalid item price mode' using errcode='22023';
    end if;
    if entry ? 'price_mode' and entry->>'price_mode' is null then
      raise exception 'Invalid item price mode' using errcode='22023';
    end if;
    if entry->>'price_mode'='AUTO' then
      price:=public.assisted_auto_unit_price(customer_id,customer_role,product,variant,student_multiplier);
    end if;
$patch$||marker);
    definition:=replace(definition,'  return result||jsonb_build_object(',
      '  return result||jsonb_build_object(''price_modes_supported'',true,');
    definition:=replace(definition,'quantity integer; price numeric;',
      'quantity integer; price numeric; student_multiplier numeric;');
    definition:=replace(definition,$q$  for entry in select value from jsonb_array_elements(p_payload->'items') loop$q$,
      $q$  student_multiplier:=public.student_pricing_multiplier(customer_id);
  for entry in select value from jsonb_array_elements(p_payload->'items') loop$q$);
    -- Keep the explicit mode on sale lines. Legacy lines retain their old shape.
    definition:=replace(definition,$q$  if p_payload->>'fulfillment_method' not in$q$,$patch$
  select jsonb_agg(line || case when input ? 'price_mode' then jsonb_build_object('price_mode',input->'price_mode') else '{}'::jsonb end order by n)
    into lines from jsonb_array_elements(lines) with ordinality as actual(line,n)
    join jsonb_array_elements(p_payload->'items') input on input->>'variant_id'=line->>'variant_id';
  if p_payload->>'fulfillment_method' not in$patch$);
    execute definition;
  end if;
  definition:=pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure);
  if position('public.assisted_auto_unit_price' in definition)=0 then
    marker:='    suggested_prices := suggested_prices ||';
    if position(marker in definition)=0 or position('benefit_quote:=public.quote_assisted_order(p_payload)' in definition)=0 then
      raise exception 'Assisted create differs'; end if;
    definition:=replace(definition,marker,$patch$
    if item ? 'price_mode' and (item->>'price_mode' is null or item->>'price_mode' not in ('AUTO','MANUAL')) then
      raise exception 'Invalid item price mode' using errcode='22023';
    end if;
    if item->>'price_mode'='AUTO' then
      unit_price:=public.assisted_auto_unit_price(member_id,member_role,target_product,target_variant,student_multiplier);
      suggested_price:=unit_price;
    end if;
$patch$||marker);
    definition:=replace(definition,'suggested_price numeric;', 'suggested_price numeric; student_multiplier numeric;');
    definition:=replace(definition,$q$  for item in select value from jsonb_array_elements(p_payload->'items') loop$q$,
      $q$  student_multiplier:=public.student_pricing_multiplier(member_id);
  if exists(select 1 from jsonb_array_elements(p_payload->'items') x where x->>'price_mode'='AUTO')
    and not (p_payload ? 'expected_quote') then
    raise exception 'AUTO 商品須重新報價並確認' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop$q$);
    definition:=replace(definition,$q$  benefit_discount:=(benefit_quote->>'discount')::numeric;$q$,$patch$
  -- All persisted totals use the same authoritative benefit_quote as items.
  subtotal_amount:=(benefit_quote->>'subtotal')::numeric;
  select jsonb_agg(context || case when line->>'price_mode'='AUTO' then
      jsonb_build_object('suggested_unit_price',line->'unit_price','final_unit_price',line->'unit_price','price_mode','AUTO')
    when line->>'price_mode'='MANUAL' then jsonb_build_object('price_mode','MANUAL') else '{}'::jsonb end order by n)
    into suggested_prices from jsonb_array_elements(suggested_prices) with ordinality as existing(context,n)
    join jsonb_array_elements(benefit_quote->'items') line on line->>'variant_id'=context->>'variant_id' and coalesce(line->>'line_type','merchandise')<>'gift';
  benefit_discount:=(benefit_quote->>'discount')::numeric;$patch$);
    execute definition;
  end if;
end $migration$;
revoke all on function public.student_pricing_multiplier(uuid),public.apply_student_price(numeric,numeric),
  public.assisted_auto_unit_price(uuid,text,public.products,public.product_variants,numeric),public.get_my_student_product_prices()
  from public,anon,authenticated;
grant execute on function public.get_my_student_product_prices() to anon,authenticated;
-- No client setter. OFF is the installation default; enabling is a later separately
-- approved DB action after 2A/2B acceptance, never a browser flag or JWT field.
notify pgrst,'reload schema';
commit;

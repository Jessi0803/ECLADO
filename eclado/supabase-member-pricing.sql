-- ECLADO: global member pricing + per-product overrides (all variants share).
-- Apply AFTER current pricing hardening, internal-staff, catalog-save and audit migrations.
-- Run in one transaction. Do NOT rerun older pricing setup scripts afterwards:
-- their seed UPSERTs reset membership_tiers. Deploy the new frontend promptly;
-- older frontends still assume fixed 70%/65%/50% pricing.
begin;

do $$
begin
  if to_regprocedure('public.quote_order_pricing_internal_20260916(jsonb,text)') is null
    or to_regprocedure('public.save_product_with_variants(jsonb,jsonb)') is null
    or to_regprocedure('public.audit_log_projection(text,jsonb)') is null then
    raise exception 'Current pricing, catalog-save and audit migrations are required';
  end if;
  if (select count(*) from public.membership_tiers
    where role in ('instructor','distributor','staff') and active
      and professional_price_multiplier > 0 and professional_price_multiplier <= 1
      and professional_price_multiplier = round(professional_price_multiplier,3)) <> 3 then
    raise exception 'Three active pricing roles with valid default multipliers are required';
  end if;
end $$;

alter table public.products
  add column if not exists instructor_price_multiplier numeric,
  add column if not exists distributor_price_multiplier numeric,
  add column if not exists staff_price_multiplier numeric;

-- One-time conversion. Never overwrite later product overrides on rerun.
do $$
begin
  if to_regprocedure('public.resolve_product_price_multiplier(public.products,text,numeric)') is null then
    update public.products set
      instructor_price_multiplier = 1,
      distributor_price_multiplier = 1,
      staff_price_multiplier = 1
    where apply_tier_multiplier is false;
  end if;
end $$;

do $$
declare role_name text;
begin
  foreach role_name in array array['instructor','distributor','staff'] loop
    if not exists (select 1 from pg_constraint where conrelid='public.products'::regclass
      and conname=role_name || '_price_multiplier_check') then
      execute format('alter table public.products add constraint %I check (%I is null or (%I > 0 and %I <= 1 and %I = round(%I,3)))',
        role_name || '_price_multiplier_check', role_name || '_price_multiplier',
        role_name || '_price_multiplier', role_name || '_price_multiplier',
        role_name || '_price_multiplier', role_name || '_price_multiplier');
    end if;
  end loop;
end $$;

comment on column public.products.apply_tier_multiplier is
  'Legacy compatibility only. New pricing ignores this flag; use per-role nullable multipliers.';
comment on column public.products.instructor_price_multiplier is 'NULL inherits global; 1 means professional price; all variants share.';
comment on column public.products.distributor_price_multiplier is 'NULL inherits global; 1 means professional price; all variants share.';
comment on column public.products.staff_price_multiplier is 'NULL inherits global; 1 means professional price; all variants share.';

create or replace function public.resolve_product_price_multiplier(
  p_product public.products, p_role text, p_default numeric
) returns numeric language sql immutable set search_path='' as $$
  select case p_role
    when 'instructor' then coalesce(p_product.instructor_price_multiplier, p_default)
    when 'distributor' then coalesce(p_product.distributor_price_multiplier, p_default)
    when 'staff' then coalesce(p_product.staff_price_multiplier, p_default)
    else p_default end;
$$;
revoke all on function public.resolve_product_price_multiplier(public.products,text,numeric) from public, anon, authenticated;

-- Modify only the existing base-price block; preserve coupons, gifts, minimums,
-- shipping groups, credit, order snapshots and security wrappers unchanged.
do $migration$
declare
  definition text := pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure);
  old_block text := $old$    elsif product_row.apply_tier_multiplier is false then
      unit_price := professional_price;
    else
      unit_price := round(
        coalesce(nullif(professional_price, 0), list_price)
        * tier.professional_price_multiplier
      );$old$;
  new_block text := $new$    else
      unit_price := round(
        case when
          (member_role='instructor' and product_row.instructor_price_multiplier=1)
          or (member_role='distributor' and product_row.distributor_price_multiplier=1)
          or (member_role='staff' and product_row.staff_price_multiplier=1)
          or (member_role='pro' and product_row.instructor_price_multiplier=1
            and product_row.distributor_price_multiplier=1 and product_row.staff_price_multiplier=1)
        then professional_price else coalesce(nullif(professional_price, 0), list_price) end
        * public.resolve_product_price_multiplier(product_row, member_role, tier.professional_price_multiplier)
      );$new$;
begin
  if position('resolve_product_price_multiplier' in definition) = 0 then
    if position(old_block in definition) = 0 then
      raise exception 'Base pricing definition differs; migration aborted without changes';
    end if;
    definition := replace(definition, old_block, new_block);
    if position('if unit_price is null or unit_price < 0 then' in definition)=0 then
      raise exception 'Base pricing validation differs; migration aborted';
    end if;
    definition := replace(definition, 'if unit_price is null or unit_price < 0 then', $validation$
    if requested_item.value ? 'expected_unit_price' and
      (requested_item.value ->> 'expected_unit_price')::numeric is distinct from unit_price then
      raise exception '商品價格已更新，請重新整理並確認金額後再建立付款單。' using errcode='22023';
    end if;
    if unit_price is null or unit_price < 0 then$validation$);
    execute definition;
  end if;
end $migration$;
revoke all on function public.quote_order_pricing_internal_20260916(jsonb,text) from public, anon, authenticated;

-- Integrate overrides into the EXISTING transactional save, not a second request.
-- Old clients may omit new fields; updates then preserve existing overrides.
do $migration$
declare
  definition text := pg_get_functiondef('public.save_product_with_variants(jsonb,jsonb)'::regprocedure);
  column_marker text := 'min_stock, is_pro_only, apply_tier_multiplier,';
  value_marker text := 'coalesce((p_product ->> ''apply_tier_multiplier'')::boolean, true),';
  update_marker text := 'apply_tier_multiplier = coalesce((p_product ->> ''apply_tier_multiplier'')::boolean, apply_tier_multiplier),';
  lock_marker text := 'target_asset_key := existing_product.asset_key;';
  values_fragment text := '';
  update_fragment text := '';
  role_name text;
begin
  if position('instructor_price_multiplier' in definition) = 0 then
    if position(column_marker in definition)=0 or position(value_marker in definition)=0 or position(update_marker in definition)=0 or position(lock_marker in definition)=0 then
      raise exception 'Catalog-save definition differs; migration aborted without changes';
    end if;
    foreach role_name in array array['instructor','distributor','staff'] loop
      values_fragment := values_fragment || format(
        E'\n      case when p_product ? %L then nullif(p_product ->> %L, '''')::numeric else case when (p_product ->> ''apply_tier_multiplier'')::boolean is false then 1 else null end end,',
        role_name || '_price_multiplier', role_name || '_price_multiplier');
      update_fragment := update_fragment || format(
        E'\n      %I = case when p_product ? %L then nullif(p_product ->> %L, '''')::numeric else %I end,',
        role_name || '_price_multiplier', role_name || '_price_multiplier', role_name || '_price_multiplier', role_name || '_price_multiplier');
    end loop;
    definition := replace(definition, column_marker, column_marker || ' instructor_price_multiplier, distributor_price_multiplier, staff_price_multiplier,');
    definition := replace(definition, value_marker, value_marker || values_fragment);
    definition := replace(definition, update_marker, update_marker || update_fragment);
    definition := replace(definition, lock_marker, $check$
      if (p_product ?| array['instructor_price_multiplier','distributor_price_multiplier','staff_price_multiplier'])
        and not (p_product ? 'expected_pricing_overrides') then
        raise exception 'Original product pricing snapshot required; reload before saving' using errcode='22023';
      end if;
      if p_product ? 'expected_pricing_overrides' and
        jsonb_build_object('instructor',existing_product.instructor_price_multiplier,
          'distributor',existing_product.distributor_price_multiplier,'staff',existing_product.staff_price_multiplier)
        is distinct from p_product -> 'expected_pricing_overrides' then
        raise exception 'Product pricing changed; reload before saving' using errcode='40001';
      end if;
      target_asset_key := existing_product.asset_key;$check$);
    execute definition;
  end if;
end $migration$;

-- Extend the existing whitelist without losing permissions from other migrations.
do $permission_migration$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition
  from pg_constraint
  where conrelid='public.backoffice_role_permissions'::regclass
    and conname='backoffice_role_permissions_permission_check' and contype='c';
  if definition is null or definition not like 'CHECK (%)' then
    raise exception 'Expected backoffice permission whitelist constraint is missing';
  end if;
  if position('member_pricing.manage' in definition)=0 then
    alter table public.backoffice_role_permissions
      drop constraint backoffice_role_permissions_permission_check;
    execute 'alter table public.backoffice_role_permissions add constraint '
      || 'backoffice_role_permissions_permission_check CHECK (permission = ''member_pricing.manage'' OR '
      || substring(definition from 7) || ')';
  end if;
end $permission_migration$;

insert into public.backoffice_role_permissions(role,permission) values
  ('admin','member_pricing.manage'), ('super_admin','member_pricing.manage') on conflict do nothing;

create or replace function public.member_pricing_defaults()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_object_agg(role,professional_price_multiplier) from public.membership_tiers
  where role in ('instructor','distributor','staff') and active is true;
$$;
revoke all on function public.member_pricing_defaults() from public, anon, authenticated;

create or replace function public.get_admin_member_pricing()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_backoffice_permission('catalog.read') and not public.has_backoffice_permission('member_pricing.manage') then
    raise exception 'Member pricing read access required' using errcode='42501';
  end if;
  return jsonb_build_object('multipliers', public.member_pricing_defaults());
end $$;
revoke all on function public.get_admin_member_pricing() from public;
grant execute on function public.get_admin_member_pricing() to authenticated;

create or replace function public.save_member_pricing(p_multipliers jsonb, p_expected_multipliers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text; multiplier numeric; previous_values jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('member_pricing.manage') then
    raise exception 'Member pricing manage access required' using errcode='42501';
  end if;
  if p_multipliers is null or jsonb_typeof(p_multipliers) <> 'object'
    or (select count(*) from jsonb_object_keys(p_multipliers)) <> 3 then
    raise exception 'Exactly three pricing roles are required' using errcode='22023';
  end if;
  foreach role_name in array array['instructor','distributor','staff'] loop
    if jsonb_typeof(p_multipliers -> role_name) is distinct from 'number' then
      raise exception 'Each multiplier must be numeric' using errcode='22023';
    end if;
    multiplier := (p_multipliers ->> role_name)::numeric;
    if multiplier <= 0 or multiplier > 1 or multiplier <> round(multiplier,3) then
      raise exception 'Fold must be greater than 0, at most 10, with at most two decimal places' using errcode='22023';
    end if;
  end loop;
  -- Consistent lock order; atomic comparison/update across all three roles.
  perform 1 from public.membership_tiers where role in ('instructor','distributor','staff') order by role for update;
  previous_values := public.member_pricing_defaults();
  if previous_values is distinct from p_expected_multipliers then
    raise exception 'Pricing settings changed; reload before saving' using errcode='40001';
  end if;
  if (select count(*) from public.membership_tiers where role in ('instructor','distributor','staff') and active) <> 3 then
    raise exception 'Pricing roles are incomplete';
  end if;
  update public.membership_tiers set professional_price_multiplier=(p_multipliers ->> role)::numeric, updated_at=now()
  where role in ('instructor','distributor','staff') and professional_price_multiplier is distinct from (p_multipliers ->> role)::numeric;
  return jsonb_build_object('multipliers', public.member_pricing_defaults());
end $$;
revoke all on function public.save_member_pricing(jsonb,jsonb) from public;
grant execute on function public.save_member_pricing(jsonb,jsonb) to authenticated;
-- No new direct table write permission. Changes go through the guarded RPC.
revoke insert, update, delete on public.membership_tiers from anon, authenticated;

-- Catalog wrappers preserve current field redaction / event visibility.
-- Defaults travel in the SAME catalog response, preventing a separate stale fetch.
do $migration$
declare function_name text; internal_name text;
begin
  foreach function_name in array array['get_storefront_catalog','get_event_catalog','get_admin_catalog'] loop
    internal_name := function_name || '_before_member_pricing';
    if to_regprocedure('public.' || internal_name || '()') is null then
      execute format('alter function public.%I() rename to %I', function_name, internal_name);
    end if;
    execute format('revoke all on function public.%I() from public, anon, authenticated',internal_name);
    execute format($wrapper$
      create or replace function public.%I() returns jsonb language plpgsql stable security definer set search_path='' as $body$
      declare payload jsonb; defaults jsonb;
      begin
        payload := public.%I();
        defaults := public.member_pricing_defaults();
        if %L <> 'get_admin_catalog' then
          payload := jsonb_set(payload, '{variants}', coalesce((select jsonb_agg(item - array['procurement_unit_cost_usd','gift_enabled','gift_stock','gift_min_stock'] order by position) from jsonb_array_elements(payload -> 'variants') with ordinality entries(item,position)),'[]'::jsonb));
        end if;
        return jsonb_set(payload, '{products}', coalesce((select jsonb_agg(item || jsonb_build_object('pricing_defaults',defaults) order by position) from jsonb_array_elements(payload -> 'products') with ordinality entries(item,position)),'[]'::jsonb)) || jsonb_build_object('member_pricing_version',1,'pricing_defaults',defaults);
      end $body$;
    $wrapper$, function_name, internal_name, function_name);
    execute format('revoke all on function public.%I() from public',function_name);
    if function_name='get_admin_catalog' then
      execute format('grant execute on function public.%I() to authenticated',function_name);
    else
      execute format('grant execute on function public.%I() to anon, authenticated',function_name);
    end if;
  end loop;
end $migration$;

-- Wrap the installed projection instead of matching its source formatting.
-- Preserve all existing entity fields, including site-specific additions.
do $migration$
begin
  if to_regprocedure('public.audit_log_projection_before_member_pricing(text,jsonb)') is null then
    alter function public.audit_log_projection(text,jsonb)
      rename to audit_log_projection_before_member_pricing;
  end if;
end $migration$;
revoke all on function public.audit_log_projection_before_member_pricing(text,jsonb) from public, anon, authenticated;
create or replace function public.audit_log_projection(table_name text,row_data jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(public.audit_log_projection_before_member_pricing(table_name,row_data),'{}'::jsonb)
    || case table_name
      when 'products' then jsonb_build_object(
        'instructor_price_multiplier',row_data -> 'instructor_price_multiplier',
        'distributor_price_multiplier',row_data -> 'distributor_price_multiplier',
        'staff_price_multiplier',row_data -> 'staff_price_multiplier')
      when 'membership_tiers' then jsonb_build_object(
        'role',row_data -> 'role',
        'professional_price_multiplier',row_data -> 'professional_price_multiplier')
      else '{}'::jsonb end;
$$;
revoke all on function public.audit_log_projection(text,jsonb) from public, anon, authenticated;
drop trigger if exists trg_membership_tiers_pricing_audit on public.membership_tiers;
create trigger trg_membership_tiers_pricing_audit after update on public.membership_tiers
for each row execute function public.capture_admin_audit_log('role');

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='membership_tiers') then
    alter publication supabase_realtime add table public.membership_tiers;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;

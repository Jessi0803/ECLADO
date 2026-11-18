-- Apply after the installed activity editors and storefront display migration.
begin;

-- Public display projection. Pricing continues to read promotion_scopes.
alter table public.promotions
  add column if not exists storefront_variant_ids text[] not null default '{}';

create or replace function public.promotion_storefront_scope(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists(select 1 from public.promotion_scopes where promotion_id=p_id and scope_role='benefit' and mode='include' and target_type='all_sellable') then 'all_sellable'
    when exists(select 1 from public.promotion_scopes where promotion_id=p_id and scope_role='benefit' and mode='include' and target_type='all_regular') then 'all_regular'
    when exists(select 1 from public.promotion_scopes where promotion_id=p_id and scope_role='benefit' and mode='include' and target_type in ('product','variant')) then 'products'
    else null end;
$$;
revoke all on function public.promotion_storefront_scope(uuid) from public, anon, authenticated;

-- Extend the inner editor so scope writes stay inside the existing audited save,
-- including audience, gifts, student policy and label wrappers.
do $migration$
declare
  editor regprocedure := 'public.save_discount_promotion_before_audience_20261017(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(editor);
  anchor text;
  replacement text;
begin
  if position('storefront_variant_ids' in definition) > 0 then return; end if;

  foreach anchor in array array[
    'target_product_id integer;',
    $old$  if benefit not in ($old$,
    $old$  if scope_type='products' and jsonb_array_length(coalesce(p_payload->'product_ids','[]'::jsonb))=0 then raise exception 'Choose at least one product' using errcode='22023'; end if;$old$,
    '  return target_id;'
  ] loop
    if (length(definition)-length(replace(definition,anchor,''))) <> length(anchor) then
      raise exception 'Unexpected activity editor definition: %', anchor;
    end if;
    replacement := case anchor
      when 'target_product_id integer;' then anchor || $new$
  variant_ids bigint[] := '{}';$new$
      when $old$  if benefit not in ($old$ then $new$
  if scope_type='products_and_variants' then scope_type:='products'; end if;
  if benefit not in ($new$
      when '  return target_id;' then $new$
  insert into public.promotion_scopes(promotion_id,scope_role,target_type,product_variant_id)
  select target_id,role,'variant',variant_id
    from unnest(variant_ids) as variants(variant_id)
    cross join (values ('qualification'),('benefit')) as roles(role);
  update public.promotions set storefront_variant_ids=variant_ids::text[]
    where id=target_id and storefront_variant_ids is distinct from variant_ids::text[];
  return target_id;$new$
      else $new$
  -- Serialize scope replacement and the legacy-client check for this activity.
  perform 1 from public.promotions where id=target_id for update;
  if p_payload ? 'variant_ids' then
    if jsonb_typeof(p_payload->'variant_ids') is distinct from 'array' then
      raise exception 'Invalid promotion variant IDs' using errcode='22023';
    end if;
    if scope_type='products' then
      variant_ids := array(select distinct value::bigint
        from jsonb_array_elements_text(p_payload->'variant_ids') order by 1);
      if exists(select 1 from unnest(variant_ids) as selected(id)
        where not exists(select 1 from public.product_variants v where v.id=selected.id)) then
        raise exception 'Promotion variant not found' using errcode='22023';
      end if;
    elsif jsonb_array_length(p_payload->'variant_ids') > 0 then
      raise exception 'Variants require a specified product scope' using errcode='22023';
    end if;
  elsif exists(select 1 from public.promotion_scopes
    where promotion_id=target_id and target_type='variant') then
    raise exception 'Reload the activity editor before changing variant scopes' using errcode='22023';
  end if;
  if scope_type='products' and cardinality(variant_ids)=0
    and jsonb_array_length(coalesce(p_payload->'product_ids','[]'::jsonb))=0 then
    raise exception 'Choose at least one product or variant' using errcode='22023';
  end if;$new$
    end;
    definition := replace(definition,anchor,replacement);
  end loop;

  execute definition;
end
$migration$;

notify pgrst, 'reload schema';
commit;

-- ECLADO transactional product + variants admin save RPC (phase 2)
-- Run after:
--   1. supabase-core-rls-hardening.sql
--   2. supabase-product-variants-foundation.sql

create or replace function public.save_product_with_variants(
  p_product jsonb,
  p_variants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_product_id integer;
  requested_product_id integer;
  target_asset_key uuid;
  requested_asset_key uuid;
  existing_product public.products%rowtype;
  variant_input jsonb;
  variant_position bigint;
  variant_id bigint;
  saved_variant_ids bigint[] := '{}'::bigint[];
  seen_skus text[] := '{}'::text[];
  normalized_sku text;
  normalized_size text;
  normalized_price numeric;
  normalized_pro_price numeric;
  normalized_stock integer;
  normalized_active boolean;
  normalized_default boolean;
  normalized_custom_order boolean;
  normalized_procurement_unit_cost numeric;
  normalized_publication_status text;
  default_count integer := 0;
  default_variant public.product_variants%rowtype;
  response_variants jsonb;
begin
  if auth.uid() is null or not public.is_eclado_admin() then
    raise exception 'Administrator authorization required' using errcode = '42501';
  end if;

  if p_product is null or jsonb_typeof(p_product) <> 'object' then
    raise exception 'Product payload must be an object' using errcode = '22023';
  end if;
  if p_variants is null
    or jsonb_typeof(p_variants) <> 'array'
    or jsonb_array_length(p_variants) = 0
  then
    raise exception 'At least one product variant is required' using errcode = '22023';
  end if;

  if nullif(trim(p_product ->> 'name'), '') is null
    or nullif(trim(p_product ->> 'name_zh'), '') is null
    or nullif(trim(p_product ->> 'category'), '') is null
  then
    raise exception 'Product name, Chinese name and category are required' using errcode = '22023';
  end if;
  if p_product ? 'image_urls'
    and p_product -> 'image_urls' <> 'null'::jsonb
    and jsonb_typeof(p_product -> 'image_urls') <> 'array'
  then
    raise exception 'Product image_urls must be an array' using errcode = '22023';
  end if;
  if p_product ? 'features'
    and p_product -> 'features' <> 'null'::jsonb
    and jsonb_typeof(p_product -> 'features') <> 'array'
  then
    raise exception 'Product features must be an array' using errcode = '22023';
  end if;
  if nullif(p_product ->> 'product_list_image_scale', '') is not null
    and (
      (p_product ->> 'product_list_image_scale')::numeric < 0.1
      or (p_product ->> 'product_list_image_scale')::numeric > 3
    )
  then
    raise exception 'Product list image scale must be between 0.1 and 3' using errcode = '22023';
  end if;

  if nullif(trim(p_product ->> 'id'), '') is not null then
    begin
      requested_product_id := (p_product ->> 'id')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Product ID must be an integer' using errcode = '22023';
    end;
  end if;

  if nullif(trim(p_product ->> 'asset_key'), '') is not null then
    requested_asset_key := (p_product ->> 'asset_key')::uuid;
  end if;

  normalized_publication_status := case
    when p_product ? 'publication_status'
      then nullif(trim(p_product ->> 'publication_status'), '')
    when p_product ? 'active'
      then case when (p_product ->> 'active')::boolean then 'active' else 'archived' end
    else null
  end;
  if normalized_publication_status is not null
    and normalized_publication_status not in ('draft', 'active', 'archived')
  then
    raise exception 'Invalid product publication status' using errcode = '22023';
  end if;

  if requested_product_id is null then
    insert into public.products (
      asset_key, name, name_zh, subtitle, category, series, min_stock, is_pro_only,
      image_url, image_urls, description, skin_type, ingredients, features,
      source_folder_name, imported_from_drive, product_list_image_scale, publication_status, active,
      size, price, pro_price, stock, variants
    )
    values (
      coalesce(requested_asset_key, gen_random_uuid()),
      trim(p_product ->> 'name'),
      trim(p_product ->> 'name_zh'),
      nullif(trim(p_product ->> 'subtitle'), ''),
      trim(p_product ->> 'category'),
      nullif(trim(p_product ->> 'series'), ''),
      greatest(coalesce((p_product ->> 'min_stock')::integer, 3), 0),
      coalesce((p_product ->> 'is_pro_only')::boolean, false),
      nullif(trim(p_product ->> 'image_url'), ''),
      case
        when jsonb_typeof(p_product -> 'image_urls') = 'array' then p_product -> 'image_urls'
        else '[]'::jsonb
      end,
      coalesce(p_product ->> 'description', ''),
      coalesce(p_product ->> 'skin_type', ''),
      coalesce(p_product ->> 'ingredients', ''),
      case
        when jsonb_typeof(p_product -> 'features') = 'array' then p_product -> 'features'
        else '[]'::jsonb
      end,
      nullif(trim(p_product ->> 'source_folder_name'), ''),
      coalesce((p_product ->> 'imported_from_drive')::boolean, false),
      nullif(p_product ->> 'product_list_image_scale', '')::numeric,
      coalesce(normalized_publication_status, 'draft'),
      coalesce(normalized_publication_status, 'draft') = 'active',
      '', 0, 0, 0, '[]'::jsonb
    )
    returning id, asset_key into target_product_id, target_asset_key;
  else
    target_product_id := requested_product_id;

    select * into existing_product
    from public.products
    where id = target_product_id
    for update;

    if not found then
      raise exception 'Product % not found', target_product_id using errcode = 'P0002';
    end if;
    target_asset_key := existing_product.asset_key;
    normalized_publication_status := coalesce(
      normalized_publication_status,
      existing_product.publication_status
    );

    update public.products
    set
      name = trim(p_product ->> 'name'),
      name_zh = trim(p_product ->> 'name_zh'),
      subtitle = case
        when p_product ? 'subtitle' then nullif(trim(p_product ->> 'subtitle'), '')
        else subtitle
      end,
      category = trim(p_product ->> 'category'),
      series = case
        when p_product ? 'series' then nullif(trim(p_product ->> 'series'), '')
        else series
      end,
      min_stock = greatest(coalesce((p_product ->> 'min_stock')::integer, min_stock, 3), 0),
      is_pro_only = coalesce((p_product ->> 'is_pro_only')::boolean, is_pro_only),
      image_url = case
        when p_product ? 'image_url' then nullif(trim(p_product ->> 'image_url'), '')
        else image_url
      end,
      image_urls = case
        when jsonb_typeof(p_product -> 'image_urls') = 'array' then p_product -> 'image_urls'
        when p_product ? 'image_urls' then '[]'::jsonb
        else image_urls
      end,
      description = coalesce(p_product ->> 'description', description),
      skin_type = coalesce(p_product ->> 'skin_type', skin_type),
      ingredients = coalesce(p_product ->> 'ingredients', ingredients),
      features = case
        when jsonb_typeof(p_product -> 'features') = 'array' then p_product -> 'features'
        when p_product ? 'features' then '[]'::jsonb
        else features
      end,
      source_folder_name = case
        when p_product ? 'source_folder_name' then nullif(trim(p_product ->> 'source_folder_name'), '')
        else source_folder_name
      end,
      imported_from_drive = coalesce((p_product ->> 'imported_from_drive')::boolean, imported_from_drive),
      product_list_image_scale = case
        when p_product ? 'product_list_image_scale'
          then nullif(p_product ->> 'product_list_image_scale', '')::numeric
        else product_list_image_scale
      end,
      publication_status = normalized_publication_status,
      active = normalized_publication_status = 'active',
      updated_at = now()
    where id = target_product_id;
  end if;

  -- Validate every variant and collect existing IDs before writing anything.
  for variant_input, variant_position in
    select value, ordinality
    from jsonb_array_elements(p_variants) with ordinality
  loop
    if jsonb_typeof(variant_input) <> 'object' then
      raise exception 'Variant % must be an object', variant_position using errcode = '22023';
    end if;

    normalized_sku := nullif(trim(variant_input ->> 'sku'), '');
    normalized_size := nullif(trim(variant_input ->> 'size'), '');
    if normalized_sku is null or normalized_size is null then
      raise exception 'Variant % requires SKU and size', variant_position using errcode = '22023';
    end if;

    begin
      normalized_price := (variant_input ->> 'price')::numeric;
      normalized_pro_price := (variant_input ->> 'pro_price')::numeric;
      normalized_stock := (variant_input ->> 'stock')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Variant % has invalid price or stock', variant_position using errcode = '22023';
    end;

    if normalized_price < 0 or normalized_pro_price < 0 or normalized_stock < 0 then
      raise exception 'Variant % price and stock cannot be negative', variant_position using errcode = '22023';
    end if;

    if lower(normalized_sku) = any(seen_skus) then
      raise exception 'Duplicate SKU in request: %', normalized_sku using errcode = '23505';
    end if;
    seen_skus := array_append(seen_skus, lower(normalized_sku));

    normalized_default := coalesce((variant_input ->> 'is_default')::boolean, false);
    if normalized_default then
      default_count := default_count + 1;
    end if;

    variant_id := null;
    if coalesce(variant_input ->> 'id', '') ~ '^[0-9]+$' then
      variant_id := (variant_input ->> 'id')::bigint;
      if not exists (
        select 1
        from public.product_variants
        where id = variant_id
          and product_id = target_product_id
      ) then
        raise exception 'Variant % does not belong to product %', variant_id, target_product_id
          using errcode = '42501';
      end if;
      saved_variant_ids := array_append(saved_variant_ids, variant_id);
    end if;
  end loop;

  if default_count <> 1 then
    raise exception 'Exactly one default variant is required' using errcode = '23514';
  end if;

  -- Allow existing variants to exchange SKU values without transient conflicts.
  update public.product_variants
  set sku = '__pending__' || id
  where product_id = target_product_id
    and id = any(saved_variant_ids);

  for variant_input, variant_position in
    select value, ordinality
    from jsonb_array_elements(p_variants) with ordinality
  loop
    normalized_sku := trim(variant_input ->> 'sku');
    normalized_size := trim(variant_input ->> 'size');
    normalized_price := (variant_input ->> 'price')::numeric;
    normalized_pro_price := (variant_input ->> 'pro_price')::numeric;
    normalized_stock := (variant_input ->> 'stock')::integer;
    normalized_default := coalesce((variant_input ->> 'is_default')::boolean, false);
    normalized_active := coalesce((variant_input ->> 'active')::boolean, true);
    normalized_custom_order := coalesce((variant_input ->> 'is_custom_order')::boolean, false);
    normalized_procurement_unit_cost := nullif(variant_input ->> 'procurement_unit_cost_usd', '')::numeric;

    if normalized_procurement_unit_cost is not null and normalized_procurement_unit_cost < 0 then
      raise exception 'Procurement unit cost must be zero or greater' using errcode = '22023';
    end if;

    if coalesce(variant_input ->> 'id', '') ~ '^[0-9]+$' then
      variant_id := (variant_input ->> 'id')::bigint;
      update public.product_variants
      set
        sku = normalized_sku,
        size = normalized_size,
        price = normalized_price,
        pro_price = normalized_pro_price,
        stock = normalized_stock,
        is_default = normalized_default,
        is_custom_order = normalized_custom_order,
        procurement_unit_cost_usd = normalized_procurement_unit_cost,
        sort_order = greatest(coalesce((variant_input ->> 'sort_order')::integer, variant_position::integer - 1), 0),
        active = normalized_active,
        updated_at = now()
      where id = variant_id
        and product_id = target_product_id;
    else
      insert into public.product_variants (
        product_id, sku, size, price, pro_price, stock,
        is_default, is_custom_order, procurement_unit_cost_usd, sort_order, active
      )
      values (
        target_product_id, normalized_sku, normalized_size,
        normalized_price, normalized_pro_price, normalized_stock,
        normalized_default, normalized_custom_order, normalized_procurement_unit_cost,
        greatest(coalesce((variant_input ->> 'sort_order')::integer, variant_position::integer - 1), 0),
        normalized_active
      )
      returning id into variant_id;

      saved_variant_ids := array_append(saved_variant_ids, variant_id);
    end if;
  end loop;

  -- Missing rows are retained for historical references, but are no longer sellable.
  update public.product_variants
  set active = false, is_default = false, updated_at = now()
  where product_id = target_product_id
    and not (id = any(saved_variant_ids));

  select * into default_variant
  from public.product_variants
  where product_id = target_product_id
    and is_default is true
    and active is true;

  if not found then
    raise exception 'The default variant must be active' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', variant.id::text,
        'sku', variant.sku,
        'size', variant.size,
        'price', variant.price,
        'proPrice', variant.pro_price,
        'stock', variant.stock,
        'isDefault', variant.is_default,
        'isCustomOrder', variant.is_custom_order,
        'procurementUnitCostUsd', variant.procurement_unit_cost_usd,
        'sortOrder', variant.sort_order,
        'active', variant.active
      )
      order by variant.sort_order, variant.id
    ),
    '[]'::jsonb
  )
  into response_variants
  from public.product_variants variant
  where variant.product_id = target_product_id
    and variant.active is true;

  -- Transitional compatibility: legacy readers receive the same default and
  -- JSON data, while product_variants remains the source of truth for this RPC.
  update public.products
  set
    size = default_variant.size,
    price = default_variant.price,
    pro_price = default_variant.pro_price,
    stock = default_variant.stock,
    variants = response_variants,
    updated_at = now()
  where id = target_product_id;

  return jsonb_build_object(
    'product_id', target_product_id,
    'asset_key', target_asset_key,
    'default_variant_id', default_variant.id,
    'variants', response_variants
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Product payload contains an invalid number or boolean' using errcode = '22023';
end;
$$;

revoke all on function public.save_product_with_variants(jsonb, jsonb) from public;
grant execute on function public.save_product_with_variants(jsonb, jsonb) to authenticated;

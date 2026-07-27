-- ECLADO migrate legacy products.variants into product_variants (phase 3)
-- Run after:
--   1. supabase-product-variants-foundation.sql
--   2. supabase-save-product-with-variants.sql
--
-- Safe to rerun. Existing unmatched variants are deactivated, never deleted.

do $$
declare
  product_row public.products%rowtype;
  legacy_variant jsonb;
  variant_position bigint;
  matched_variant public.product_variants%rowtype;
  saved_variant_ids bigint[];
  explicit_default_count integer;
  default_assigned boolean;
  desired_default boolean;
  desired_sku text;
  desired_size text;
  desired_price numeric;
  desired_pro_price numeric;
  desired_stock integer;
  desired_active boolean;
  desired_sort_order integer;
  legacy_id text;
  migrated_variant_id bigint;
  response_variants jsonb;
  default_variant public.product_variants%rowtype;
begin
  for product_row in
    select *
    from public.products
    order by id
    for update
  loop
    saved_variant_ids := '{}'::bigint[];
    default_assigned := false;

    if jsonb_typeof(product_row.variants) = 'array'
      and jsonb_array_length(product_row.variants) > 0
    then
      select count(*)
      into explicit_default_count
      from jsonb_array_elements(product_row.variants) item
      where lower(coalesce(item ->> 'isDefault', item ->> 'is_default', 'false')) = 'true'
        and lower(coalesce(item ->> 'active', 'true')) <> 'false';

      -- Legacy JSON is the current admin source. Rows not represented in it are
      -- preserved for history, but removed from sale.
      update public.product_variants
      set active = false, is_default = false, updated_at = now()
      where product_id = product_row.id;

      for legacy_variant, variant_position in
        select value, ordinality
        from jsonb_array_elements(product_row.variants) with ordinality
      loop
        if jsonb_typeof(legacy_variant) <> 'object' then
          raise exception 'Product % variant % must be an object',
            product_row.id, variant_position using errcode = '22023';
        end if;

        legacy_id := nullif(trim(legacy_variant ->> 'id'), '');
        desired_size := coalesce(
          nullif(trim(legacy_variant ->> 'size'), ''),
          nullif(trim(product_row.size), ''),
          '規格 ' || variant_position
        );

        begin
          desired_price := greatest(
            coalesce(nullif(legacy_variant ->> 'price', '')::numeric, product_row.price, 0),
            0
          );
          desired_pro_price := greatest(
            coalesce(
              nullif(coalesce(legacy_variant ->> 'proPrice', legacy_variant ->> 'pro_price'), '')::numeric,
              product_row.pro_price,
              0
            ),
            0
          );
          desired_stock := greatest(
            coalesce(nullif(legacy_variant ->> 'stock', '')::integer, product_row.stock, 0),
            0
          );
          desired_sort_order := greatest(
            coalesce(
              nullif(coalesce(legacy_variant ->> 'sortOrder', legacy_variant ->> 'sort_order'), '')::integer,
              variant_position::integer - 1
            ),
            0
          );
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'Product % variant % has invalid price, stock or order',
            product_row.id, variant_position using errcode = '22023';
        end;

        desired_active := lower(coalesce(legacy_variant ->> 'active', 'true')) <> 'false';
        desired_default := desired_active and not default_assigned and (
          (
            explicit_default_count > 0
            and lower(coalesce(legacy_variant ->> 'isDefault', legacy_variant ->> 'is_default', 'false')) = 'true'
          )
          or (
            explicit_default_count = 0
            and variant_position = 1
          )
        );

        matched_variant := null;

        -- Prefer the stable numeric variant ID when legacy JSON already has one.
        if legacy_id ~ '^[0-9]+$' then
          if legacy_id::bigint = any(saved_variant_ids) then
            raise exception 'Product % repeats variant ID %',
              product_row.id, legacy_id using errcode = '23505';
          end if;
          select * into matched_variant
          from public.product_variants
          where id = legacy_id::bigint
            and product_id = product_row.id;
        end if;

        -- Older JSON IDs were often the capacity text. Match those by size.
        if matched_variant.id is null then
          select * into matched_variant
          from public.product_variants
          where product_id = product_row.id
            and lower(btrim(size)) = lower(desired_size)
            and not (id = any(saved_variant_ids))
          order by active desc, sort_order, id
          limit 1;
        end if;

        desired_sku := nullif(trim(legacy_variant ->> 'sku'), '');
        if desired_sku is null and matched_variant.id is not null then
          desired_sku := matched_variant.sku;
        end if;
        if desired_sku is null then
          desired_sku := 'P' || product_row.id || '-LEGACY-' || variant_position;
        end if;

        -- If SKU identifies an existing row more accurately, use that row.
        if matched_variant.id is null then
          select * into matched_variant
          from public.product_variants
          where product_id = product_row.id
            and lower(sku) = lower(desired_sku)
            and not (id = any(saved_variant_ids))
          order by id
          limit 1;
        end if;

        if matched_variant.id is not null then
          if exists (
            select 1
            from public.product_variants conflict
            where conflict.product_id = product_row.id
              and lower(conflict.sku) = lower(desired_sku)
              and conflict.id <> matched_variant.id
          ) then
            desired_sku := desired_sku || '-M' || variant_position;
          end if;

          update public.product_variants
          set
            sku = desired_sku,
            size = desired_size,
            price = desired_price,
            pro_price = desired_pro_price,
            stock = desired_stock,
            is_default = desired_default,
            sort_order = desired_sort_order,
            active = desired_active,
            updated_at = now()
          where id = matched_variant.id
          returning id into migrated_variant_id;
        else
          if exists (
            select 1
            from public.product_variants conflict
            where conflict.product_id = product_row.id
              and lower(conflict.sku) = lower(desired_sku)
          ) then
            desired_sku := desired_sku || '-M' || variant_position;
          end if;

          insert into public.product_variants (
            product_id, sku, size, price, pro_price, stock,
            is_default, sort_order, active
          )
          values (
            product_row.id, desired_sku, desired_size,
            desired_price, desired_pro_price, desired_stock,
            desired_default, desired_sort_order, desired_active
          )
          returning id into migrated_variant_id;
        end if;

        saved_variant_ids := array_append(saved_variant_ids, migrated_variant_id);
        if desired_default then
          default_assigned := true;
        end if;
      end loop;
    else
      -- A single-capacity product receives one real default variant.
      select * into matched_variant
      from public.product_variants
      where product_id = product_row.id
      order by is_default desc, active desc, sort_order, id
      limit 1;

      if matched_variant.id is null then
        insert into public.product_variants (
          product_id, sku, size, price, pro_price, stock,
          is_default, sort_order, active
        )
        values (
          product_row.id,
          'P' || product_row.id || '-DEFAULT',
          coalesce(nullif(trim(product_row.size), ''), '單一規格'),
          greatest(coalesce(product_row.price, 0), 0),
          greatest(coalesce(product_row.pro_price, 0), 0),
          greatest(coalesce(product_row.stock, 0), 0),
          true, 0, true
        )
        returning id into migrated_variant_id;
      else
        update public.product_variants
        set
          size = coalesce(nullif(trim(size), ''), nullif(trim(product_row.size), ''), '單一規格'),
          price = greatest(coalesce(price, product_row.price, 0), 0),
          pro_price = greatest(coalesce(pro_price, product_row.pro_price, 0), 0),
          stock = greatest(coalesce(stock, product_row.stock, 0), 0),
          is_default = true,
          active = true,
          sort_order = 0,
          updated_at = now()
        where id = matched_variant.id
        returning id into migrated_variant_id;

        update public.product_variants
        set active = false, is_default = false, updated_at = now()
        where product_id = product_row.id
          and id <> migrated_variant_id;
      end if;

      saved_variant_ids := array_append(saved_variant_ids, migrated_variant_id);
    end if;

    select * into default_variant
    from public.product_variants
    where product_id = product_row.id
      and is_default is true
      and active is true;

    if not found then
      -- If a legacy JSON explicitly disabled every row, activate the first row
      -- so the product still has one deterministic sellable default.
      select * into default_variant
      from public.product_variants
      where product_id = product_row.id
        and id = any(saved_variant_ids)
      order by sort_order, id
      limit 1;

      update public.product_variants
      set active = true, is_default = true, updated_at = now()
      where id = default_variant.id
      returning * into default_variant;
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
          'sortOrder', variant.sort_order,
          'active', variant.active
        )
        order by variant.sort_order, variant.id
      ),
      '[]'::jsonb
    )
    into response_variants
    from public.product_variants variant
    where variant.product_id = product_row.id
      and variant.active is true;

    update public.products
    set
      size = default_variant.size,
      price = default_variant.price,
      pro_price = default_variant.pro_price,
      stock = default_variant.stock,
      variants = response_variants,
      updated_at = now()
    where id = product_row.id;
  end loop;
end
$$;

-- Verification report: every product must have active variants and one default.
select
  product.id as product_id,
  product.name_zh,
  count(variant.id) filter (where variant.active is true) as active_variant_count,
  count(variant.id) filter (
    where variant.active is true and variant.is_default is true
  ) as active_default_count,
  bool_and(variant.price >= 0 and variant.pro_price >= 0 and variant.stock >= 0) as values_valid
from public.products product
left join public.product_variants variant on variant.product_id = product.id
group by product.id, product.name_zh
order by product.id;

-- This query must return zero rows.
select product_id
from public.product_variants
group by product_id
having count(*) filter (where active is true) = 0
   or count(*) filter (where active is true and is_default is true) <> 1;

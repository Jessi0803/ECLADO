-- ECLADO transactional product image metadata save RPC (phase 3)
-- Run after supabase-product-images-foundation.sql.

create or replace function public.save_product_images(
  p_product_id integer,
  p_images jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  product_row public.products%rowtype;
  image_input jsonb;
  image_position bigint;
  image_id uuid;
  saved_image_ids uuid[] := '{}'::uuid[];
  active_primary_count integer := 0;
  normalized_path text;
  normalized_active boolean;
  normalized_primary boolean;
  response_images jsonb;
begin
  if auth.role() <> 'service_role'
    and (auth.uid() is null or not public.has_backoffice_permission('catalog.write'))
  then
    raise exception 'Administrator authorization required' using errcode = '42501';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'Images payload must be an array' using errcode = '22023';
  end if;

  select * into product_row
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Product % not found', p_product_id using errcode = 'P0002';
  end if;

  for image_input, image_position in
    select value, ordinality
    from jsonb_array_elements(p_images) with ordinality
  loop
    normalized_path := nullif(trim(image_input ->> 'storage_path'), '');
    normalized_active := coalesce((image_input ->> 'active')::boolean, true);
    normalized_primary := coalesce((image_input ->> 'is_primary')::boolean, false);

    if normalized_path is null
      or split_part(normalized_path, '/', 1) <> 'products'
      or split_part(normalized_path, '/', 2) <> product_row.asset_key::text
    then
      raise exception 'Image % does not belong to product asset key', image_position
        using errcode = '22023';
    end if;
    if normalized_active and normalized_primary then
      active_primary_count := active_primary_count + 1;
    end if;

    if nullif(trim(image_input ->> 'id'), '') is not null then
      image_id := (image_input ->> 'id')::uuid;
      if image_id = any(saved_image_ids) then
        raise exception 'Image % is repeated in payload', image_id
          using errcode = '23505';
      end if;
      if not exists (
        select 1 from public.product_images
        where id = image_id and product_id = p_product_id
      ) then
        raise exception 'Image % does not belong to product %', image_id, p_product_id
          using errcode = '42501';
      end if;
      saved_image_ids := array_append(saved_image_ids, image_id);
    end if;
  end loop;

  if jsonb_array_length(p_images) > 0 and active_primary_count <> 1 then
    raise exception 'Product must have exactly one active primary image'
      using errcode = '22023';
  end if;

  -- Clear the previous primary first to avoid the partial unique index while
  -- another image becomes primary in the same transaction.
  update public.product_images
  set is_primary = false, updated_at = now()
  where product_id = p_product_id;

  update public.product_images
  set active = false, is_primary = false, updated_at = now()
  where product_id = p_product_id
    and not (id = any(saved_image_ids));

  for image_input, image_position in
    select value, ordinality
    from jsonb_array_elements(p_images) with ordinality
  loop
    normalized_path := trim(image_input ->> 'storage_path');
    normalized_active := coalesce((image_input ->> 'active')::boolean, true);
    normalized_primary := normalized_active
      and coalesce((image_input ->> 'is_primary')::boolean, false);

    if nullif(trim(image_input ->> 'id'), '') is not null then
      image_id := (image_input ->> 'id')::uuid;
      update public.product_images
      set
        storage_path = normalized_path,
        original_name = coalesce(image_input ->> 'original_name', original_name),
        alt_text = coalesce(image_input ->> 'alt_text', alt_text),
        sort_order = image_position::integer - 1,
        is_primary = normalized_primary,
        active = normalized_active,
        mime_type = nullif(image_input ->> 'mime_type', ''),
        file_size = nullif(image_input ->> 'file_size', '')::integer,
        width = nullif(image_input ->> 'width', '')::integer,
        height = nullif(image_input ->> 'height', '')::integer,
        updated_at = now()
      where id = image_id and product_id = p_product_id;
    else
      insert into public.product_images (
        product_id, storage_path, original_name, alt_text, sort_order,
        is_primary, active, mime_type, file_size, width, height
      )
      values (
        p_product_id,
        normalized_path,
        coalesce(image_input ->> 'original_name', ''),
        coalesce(image_input ->> 'alt_text', ''),
        image_position::integer - 1,
        normalized_primary,
        normalized_active,
        nullif(image_input ->> 'mime_type', ''),
        nullif(image_input ->> 'file_size', '')::integer,
        nullif(image_input ->> 'width', '')::integer,
        nullif(image_input ->> 'height', '')::integer
      );
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', image.id,
        'storage_path', image.storage_path,
        'original_name', image.original_name,
        'alt_text', image.alt_text,
        'sort_order', image.sort_order,
        'is_primary', image.is_primary,
        'active', image.active,
        'mime_type', image.mime_type,
        'file_size', image.file_size,
        'width', image.width,
        'height', image.height
      )
      order by image.sort_order, image.id
    ),
    '[]'::jsonb
  )
  into response_images
  from public.product_images image
  where image.product_id = p_product_id
    and image.active is true;

  return jsonb_build_object(
    'product_id', p_product_id,
    'asset_key', product_row.asset_key,
    'images', response_images
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Image payload contains an invalid UUID or number'
      using errcode = '22023';
end;
$$;

revoke all on function public.save_product_images(integer, jsonb) from public;
grant execute on function public.save_product_images(integer, jsonb) to authenticated;
grant execute on function public.save_product_images(integer, jsonb) to service_role;

-- Member cart identifiers only; never authoritative for pricing or checkout.
begin;
create table if not exists public.member_carts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.member_cart_operations (
  user_id uuid not null references public.member_carts(user_id) on delete cascade,
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.member_carts enable row level security;
alter table public.member_cart_operations enable row level security;
revoke all on public.member_carts, public.member_cart_operations from public, anon, authenticated;

create or replace function public.sync_my_cart(
  p_member_id uuid,
  p_operation_id uuid default null,
  p_mode text default 'patch',
  p_items jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.member_carts%rowtype;
  item jsonb;
  clean jsonb;
  item_map jsonb := '{}'::jsonb;
  next_items jsonb;
  item_key text;
  quantity integer;
begin
  -- Expected identity prevents requests queued for A from executing as B.
  if auth.uid() is null or p_member_id is distinct from auth.uid() then
    raise exception 'Cart owner mismatch' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('patch', 'merge', 'consume')
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 200 or octet_length(p_items::text) > 100000
    or (p_operation_id is null and p_items <> '[]'::jsonb) then
    raise exception 'Invalid cart operation' using errcode = '22023';
  end if;
  insert into public.member_carts(user_id) values (auth.uid()) on conflict do nothing;
  select * into saved from public.member_carts where user_id = auth.uid() for update;
  if p_operation_id is not null and not exists (
    select 1 from public.member_cart_operations
    where user_id = auth.uid() and operation_id = p_operation_id
  ) then
    for item in select value from jsonb_array_elements(saved.items) loop
      item_map := jsonb_set(item_map, array[(item->>'id') || ':' || (item->>'variantId')], item);
    end loop;
    for item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(item) <> 'object'
        or coalesce(item->>'id', '') !~ '^[1-9][0-9]{0,14}$'
        or coalesce(item->>'qty', '') !~ '^[0-9]{1,2}$'
        or jsonb_typeof(item->'variantId') is distinct from 'string'
        or char_length(item->>'variantId') > 200 then
        raise exception 'Invalid cart item' using errcode = '22023';
      end if;
      quantity := (item->>'qty')::integer;
      if p_mode <> 'patch' and quantity = 0 then
        raise exception 'Invalid cart item' using errcode = '22023';
      end if;
      item_key := (item->>'id') || ':' || (item->>'variantId');
      clean := jsonb_build_object('id', (item->>'id')::bigint,
        'variantId', item->>'variantId', 'qty', quantity);
      if item->'recommendationOnly' = 'true'::jsonb then
        clean := clean || '{"recommendationOnly":true}'::jsonb;
      end if;
      if p_mode = 'consume' then
        if not item_map ? item_key then continue; end if;
        quantity := greatest(0, (item_map->item_key->>'qty')::integer - quantity);
        clean := jsonb_set(item_map->item_key, '{qty}', to_jsonb(quantity));
      elsif p_mode = 'merge' and item_map ? item_key then
        clean := jsonb_set(clean, '{qty}', to_jsonb(greatest(quantity, (item_map->item_key->>'qty')::integer)));
        if coalesce(item_map->item_key->'recommendationOnly', 'false'::jsonb) <> 'true'::jsonb then
          clean := clean - 'recommendationOnly';
        end if;
      end if;
      if quantity = 0 then item_map := item_map - item_key;
      else item_map := jsonb_set(item_map, array[item_key], clean);
      end if;
    end loop;
    if (select count(*) from jsonb_each(item_map)) > 200 then
      raise exception 'Cart supports at most 200 items' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(value order by key), '[]'::jsonb) into next_items from jsonb_each(item_map);
    if next_items is distinct from saved.items then
      update public.member_carts set items = next_items, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() returning * into saved;
    end if;
    insert into public.member_cart_operations(user_id, operation_id) values (auth.uid(), p_operation_id);
  end if;
  return jsonb_build_object('items', saved.items, 'revision', saved.revision, 'updated_at', saved.updated_at);
end;
$$;
revoke all on function public.sync_my_cart(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.sync_my_cart(uuid, uuid, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

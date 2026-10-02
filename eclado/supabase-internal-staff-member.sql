-- ECLADO internal staff member role.
-- Run this migration before deploying the frontend that exposes the staff role.
-- Staff pricing is 50% of professional price when tier multipliers are enabled.
-- Staff can buy professional products, always receives free shipping, and is
-- deliberately excluded from professional minimum-order and combined-shipping rules.

begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('consumer', 'pro', 'instructor', 'distributor', 'staff', 'pending'));

alter table public.orders
  drop constraint if exists orders_type_check;
alter table public.orders
  add constraint orders_type_check
  check (type in ('consumer', 'pro', 'instructor', 'distributor', 'staff', 'pending'));

insert into public.membership_tiers (
  role, label, professional_price_multiplier, can_buy_pro_products, active
) values (
  'staff', '內部人員', 0.50, true, true
)
on conflict (role) do update set
  label = excluded.label,
  professional_price_multiplier = excluded.professional_price_multiplier,
  can_buy_pro_products = excluded.can_buy_pro_products,
  active = excluded.active,
  updated_at = now();

-- Existing coupons keep their current audiences. The expanded constraint only
-- allows an administrator to explicitly include staff in a campaign.
alter table public.coupon_campaigns
  drop constraint if exists coupon_campaigns_audience_check,
  drop constraint if exists coupon_campaigns_audience_mode_check;
alter table public.coupon_campaigns
  add constraint coupon_campaigns_audience_mode_check check (
    (
      audience_mode = 'roles'
      and cardinality(audience_roles) > 0
      and audience_roles <@ array['consumer', 'pro', 'instructor', 'distributor', 'staff']::text[]
    )
    or (
      audience_mode = 'members'
      and cardinality(audience_roles) = 0
      and allow_guest is false
    )
  );

-- All current quote engines fall back to this function for roles that do not
-- use the professional shipping threshold. Reading the authenticated role here
-- makes staff shipping authoritative without admitting staff to shipping groups.
create or replace function public.calculate_order_shipping(p_items jsonb)
returns numeric
language sql
stable
strict
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role = 'staff'
    ) then 0::numeric
    when jsonb_array_length(p_items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(p_items) item
        where (item ->> 'product_id')::integer <> 9
      )
    then 0::numeric
    else 120::numeric
  end;
$$;
revoke all on function public.calculate_order_shipping(jsonb) from public;

-- The current role-change RPC remains the only admin path. Staff never creates
-- a quarterly instructor/distributor membership row.
create or replace function public.set_member_role_with_membership(
  p_member_id uuid,
  p_role text,
  p_effective_on date default null,
  p_change_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
  effective_on date := coalesce(p_effective_on, (now() at time zone 'Asia/Taipei')::date);
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_role not in ('consumer', 'pro', 'instructor', 'distributor', 'staff', 'pending') then
    raise exception 'Invalid member role' using errcode = '22023';
  end if;
  if effective_on > (now() at time zone 'Asia/Taipei')::date then
    raise exception 'Effective date cannot be in the future' using errcode = '22023';
  end if;

  select * into target_profile
  from public.profiles
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if target_profile.role = p_role then
    return jsonb_build_object('member_id', p_member_id, 'role', p_role, 'changed', false);
  end if;

  delete from public.professional_memberships membership
  where membership.user_id = p_member_id
    and membership.ended_on is null
    and membership.started_on >= effective_on
    and not exists (
      select 1
      from public.professional_sales_adjustments adjustment
      where adjustment.membership_id = membership.id
    );

  update public.professional_memberships
  set ended_on = greatest(effective_on, started_on),
      change_reason = coalesce(nullif(btrim(p_change_reason), ''), change_reason)
  where user_id = p_member_id
    and ended_on is null;

  if p_role in ('instructor', 'distributor') then
    insert into public.professional_memberships (
      user_id, role, started_on, created_by, change_reason
    ) values (
      p_member_id,
      p_role,
      effective_on,
      auth.uid(),
      nullif(btrim(p_change_reason), '')
    );
  end if;

  update public.profiles
  set role = p_role
  where id = p_member_id;

  return jsonb_build_object(
    'member_id', p_member_id,
    'previous_role', target_profile.role,
    'role', p_role,
    'effective_on', effective_on,
    'changed', true
  );
end;
$$;
revoke all on function public.set_member_role_with_membership(uuid, text, date, text) from public, anon;
grant execute on function public.set_member_role_with_membership(uuid, text, date, text) to authenticated;

-- Catalog RPCs expose professional prices and professional-only products to
-- staff while continuing to minimize stock and internal product data.
create or replace function public.get_storefront_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer') into viewer_role
    from public.profiles profile where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor', 'staff');
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array['min_stock','pro_price','stock','variants','created_at','updated_at'])
        || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        ) order by product.id
      ) from public.products product
      where product.publication_status='active' and product.active=true
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku','pro_price','stock','gift_enabled','gift_stock','gift_min_stock','created_at','updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        ) order by variant.product_id,variant.sort_order,variant.id
      ) from public.product_variants variant
      join public.products product on product.id=variant.product_id
      where variant.active=true and product.publication_status='active' and product.active=true
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',image.id,'product_id',image.product_id,'storage_path',image.storage_path,
        'alt_text',image.alt_text,'sort_order',image.sort_order,'is_primary',image.is_primary,'active',image.active
      ) order by image.product_id,image.sort_order,image.id)
      from public.product_images image
      join public.products product on product.id=image.product_id
      where image.active=true and product.publication_status='active' and product.active=true
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;
revoke all on function public.get_storefront_catalog() from public;
grant execute on function public.get_storefront_catalog() to anon, authenticated;

create or replace function public.get_event_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer') into viewer_role
    from public.profiles profile where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor', 'staff');
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array['min_stock','pro_price','stock','variants','created_at','updated_at'])
        || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        ) order by product.id
      ) from public.products product where product.publication_status='event_only'
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku','pro_price','stock','gift_enabled','gift_stock','gift_min_stock','created_at','updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        ) order by variant.product_id,variant.sort_order,variant.id
      ) from public.product_variants variant
      join public.products product on product.id=variant.product_id
      where variant.active=true and product.publication_status='event_only'
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',image.id,'product_id',image.product_id,'storage_path',image.storage_path,
        'alt_text',image.alt_text,'sort_order',image.sort_order,'is_primary',image.is_primary,'active',image.active
      ) order by image.product_id,image.sort_order,image.id)
      from public.product_images image
      join public.products product on product.id=image.product_id
      where image.active=true and product.publication_status='event_only'
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;
revoke all on function public.get_event_catalog() from public;
grant execute on function public.get_event_catalog() to anon, authenticated;

commit;

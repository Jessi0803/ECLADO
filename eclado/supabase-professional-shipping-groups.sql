-- ECLADO professional additional orders and combined shipping.
-- Run after the current promotion/gift, invoice and shopping-credit migrations.
--
-- DEPLOYMENT: this migration changes live pricing and order triggers immediately.
-- Run it during a low-traffic release window, then deploy the matching application
-- code immediately. Do not leave production on this migration with the old UI.
--
-- Existing orders remain independent. A shipping group only records the
-- customer/warehouse relationship between orders that will leave together.

begin;

create table if not exists public.shipping_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'open' check (status in ('open', 'locked')),
  fulfillment_method text not null default 'delivery'
    check (fulfillment_method = 'delivery'),
  original_order_id text not null unique,
  original_shipping_amount bigint not null default 0
    check (original_shipping_amount >= 0),
  shipping_refund_ledger_id bigint,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  shipping_refunded_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'open' and locked_at is null)
    or (status = 'locked' and locked_at is not null)
  )
);

alter table public.orders
  add column if not exists shipping_group_id uuid
    references public.shipping_groups(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shipping_groups_original_order_fk'
      and conrelid = 'public.shipping_groups'::regclass
  ) then
    alter table public.shipping_groups
      add constraint shipping_groups_original_order_fk
      foreign key (original_order_id) references public.orders(id)
      on delete restrict;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shipping_groups_refund_ledger_fk'
      and conrelid = 'public.shipping_groups'::regclass
  ) then
    alter table public.shipping_groups
      add constraint shipping_groups_refund_ledger_fk
      foreign key (shipping_refund_ledger_id)
      references public.shopping_credit_ledger(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists shipping_groups_user_status_idx
  on public.shipping_groups (user_id, status, created_at desc);
create index if not exists orders_shipping_group_idx
  on public.orders (shipping_group_id, created_at, id)
  where shipping_group_id is not null;
create unique index if not exists shopping_credit_shipping_refund_unique_idx
  on public.shopping_credit_ledger ((metadata ->> 'shipping_group_id'))
  where reason_code = 'shipping_refund'
    and metadata ? 'shipping_group_id';

alter table public.shipping_groups enable row level security;
revoke all on table public.shipping_groups from anon, authenticated;

create or replace function public.is_professional_shipping_role(p_role text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_role, '') in ('pro', 'instructor', 'distributor');
$$;
revoke all on function public.is_professional_shipping_role(text) from public, anon, authenticated;

create or replace function public.is_shipping_group_valid_order_status(p_status text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_status, '') in (
    'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
  );
$$;
revoke all on function public.is_shipping_group_valid_order_status(text) from public, anon, authenticated;

create or replace function public.shipping_group_effective_amount(p_order public.orders)
returns numeric
language sql
immutable
parallel safe
as $$
  select greatest(0, coalesce(p_order.subtotal, 0) - coalesce(p_order.discount, 0));
$$;
revoke all on function public.shipping_group_effective_amount(public.orders) from public, anon, authenticated;

create or replace function public.get_my_appendable_shipping_group()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  member_role text;
  group_count integer;
  target_group public.shipping_groups%rowtype;
  effective_total numeric;
  valid_order_count integer;
  pending_order_count integer;
  legacy_candidate_count integer;
  legacy_order_id text;
  legacy_order public.orders%rowtype;
  created_group_id uuid;
begin
  if current_user_id is null then
    return null;
  end if;

  select profile.role into member_role
  from public.profiles profile
  where profile.id = current_user_id;

  if not public.is_professional_shipping_role(member_role) then
    return null;
  end if;

  -- Safe lazy compatibility for a single pre-migration paid order. Multiple
  -- candidates are deliberately not guessed or merged.
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  if not exists (
    select 1 from public.shipping_groups existing_group
    where existing_group.user_id = current_user_id
      and existing_group.status = 'open'
  ) then
    select count(*), min(target_order.id)
    into legacy_candidate_count, legacy_order_id
    from public.orders target_order
    where target_order.user_id = current_user_id
      and target_order.shipping_group_id is null
      and target_order.fulfillment_method = 'delivery'
      and target_order.status = 'paid'
      and public.shipping_group_effective_amount(target_order) >= 5000;

    if legacy_candidate_count > 1 then
      raise exception '此會員有多張可追加的舊訂單，請聯繫客服確認出貨批次'
        using errcode = '55000';
    elsif legacy_candidate_count = 1 then
      select * into legacy_order
      from public.orders target_order
      where target_order.id = legacy_order_id
      for update;

      insert into public.shipping_groups (
        user_id, status, fulfillment_method, original_order_id,
        original_shipping_amount
      ) values (
        current_user_id, 'open', 'delivery', legacy_order.id,
        floor(greatest(0, coalesce((legacy_order.pricing_snapshot ->> 'shipping')::numeric, 0)))::bigint
      )
      returning id into created_group_id;

      perform set_config('app.eclado_shipping_group_write', '1', true);
      update public.orders
      set shipping_group_id = created_group_id
      where id = legacy_order.id
        and shipping_group_id is null;
      perform set_config('app.eclado_shipping_group_write', '0', true);
    end if;
  end if;

  select count(*) into group_count
  from public.shipping_groups shipping_group
  where shipping_group.user_id = current_user_id
    and shipping_group.status = 'open'
    and exists (
      select 1
      from public.orders target_order
      where target_order.shipping_group_id = shipping_group.id
        and public.is_shipping_group_valid_order_status(target_order.status)
    );

  if group_count > 1 then
    raise exception '此會員有多個可追加出貨批次，請聯繫客服確認'
      using errcode = '55000';
  end if;
  if group_count = 0 then
    return null;
  end if;

  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.user_id = current_user_id
    and shipping_group.status = 'open'
    and exists (
      select 1
      from public.orders target_order
      where target_order.shipping_group_id = shipping_group.id
        and public.is_shipping_group_valid_order_status(target_order.status)
    )
  order by shipping_group.created_at, shipping_group.id
  limit 1;

  select
    coalesce(sum(
      case
        when public.is_shipping_group_valid_order_status(target_order.status)
          then public.shipping_group_effective_amount(target_order)
        else 0
      end
    ), 0),
    count(*) filter (
      where public.is_shipping_group_valid_order_status(target_order.status)
    ),
    count(*) filter (
      where target_order.status in ('awaiting_confirm', 'unpaid')
    )
  into effective_total, valid_order_count, pending_order_count
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id;

  return jsonb_build_object(
    'id', target_group.id,
    'status', target_group.status,
    'original_order_id', target_group.original_order_id,
    'original_shipping_amount', target_group.original_shipping_amount,
    'effective_total', effective_total,
    'valid_order_count', valid_order_count,
    'pending_order_count', pending_order_count,
    'free_shipping', effective_total >= 15000,
    'shipping_refunded', target_group.shipping_refund_ledger_id is not null
  );
end;
$$;
revoke all on function public.get_my_appendable_shipping_group() from public, anon;
grant execute on function public.get_my_appendable_shipping_group() to authenticated;

create or replace function public.quote_order_pricing_discount_v2(
  p_items jsonb,
  p_fulfillment_method text,
  p_coupon_code text,
  p_guest_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  base_quote jsonb;
  pricing_lines jsonb;
  member_role text;
  subtotal_amount numeric;
  automatic_discount numeric := 0;
  automatic_id uuid;
  automatic_name text;
  automatic_type text;
  automatic_eligible_subtotal numeric;
  automatic_qualification_subtotal numeric;
  automatic_qualification_quantity numeric;
  automatic_threshold_type text := 'amount';
  automatic_threshold_value numeric;
  legacy_discount numeric;
  legacy_id uuid;
  legacy_name text;
  candidate record;
  activity record;
  qualification_subtotal numeric;
  qualification_quantity numeric;
  eligible_subtotal numeric;
  activity_discount numeric;
  total_discount numeric := 0;
  shipping_amount numeric;
  total_amount numeric;
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
  campaign public.coupon_campaigns%rowtype;
  coupon_adjustments jsonb := '[]'::jsonb;
  automatic_adjustments jsonb := '[]'::jsonb;
  all_adjustments jsonb := '[]'::jsonb;
  current_user_id uuid := auth.uid();
  guest_hash text;
  active_usage integer;
  identity_usage integer;
  normalized_fulfillment text := coalesce(nullif(btrim(p_fulfillment_method), ''), 'delivery');
  shipping_group_context jsonb;
  appendable_group_id uuid;
  is_additional_order boolean := false;
  effective_merchandise_amount numeric;
begin
  base_quote := public.quote_order_pricing(p_items, normalized_fulfillment);
  pricing_lines := base_quote -> 'items';
  member_role := base_quote ->> 'member_role';
  subtotal_amount := (base_quote ->> 'subtotal')::numeric;
  legacy_discount := coalesce((base_quote ->> 'discount')::numeric, 0);
  legacy_id := nullif(base_quote ->> 'promotion_id', '')::uuid;
  legacy_name := base_quote ->> 'promotion_name';

  -- Add a non-rounded remaining amount to each line. It is only an internal
  -- calculation field and is removed before returning the quote.
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'remaining_total', (item ->> 'line_total')::numeric
  )), '[]'::jsonb)
  into pricing_lines
  from jsonb_array_elements(pricing_lines) item;

  -- Compare every atomic automatic discount against the legacy winner. Only
  -- one automatic price discount may win, preserving the site's prior rule.
  automatic_discount := legacy_discount;
  automatic_id := legacy_id;
  automatic_name := legacy_name;
  automatic_type := case when legacy_id is not null then 'legacy_discount' end;
  automatic_eligible_subtotal := coalesce(
    (base_quote #>> '{pricing_snapshot,promotion,eligible_subtotal}')::numeric,
    subtotal_amount
  );
  automatic_qualification_subtotal := subtotal_amount;
  automatic_qualification_quantity := (
    select coalesce(sum((item ->> 'qty')::numeric), 0)
    from jsonb_array_elements(pricing_lines) item
  );

  for candidate in
    select promotion.*
    from public.promotions promotion
    where promotion.active = true
      and promotion.activation_type = 'automatic'
      and promotion.benefit_type in ('percentage_discount', 'fixed_discount')
      and promotion.archived_at is null
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
    order by promotion.priority asc, promotion.created_at asc, promotion.id asc
  loop
    select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into qualification_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');

    select coalesce(sum((item ->> 'qty')::numeric), 0)
      into qualification_quantity
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');

    select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into eligible_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'benefit');

    if (case when candidate.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end) > 0
      and eligible_subtotal > 0
      and (candidate.threshold_value is null or case
        when candidate.threshold_type = 'quantity' then qualification_quantity
        else qualification_subtotal
      end >= candidate.threshold_value)
    then
      activity_discount := case candidate.benefit_type
        when 'percentage_discount' then round(eligible_subtotal * (1 - candidate.discount_rate))
        when 'fixed_discount' then least(eligible_subtotal, candidate.discount_amount)
        else 0
      end;
      activity_discount := least(greatest(coalesce(activity_discount, 0), 0), eligible_subtotal);

      if activity_discount > automatic_discount then
        automatic_discount := activity_discount;
        automatic_id := candidate.id;
        automatic_name := candidate.name;
        automatic_type := candidate.benefit_type;
        automatic_eligible_subtotal := eligible_subtotal;
        automatic_qualification_subtotal := qualification_subtotal;
        automatic_qualification_quantity := qualification_quantity;
        automatic_threshold_type := candidate.threshold_type;
        automatic_threshold_value := candidate.threshold_value;
      end if;
    end if;
  end loop;

  if automatic_id is not null and automatic_discount > 0 then
    automatic_adjustments := jsonb_build_array(jsonb_build_object(
      'promotion_id', automatic_id,
      'coupon_campaign_id', null,
      'adjustment_type', automatic_type,
      'name', automatic_name,
      'amount', automatic_discount,
      'sort_order', 0,
      'qualification', jsonb_build_object(
        'basis', automatic_threshold_type,
        'value', case when automatic_threshold_type = 'quantity' then automatic_qualification_quantity else automatic_qualification_subtotal end,
        'subtotal', automatic_qualification_subtotal,
        'quantity', automatic_qualification_quantity,
        'threshold', automatic_threshold_value
      )
    ));
  end if;

  if normalized_code <> '' then
    select * into campaign
    from public.coupon_campaigns target
    where target.code_normalized = normalized_code
      and target.active = true
      and target.archived_at is null
      and (target.start_at is null or target.start_at <= now())
      and (target.end_at is null or target.end_at > now());

    if not found
      or not public.coupon_campaign_allows_identity(campaign.id, member_role)
    then
      raise exception '優惠碼無效或目前無法使用' using errcode = '22023';
    end if;

    if current_user_id is null then
      if nullif(lower(btrim(coalesce(p_guest_email, ''))), '') is null then
        raise exception '訪客使用優惠碼時需先填寫 Email' using errcode = '22023';
      end if;
      guest_hash := encode(digest(lower(btrim(p_guest_email)), 'sha256'), 'hex');
    end if;

    select count(*) into active_usage
    from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()));

    select count(*) into identity_usage
    from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()))
      and ((current_user_id is not null and redemption.user_id = current_user_id)
        or (current_user_id is null and redemption.guest_identity_hash = guest_hash));

    if campaign.total_usage_limit is not null and active_usage >= campaign.total_usage_limit then
      raise exception '優惠碼已達使用上限' using errcode = '22023';
    end if;
    if campaign.per_member_limit is not null and identity_usage >= campaign.per_member_limit then
      raise exception '此優惠碼已達個人使用上限' using errcode = '22023';
    end if;

    -- coupon_only and allow_auto_gifts both suppress automatic price discounts.
    -- allow_auto_gifts becomes observably different once the gift batch lands.
    if campaign.stacking_policy <> 'allow_all' then
      automatic_discount := 0;
      automatic_id := null;
      automatic_name := null;
      automatic_type := null;
      automatic_adjustments := '[]'::jsonb;
    else
      -- Reduce all lines proportionally for the automatic winner so subsequent
      -- coupon activities calculate from the remaining payable merchandise.
      if automatic_discount > 0 then
        select coalesce(jsonb_agg(case
          when (
            automatic_type = 'legacy_discount'
            and (item ->> 'product_id')::integer = any(
              (select product_ids from public.promotions where id = automatic_id)
            )
          ) or (
            automatic_type in ('percentage_discount', 'fixed_discount')
            and public.promotion_item_matches_scope(automatic_id, item, 'benefit')
          ) then item || jsonb_build_object(
            'remaining_total', greatest(0,
              (item ->> 'remaining_total')::numeric
              - automatic_discount * (item ->> 'remaining_total')::numeric
                / nullif(automatic_eligible_subtotal, 0)
            )
          )
          else item
        end), '[]'::jsonb) into pricing_lines
        from jsonb_array_elements(pricing_lines) item;
      end if;
    end if;

    for activity in
      select promotion.*, link.sort_order as bundle_sort_order
      from public.coupon_promotions link
      join public.promotions promotion on promotion.id = link.promotion_id
      where link.coupon_campaign_id = campaign.id
        and promotion.active = true
        and promotion.activation_type = 'coupon_only'
        and promotion.benefit_type in ('percentage_discount', 'fixed_discount')
        and promotion.archived_at is null
        and (promotion.start_at is null or promotion.start_at <= now())
        and (promotion.end_at is null or promotion.end_at > now())
      order by link.sort_order asc, link.id asc
    loop
      select coalesce(sum(case
        when activity.threshold_basis = 'after_bundle_discount'
          then (item ->> 'remaining_total')::numeric
        else (item ->> 'line_total')::numeric
      end), 0)
      into qualification_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(activity.id, item, 'qualification');

      select coalesce(sum((item ->> 'qty')::numeric), 0)
        into qualification_quantity
        from jsonb_array_elements(pricing_lines) item
        where public.promotion_item_matches_scope(activity.id, item, 'qualification');

      select coalesce(sum((item ->> 'remaining_total')::numeric), 0)
        into eligible_subtotal
        from jsonb_array_elements(pricing_lines) item
        where public.promotion_item_matches_scope(activity.id, item, 'benefit');

      if (case when activity.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end) > 0
        and eligible_subtotal > 0
        and (activity.threshold_value is null or case
          when activity.threshold_type = 'quantity' then qualification_quantity
          else qualification_subtotal
        end >= activity.threshold_value)
      then
        activity_discount := case activity.benefit_type
          when 'percentage_discount' then round(eligible_subtotal * (1 - activity.discount_rate))
          when 'fixed_discount' then least(eligible_subtotal, activity.discount_amount)
          else 0
        end;
        activity_discount := least(greatest(coalesce(activity_discount, 0), 0), eligible_subtotal);

        if activity_discount > 0 then
          coupon_adjustments := coupon_adjustments || jsonb_build_array(jsonb_build_object(
            'promotion_id', activity.id,
            'coupon_campaign_id', campaign.id,
            'adjustment_type', activity.benefit_type,
            'name', activity.name,
            'amount', activity_discount,
            'sort_order', activity.bundle_sort_order + 1,
            'qualification', jsonb_build_object(
              'basis', activity.threshold_type,
              'value', case when activity.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end,
              'subtotal', qualification_subtotal,
              'quantity', qualification_quantity,
              'eligible_subtotal', eligible_subtotal,
              'threshold', activity.threshold_value,
              'threshold_basis', activity.threshold_basis
            )
          ));

          -- Preserve each line's share as a decimal. Individual lines are not
          -- charged from this field, so aggregate rounding stays exact while a
          -- later bundled activity still sees the correct remaining base.
          select coalesce(jsonb_agg(case
            when public.promotion_item_matches_scope(activity.id, item, 'benefit') then
              item || jsonb_build_object(
                'remaining_total', greatest(0,
                  (item ->> 'remaining_total')::numeric
                  - activity_discount * (item ->> 'remaining_total')::numeric / nullif(eligible_subtotal, 0)
                )
              )
            else item
          end), '[]'::jsonb)
          into pricing_lines
          from jsonb_array_elements(pricing_lines) item;
        end if;
      end if;
    end loop;

    if jsonb_array_length(coupon_adjustments) = 0
      and not exists (
        select 1
        from public.coupon_promotions gift_link
        join public.promotions gift_promotion on gift_promotion.id = gift_link.promotion_id
        where gift_link.coupon_campaign_id = campaign.id
          and gift_promotion.active = true
          and gift_promotion.activation_type = 'coupon_only'
          and gift_promotion.benefit_type in ('amount_gift', 'quantity_gift')
          and gift_promotion.archived_at is null
          and (gift_promotion.start_at is null or gift_promotion.start_at <= now())
          and (gift_promotion.end_at is null or gift_promotion.end_at > now())
      )
    then
      raise exception '此優惠碼不適用目前購物車內容' using errcode = '22023';
    end if;
  end if;

  all_adjustments := automatic_adjustments || coupon_adjustments;
  select coalesce(sum((adjustment ->> 'amount')::numeric), 0)
    into total_discount
    from jsonb_array_elements(all_adjustments) adjustment;
  total_discount := least(greatest(total_discount, 0), subtotal_amount);

  effective_merchandise_amount := subtotal_amount - total_discount;

  if member_role in ('pro', 'instructor', 'distributor')
    and normalized_fulfillment = 'delivery'
  then
    shipping_group_context := public.get_my_appendable_shipping_group();
    appendable_group_id := nullif(shipping_group_context ->> 'id', '')::uuid;
    is_additional_order := appendable_group_id is not null;
  end if;

  if member_role in ('pro', 'instructor', 'distributor')
    and effective_merchandise_amount < 5000
    and not is_additional_order
  then
    raise exception '專業會員單筆訂單最低金額為 NT$ 5,000' using errcode = '22023';
  end if;

  if normalized_fulfillment = 'onsite_pickup' then
    shipping_amount := 0;
  elsif is_additional_order then
    shipping_amount := 0;
  elsif member_role = 'staff' then
    shipping_amount := 0;
  elsif member_role in ('pro', 'instructor', 'distributor')
    and effective_merchandise_amount >= 15000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(base_quote -> 'items');
  end if;
  total_amount := effective_merchandise_amount + shipping_amount;

  return jsonb_build_object(
    'member_role', member_role,
    'items', base_quote -> 'items',
    'subtotal', subtotal_amount,
    'discount', total_discount,
    'shipping', shipping_amount,
    'total', total_amount,
    'fulfillment_method', normalized_fulfillment,
    'shipping_group_id', appendable_group_id,
    'is_additional_order', is_additional_order,
    'shipping_group', shipping_group_context,
    'promotion_id', automatic_id,
    'promotion_name', automatic_name,
    'coupon_campaign_id', case when normalized_code = '' then null else campaign.id end,
    'coupon_name', case when normalized_code = '' then null else campaign.name end,
    'coupon_code_mask', case when normalized_code = '' then null
      else left(normalized_code, least(3, length(normalized_code))) || repeat('*', greatest(length(normalized_code) - 3, 3)) end,
    'adjustments', all_adjustments,
    'pricing_snapshot', jsonb_build_object(
      'version', 4,
      'engine', 'authoritative_quote_v2',
      'calculated_at', clock_timestamp(),
      'currency', 'TWD',
      'member_role', member_role,
      'fulfillment_method', normalized_fulfillment,
      'items', base_quote -> 'items',
      'automatic_promotion', case when automatic_id is null then null else jsonb_build_object(
        'id', automatic_id, 'name', automatic_name, 'type', automatic_type,
        'discount', automatic_discount
      ) end,
      'coupon', case when normalized_code = '' then null else jsonb_build_object(
        'id', campaign.id, 'name', campaign.name,
        'code_mask', left(normalized_code, least(3, length(normalized_code))) || repeat('*', greatest(length(normalized_code) - 3, 3)),
        'stacking_policy', campaign.stacking_policy
      ) end,
      'adjustments', all_adjustments,
      'subtotal', subtotal_amount,
      'discount', total_discount,
      'final_subtotal', effective_merchandise_amount,
      'shipping_group_id', appendable_group_id,
      'is_additional_order', is_additional_order,
      'shipping_group', shipping_group_context,
      'shipping', shipping_amount,
      'total', total_amount
    )
  );
end;
$$;


-- The quote snapshot carries the selected group. The INSERT trigger is the
-- authority: it locks and revalidates ownership/status immediately before the
-- immutable order row is created.
create or replace function public.assign_shipping_group_to_additional_order()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  quoted_group_id uuid;
  target_group public.shipping_groups%rowtype;
  trusted_role text;
begin
  quoted_group_id := nullif(new.pricing_snapshot ->> 'shipping_group_id', '')::uuid;
  if quoted_group_id is null then
    return new;
  end if;

  if new.user_id is null or new.fulfillment_method <> 'delivery' then
    raise exception 'Combined shipping requires a signed-in delivery order'
      using errcode = '42501';
  end if;

  select profile.role into trusted_role
  from public.profiles profile
  where profile.id = new.user_id;
  if not public.is_professional_shipping_role(trusted_role) then
    raise exception 'Combined shipping is available only to professional members'
      using errcode = '42501';
  end if;

  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.id = quoted_group_id
  for update;

  if not found
    or target_group.user_id <> new.user_id
    or target_group.status <> 'open'
    or not exists (
      select 1
      from public.orders grouped_order
      where grouped_order.shipping_group_id = target_group.id
        and public.is_shipping_group_valid_order_status(grouped_order.status)
    )
  then
    raise exception 'Combined shipping group is no longer appendable'
      using errcode = '40001';
  end if;

  new.shipping_group_id := target_group.id;
  return new;
end;
$$;
revoke all on function public.assign_shipping_group_to_additional_order() from public, anon, authenticated;
drop trigger if exists trg_assign_shipping_group_to_additional_order on public.orders;
create trigger trg_assign_shipping_group_to_additional_order
  before insert on public.orders
  for each row execute function public.assign_shipping_group_to_additional_order();

create or replace function public.protect_order_shipping_group_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.shipping_group_id is distinct from old.shipping_group_id
    and coalesce(current_setting('app.eclado_shipping_group_write', true), '0') <> '1'
  then
    raise exception 'Order shipping group relationship is managed by the combined-shipping workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_order_shipping_group_relationship() from public, anon, authenticated;
drop trigger if exists trg_protect_order_shipping_group_relationship on public.orders;
create trigger trg_protect_order_shipping_group_relationship
  before update of shipping_group_id on public.orders
  for each row execute function public.protect_order_shipping_group_relationship();

-- A professional delivery order becomes an appendable group only when the
-- order first enters a paid/inventory-active state. Existing grouped pending
-- orders keep their group even if the group was locked after they were created.
create or replace function public.prepare_shipping_group_for_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  trusted_role text;
  created_group_id uuid;
  original_shipping numeric;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if not public.is_shipping_group_valid_order_status(old.status)
    and new.status = 'paid'
    and new.shipping_group_id is null
    and new.user_id is not null
    and new.fulfillment_method = 'delivery'
  then
    select profile.role into trusted_role
    from public.profiles profile
    where profile.id = new.user_id;

    if public.is_professional_shipping_role(trusted_role) then
      if public.shipping_group_effective_amount(new) < 5000 then
        raise exception 'A new professional shipping group requires NT$5,000 merchandise'
          using errcode = '23514';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
      original_shipping := greatest(
        0,
        coalesce((new.pricing_snapshot ->> 'shipping')::numeric, 0)
      );

      insert into public.shipping_groups (
        user_id, status, fulfillment_method, original_order_id,
        original_shipping_amount
      ) values (
        new.user_id, 'open', 'delivery', new.id,
        floor(original_shipping)::bigint
      )
      returning id into created_group_id;

      new.shipping_group_id := created_group_id;
    end if;
  end if;

  if new.shipping_group_id is not null
    and new.status in (
      'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
    )
  then
    update public.shipping_groups
    set status = 'locked',
        locked_at = coalesce(locked_at, now()),
        updated_at = now()
    where id = new.shipping_group_id
      and status = 'open';
  end if;

  return new;
end;
$$;
revoke all on function public.prepare_shipping_group_for_order_status() from public, anon, authenticated;
drop trigger if exists trg_prepare_shipping_group_for_order_status on public.orders;
create trigger trg_prepare_shipping_group_for_order_status
  before update of status on public.orders
  for each row execute function public.prepare_shipping_group_for_order_status();

create or replace function public.refund_shipping_group_fee(p_shipping_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.shipping_groups%rowtype;
  original_order public.orders%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  effective_total numeric;
  refund_amount bigint;
  next_available bigint;
  ledger_id bigint;
begin
  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.id = p_shipping_group_id
  for update;

  if not found then
    raise exception 'Shipping group not found' using errcode = 'P0002';
  end if;
  if target_group.shipping_refund_ledger_id is not null then
    return jsonb_build_object(
      'ok', true, 'already_processed', true,
      'amount', target_group.original_shipping_amount
    );
  end if;

  select coalesce(sum(public.shipping_group_effective_amount(target_order)), 0)
  into effective_total
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id
    and public.is_shipping_group_valid_order_status(target_order.status);

  refund_amount := target_group.original_shipping_amount;
  if effective_total < 15000 or refund_amount <= 0 then
    return jsonb_build_object(
      'ok', true, 'already_processed', false, 'amount', 0,
      'effective_total', effective_total
    );
  end if;

  select * into original_order
  from public.orders target_order
  where target_order.id = target_group.original_order_id
    and target_order.user_id = target_group.user_id
    and public.is_shipping_group_valid_order_status(target_order.status);

  if not found then
    return jsonb_build_object(
      'ok', true, 'already_processed', false, 'amount', 0,
      'effective_total', effective_total
    );
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (target_group.user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = target_group.user_id
  for update;

  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is unavailable'
      using errcode = '55000';
  end if;

  next_available := target_account.available_balance + refund_amount;
  update public.shopping_credit_accounts
  set available_balance = next_available,
      version = version + 1,
      updated_at = now()
  where user_id = target_group.user_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    target_group.user_id, 'grant', refund_amount, refund_amount, 0,
    next_available, target_account.reserved_balance,
    target_group.original_order_id, 'shipping_refund',
    jsonb_build_object(
      'source', 'shipping_group',
      'shipping_group_id', target_group.id,
      'original_order_id', target_group.original_order_id
    )
  )
  returning id into ledger_id;

  update public.shipping_groups
  set shipping_refund_ledger_id = ledger_id,
      shipping_refunded_at = now(),
      updated_at = now()
  where id = target_group.id;

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'amount', refund_amount, 'effective_total', effective_total,
    'ledger_id', ledger_id
  );
exception
  when unique_violation then
    select entry.id into ledger_id
    from public.shopping_credit_ledger entry
    where entry.reason_code = 'shipping_refund'
      and entry.metadata ->> 'shipping_group_id' = p_shipping_group_id::text
    order by entry.id
    limit 1;

    if ledger_id is null then
      raise;
    end if;

    update public.shipping_groups
    set shipping_refund_ledger_id = ledger_id,
        shipping_refunded_at = coalesce(shipping_refunded_at, now()),
        updated_at = now()
    where id = p_shipping_group_id
      and shipping_refund_ledger_id is null;

    return jsonb_build_object(
      'ok', true, 'already_processed', true,
      'amount', target_group.original_shipping_amount,
      'ledger_id', ledger_id
    );
end;
$$;
revoke all on function public.refund_shipping_group_fee(uuid) from public, anon, authenticated;

create or replace function public.sync_shipping_group_from_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shipping_group_id is not null
    and (
      new.status is distinct from old.status
      or new.shipping_group_id is distinct from old.shipping_group_id
    )
  then
    perform public.refund_shipping_group_fee(new.shipping_group_id);
  end if;
  return new;
end;
$$;
revoke all on function public.sync_shipping_group_from_order_status() from public, anon, authenticated;
drop trigger if exists trg_sync_shipping_group_from_order_status on public.orders;
create trigger trg_sync_shipping_group_from_order_status
  after update of status, shipping_group_id on public.orders
  for each row execute function public.sync_shipping_group_from_order_status();

create or replace function public.get_admin_shipping_groups()
returns table (
  order_id text,
  shipping_group jsonb
)
language plpgsql
security definer
stable
set search_path = public, auth
as $$
begin
  if auth.uid() is null
    or not public.has_backoffice_permission('orders.read')
  then
    raise exception 'Order read permission required' using errcode = '42501';
  end if;

  return query
  with group_totals as (
    select
      shipping_group.id,
      coalesce(sum(
        case
          when public.is_shipping_group_valid_order_status(target_order.status)
            then public.shipping_group_effective_amount(target_order)
          else 0
        end
      ), 0) as effective_total,
      count(*) filter (
        where public.is_shipping_group_valid_order_status(target_order.status)
      ) as valid_order_count,
      count(*) filter (
        where target_order.status in ('awaiting_confirm', 'unpaid')
      ) as pending_order_count,
      jsonb_agg(
        jsonb_build_object(
          'id', target_order.id,
          'status', target_order.status,
          'effective_amount', public.shipping_group_effective_amount(target_order),
          'is_valid', public.is_shipping_group_valid_order_status(target_order.status)
        )
        order by target_order.created_at, target_order.id
      ) as orders
    from public.shipping_groups shipping_group
    join public.orders target_order
      on target_order.shipping_group_id = shipping_group.id
    group by shipping_group.id
  )
  select
    target_order.id,
    jsonb_build_object(
      'id', shipping_group.id,
      'status', shipping_group.status,
      'created_at', shipping_group.created_at,
      'locked_at', shipping_group.locked_at,
      'original_order_id', shipping_group.original_order_id,
      'original_shipping_amount', shipping_group.original_shipping_amount,
      'effective_total', group_totals.effective_total,
      'valid_order_count', group_totals.valid_order_count,
      'pending_order_count', group_totals.pending_order_count,
      'free_shipping', group_totals.effective_total >= 15000,
      'shipping_refunded', shipping_group.shipping_refund_ledger_id is not null,
      'shipping_refunded_at', shipping_group.shipping_refunded_at,
      'orders', group_totals.orders,
      'requires_manual_review',
        shipping_group.shipping_refund_ledger_id is not null
        and group_totals.effective_total < 15000,
      'below_minimum_warning',
        group_totals.effective_total > 0
        and group_totals.effective_total < 5000
    )
  from public.orders target_order
  join public.shipping_groups shipping_group
    on shipping_group.id = target_order.shipping_group_id
  join group_totals on group_totals.id = shipping_group.id;
end;
$$;
revoke all on function public.get_admin_shipping_groups() from public, anon;
grant execute on function public.get_admin_shipping_groups() to authenticated;

comment on table public.shipping_groups is
  'Professional-member delivery batches. Orders remain independent; the group only controls appendability and one-time shipping refund.';
comment on column public.orders.shipping_group_id is
  'Optional combined-shipping relationship. Null preserves all legacy order behavior.';
comment on function public.get_my_appendable_shipping_group() is
  'Returns the sole paid, open professional delivery group. Multiple open groups fail closed instead of being guessed.';
comment on function public.refund_shipping_group_fee(uuid) is
  'Credits the original shipping fee once after paid valid group merchandise reaches NT$15,000.';

commit;

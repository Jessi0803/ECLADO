-- ECLADO promotions and coupons — batch 3 coupon and atomic discount engine
--
-- Run after:
--   supabase-promotions-coupons-foundation.sql
--   supabase-promotion-pricing-engine.sql
--
-- This batch enables percentage_discount and fixed_discount. Gift benefits
-- remain deliberately disabled until the next batch.

begin;

-- Public storefront queries must never receive coupon-only definitions. Apart
-- from leaking campaign mechanics, the old policy would let legacy browser
-- preview code mistake a coupon benefit for an automatic activity.
drop policy if exists "promotions_select_live" on public.promotions;
create policy "promotions_select_live"
  on public.promotions for select
  to anon, authenticated
  using (
    active = true
    and activation_type = 'automatic'
    and archived_at is null
    and benefit_type in ('legacy_discount', 'percentage_discount', 'fixed_discount')
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at > now())
  );

-- A scope contains include rows and optional excludes. New atomic activities
-- require at least one include row. all_regular means the ordinary storefront
-- catalog only; event_only and gift_only never enter it implicitly.
create or replace function public.promotion_item_matches_scope(
  p_promotion_id uuid,
  p_item jsonb,
  p_scope_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with item_data as (
    select
      nullif(p_item ->> 'product_id', '')::integer as product_id,
      nullif(p_item ->> 'variant_id', '')::bigint as variant_id
  ), product_data as (
    select product.*
    from public.products product
    join item_data item on item.product_id = product.id
  ), scopes as (
    select scope.*
    from public.promotion_scopes scope
    where scope.promotion_id = p_promotion_id
      and scope.scope_role = p_scope_role
  ), matched as (
    select scope.mode
    from scopes scope
    cross join item_data item
    cross join product_data product
    where case scope.target_type
      when 'all_regular' then product.publication_status = 'active'
      when 'all_sellable' then product.publication_status in ('active', 'event_only')
      when 'product' then scope.product_id = item.product_id
      when 'variant' then scope.product_variant_id = item.variant_id
      when 'category' then lower(btrim(scope.target_value)) = lower(btrim(coalesce(product.category, '')))
      when 'series' then lower(btrim(scope.target_value)) = lower(btrim(coalesce(product.series, '')))
      else false
    end
  )
  select exists (select 1 from matched where mode = 'include')
    and not exists (select 1 from matched where mode = 'exclude');
$$;

revoke all on function public.promotion_item_matches_scope(uuid, jsonb, text) from public;

-- Four-argument quote overload. The two-argument batch-2 function remains as
-- a compatibility base and continues to build authoritative items/prices.
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
      or not (member_role = any(campaign.audience_roles))
      or (current_user_id is null and campaign.allow_guest is false)
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

  if member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - total_discount < 5000
  then
    raise exception '專業會員單筆訂單最低金額為 NT$ 5,000' using errcode = '22023';
  end if;

  if normalized_fulfillment = 'onsite_pickup' then
    shipping_amount := 0;
  elsif member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - total_discount >= 15000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(base_quote -> 'items');
  end if;
  total_amount := subtotal_amount - total_discount + shipping_amount;

  return jsonb_build_object(
    'member_role', member_role,
    'items', base_quote -> 'items',
    'subtotal', subtotal_amount,
    'discount', total_discount,
    'shipping', shipping_amount,
    'total', total_amount,
    'fulfillment_method', normalized_fulfillment,
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
      'final_subtotal', subtotal_amount - total_discount,
      'shipping', shipping_amount,
      'total', total_amount
    )
  );
end;
$$;

revoke all on function public.quote_order_pricing_discount_v2(jsonb, text, text, text) from public;

comment on function public.quote_order_pricing_discount_v2(jsonb, text, text, text) is
  'Read-only authoritative quote with atomic automatic discounts and a sanitized coupon result. It never reserves quota.';

-- Batch 3 compatibility wrapper. Batch 4 replaces this public wrapper with
-- gift evaluation while continuing to call the same discount helper. Keeping
-- the helper name stable also lets later discount migrations update it safely.
create or replace function public.quote_order_pricing(
  p_items jsonb,
  p_fulfillment_method text,
  p_coupon_code text,
  p_guest_email text
)
returns jsonb
language sql
security definer
set search_path = public, auth, extensions
as $$
  select public.quote_order_pricing_discount_v2(
    p_items, p_fulfillment_method, p_coupon_code, p_guest_email
  );
$$;

revoke all on function public.quote_order_pricing(jsonb, text, text, text) from public;
grant execute on function public.quote_order_pricing(jsonb, text, text, text) to anon, authenticated;

-- New order overload reserves coupon quota and snapshots every applied atomic
-- adjustment in the same transaction as the order.
create or replace function public.create_order_with_pricing(
  p_items jsonb,
  p_member text,
  p_address text,
  p_phone text,
  p_email text,
  p_note text,
  p_payment_method text,
  p_fulfillment_method text,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_fulfillment text := coalesce(nullif(btrim(p_fulfillment_method), ''), 'delivery');
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
  quote_result jsonb;
  campaign public.coupon_campaigns%rowtype;
  guest_hash text;
  active_usage integer;
  identity_usage integer;
  payment_token text := encode(gen_random_bytes(32), 'hex');
  order_id text;
  order_status text;
  payment_expiry timestamptz;
  adjustment jsonb;
begin
  if normalized_fulfillment = 'delivery' and nullif(btrim(p_address), '') is null then
    raise exception 'Delivery address is required' using errcode = '22023';
  end if;

  quote_result := public.quote_order_pricing(p_items, normalized_fulfillment, normalized_code, p_email);

  if normalized_code <> '' then
    campaign.id := nullif(quote_result ->> 'coupon_campaign_id', '')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(campaign.id::text, 0));

    select * into campaign from public.coupon_campaigns target
    where target.id = campaign.id
      and target.code_normalized = normalized_code
      and target.active = true
      and target.archived_at is null
      and (quote_result ->> 'member_role') = any(target.audience_roles)
      and (current_user_id is not null or target.allow_guest = true)
      and (target.start_at is null or target.start_at <= now())
      and (target.end_at is null or target.end_at > now());
    if not found then
      raise exception '優惠碼無效或目前無法使用' using errcode = '22023';
    end if;

    if current_user_id is null then
      guest_hash := encode(digest(lower(btrim(p_email)), 'sha256'), 'hex');
    end if;

    select count(*) into active_usage from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()));
    select count(*) into identity_usage from public.coupon_redemptions redemption
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
  end if;

  order_status := case when p_payment_method = 'atm' then 'awaiting_confirm' else 'unpaid' end;
  order_id := 'ECL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    id, member, type, items, total, subtotal, discount, status, date,
    address, phone, email, note, user_id, promotion_id, promotion_name,
    coupon_campaign_id, coupon_name, coupon_code_mask,
    pricing_snapshot, fulfillment_method
  ) values (
    order_id,
    coalesce(nullif(btrim(p_member), ''), '訪客'),
    quote_result ->> 'member_role',
    quote_result -> 'items',
    (quote_result ->> 'total')::numeric,
    (quote_result ->> 'subtotal')::numeric,
    (quote_result ->> 'discount')::numeric,
    order_status, current_date::text, coalesce(p_address, ''), coalesce(p_phone, ''),
    coalesce(p_email, ''), coalesce(p_note, ''), current_user_id,
    nullif(quote_result ->> 'promotion_id', '')::uuid,
    quote_result ->> 'promotion_name',
    nullif(quote_result ->> 'coupon_campaign_id', '')::uuid,
    quote_result ->> 'coupon_name', quote_result ->> 'coupon_code_mask',
    quote_result -> 'pricing_snapshot', quote_result ->> 'fulfillment_method'
  ) returning payment_due_at into payment_expiry;

  insert into public.order_payment_authorizations (order_id, token_hash, provider_order_no, attempt_no)
  values (order_id, encode(digest(payment_token, 'sha256'), 'hex'), order_id, 1);

  for adjustment in select value from jsonb_array_elements(quote_result -> 'adjustments')
  loop
    if adjustment ->> 'adjustment_type' in ('percentage_discount', 'fixed_discount') then
      insert into public.order_adjustments (
        order_id, promotion_id, coupon_campaign_id, adjustment_type,
        name_snapshot, qualification_snapshot, amount, sort_order, metadata
      ) values (
        order_id,
        nullif(adjustment ->> 'promotion_id', '')::uuid,
        nullif(adjustment ->> 'coupon_campaign_id', '')::uuid,
        adjustment ->> 'adjustment_type', adjustment ->> 'name',
        coalesce(adjustment -> 'qualification', '{}'::jsonb),
        (adjustment ->> 'amount')::numeric,
        coalesce((adjustment ->> 'sort_order')::integer, 0),
        jsonb_build_object('pricing_engine_version', 4)
      );
    end if;
  end loop;

  if normalized_code <> '' then
    insert into public.coupon_redemptions (
      coupon_campaign_id, order_id, user_id, guest_identity_hash,
      status, expires_at
    ) values (
      campaign.id, order_id, current_user_id,
      case when current_user_id is null then guest_hash else null end,
      'reserved', payment_expiry
    );
  end if;

  return quote_result || jsonb_build_object(
    'order_id', order_id, 'status', order_status, 'payment_token', payment_token
  );
end;
$$;

revoke all on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.create_order_with_pricing(
  jsonb, text, text, text, text, text, text, text, text
) to anon, authenticated;

-- Keep the original RPC signature alive for an older deployed browser during
-- rollout, while routing it through the new engine with no coupon.
create or replace function public.create_order_with_pricing(
  p_items jsonb,
  p_member text,
  p_address text,
  p_phone text,
  p_email text,
  p_note text default '',
  p_payment_method text default 'atm',
  p_fulfillment_method text default 'delivery'
)
returns jsonb
language sql
security definer
set search_path = public, auth, extensions
as $$
  select public.create_order_with_pricing(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, null
  );
$$;

-- Coupon usage follows payment lifecycle without changing the public order
-- status model. Expired reservations stop counting immediately even before a
-- cleanup job marks them released.
create or replace function public.sync_coupon_redemption_from_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered') then
    update public.coupon_redemptions
    set status = 'redeemed', redeemed_at = coalesce(redeemed_at, now()), released_at = null,
        release_reason = null
    where order_id = new.id and status = 'reserved';
  elsif new.status in ('cancelled', 'returned') then
    update public.coupon_redemptions
    set status = 'released', released_at = coalesce(released_at, now()),
        release_reason = 'order_' || new.status
    where order_id = new.id and status = 'reserved';
  end if;
  return new;
end;
$$;

revoke all on function public.sync_coupon_redemption_from_order_status() from public;
drop trigger if exists trg_sync_coupon_redemption_from_order_status on public.orders;
create trigger trg_sync_coupon_redemption_from_order_status
  after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public.sync_coupon_redemption_from_order_status();

-- Transactional admin save helpers prevent a promotion header from being
-- saved without its matching qualification/benefit scopes.
create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  benefit text := p_payload ->> 'benefit_type';
  activation text := p_payload ->> 'activation_type';
  threshold_type text := coalesce(nullif(p_payload ->> 'threshold_type', ''), 'amount');
  scope_type text := coalesce(p_payload ->> 'scope_type', 'all_regular');
  target_product_id integer;
begin
  if not public.has_backoffice_permission('promotions.manage') then raise exception 'Promotion management access required' using errcode = '42501'; end if;
  if nullif(btrim(p_payload ->> 'name'), '') is null then raise exception 'Promotion name is required' using errcode = '22023'; end if;
  if benefit not in ('percentage_discount', 'fixed_discount') or activation not in ('automatic', 'coupon_only') or scope_type not in ('all_regular', 'all_sellable', 'products') then raise exception 'Invalid discount promotion configuration' using errcode = '22023'; end if;
  if threshold_type not in ('amount', 'quantity') then raise exception 'Invalid discount threshold type' using errcode = '22023'; end if;
  if threshold_type = 'quantity' and nullif(p_payload ->> 'threshold_value', '') is not null
    and (p_payload ->> 'threshold_value')::numeric <> trunc((p_payload ->> 'threshold_value')::numeric)
    then raise exception 'Quantity threshold must be a whole number' using errcode = '22023'; end if;
  if benefit = 'percentage_discount' and coalesce((p_payload ->> 'discount_rate')::numeric, 1) not between 0 and 1 then raise exception 'Discount rate must be between 0 and 1' using errcode = '22023'; end if;
  if benefit = 'fixed_discount' and coalesce((p_payload ->> 'discount_amount')::numeric, 0) <= 0 then raise exception 'Discount amount must be greater than zero' using errcode = '22023'; end if;
  if scope_type = 'products' and jsonb_array_length(coalesce(p_payload -> 'product_ids', '[]'::jsonb)) = 0 then raise exception 'Choose at least one product' using errcode = '22023'; end if;

  if target_id is null then
    insert into public.promotions (name, description, product_ids, discount_rate, discount_amount, discount_order, start_at, end_at, active, benefit_type, activation_type, threshold_value, threshold_type, threshold_basis, priority)
    values (btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''), array(select jsonb_array_elements_text(coalesce(p_payload -> 'product_ids', '[]'::jsonb))::integer), case when benefit = 'percentage_discount' then (p_payload ->> 'discount_rate')::numeric else 1 end, case when benefit = 'fixed_discount' then (p_payload ->> 'discount_amount')::numeric else 0 end, 'rate_then_amount', nullif(p_payload ->> 'start_at', '')::timestamptz, nullif(p_payload ->> 'end_at', '')::timestamptz, coalesce((p_payload ->> 'active')::boolean, true), benefit, activation, nullif(p_payload ->> 'threshold_value', '')::numeric, coalesce(nullif(p_payload ->> 'threshold_type', ''), 'amount'), case when nullif(p_payload ->> 'threshold_value', '') is null or coalesce(nullif(p_payload ->> 'threshold_type', ''), 'amount') = 'quantity' then null else coalesce(nullif(p_payload ->> 'threshold_basis', ''), 'before_bundle_discount') end, coalesce((p_payload ->> 'priority')::integer, 100))
    returning id into target_id;
  else
    update public.promotions set name = btrim(p_payload ->> 'name'), description = nullif(btrim(p_payload ->> 'description'), ''), product_ids = array(select jsonb_array_elements_text(coalesce(p_payload -> 'product_ids', '[]'::jsonb))::integer), discount_rate = case when benefit = 'percentage_discount' then (p_payload ->> 'discount_rate')::numeric else 1 end, discount_amount = case when benefit = 'fixed_discount' then (p_payload ->> 'discount_amount')::numeric else 0 end, start_at = nullif(p_payload ->> 'start_at', '')::timestamptz, end_at = nullif(p_payload ->> 'end_at', '')::timestamptz, active = coalesce((p_payload ->> 'active')::boolean, true), benefit_type = benefit, activation_type = activation, threshold_value = nullif(p_payload ->> 'threshold_value', '')::numeric, threshold_type = coalesce(nullif(p_payload ->> 'threshold_type', ''), 'amount'), threshold_basis = case when nullif(p_payload ->> 'threshold_value', '') is null or coalesce(nullif(p_payload ->> 'threshold_type', ''), 'amount') = 'quantity' then null else coalesce(nullif(p_payload ->> 'threshold_basis', ''), 'before_bundle_discount') end, priority = coalesce((p_payload ->> 'priority')::integer, 100)
    where id = target_id and archived_at is null;
    if not found then raise exception 'Promotion not found' using errcode = 'P0002'; end if;
    delete from public.promotion_scopes scope where scope.promotion_id = target_id;
  end if;
  if scope_type in ('all_regular', 'all_sellable') then
    insert into public.promotion_scopes (promotion_id, scope_role, target_type) values (target_id, 'qualification', scope_type), (target_id, 'benefit', scope_type);
  else
    for target_product_id in select jsonb_array_elements_text(p_payload -> 'product_ids')::integer loop
      insert into public.promotion_scopes (promotion_id, scope_role, target_type, product_id) values (target_id, 'qualification', 'product', target_product_id), (target_id, 'benefit', 'product', target_product_id);
    end loop;
  end if;
  return target_id;
end;
$$;

revoke all on function public.save_discount_promotion(jsonb) from public;
grant execute on function public.save_discount_promotion(jsonb) to authenticated;

create or replace function public.save_coupon_campaign(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  promotion_id uuid;
  position integer := 0;
begin
  if not public.has_backoffice_permission('promotions.manage') then raise exception 'Promotion management access required' using errcode = '42501'; end if;
  if nullif(btrim(p_payload ->> 'name'), '') is null or nullif(btrim(p_payload ->> 'code'), '') is null then raise exception 'Coupon name and code are required' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_payload -> 'promotion_ids', '[]'::jsonb)) = 0 then raise exception 'Choose at least one coupon activity' using errcode = '22023'; end if;
  if target_id is null then
    insert into public.coupon_campaigns (name, description, code, code_normalized, start_at, end_at, active, total_usage_limit, per_member_limit, audience_roles, allow_guest, stacking_policy, created_by, updated_by)
    values (btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''), btrim(p_payload ->> 'code'), upper(btrim(p_payload ->> 'code')), nullif(p_payload ->> 'start_at', '')::timestamptz, nullif(p_payload ->> 'end_at', '')::timestamptz, coalesce((p_payload ->> 'active')::boolean, true), nullif(p_payload ->> 'total_usage_limit', '')::integer, nullif(p_payload ->> 'per_member_limit', '')::integer, array(select jsonb_array_elements_text(coalesce(p_payload -> 'audience_roles', '["consumer","pro","instructor","distributor"]'::jsonb))), coalesce((p_payload ->> 'allow_guest')::boolean, true), coalesce(p_payload ->> 'stacking_policy', 'allow_auto_gifts'), auth.uid(), auth.uid()) returning id into target_id;
  else
    update public.coupon_campaigns set name = btrim(p_payload ->> 'name'), description = nullif(btrim(p_payload ->> 'description'), ''), code = btrim(p_payload ->> 'code'), start_at = nullif(p_payload ->> 'start_at', '')::timestamptz, end_at = nullif(p_payload ->> 'end_at', '')::timestamptz, active = coalesce((p_payload ->> 'active')::boolean, true), total_usage_limit = nullif(p_payload ->> 'total_usage_limit', '')::integer, per_member_limit = nullif(p_payload ->> 'per_member_limit', '')::integer, audience_roles = array(select jsonb_array_elements_text(coalesce(p_payload -> 'audience_roles', '["consumer","pro","instructor","distributor"]'::jsonb))), allow_guest = coalesce((p_payload ->> 'allow_guest')::boolean, true), stacking_policy = coalesce(p_payload ->> 'stacking_policy', 'allow_auto_gifts'), updated_by = auth.uid()
    where id = target_id and archived_at is null;
    if not found then raise exception 'Coupon campaign not found' using errcode = 'P0002'; end if;
    delete from public.coupon_promotions link where link.coupon_campaign_id = target_id;
  end if;
  for promotion_id in select jsonb_array_elements_text(p_payload -> 'promotion_ids')::uuid loop
    insert into public.coupon_promotions (coupon_campaign_id, promotion_id, sort_order) values (target_id, promotion_id, position);
    position := position + 1;
  end loop;
  return target_id;
end;
$$;

revoke all on function public.save_coupon_campaign(jsonb) from public;
grant execute on function public.save_coupon_campaign(jsonb) to authenticated;

commit;

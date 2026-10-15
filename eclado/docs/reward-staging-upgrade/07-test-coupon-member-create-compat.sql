-- TEST ONLY: qqlgqasbmbicnmvnlqbr.
-- Verifies the member-targeted coupon quote/create compatibility patch through
-- the current storefront wallet entrypoints. The entire scenario rolls back.
-- Never run against production.

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $smoke$
declare
  test_student_id uuid;
  test_instructor_id uuid;
  test_product_id integer;
  test_variant_id bigint;
  campaign_id uuid := gen_random_uuid();
  promotion_id uuid := gen_random_uuid();
  coupon_code text := 'TEST_MEMBER_COMPAT';
  items jsonb;
  quoted jsonb;
  created jsonb;
  created_order_id text;
begin
  select id into strict test_student_id
  from auth.users where lower(email) = 'student.stage@eclado.test';
  select id into strict test_instructor_id
  from auth.users where lower(email) = 'instructor.stage@eclado.test';

  if not exists (
    select 1 from public.profiles
    where id = test_student_id and role = 'pro'
  ) or not exists (
    select 1 from public.profiles
    where id = test_instructor_id and role = 'instructor'
  ) then
    raise exception 'Expected test-only member roles are missing';
  end if;

  select product.id, variant.id
  into strict test_product_id, test_variant_id
  from public.products product
  join public.product_variants variant on variant.product_id = product.id
  where lower(product.slug) = 'reward-system-test-product'
    and variant.sku = 'TEST-REWARD-200'
    and product.active
    and variant.active;

  items := jsonb_build_array(jsonb_build_object(
    'product_id', test_product_id,
    'variant_id', test_variant_id,
    'qty', 10
  ));

  insert into public.promotions(
    id, name, benefit_type, activation_type, discount_amount, active
  ) values(
    promotion_id, 'TEST 指定會員券折抵', 'fixed_discount',
    'coupon_only', 50, true
  );
  insert into public.promotion_scopes(promotion_id, scope_role, target_type)
  values
    (promotion_id, 'qualification', 'all_regular'),
    (promotion_id, 'benefit', 'all_regular');
  insert into public.coupon_campaigns(
    id, name, code, code_normalized, active, audience_mode,
    audience_roles, allow_guest, stacking_policy
  ) values(
    campaign_id, 'TEST 指定會員券', coupon_code, coupon_code, true,
    'members', '{}'::text[], false, 'allow_all'
  );
  insert into public.coupon_campaign_members(coupon_campaign_id, user_id)
  values(campaign_id, test_student_id);
  insert into public.coupon_promotions(coupon_campaign_id, promotion_id, sort_order)
  values(campaign_id, promotion_id, 0);

  perform set_config('request.jwt.claim.sub', test_student_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  quoted := public.quote_order_with_wallets(items, 'delivery', coupon_code, '', 0, 0);

  if nullif(quoted->>'coupon_campaign_id', '')::uuid is distinct from campaign_id
    or (quoted->>'discount')::numeric < 50 then
    raise exception 'Selected member quote did not apply the coupon';
  end if;

  created := public.create_order_with_wallets(
    items,
    'TEST 學生',
    'TEST 台北市中正區測試路 1 號',
    '0912345678',
    'student.stage@eclado.test',
    'TEST_COUPON_MEMBER_COMPAT_ROLLBACK',
    'atm',
    'delivery',
    coupon_code,
    'personal',
    null,
    null,
    0,
    0,
    quoted
  );
  created_order_id := created->>'order_id';

  if not exists (
    select 1 from public.orders
    where id = created_order_id
      and user_id = test_student_id
      and coupon_campaign_id = campaign_id
  ) or not exists (
    select 1 from public.coupon_redemptions
    where order_id = created_order_id
      and coupon_campaign_id = campaign_id
      and user_id = test_student_id
      and status = 'reserved'
  ) then
    raise exception 'Selected member create did not reserve the coupon';
  end if;

  perform set_config('request.jwt.claim.sub', test_instructor_id::text, true);
  begin
    perform public.quote_order_with_wallets(items, 'delivery', coupon_code, '', 0, 0);
    raise exception 'Non-target member unexpectedly received the coupon';
  exception
    when sqlstate '22023' then null;
  end;
end;
$smoke$;

rollback;

select jsonb_build_object(
  'helper_present', position(
    'public.coupon_campaign_allows_identity(target.id, quote_result ->> ''member_role'')'
    in pg_get_functiondef(
      'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'legacy_removed', position(
    '(quote_result ->> ''member_role'') = any(target.audience_roles)'
    in pg_get_functiondef(
      'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure
    )
  ) = 0,
  'rollback_order_count', (
    select count(*) from public.orders
    where note = 'TEST_COUPON_MEMBER_COMPAT_ROLLBACK'
  ),
  'rollback_coupon_count', (
    select count(*) from public.coupon_campaigns
    where code_normalized = 'TEST_MEMBER_COMPAT'
  )
) as verification;

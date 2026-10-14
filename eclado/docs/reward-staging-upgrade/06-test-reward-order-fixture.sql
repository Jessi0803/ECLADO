-- TEST ONLY: qqlgqasbmbicnmvnlqbr.
-- Creates one real test order through the production quote/create RPCs, records
-- an explicit simulated admin receipt, and delivers it so the instructor can
-- inspect the resulting snapshot and Ledger entry. No bank or notification
-- provider is contacted. Never run against production.

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $fixture$
declare
  test_admin_id uuid;
  test_instructor_id uuid;
  test_student_id uuid;
  test_product_id integer;
  test_variant_id bigint;
  items jsonb;
  quoted jsonb;
  created_order jsonb;
  created_order_id text;
  reward_total bigint;
begin
  select id into strict test_admin_id
  from auth.users where lower(email) = 'admin.stage@eclado.test';
  select id into strict test_instructor_id
  from auth.users where lower(email) = 'instructor.stage@eclado.test';
  select id into strict test_student_id
  from auth.users where lower(email) = 'student.stage@eclado.test';

  if not exists (
    select 1 from public.admin_users
    where user_id = test_admin_id and active and role = 'super_admin'
  ) or not exists (
    select 1 from public.profiles
    where id = test_instructor_id and role = 'instructor'
  ) or not exists (
    select 1 from public.profiles
    where id = test_student_id and role = 'pro'
  ) then
    raise exception 'Expected test-only member roles are missing';
  end if;

  if not exists (
    select 1 from public.instructor_student_bindings
    where student_id = test_student_id
      and instructor_id = test_instructor_id
      and ended_at is null
  ) then
    raise exception 'Expected active test instructor/student binding is missing';
  end if;

  if not (select enabled from public.student_pricing_feature_settings where singleton) then
    raise exception 'Test student pricing must be enabled before creating the fixture';
  end if;

  if exists (
    select 1 from public.orders
    where user_id = test_student_id
      and note = 'TEST_REWARD_ACCEPTANCE_ORDER'
  ) then
    raise exception 'The persistent test reward order already exists';
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
    'qty', 4
  ));

  perform set_config('request.jwt.claim.sub', test_student_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  quoted := public.quote_order_with_wallets(items, 'delivery', '', '', 0, 0);

  if (quoted->>'subtotal')::bigint is distinct from 5760 then
    raise exception 'Unexpected student subtotal: %', quoted->>'subtotal';
  end if;

  created_order := public.create_order_with_wallets(
    items,
    'TEST 學生',
    'TEST 台北市中正區測試路 1 號',
    '0912345678',
    'student.stage@eclado.test',
    'TEST_REWARD_ACCEPTANCE_ORDER',
    'atm',
    'delivery',
    '',
    'personal',
    null,
    null,
    0,
    0,
    quoted
  );
  created_order_id := created_order->>'order_id';

  select total_reward into strict reward_total
  from public.student_reward_snapshots
  where order_id = created_order_id;

  if reward_total is distinct from 1280 then
    raise exception 'Unexpected reward snapshot total: %', reward_total;
  end if;

  perform set_config('request.jwt.claim.sub', test_admin_id::text, true);
  perform public.confirm_admin_instructor_reward_payment(created_order_id, true);
  update public.orders set status = 'delivered' where id = created_order_id;

  if not exists (
    select 1 from public.instructor_reward_order_states
    where order_id = created_order_id and status = 'credited'
  ) then
    raise exception 'Reward was not credited after simulated receipt and delivery';
  end if;

  if (select balance from public.instructor_reward_accounts where user_id = test_instructor_id)
      is distinct from 1280 then
    raise exception 'Unexpected instructor reward balance';
  end if;
end;
$fixture$;

commit;

select jsonb_build_object(
  'order_id', orders.id,
  'order_status', orders.status,
  'subtotal', orders.subtotal,
  'shipping', orders.total - orders.subtotal + orders.discount,
  'total', orders.total,
  'snapshot_reward', snapshots.total_reward,
  'reward_state', states.status,
  'instructor_balance', accounts.balance,
  'student_pricing_enabled', feature.enabled,
  'real_bank', false,
  'notification_provider_called', false
) as verification
from public.orders orders
join public.student_reward_snapshots snapshots on snapshots.order_id = orders.id
join public.instructor_reward_order_states states on states.order_id = orders.id
join public.instructor_reward_accounts accounts on accounts.user_id = snapshots.instructor_id
cross join public.student_pricing_feature_settings feature
where orders.note = 'TEST_REWARD_ACCEPTANCE_ORDER'
  and orders.user_id = (
    select id from auth.users where lower(email) = 'student.stage@eclado.test'
  );

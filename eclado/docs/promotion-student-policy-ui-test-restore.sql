-- TEST ONLY qqlgqasbmbicnmvnlqbr. Retain the reusable fixture and audit history by archiving.
begin;
set local lock_timeout='5s';
do $$begin
 if not exists(select 1 from auth.users where lower(email)='admin.stage@eclado.test')
  or (select count(*) from public.promotions where name='TEST｜學生互斥買3送1｜20261030')<>1
 then raise exception 'TEST UI fixture differs; stop';end if;
 perform set_config('request.jwt.claim.sub',(select id::text from auth.users where lower(email)='admin.stage@eclado.test'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where lower(email)='admin.stage@eclado.test'),'role','authenticated')::text,true);
 update public.promotion_student_policy_settings set enabled=false where singleton;
 update public.automatic_price_allocation_settings set enabled=false where singleton;
 update public.promotions set active=false,archived_at=coalesce(archived_at,clock_timestamp())
  where name='TEST｜學生互斥買3送1｜20261030';
end $$;
commit;
select (select enabled from public.promotion_student_policy_settings where singleton) as student_policy_enabled,
 (select enabled from public.automatic_price_allocation_settings where singleton) as allocation_enabled,
 (select count(*) from public.orders) as orders,(select count(*) from public.student_reward_snapshots) as snapshots,
 (select count(*) from public.instructor_reward_ledger) as ledger,(select count(*) from public.order_adjustments) as adjustments,
 (select count(*) from public.promotions where active and archived_at is null) as active_promotions,
 (select count(*) from public.promotions where name='TEST｜學生互斥買3送1｜20261030' and not active and archived_at is not null) as archived_test_fixtures;

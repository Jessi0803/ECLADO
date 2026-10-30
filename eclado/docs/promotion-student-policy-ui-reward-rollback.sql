-- TEST ONLY qqlgqasbmbicnmvnlqbr; exact browser fixture. Real order RPC, always rollback.
begin;
set local statement_timeout='30s';
do $verify$
declare buyer uuid; pid integer; cart jsonb; q jsonb; created jsonb; snap jsonb; results jsonb; baseline jsonb; restored jsonb;
begin
 select id into strict buyer from auth.users where lower(email)='student.stage@eclado.test';
 select id into strict pid from public.products where slug='reward-system-test-product';
 select jsonb_agg(to_jsonb(v) order by v.id) into baseline from public.product_variants v where v.product_id=pid;
 if not exists(select 1 from public.promotions where name='TEST｜學生互斥買3送1｜20261030' and active and archived_at is null)
  or (select count(*) from public.orders)<>1 or (select count(*) from public.student_reward_snapshots)<>1 or (select count(*) from public.instructor_reward_ledger)<>12 then raise exception 'TEST baseline differs';end if;
 begin
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
  select jsonb_agg(jsonb_build_object('product_id',pid,'variant_id',v.id,'qty',case when v.sku='TEST-REWARD-100' then 5 else 3 end) order by v.id) into cart from public.product_variants v where v.product_id=pid and v.sku in('TEST-REWARD-100','TEST-REWARD-200');
  q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
  if (q->>'total')::numeric is distinct from 8340 then raise exception 'Browser amount mismatch';end if;
  created:=public.create_order_with_wallets(cart,'TEST UI','TEST','0900000000','policy.ui@example.test','','atm','delivery','','personal',null,null,0,0,q);
  select to_jsonb(s) into snap from public.student_reward_snapshots s where order_id=created->>'order_id';
  if (snap->>'total_reward')::numeric is distinct from 1160 or snap#>>'{items,0,reward_excluded_quantity}' is distinct from '4' or snap#>>'{items,1,reward_excluded_quantity}' is distinct from '0' then raise exception 'Exact browser reward mismatch: %',snap;end if;
  update public.orders set status='cancelled' where id=created->>'order_id';
  update public.orders set status='cancelled' where id=created->>'order_id';
  if not (select count(*)=1 and sum(amount)=1160 from public.instructor_reward_ledger where order_id=created->>'order_id' and event_type='cancel') then raise exception 'Frozen cancellation mismatch';end if;
  results:=jsonb_build_object('passed',true,'subtotal',q->'subtotal','discount',q->'discount','shipping',q->'shipping','total',q->'total','reward',snap->'total_reward','excluded_quantities',jsonb_build_array(snap#>'{items,0,reward_excluded_quantity}',snap#>'{items,1,reward_excluded_quantity}'),'cancel_event_count',1,'bank_calls',0);
  raise exception 'Revert exact browser fixture order' using errcode='P9001';
 exception when sqlstate 'P9001' then null;end;
 select jsonb_agg(to_jsonb(v) order by v.id) into restored from public.product_variants v where v.product_id=pid;
 if restored<>baseline or (select count(*) from public.orders)<>1 or (select count(*) from public.student_reward_snapshots)<>1 or (select count(*) from public.instructor_reward_ledger)<>12 then raise exception 'Rollback baseline mismatch';end if;
 perform set_config('test.policy_ui_reward', (results||jsonb_build_object('inventory_unchanged',true,'retained_test_orders',0))::text,true);
end $verify$;
select current_setting('test.policy_ui_reward')::jsonb as report;
rollback;

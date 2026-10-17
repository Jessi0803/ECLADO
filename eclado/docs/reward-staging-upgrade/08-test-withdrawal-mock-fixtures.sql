-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Creates 30 MOCK withdrawals, not real transfers.
-- No new Auth credentials, no changes to existing withdrawals or original product stock.
-- Reuses TEST instructor's encrypted bank snapshot (same owner/AAD).
-- A hidden dedicated MOCK product supplies income through real quote/create/receipt RPCs.
begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
do $mock$
declare
 g constant text:='MOCK_WITHDRAWALS_20261015_V1';
 adm uuid;teacher uuid;student uuid;pid integer;vid bigint;b public.instructor_reward_bank_profiles%rowtype;
 original_balance bigint;original_shopping bigint;original_hold bigint;original_orders bigint;original_stock jsonb;
 i integer;q jsonb;o jsonb;items jsonb;oid text;wid uuid;carry uuid;amt bigint;batch date;target text;v bigint;
begin
 perform pg_advisory_xact_lock(hashtext(g));
 select id into strict adm from auth.users where email='admin.stage@eclado.test';
 select id into strict teacher from auth.users where email='instructor.stage@eclado.test';
 select id into strict student from auth.users where email='student.stage@eclado.test';
 if not exists(select 1 from public.products where slug='reward-system-test-product') or not (select enabled from public.student_pricing_feature_settings where singleton)
 or not exists(select 1 from public.profiles where id=teacher and role='instructor') or not exists(select 1 from public.profiles where id=student and role='pro')
 or not exists(select 1 from public.instructor_student_bindings where student_id=student and instructor_id=teacher and ended_at is null) then raise exception 'Expected test-only pricing fixtures missing';end if;
 if exists(select 1 from public.instructor_reward_withdrawal_events where details->>'fixture_group'=g) then raise exception 'MOCK fixture group already exists; no duplicates created';end if;
 select * into strict b from public.instructor_reward_bank_profiles where user_id=teacher for share;
 if coalesce(b.masked->>'bank_name','') !~* '(test|測試|mock|隔離)' then raise exception 'Only clearly labeled mock bank data is allowed';end if;
 perform 1 from auth.users where id=teacher for key share;
 select balance,reserved_balance,withdrawal_reserved_balance into strict original_balance,original_shopping,original_hold from public.instructor_reward_accounts where user_id=teacher for update;
 if original_balance<=15 then raise exception 'This test fixture expects an existing available balance above 15';end if;
 select count(*) into original_orders from public.orders;
 select jsonb_agg(jsonb_build_array(id,stock,gift_stock) order by id) into original_stock from public.product_variants;
 insert into public.products(name,name_zh,slug,category,series,size,price,pro_price,stock,min_stock,is_pro_only,active,publication_status,description,apply_tier_multiplier,instructor_price_multiplier)
 values('mock-withdrawal-fixture-20261015','MOCK 提領驗收專用商品','mock-withdrawal-fixture-20261015','toner','MOCK','200ml',2000,1600,1000,0,true,true,'active',g,true,0.70) returning id into pid;
 insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order)
 values(pid,'MOCK-WITHDRAWAL-20261015','200ml',2000,1600,1000,true,0,true,false) returning id into vid;
 -- This is a privileged postgres fixture transaction, not public member traffic.
 -- Use the existing trusted-server path; never disable or change the member rate-limit trigger.
 perform set_config('request.jwt.claim.role','service_role',true);
 for i in 0..29 loop
  if i=0 then
   -- Temporary reservation of existing TEST funds; fully returned at end of this transaction.
   amt:=original_balance;batch:='2026-11-10';target:='failed';
  else
   perform set_config('request.jwt.claim.sub',student::text,true);
   items:=jsonb_build_array(jsonb_build_object('product_id',pid,'variant_id',vid,'qty',4+i%5));
   q:=public.quote_order_with_wallets(items,'delivery','','',0,0);
   o:=public.create_order_with_wallets(items,'MOCK TEST 學生','TEST 台北市測試地址','0912345678','student.stage@eclado.test',g||':'||i,'atm','delivery','','personal',null,null,0,0,q);
   oid:=o->>'order_id';
   perform set_config('request.jwt.claim.sub',adm::text,true);
   perform public.confirm_admin_instructor_reward_payment(oid,true);
   update public.orders set status='delivered' where id=oid;
   select balance into amt from public.instructor_reward_accounts where user_id=teacher;
   if amt<=15 then raise exception 'Mock income did not become available';end if;
   batch:=case when i<=10 then date '2026-09-10' when i<=20 then date '2026-10-10' else date '2026-11-10' end;
   target:=(array['pending','processing','paid','failed','unknown'])[1+i%5];
  end if;
  perform set_config('request.jwt.claim.sub',teacher::text,true);
  insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date,created_at)
  values(teacher,extensions.gen_random_uuid(),amt,amt-15,b.cipher,b.masked,b.version,batch,batch,least(batch-5,(now() at time zone 'Asia/Taipei')::date-1)::timestamp at time zone 'Asia/Taipei') returning id into wid;
  perform public.post_reward_withdrawal(wid,'withdraw_reserve');
  insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id,details)
  values(wid,extensions.gen_random_uuid(),'requested',teacher,jsonb_build_object('fixture_group',g,'fixture_index',i,'simulated',true,'reason','MOCK 測試提領 #'||lpad(i::text,2,'0')));
  if i=0 then carry:=wid;continue;end if;
  perform set_config('request.jwt.claim.sub',adm::text,true);
  if target<>'pending' then
   perform public.manage_reward_withdrawal(wid,extensions.gen_random_uuid(),'claim',1,'{}');
   if target='paid' then
    perform public.manage_reward_withdrawal(wid,extensions.gen_random_uuid(),'paid',2,jsonb_build_object('transfer_date',least(batch,(now() at time zone 'Asia/Taipei')::date),'reference','MOCK-NO-BANK-'||i,'amount',amt-15));
   elsif target='failed' then
    perform public.manage_reward_withdrawal(wid,extensions.gen_random_uuid(),'failed',2,jsonb_build_object('reason','MOCK 測試：未實際匯款，全額退回','confirmed_unpaid',true));
    -- Reverse only the newly generated fixture income, leaving original TEST balance intact.
    update public.orders set status='returned' where id=oid;
   elsif target='unknown' then
    perform public.manage_reward_withdrawal(wid,extensions.gen_random_uuid(),'unknown',2,jsonb_build_object('reason','MOCK 測試：模擬匯款結果確認中，沒有實際匯款'));
   end if;
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',adm::text,true);
 perform public.manage_reward_withdrawal(carry,extensions.gen_random_uuid(),'claim',1,'{}');
 perform public.manage_reward_withdrawal(carry,extensions.gen_random_uuid(),'failed',2,jsonb_build_object('reason','MOCK 測試：暫存原測試餘額已全額返還','confirmed_unpaid',true));
 -- Prevent the mock events from reaching notification providers, including configured admin inboxes.
 update public.instructor_reward_notification_outbox n set status='blocked',last_error='mock_fixture_no_delivery',next_retry_at='infinity',lease_token=null,lease_until=null
 where exists(select 1 from public.instructor_reward_withdrawal_events e where e.withdrawal_id=n.withdrawal_id and e.details->>'fixture_group'=g);
 update public.product_variants set active=false where id=vid;
 update public.products set active=false where id=pid;
 if (select jsonb_agg(jsonb_build_array(id,stock,gift_stock) order by id) from public.product_variants where product_id<>pid) is distinct from original_stock then raise exception 'Original catalog stock changed';end if;
 if (select balance from public.instructor_reward_accounts where user_id=teacher) is distinct from original_balance
 or (select reserved_balance from public.instructor_reward_accounts where user_id=teacher) is distinct from original_shopping then raise exception 'Original available/shopping balances changed';end if;
 if exists(select 1 from public.instructor_reward_accounts a where a.user_id=teacher and jsonb_build_array(a.balance,a.reserved_balance,a.withdrawal_reserved_balance) is distinct from
 (select jsonb_build_array(coalesce(sum(balance_delta),0),coalesce(sum(reserved_delta),0),coalesce(sum(withdrawal_reserved_delta),0)) from public.instructor_reward_ledger where instructor_id=teacher)) then raise exception 'Account and Ledger mismatch';end if;
 if (select count(distinct withdrawal_id) from public.instructor_reward_withdrawal_events where details->>'fixture_group'=g)<>30 or (select count(*) from public.orders)<>original_orders+29 then raise exception 'Unexpected fixture count';end if;
end $mock$;
commit;
select jsonb_build_object('fixture_group','MOCK_WITHDRAWALS_20261015_V1','count',sum(n),'statuses',jsonb_object_agg(status,n)) as verification from
(select w.status,count(*) as n from public.instructor_reward_withdrawals w where exists(select 1 from public.instructor_reward_withdrawal_events e where e.withdrawal_id=w.id and e.details->>'fixture_group'='MOCK_WITHDRAWALS_20261015_V1') group by w.status) counts;

-- TEST ONLY qqlgqasbmbicnmvnlqbr. No real bank transfers or notification delivery.
-- Run only after the approved 2026-10-19 backup/reset and both withdrawal upgrades.
begin;
set local statement_timeout='60s';set local lock_timeout='5s';
do $fixture$
declare adm uuid;teacher uuid;student uuid;pid integer;vid bigint;items jsonb;q jsonb;o jsonb;
 b public.instructor_reward_bank_profiles%rowtype;wid uuid;failed_id uuid;request_key uuid:=extensions.gen_random_uuid();
 batch date;stock_before jsonb;bank_before text;
begin
 if (select count(*) from auth.users)<>3 or (select count(*) from auth.users where email in ('admin.stage@eclado.test','instructor.stage@eclado.test','student.stage@eclado.test'))<>3 then raise exception 'Test-only guard failed';end if;
 if exists(select 1 from public.orders) or exists(select 1 from public.instructor_reward_withdrawals) or exists(select 1 from public.instructor_reward_ledger) then raise exception 'Expected approved reset state';end if;
 select id into strict adm from auth.users where email='admin.stage@eclado.test';
 select id into strict teacher from auth.users where email='instructor.stage@eclado.test';
 select id into strict student from auth.users where email='student.stage@eclado.test';
 select * into strict b from public.instructor_reward_bank_profiles where user_id=teacher;
 if coalesce(b.masked->>'bank_name','') !~* '(test|測試|mock|隔離)' then raise exception 'Mock bank required';end if;
 select md5(to_jsonb(x)::text) into bank_before from public.instructor_reward_bank_profiles x where user_id=teacher;
 select jsonb_agg(jsonb_build_array(id,stock,gift_stock) order by id) into stock_before from public.product_variants;
 insert into public.products(name,name_zh,slug,category,series,size,price,pro_price,stock,min_stock,is_pro_only,active,publication_status,description,apply_tier_multiplier,instructor_price_multiplier)
 values('mock-withdrawal-fixture-20261019','MOCK 自選提領驗收商品','mock-withdrawal-fixture-20261019','toner','MOCK','200ml',12500,10000,1000,0,true,true,'active','MOCK_PARTIAL_20261019',true,0.70) returning id into pid;
 insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order)
 values(pid,'MOCK-PARTIAL-20261019','200ml',12500,10000,1000,true,0,true,false) returning id into vid;
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claim.sub',student::text,true);
 items:=jsonb_build_array(jsonb_build_object('product_id',pid,'variant_id',vid,'qty',30));
 q:=public.quote_order_with_wallets(items,'delivery','','',0,0);
 o:=public.create_order_with_wallets(items,'MOCK TEST 學生','TEST 台北市測試地址','0912345678','student.stage@eclado.test','MOCK_PARTIAL_20261019','atm','delivery','','personal',null,null,0,0,q);
 perform set_config('request.jwt.claim.sub',adm::text,true);
 perform public.confirm_admin_instructor_reward_payment(o->>'order_id',true);
 update public.orders set status='delivered' where id=o->>'order_id';
 if (select balance from public.instructor_reward_accounts where user_id=teacher)<>60000 then raise exception 'Expected real fixture income 60000';end if;
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 q:=public.quote_my_reward_withdrawal(30000);
 if (q->>'net_amount')::bigint<>26352 then raise exception 'Taxed fixture mismatch';end if;
 batch:=((q->>'batch_date')::date-interval '1 month')::date;
 -- One historical paid fixture, with a real ledger reserve/complete and frozen deductions.
 insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,income_tax,supplementary_premium,deduction_policy_version,deduction_snapshot,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 values(teacher,extensions.gen_random_uuid(),30000,26352,3000,633,q->>'deduction_policy_version',q->'deduction_snapshot',b.cipher,b.masked,b.version,batch,batch) returning id into wid;
 perform public.post_reward_withdrawal(wid,'withdraw_reserve');
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id,details)
 values(wid,extensions.gen_random_uuid(),'requested',teacher,'{"fixture_group":"MOCK_PARTIAL_20261019","simulated":true}');
 perform set_config('request.jwt.claim.sub',adm::text,true);
 perform public.manage_reward_withdrawal(wid,extensions.gen_random_uuid(),'claim',1,'{}');
 perform public.manage_reward_withdrawal(wid,extensions.gen_random_uuid(),'paid',2,jsonb_build_object('transfer_date',least(batch,(now() at time zone 'Asia/Taipei')::date),'reference','MOCK-NO-BANK-PARTIAL-20261019','amount',26352));
 -- Current-batch failure uses the actual public request RPC, idempotent retry and full return.
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 q:=public.quote_my_reward_withdrawal(20000);
 if (q->>'income_tax')::bigint<>0 or (q->>'supplementary_premium')::bigint<>422 or (q->>'net_amount')::bigint<>19563 then raise exception '20000 boundary mismatch';end if;
 o:=public.request_my_reward_withdrawal(request_key,q);failed_id:=(o->>'id')::uuid;
 if (public.request_my_reward_withdrawal(request_key,q)->>'id')::uuid<>failed_id then raise exception 'Idempotency failed';end if;
 begin
  perform public.quote_my_reward_withdrawal(1000);raise exception 'Batch gate did not reject duplicate';
 exception when sqlstate '55000' then null;end;
 perform set_config('request.jwt.claim.sub',adm::text,true);
 perform public.manage_reward_withdrawal(failed_id,extensions.gen_random_uuid(),'claim',1,'{}');
 perform public.manage_reward_withdrawal(failed_id,extensions.gen_random_uuid(),'failed',2,'{"reason":"MOCK_PARTIAL_20261019：確認未付款，測試全額退回","confirmed_unpaid":true}');
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 if (public.quote_my_reward_withdrawal(10000)->>'net_amount')::bigint<>9985 or (public.get_my_reward_withdrawals(0)->'withdrawal_batch'->>'blocked')::boolean then raise exception 'Failed batch did not reopen';end if;
 if (select balance from public.instructor_reward_accounts where user_id=teacher)<>30000 or (select withdrawal_reserved_balance from public.instructor_reward_accounts where user_id=teacher)<>0 then raise exception 'Final wallet mismatch';end if;
 update public.instructor_reward_notification_outbox set status='blocked',last_error='mock_fixture_no_delivery',next_retry_at='infinity',lease_token=null,lease_until=null;
 update public.product_variants set active=false where id=vid;
 update public.products set active=false where id=pid;
 if (select jsonb_agg(jsonb_build_array(id,stock,gift_stock) order by id) from public.product_variants where id<>vid) is distinct from stock_before then raise exception 'Existing catalog stock changed';end if;
 if (select md5(to_jsonb(x)::text) from public.instructor_reward_bank_profiles x where user_id=teacher)<>bank_before then raise exception 'Bank profile changed';end if;
 if exists(select 1 from public.reward_financial_checks()) then raise exception 'Financial reconciliation failed';end if;
end $fixture$;
commit;
select jsonb_build_object('orders',(select count(*) from public.orders),'withdrawals',(select count(*) from public.instructor_reward_withdrawals),'balance',(select balance from public.instructor_reward_accounts),'withdrawal_hold',(select withdrawal_reserved_balance from public.instructor_reward_accounts),'findings',(select count(*) from public.reward_financial_checks()),'bank_called',false,'notification_provider_called',false) fixture_verified;

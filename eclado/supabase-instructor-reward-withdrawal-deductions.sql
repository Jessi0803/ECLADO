-- Run AFTER current withdrawals, notifications, reconciliation and withdrawal-operations migrations.
-- Existing snapshots retain legacy policy and original amounts. No backfill of tax.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.instructor_reward_withdrawals
 add column if not exists income_tax bigint not null default 0 check(income_tax>=0),
 add column if not exists supplementary_premium bigint not null default 0 check(supplementary_premium>=0),
 add column if not exists deduction_policy_version text not null default 'legacy_fee_only_v1',
 add column if not exists deduction_snapshot jsonb not null default '{}'::jsonb;
-- Remove only the old fee-only net equation, retaining all status/accounting checks.
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.instructor_reward_withdrawals'::regclass and contype='c'
 and pg_get_constraintdef(oid) ~ 'net_amount = \(amount - 15\)' loop
 execute format('alter table public.instructor_reward_withdrawals drop constraint %I',c.conname);end loop;
end $$;
alter table public.instructor_reward_withdrawals drop constraint if exists reward_withdrawal_deductions_check;
alter table public.instructor_reward_withdrawals add constraint reward_withdrawal_deductions_check check (
 net_amount=amount-fee-income_tax-supplementary_premium and net_amount>0 and (
 (deduction_policy_version='legacy_fee_only_v1' and income_tax=0 and supplementary_premium=0 and deduction_snapshot='{}'::jsonb)
 or (deduction_policy_version='tw_withdrawal_v2' and income_tax=case when amount>20000 then floor(amount::numeric/10)::bigint else 0 end
 and supplementary_premium=case when amount>=20000 then round(amount::numeric*211/10000)::bigint else 0 end
 and deduction_snapshot=jsonb_build_object('policy_version','tw_withdrawal_v2','basis',amount,
 'income_tax_rate',0.10,'income_tax_threshold',20000,'income_tax_comparison','gt','income_tax_rounding','floor',
 'supplementary_premium_rate',0.0211,'supplementary_premium_threshold',20000,'supplementary_premium_comparison','gte','supplementary_premium_rounding','round'))
 ));
create or replace function public.calculate_reward_withdrawal_deductions(p_amount bigint)
returns jsonb language plpgsql immutable set search_path='' as $$
declare tax bigint;premium bigint;begin
 if p_amount is null or p_amount<0 or p_amount>9007199254740991 then raise exception 'Invalid withdrawal amount' using errcode='22023';end if;
 tax:=case when p_amount>20000 then floor(p_amount::numeric/10)::bigint else 0 end;
 premium:=case when p_amount>=20000 then round(p_amount::numeric*211/10000)::bigint else 0 end;
 return jsonb_build_object('amount',p_amount,'fee',15,'income_tax',tax,'supplementary_premium',premium,
 'net_amount',greatest(0,p_amount-15-tax-premium),'deduction_policy_version','tw_withdrawal_v2',
 'deduction_snapshot',jsonb_build_object('policy_version','tw_withdrawal_v2','basis',p_amount,
 'income_tax_rate',0.10,'income_tax_threshold',20000,'income_tax_comparison','gt','income_tax_rounding','floor',
 'supplementary_premium_rate',0.0211,'supplementary_premium_threshold',20000,'supplementary_premium_comparison','gte','supplementary_premium_rounding','round'));
end $$;
revoke all on function public.calculate_reward_withdrawal_deductions(bigint) from public,anon,authenticated,service_role;

create or replace function public.quote_my_reward_withdrawal()
returns jsonb language plpgsql stable security definer set search_path='' as $$ declare a public.instructor_reward_accounts%rowtype;b public.instructor_reward_bank_profiles%rowtype;s jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then raise exception '師資資格不足' using errcode='42501';end if;
 select * into a from public.instructor_reward_accounts where user_id=auth.uid();
 select * into b from public.instructor_reward_bank_profiles where user_id=auth.uid();
 if a.user_id is null or a.status<>'active' or a.balance<=15 then raise exception '可用返饋金必須大於 NT$15' using errcode='22003';end if;
 if b.user_id is null then raise exception '請先設定完整收款銀行資料' using errcode='22023';end if;
 s:=public.reward_withdrawal_schedule(statement_timestamp());
 return s||public.calculate_reward_withdrawal_deductions(a.balance)||jsonb_build_object('account_version',a.version,'bank_version',b.version,'bank',b.masked);end $$;

create or replace function public.request_my_reward_withdrawal(p_request_key uuid,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$ declare q jsonb;w public.instructor_reward_withdrawals%rowtype;begin
 if auth.uid() is null or p_request_key is null then raise exception 'Invalid withdrawal identity/request key' using errcode='42501';end if;
 perform 1 from auth.users where id=auth.uid() for key share;
 perform 1 from public.profiles where id=auth.uid() and role='instructor' for share;
 if not found then raise exception '師資資格不足' using errcode='42501';end if;
 perform 1 from public.instructor_reward_accounts where user_id=auth.uid() for update;
 select * into w from public.instructor_reward_withdrawals where user_id=auth.uid() and request_key=p_request_key;
 if found then return jsonb_build_object('id',w.id,'status',w.status);end if;
 perform 1 from public.instructor_reward_bank_profiles where user_id=auth.uid() for share;
 q:=public.quote_my_reward_withdrawal();
 if q is distinct from p_expected_quote then raise exception '餘額、銀行資料或批次已變更，請重新確認' using errcode='40001';end if;
 insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,income_tax,supplementary_premium,deduction_policy_version,deduction_snapshot,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 select auth.uid(),p_request_key,(q->>'amount')::bigint,(q->>'net_amount')::bigint,(q->>'income_tax')::bigint,(q->>'supplementary_premium')::bigint,q->>'deduction_policy_version',q->'deduction_snapshot',cipher,masked,version,(q->>'batch_date')::date,(q->>'scheduled_date')::date from public.instructor_reward_bank_profiles where user_id=auth.uid() returning * into w;
 perform public.post_reward_withdrawal(w.id,'withdraw_reserve');
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id) values(w.id,p_request_key,'requested',auth.uid());
 return jsonb_build_object('id',w.id,'status',w.status);end $$;

create or replace function public.reward_withdrawal_projection(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',w.id,'user_id',w.user_id,'name',p.name,'amount',w.amount,'fee',w.fee,'net_amount',w.net_amount,'income_tax',w.income_tax,'supplementary_premium',w.supplementary_premium,'deduction_policy_version',w.deduction_policy_version,'deduction_snapshot',w.deduction_snapshot,'bank',w.bank_masked,
 'created_at',w.created_at,'batch_date',w.batch_date,'scheduled_date',w.scheduled_date,'status',w.status,'version',w.version,'processor_id',w.processor_id,
 'transfer_date',w.transfer_date,'reference',w.transfer_reference,'transferred_amount',w.transferred_amount,'fee_charged',w.fee_charged,'failure_reason',w.failure_reason,
 'events',coalesce((select jsonb_agg(jsonb_build_object('type',event_type,'at',created_at,'details',details) order by id) from public.instructor_reward_withdrawal_events where withdrawal_id=w.id),'[]'))
 from public.instructor_reward_withdrawals w left join public.profiles p on p.id=w.user_id where w.id=p_id $$;

create or replace function public.get_my_reward_withdrawals(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then raise exception '師資資格不足' using errcode='42501';end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset';end if;
 return jsonb_build_object('balance',coalesce((select balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'available_balance',coalesce((select greatest(0,balance) from public.instructor_reward_accounts where user_id=auth.uid() and status='active'),0),
 'withdrawal_estimate',public.calculate_reward_withdrawal_deductions(coalesce((select greatest(0,balance) from public.instructor_reward_accounts where user_id=auth.uid() and status='active'),0)),
 'shopping_reserved_balance',coalesce((select reserved_balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'withdrawal_reserved_balance',coalesce((select withdrawal_reserved_balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'bank',coalesce((select jsonb_build_object('version',version,'masked',masked) from public.instructor_reward_bank_profiles where user_id=auth.uid()),'null'),
 'total',(select count(*) from public.instructor_reward_withdrawals where user_id=auth.uid()),
 'withdrawals',coalesce((select jsonb_agg(public.reward_withdrawal_projection(id) order by created_at desc,id) from
 (select id,created_at from public.instructor_reward_withdrawals where user_id=auth.uid() order by created_at desc,id limit 20 offset p_offset) q),'[]'));end $$;

create or replace function public.get_admin_reward_withdrawal_queue(p_offset integer default 0,p_batch_date date default null,p_status text default '',p_search text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;begin
 perform public.assert_reward_withdrawal_admin(false);
 if p_offset is null or p_offset<0 or p_status is null or p_status not in('','pending','processing','paid','failed','unknown') or p_search is null or length(p_search)>100
 or (p_batch_date is not null and extract(day from p_batch_date)<>10) then raise exception 'Invalid withdrawal filters' using errcode='22023';end if;
 with filtered as materialized (
 select w.id,w.created_at from public.instructor_reward_withdrawals w left join public.profiles p on p.id=w.user_id
 where (p_batch_date is null or w.batch_date=p_batch_date) and (p_status='' or w.status=p_status)
 and (btrim(p_search)='' or strpos(lower(coalesce(p.name,'')),lower(btrim(p_search)))>0 or strpos(w.id::text,lower(btrim(p_search)))>0)
 ) select jsonb_build_object('total',(select count(*) from filtered),
 'withdrawals',coalesce((select jsonb_agg(public.reward_withdrawal_projection(id) order by created_at desc,id) from (select * from filtered order by created_at desc,id limit 20 offset p_offset) q),'[]'::jsonb),
 'batches',coalesce((select jsonb_agg(batch_date order by batch_date desc) from(select distinct batch_date from public.instructor_reward_withdrawals) b),'[]'::jsonb),
 'batch_summary',case when p_batch_date is null then null else (select jsonb_build_object('batch_date',p_batch_date,'count',count(*),'amount',coalesce(sum(amount),0),'fee',coalesce(sum(fee),0),'income_tax',coalesce(sum(income_tax),0),'supplementary_premium',coalesce(sum(supplementary_premium),0),'net_amount',coalesce(sum(net_amount),0)) from public.instructor_reward_withdrawals where batch_date=p_batch_date and status in('pending','processing')) end) into result;
 return result;
end $$;

create or replace function public.export_reward_withdrawal_batch(p_actor uuid,p_batch_date date)
returns jsonb language plpgsql security definer set search_path='' as $$ declare rows jsonb;manifest jsonb;n bigint;total bigint;export_id uuid;begin
 if auth.role() is distinct from 'service_role' or not exists(
 select 1 from public.admin_users a join public.backoffice_roles r on r.role=a.role and r.active
 join public.backoffice_role_permissions p on p.role=a.role and p.permission='rewards.withdrawals.manage'
 where a.user_id=p_actor and a.active and a.role in('admin','super_admin')) then raise exception 'Export management permission required' using errcode='42501';end if;
 if p_batch_date is null or extract(day from p_batch_date)<>10 then raise exception 'Select a monthly batch' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'user_id',w.user_id,'name',p.name,'cipher',w.bank_cipher,'amount',w.amount::text,'fee',w.fee::text,'income_tax',w.income_tax::text,'supplementary_premium',w.supplementary_premium::text,'deduction_policy_version',w.deduction_policy_version,'deduction_snapshot',w.deduction_snapshot,'net_amount',w.net_amount::text,'batch_date',w.batch_date) order by w.created_at,w.id),'[]'::jsonb),
 coalesce(jsonb_agg(jsonb_build_object('id',w.id,'version',w.version,'status',w.status,'amount',w.amount,'fee',w.fee,'income_tax',w.income_tax,'supplementary_premium',w.supplementary_premium,'deduction_policy_version',w.deduction_policy_version,'deduction_snapshot',w.deduction_snapshot,'net_amount',w.net_amount,'processor_id',w.processor_id) order by w.created_at,w.id),'[]'::jsonb),count(*),coalesce(sum(w.net_amount),0)
 into rows,manifest,n,total from public.instructor_reward_withdrawals w left join public.profiles p on p.id=w.user_id where w.batch_date=p_batch_date and w.status in('pending','processing');
 insert into public.instructor_reward_withdrawal_exports(actor_user_id,batch_date,row_count,net_amount,manifest) values(p_actor,p_batch_date,n,total,manifest) returning id into export_id;
 return jsonb_build_object('export_id',export_id,'batch_date',p_batch_date,'count',n,'net_amount',total::text,'rows',rows);
end $$;

create or replace function public.queue_reward_withdrawal_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare w public.instructor_reward_withdrawals%rowtype;p jsonb;
begin
 if new.event_type not in('requested','paid','failed','unknown') then return new;end if;
 select * into w from public.instructor_reward_withdrawals where id=new.withdrawal_id;
 p:=jsonb_build_object('template_version',1,'withdrawal_id',w.id,'user_id',w.user_id,'event_type',new.event_type,'at',new.created_at,
 'amount',w.amount,'fee',w.fee,'net_amount',w.net_amount,'income_tax',w.income_tax,'supplementary_premium',w.supplementary_premium,'deduction_policy_version',w.deduction_policy_version,'deduction_snapshot',w.deduction_snapshot,'scheduled_date',w.scheduled_date,
 'status',w.status,'transfer_date',w.transfer_date,'transferred_amount',w.transferred_amount,
 'returned_amount',case when new.event_type='failed' then w.amount else 0 end);
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,payload)
 values(new.id,w.id,w.user_id,new.event_type,'teacher',p) on conflict do nothing;
 if new.event_type='requested' then
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,payload)
 values(new.id,w.id,w.user_id,new.event_type,'admin',p) on conflict do nothing;end if;
 return new;
end $$;

create or replace function public.reward_financial_checks()
returns table(rule text,source text,expected jsonb,actual jsonb)
language sql stable security definer set search_path='' as $$
with ledger as (
 select instructor_id,sum(balance_delta) b,sum(pending_delta) p,sum(reserved_delta) s,sum(withdrawal_reserved_delta) w
 from public.instructor_reward_ledger group by instructor_id
), running as (
 select l.*,sum(balance_delta) over(partition by instructor_id order by id) b,
 sum(pending_delta) over(partition by instructor_id order by id) p,
 sum(reserved_delta) over(partition by instructor_id order by id) s,
 sum(withdrawal_reserved_delta) over(partition by instructor_id order by id) w from public.instructor_reward_ledger l
), income as (
 select order_id,count(*) filter(where event_type='pending') pn,count(*) filter(where event_type='credit') cr,
 count(*) filter(where event_type='cancel') ca,count(*) filter(where event_type='reverse') rv
 from public.instructor_reward_ledger where event_type in('pending','credit','cancel','reverse') group by order_id
), spend as (
 select order_id,reservation_cycle,count(*) filter(where event_type='spend_reserve') rs,
 count(*) filter(where event_type='spend_consume') co,count(*) filter(where event_type='spend_release') rl,
 count(*) filter(where event_type='spend_refund') rf
 from public.instructor_reward_ledger where event_type like 'spend_%' group by order_id,reservation_cycle
), withdrawal as (
 select withdrawal_id,count(*) filter(where event_type='withdraw_reserve') rs,
 count(*) filter(where event_type='withdraw_complete') co,count(*) filter(where event_type='withdraw_release') rl
 from public.instructor_reward_ledger where withdrawal_id is not null group by withdrawal_id
)
select 'account_ledger',coalesce(a.user_id,l.instructor_id)::text,
 jsonb_build_object('balance',coalesce(l.b,0),'pending',coalesce(l.p,0),'shopping_hold',coalesce(l.s,0),'withdrawal_hold',coalesce(l.w,0)),
 jsonb_build_object('balance',a.balance,'pending',a.pending_balance,'shopping_hold',a.reserved_balance,'withdrawal_hold',a.withdrawal_reserved_balance)
 from public.instructor_reward_accounts a full join ledger l on l.instructor_id=a.user_id
 where a.user_id is null or a.balance is distinct from coalesce(l.b,0) or a.pending_balance is distinct from coalesce(l.p,0) or a.reserved_balance is distinct from coalesce(l.s,0) or a.withdrawal_reserved_balance is distinct from coalesce(l.w,0)
union all
select 'ledger_running',coalesce(order_id,withdrawal_id::text)||':'||id::text,jsonb_build_object('balance',b,'pending',p,'shopping_hold',s,'withdrawal_hold',w),
 jsonb_build_object('balance',balance_after,'pending',pending_after,'shopping_hold',reserved_after,'withdrawal_hold',withdrawal_reserved_after)
 from running where balance_after<>b or pending_after<>p or reserved_after<>s or withdrawal_reserved_after<>w
union all
select 'snapshot_state',coalesce(s.order_id,r.order_id),jsonb_build_object('instructor',s.instructor_id,'amount',s.total_reward),jsonb_build_object('instructor',r.instructor_id,'amount',r.amount)
 from public.student_reward_snapshots s full join public.instructor_reward_order_states r using(order_id)
 where s.order_id is null or r.order_id is null or s.instructor_id<>r.instructor_id or s.total_reward<>r.amount or s.total_reward<>(select coalesce(sum((i->>'reward')::bigint),0) from jsonb_array_elements(s.items) i)
union all
select 'income_events',coalesce(r.order_id,i.order_id),jsonb_build_object('status',r.status,'pending',1),jsonb_build_object('pending',i.pn,'credit',i.cr,'cancel',i.ca,'reverse',i.rv)
 from public.instructor_reward_order_states r full join income i using(order_id) where
 r.order_id is null or i.order_id is null or i.pn<>1 or i.cr>1 or i.ca>1 or i.rv>1 or
 (r.status='pending' and(i.cr+i.ca+i.rv<>0)) or(r.status='credited' and(i.cr<>1 or i.ca+i.rv<>0)) or
 (r.status='cancelled' and(i.ca<>1 or i.cr+i.rv<>0)) or(r.status='reversed' and(i.cr<>1 or i.rv<>1 or i.ca<>0))
union all
select 'income_line',l.order_id||':'||l.id::text,jsonb_build_object('amount',r.amount,'instructor',r.instructor_id),jsonb_build_object('amount',l.amount,'instructor',l.instructor_id)
 from public.instructor_reward_ledger l join public.instructor_reward_order_states r using(order_id) where l.event_type in('pending','credit','cancel','reverse') and(l.amount<>r.amount or l.instructor_id<>r.instructor_id)
union all
select 'duplicate_credit',order_id,jsonb_build_object('maximum',1),jsonb_build_object('count',cr) from income where cr>1
union all
select 'duplicate_reverse',order_id,jsonb_build_object('maximum',1),jsonb_build_object('count',rv) from income where rv>1
union all
select 'income_lifecycle',r.order_id,jsonb_build_object('requires','receipt_and_completion_or_termination'),jsonb_build_object('state',r.status,'order_status',o.status,'receipt',p.order_id is not null)
 from public.instructor_reward_order_states r left join public.orders o on o.id=r.order_id left join public.instructor_reward_payment_receipts p on p.order_id=r.order_id where
 (o.id is null and r.status<>'cancelled') or
 (r.status in('pending','credited') and o.status in('cancelled','returned')) or
 (r.status in('credited','reversed') and(p.order_id is null or p.amount<>o.payment_amount)) or
 (r.status='credited' and o.status<>case when o.fulfillment_method='onsite_pickup' then 'picked_up' else 'delivered' end) or
 (r.status='pending' and p.amount=o.payment_amount and o.status=case when o.fulfillment_method='onsite_pickup' then 'picked_up' else 'delivered' end)
union all
select 'account_projections',a.user_id::text,jsonb_build_object(
 'pending',coalesce((select sum(amount) from public.instructor_reward_order_states where instructor_id=a.user_id and status='pending'),0),
 'shopping_hold',coalesce((select sum(amount) from public.instructor_reward_reservations where user_id=a.user_id and status='reserved'),0),
 'withdrawal_hold',coalesce((select sum(amount) from public.instructor_reward_withdrawals where user_id=a.user_id and status in('pending','processing','unknown')),0)),
 jsonb_build_object('pending',a.pending_balance,'shopping_hold',a.reserved_balance,'withdrawal_hold',a.withdrawal_reserved_balance)
 from public.instructor_reward_accounts a where
 a.pending_balance<>coalesce((select sum(amount) from public.instructor_reward_order_states where instructor_id=a.user_id and status='pending'),0) or
 a.reserved_balance<>coalesce((select sum(amount) from public.instructor_reward_reservations where user_id=a.user_id and status='reserved'),0) or
 a.withdrawal_reserved_balance<>coalesce((select sum(amount) from public.instructor_reward_withdrawals where user_id=a.user_id and status in('pending','processing','unknown')),0)
union all
select 'spend_events',s.order_id||':'||s.reservation_cycle,jsonb_build_object('reserve',1,'terminal_max',1),jsonb_build_object('reserve',rs,'consume',co,'release',rl,'refund',rf)
 from spend s where rs<>1 or co>1 or rl>1 or rf>1 or co+rl>1 or rf>co
union all
select 'missing_shopping_reservation',o.id,jsonb_build_object('requires','reservation'),jsonb_build_object('reward_credit_amount',o.reward_credit_amount)
 from public.orders o left join public.instructor_reward_reservations r on r.order_id=o.id where o.reward_credit_amount>0 and r.order_id is null
union all
select 'orphan_spend',s.order_id||':'||s.reservation_cycle,jsonb_build_object('requires','reservation'),jsonb_build_object('reserve',s.rs)
 from spend s left join public.instructor_reward_reservations r on r.order_id=s.order_id where r.order_id is null
union all
select 'shopping_reservation',r.order_id,jsonb_build_object('amount',o.reward_credit_amount,'cycle',r.cycle,'status',r.status),jsonb_build_object('amount',r.amount,'reserve',s.rs,'consume',s.co,'release',s.rl,'refund',s.rf)
 from public.instructor_reward_reservations r left join public.orders o on o.id=r.order_id left join spend s on s.order_id=r.order_id and s.reservation_cycle=r.cycle where
 o.id is null or r.amount<>o.reward_credit_amount or s.order_id is null or s.rs<>1 or
 (r.status='reserved' and s.co+s.rl+s.rf<>0) or(r.status='consumed' and(s.co<>1 or s.rl+s.rf<>0)) or
 (r.status='released' and(s.rl<>1 or s.co+s.rf<>0)) or(r.status='refunded' and(s.co<>1 or s.rf<>1 or s.rl<>0))
union all
select 'spend_payment',r.order_id,jsonb_build_object('requires','valid_receipt_and_matching_tender'),jsonb_build_object('status',r.status,'receipt',p.order_id is not null,'order_status',o.status)
 from public.instructor_reward_reservations r join public.orders o on o.id=r.order_id left join public.instructor_reward_payment_receipts p on p.order_id=r.order_id where
 (r.status in('consumed','refunded') and(p.order_id is null or p.amount<>o.payment_amount)) or
 (r.status='consumed' and o.status in('cancelled','returned')) or(r.status='refunded' and o.status not in('cancelled','returned')) or
 o.payment_amount<1 or o.payment_amount+o.shopping_credit_amount+o.reward_credit_amount<>o.total
union all
select 'withdrawal_events',coalesce(w.id,x.withdrawal_id)::text,jsonb_build_object('status',w.status,'reserve',1),jsonb_build_object('reserve',x.rs,'complete',x.co,'release',x.rl)
 from public.instructor_reward_withdrawals w full join withdrawal x on x.withdrawal_id=w.id where
 w.id is null or x.withdrawal_id is null or x.rs<>1 or x.co>1 or x.rl>1 or x.co+x.rl>1 or
 (w.status in('pending','processing','unknown') and x.co+x.rl<>0) or(w.status='paid' and(x.co<>1 or x.rl<>0)) or(w.status='failed' and(x.rl<>1 or x.co<>0))
union all
select 'withdrawal_amount',w.id::text,jsonb_build_object('gross',w.amount,'quoted_fee',15,'income_tax',w.income_tax,'supplementary_premium',w.supplementary_premium,'net',w.amount-15-w.income_tax-w.supplementary_premium,'charged_fee',case when w.status='paid' then 15 else 0 end),
 jsonb_build_object('quoted_fee',w.fee,'net',w.net_amount,'charged_fee',w.fee_charged,'transferred',w.transferred_amount)
 from public.instructor_reward_withdrawals w where w.amount<=15 or w.fee<>15 or w.net_amount<>w.amount-15-w.income_tax-w.supplementary_premium or
 (w.status='paid' and(w.transferred_amount is distinct from w.net_amount or w.fee_charged<>15 or w.transfer_date is null or nullif(w.transfer_reference,'') is null)) or
 (w.status<>'paid' and w.fee_charged<>0)
union all
select 'withdrawal_line',w.id::text||':'||l.id::text,jsonb_build_object('gross',w.amount,'instructor',w.user_id),jsonb_build_object('gross',l.amount,'instructor',l.instructor_id)
 from public.instructor_reward_ledger l join public.instructor_reward_withdrawals w on w.id=l.withdrawal_id where l.amount<>w.amount or l.instructor_id<>w.user_id
union all
select 'payment_unknown',order_id,jsonb_build_object('action','manual_review'),jsonb_build_object('reason',reason) from public.instructor_reward_payment_exceptions
union all
select 'withdrawal_unknown',id::text,jsonb_build_object('action','manual_bank_review_hold_unchanged'),jsonb_build_object('status',status) from public.instructor_reward_withdrawals where status='unknown'
$$;

notify pgrst,'reload schema';
commit;

-- Run LAST, after withdrawal deductions. No existing money/history is rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if to_regprocedure('public.calculate_reward_withdrawal_deductions(bigint)') is null then raise exception 'Withdrawal deductions migration is required';end if;
 if exists(select 1 from public.instructor_reward_withdrawals where status<>'failed' group by user_id,batch_date having count(*)>1) then
 raise exception 'Existing duplicate effective withdrawals in a batch: review records before installation; no records were changed';end if;
end $$;
-- Paid also occupies the batch. Only confirmed failed requests release the slot.
create unique index if not exists reward_withdrawal_single_batch_idx
 on public.instructor_reward_withdrawals(user_id,batch_date) where status<>'failed';

create or replace function public.quote_my_reward_withdrawal(p_amount bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$ declare a public.instructor_reward_accounts%rowtype;b public.instructor_reward_bank_profiles%rowtype;s jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then raise exception '師資資格不足' using errcode='42501';end if;
 select * into a from public.instructor_reward_accounts where user_id=auth.uid();
 select * into b from public.instructor_reward_bank_profiles where user_id=auth.uid();
 if a.user_id is null or a.status<>'active' or a.balance<=15 then raise exception '可用返饋金必須大於 NT$15' using errcode='22003';end if;
 if p_amount is null or p_amount<=15 or p_amount>9007199254740991 or p_amount>a.balance then raise exception '提領金額須為超過 NT$15 且不超過可用餘額的整數' using errcode='22003';end if;
 if b.user_id is null then raise exception '請先設定完整收款銀行資料' using errcode='22023';end if;
 s:=public.reward_withdrawal_schedule(statement_timestamp());
 if exists(select 1 from public.instructor_reward_withdrawals where user_id=auth.uid() and batch_date=(s->>'batch_date')::date and status<>'failed') then raise exception '本批次已有提領申請，請於下一批次再申請；明確失敗並退回後可重新申請' using errcode='55000';end if;
 return s||jsonb_build_object('selection_policy','single_per_batch_v1')||public.calculate_reward_withdrawal_deductions(p_amount)||jsonb_build_object('account_version',a.version,'bank_version',b.version,'bank',b.masked);end $$;

create or replace function public.post_reward_withdrawal(p_id uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$ declare w public.instructor_reward_withdrawals%rowtype;a public.instructor_reward_accounts%rowtype;bd bigint;wd bigint;begin
 select * into w from public.instructor_reward_withdrawals where id=p_id for update;
 if not found then raise exception 'Withdrawal missing';end if;
 perform 1 from auth.users where id=w.user_id for key share;
 select * into a from public.instructor_reward_accounts where user_id=w.user_id for update;
 if exists(select 1 from public.instructor_reward_ledger where withdrawal_id=p_id and event_type=p_event) then return;end if;
 if p_event='withdraw_reserve' and w.status='pending' and a.status='active' and a.balance>=w.amount then bd:=-w.amount;wd:=w.amount;
 elsif p_event='withdraw_complete' and w.status='paid' then bd:=0;wd:=-w.amount;
 elsif p_event='withdraw_release' and w.status='failed' then bd:=w.amount;wd:=-w.amount;
 else raise exception 'Invalid withdrawal accounting event' using errcode='55000';end if;
 if a.withdrawal_reserved_balance+wd<0 then raise exception 'Withdrawal reserve inconsistency' using errcode='23514';end if;
 update public.instructor_reward_accounts set balance=balance+bd,withdrawal_reserved_balance=withdrawal_reserved_balance+wd,version=version+1,updated_at=now() where user_id=w.user_id returning * into a;
 insert into public.instructor_reward_ledger(instructor_id,withdrawal_id,event_type,amount,balance_delta,pending_delta,balance_after,pending_after,reserved_after,withdrawal_reserved_delta,withdrawal_reserved_after,actor_user_id,reason_code)
 values(w.user_id,w.id,p_event,w.amount,bd,0,a.balance,a.pending_balance,a.reserved_balance,wd,a.withdrawal_reserved_balance,auth.uid(),p_event);end $$;

-- Keep the old no-argument endpoint compatible with full-amount clients.
create or replace function public.quote_my_reward_withdrawal()
returns jsonb language sql stable security definer set search_path='' as $$
 select public.quote_my_reward_withdrawal((select balance from public.instructor_reward_accounts where user_id=auth.uid())) $$;

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
 if jsonb_typeof(p_expected_quote->'amount') is distinct from 'number' or (p_expected_quote->>'amount') !~ '^[0-9]+$' then raise exception 'Invalid withdrawal amount' using errcode='22023';end if;
 q:=public.quote_my_reward_withdrawal((p_expected_quote->>'amount')::bigint);
 if q is distinct from p_expected_quote then raise exception '餘額、銀行資料或批次已變更，請重新確認' using errcode='40001';end if;
 insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,income_tax,supplementary_premium,deduction_policy_version,deduction_snapshot,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 select auth.uid(),p_request_key,(q->>'amount')::bigint,(q->>'net_amount')::bigint,(q->>'income_tax')::bigint,(q->>'supplementary_premium')::bigint,q->>'deduction_policy_version',q->'deduction_snapshot',cipher,masked,version,(q->>'batch_date')::date,(q->>'scheduled_date')::date from public.instructor_reward_bank_profiles where user_id=auth.uid() returning * into w;
 perform public.post_reward_withdrawal(w.id,'withdraw_reserve');
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id) values(w.id,p_request_key,'requested',auth.uid());
 return jsonb_build_object('id',w.id,'status',w.status);end $$;

create or replace function public.get_my_reward_withdrawals(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then raise exception '師資資格不足' using errcode='42501';end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset';end if;
 return jsonb_build_object('balance',coalesce((select balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'selection_policy','single_per_batch_v1',
 'withdrawal_batch',public.reward_withdrawal_schedule(statement_timestamp())||jsonb_build_object('blocked',exists(select 1 from public.instructor_reward_withdrawals where user_id=auth.uid() and batch_date=(public.reward_withdrawal_schedule(statement_timestamp())->>'batch_date')::date and status<>'failed')),
 'available_balance',coalesce((select greatest(0,balance) from public.instructor_reward_accounts where user_id=auth.uid() and status='active'),0),
 'withdrawal_estimate',public.calculate_reward_withdrawal_deductions(coalesce((select greatest(0,balance) from public.instructor_reward_accounts where user_id=auth.uid() and status='active'),0)),
 'shopping_reserved_balance',coalesce((select reserved_balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'withdrawal_reserved_balance',coalesce((select withdrawal_reserved_balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'bank',coalesce((select jsonb_build_object('version',version,'masked',masked) from public.instructor_reward_bank_profiles where user_id=auth.uid()),'null'),
 'total',(select count(*) from public.instructor_reward_withdrawals where user_id=auth.uid()),
 'withdrawals',coalesce((select jsonb_agg(public.reward_withdrawal_projection(id) order by created_at desc,id) from
 (select id,created_at from public.instructor_reward_withdrawals where user_id=auth.uid() order by created_at desc,id limit 20 offset p_offset) q),'[]'));end $$;

revoke all on function public.quote_my_reward_withdrawal(bigint) from public,anon,authenticated,service_role;
grant execute on function public.quote_my_reward_withdrawal(bigint) to authenticated;
notify pgrst,'reload schema';
commit;

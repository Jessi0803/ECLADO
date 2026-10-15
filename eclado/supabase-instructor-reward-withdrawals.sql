-- Stage 5, local/isolated first. No feature switch or bank transfer API.
begin;
do $stage5$ begin
 if to_regprocedure('public.request_my_reward_withdrawal(uuid,jsonb)') is not null then
  if to_regprocedure('public.manage_reward_withdrawal(uuid,uuid,text,bigint,jsonb)') is null then raise exception 'Partial stage 5 installation';end if;return;
 end if;
 execute $install5$
do $$ begin
 if to_regprocedure('public.reward_credit_event(text,text)') is null then raise exception 'Stage 4 is required';end if;
end $$;
alter table public.instructor_reward_accounts add column if not exists withdrawal_reserved_balance bigint not null default 0 check(withdrawal_reserved_balance>=0);
alter table public.instructor_reward_ledger alter column order_id drop not null;
alter table public.instructor_reward_ledger add column if not exists withdrawal_id uuid,
 add column if not exists withdrawal_reserved_delta bigint not null default 0,
 add column if not exists withdrawal_reserved_after bigint not null default 0 check(withdrawal_reserved_after>=0);
alter table public.instructor_reward_ledger drop constraint if exists reward_ledger_events_check,
 drop constraint if exists reward_ledger_deltas_check;
alter table public.instructor_reward_ledger add constraint reward_ledger_events_check check(event_type in
 ('pending','credit','cancel','reverse','spend_reserve','spend_consume','spend_release','spend_refund','withdraw_reserve','withdraw_complete','withdraw_release'));
alter table public.instructor_reward_ledger add constraint reward_ledger_source_check check(
 (order_id is not null and withdrawal_id is null and event_type not like 'withdraw_%') or
 (order_id is null and withdrawal_id is not null and event_type like 'withdraw_%'));
alter table public.instructor_reward_ledger add constraint reward_ledger_deltas_check check(
 (event_type='pending' and balance_delta=0 and pending_delta=amount and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=0) or
 (event_type='credit' and balance_delta=amount and pending_delta=-amount and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=0) or
 (event_type='cancel' and balance_delta=0 and pending_delta=-amount and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=0) or
 (event_type='reverse' and balance_delta=-amount and pending_delta=0 and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=0) or
 (event_type='spend_reserve' and balance_delta=-amount and pending_delta=0 and reserved_delta=amount and reservation_cycle>0 and withdrawal_reserved_delta=0) or
 (event_type='spend_consume' and balance_delta=0 and pending_delta=0 and reserved_delta=-amount and reservation_cycle>0 and withdrawal_reserved_delta=0) or
 (event_type='spend_release' and balance_delta=amount and pending_delta=0 and reserved_delta=-amount and reservation_cycle>0 and withdrawal_reserved_delta=0) or
 (event_type='spend_refund' and balance_delta=amount and pending_delta=0 and reserved_delta=0 and reservation_cycle>0 and withdrawal_reserved_delta=0) or
 (event_type='withdraw_reserve' and balance_delta=-amount and pending_delta=0 and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=amount) or
 (event_type='withdraw_complete' and balance_delta=0 and pending_delta=0 and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=-amount) or
 (event_type='withdraw_release' and balance_delta=amount and pending_delta=0 and reserved_delta=0 and reservation_cycle=0 and withdrawal_reserved_delta=-amount));
create unique index reward_ledger_withdrawal_event_idx on public.instructor_reward_ledger(withdrawal_id,event_type) where withdrawal_id is not null;

create table public.instructor_reward_bank_profiles(
 user_id uuid primary key,cipher jsonb not null,masked jsonb not null,version bigint not null default 1,updated_at timestamptz not null default now());
create table public.instructor_reward_withdrawals(
 id uuid primary key default extensions.gen_random_uuid(),user_id uuid not null,request_key uuid not null,
 amount bigint not null check(amount>15),fee bigint not null default 15 check(fee=15),net_amount bigint not null check(net_amount=amount-15),
 bank_cipher jsonb not null,bank_masked jsonb not null,bank_version bigint not null,
 batch_date date not null,scheduled_date date not null,
 status text not null default 'pending' check(status in('pending','processing','paid','failed','unknown')),
 version bigint not null default 1,processor_id uuid,processing_key uuid,
 transfer_date date,transfer_reference text,transferred_amount bigint,
 failure_reason text,fee_charged bigint not null default 0 check(fee_charged in(0,15)),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,request_key),
 check(scheduled_date>=batch_date),
 check((status='pending' and processor_id is null and processing_key is null) or(status<>'pending' and processor_id is not null and processing_key is not null)),
 check(status<>'paid' or (transfer_date is not null and transfer_reference is not null and transferred_amount=net_amount and fee_charged=15)),
 check(status<>'failed' or (failure_reason is not null and fee_charged=0)));
create index reward_withdrawal_user_idx on public.instructor_reward_withdrawals(user_id,created_at desc,id);
create index reward_withdrawal_queue_idx on public.instructor_reward_withdrawals(status,scheduled_date,id);
create table public.instructor_reward_withdrawal_events(
 id bigint generated always as identity primary key,withdrawal_id uuid not null,event_key uuid not null,event_type text not null,
 actor_user_id uuid not null,details jsonb not null default '{}',created_at timestamptz not null default now(),unique(withdrawal_id,event_key));
do $$ declare t text;begin
 foreach t in array array['instructor_reward_bank_profiles','instructor_reward_withdrawals','instructor_reward_withdrawal_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);end loop;
end $$;
revoke all on sequence public.instructor_reward_withdrawal_events_id_seq from public,anon,authenticated,service_role;
create trigger reward_withdrawal_events_immutable before update or delete on public.instructor_reward_withdrawal_events for each row execute function public.reject_instructor_reward_history_changes();

-- Dedicated capabilities: preserve every existing CHECK member, not a stale
-- replacement of the base permission list.
do $$ declare c record;d text;begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.backoffice_role_permissions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%permission%' loop
 d:=c.definition;if position('rewards.withdrawals.read' in d)=0 then
 execute format('alter table public.backoffice_role_permissions drop constraint %I',c.conname);
 execute format('alter table public.backoffice_role_permissions add constraint %I CHECK (permission in (''rewards.withdrawals.read'',''rewards.withdrawals.manage'') OR %s)',c.conname,substring(d from 7));end if;end loop;
end $$;
insert into public.backoffice_role_permissions(role,permission) values
 ('admin','rewards.withdrawals.read'),('admin','rewards.withdrawals.manage'),('super_admin','rewards.withdrawals.read'),('super_admin','rewards.withdrawals.manage') on conflict do nothing;

create or replace function public.assert_reward_withdrawal_admin(p_manage boolean)
returns void language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null or not public.is_eclado_admin() or not public.has_backoffice_permission(case when p_manage then 'rewards.withdrawals.manage' else 'rewards.withdrawals.read' end) then
 raise exception '提領管理權限不足' using errcode='42501';end if;end $$;
create or replace function public.save_reward_bank_profile(p_actor uuid,p_cipher jsonb,p_masked jsonb,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$ declare b public.instructor_reward_bank_profiles%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Bank service required' using errcode='42501';end if;
 perform 1 from auth.users where id=p_actor for key share;
 perform 1 from public.profiles where id=p_actor and role='instructor' for update;
 if not found then raise exception '師資資格不足' using errcode='42501';end if;
 -- Profile lock serializes the first insert as well as existing-row updates.
 select * into b from public.instructor_reward_bank_profiles where user_id=p_actor for update;
 if coalesce(b.version,0) is distinct from p_expected_version then raise exception '銀行資料已更新，請重新確認' using errcode='40001';end if;
 if p_cipher is null or p_masked is null or jsonb_typeof(p_cipher)<>'object' or p_cipher->>'kid' is null or p_cipher->>'iv' is null or p_cipher->>'tag' is null or p_cipher->>'data' is null
 or p_masked->>'bank_code' is null or p_masked->>'account' is null or p_masked->>'bank_code' !~ '^\d{3}$' or p_masked->>'account' !~ '^\*+[0-9]{4}$' or p_masked->>'holder' is null or p_masked->>'bank_name' is null or p_masked->>'branch' is null then raise exception 'Invalid encrypted bank data' using errcode='22023';end if;
 insert into public.instructor_reward_bank_profiles(user_id,cipher,masked) values(p_actor,p_cipher,p_masked)
 on conflict(user_id) do update set cipher=excluded.cipher,masked=excluded.masked,version=public.instructor_reward_bank_profiles.version+1,updated_at=now() returning * into b;
 return jsonb_build_object('version',b.version,'bank',b.masked);end $$;
create or replace function public.read_reward_bank_cipher(p_actor uuid,p_withdrawal_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare w public.instructor_reward_withdrawals%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Bank service required' using errcode='42501';end if;
 if p_withdrawal_id is null then
 if not exists(select 1 from public.profiles where id=p_actor and role='instructor') then raise exception '師資資格不足' using errcode='42501';end if;
 return (select jsonb_build_object('user_id',user_id,'cipher',cipher,'version',version) from public.instructor_reward_bank_profiles where user_id=p_actor);
 end if;
 if not exists(select 1 from public.admin_users a join public.backoffice_roles r on r.role=a.role and r.active
 join public.backoffice_role_permissions p on p.role=a.role and p.permission='rewards.withdrawals.manage'
 where a.user_id=p_actor and a.active and a.role in('admin','super_admin')) then raise exception 'Bank snapshot management permission required' using errcode='42501';end if;
 select * into w from public.instructor_reward_withdrawals where id=p_withdrawal_id;
 if not found then raise exception 'Withdrawal not found' using errcode='P0002';end if;
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id) values(w.id,extensions.gen_random_uuid(),'bank_snapshot_read',p_actor);
 return jsonb_build_object('user_id',w.user_id,'cipher',w.bank_cipher,'version',w.bank_version);end $$;

create or replace function public.reward_withdrawal_schedule(p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$ declare local_at timestamp:=p_at at time zone 'Asia/Taipei';batch date;begin
 batch:=(date_trunc('month',local_at)+interval '9 days')::date;
 if local_at>=batch::timestamp then batch:=(batch+interval '1 month')::date;end if;
 return jsonb_build_object('batch_date',batch,'scheduled_date',batch);end $$;
create or replace function public.quote_my_reward_withdrawal()
returns jsonb language plpgsql stable security definer set search_path='' as $$ declare a public.instructor_reward_accounts%rowtype;b public.instructor_reward_bank_profiles%rowtype;s jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then raise exception '師資資格不足' using errcode='42501';end if;
 select * into a from public.instructor_reward_accounts where user_id=auth.uid();
 select * into b from public.instructor_reward_bank_profiles where user_id=auth.uid();
 if a.user_id is null or a.status<>'active' or a.balance<=15 then raise exception '可用返饋金必須大於 NT$15' using errcode='22003';end if;
 if b.user_id is null then raise exception '請先設定完整收款銀行資料' using errcode='22023';end if;
 s:=public.reward_withdrawal_schedule(statement_timestamp());
 return s||jsonb_build_object('amount',a.balance,'fee',15,'net_amount',a.balance-15,'account_version',a.version,'bank_version',b.version,'bank',b.masked);end $$;

create or replace function public.guard_reward_withdrawal_history()
returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'Withdrawal history is immutable' using errcode='42501';end if;
 if (to_jsonb(new)-array['status','version','processor_id','processing_key','transfer_date','transfer_reference','transferred_amount','failure_reason','fee_charged','updated_at']) is distinct from
 (to_jsonb(old)-array['status','version','processor_id','processing_key','transfer_date','transfer_reference','transferred_amount','failure_reason','fee_charged','updated_at']) or old.status in('paid','failed') then raise exception 'Withdrawal snapshot/result is immutable' using errcode='42501';end if;
 return new;end $$;
create trigger reward_withdrawal_history_guard before update or delete on public.instructor_reward_withdrawals for each row execute function public.guard_reward_withdrawal_history();
create or replace function public.post_reward_withdrawal(p_id uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$ declare w public.instructor_reward_withdrawals%rowtype;a public.instructor_reward_accounts%rowtype;bd bigint;wd bigint;begin
 select * into w from public.instructor_reward_withdrawals where id=p_id for update;
 if not found then raise exception 'Withdrawal missing';end if;
 perform 1 from auth.users where id=w.user_id for key share;
 select * into a from public.instructor_reward_accounts where user_id=w.user_id for update;
 if exists(select 1 from public.instructor_reward_ledger where withdrawal_id=p_id and event_type=p_event) then return;end if;
 if p_event='withdraw_reserve' and w.status='pending' and a.status='active' and a.balance=w.amount then bd:=-w.amount;wd:=w.amount;
 elsif p_event='withdraw_complete' and w.status='paid' then bd:=0;wd:=-w.amount;
 elsif p_event='withdraw_release' and w.status='failed' then bd:=w.amount;wd:=-w.amount;
 else raise exception 'Invalid withdrawal accounting event' using errcode='55000';end if;
 if a.withdrawal_reserved_balance+wd<0 then raise exception 'Withdrawal reserve inconsistency' using errcode='23514';end if;
 update public.instructor_reward_accounts set balance=balance+bd,withdrawal_reserved_balance=withdrawal_reserved_balance+wd,version=version+1,updated_at=now() where user_id=w.user_id returning * into a;
 insert into public.instructor_reward_ledger(instructor_id,withdrawal_id,event_type,amount,balance_delta,pending_delta,balance_after,pending_after,reserved_after,withdrawal_reserved_delta,withdrawal_reserved_after,actor_user_id,reason_code)
 values(w.user_id,w.id,p_event,w.amount,bd,0,a.balance,a.pending_balance,a.reserved_balance,wd,a.withdrawal_reserved_balance,auth.uid(),p_event);end $$;
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
 insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 select auth.uid(),p_request_key,(q->>'amount')::bigint,(q->>'net_amount')::bigint,cipher,masked,version,(q->>'batch_date')::date,(q->>'scheduled_date')::date from public.instructor_reward_bank_profiles where user_id=auth.uid() returning * into w;
 perform public.post_reward_withdrawal(w.id,'withdraw_reserve');
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id) values(w.id,p_request_key,'requested',auth.uid());
 return jsonb_build_object('id',w.id,'status',w.status);end $$;

create or replace function public.manage_reward_withdrawal(p_id uuid,p_event_key uuid,p_action text,p_expected_version bigint,p_details jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$ declare w public.instructor_reward_withdrawals%rowtype;e public.instructor_reward_withdrawal_events%rowtype;begin
 perform public.assert_reward_withdrawal_admin(true);
 if p_event_key is null or p_details is null then raise exception 'Invalid management request' using errcode='22023';end if;
 select * into w from public.instructor_reward_withdrawals where id=p_id for update;
 if not found then raise exception 'Withdrawal not found' using errcode='P0002';end if;
 select * into e from public.instructor_reward_withdrawal_events where withdrawal_id=p_id and event_key=p_event_key;
 if found then
 if e.actor_user_id is distinct from auth.uid() or e.event_type is distinct from p_action or e.details is distinct from p_details then raise exception 'Idempotency key conflict' using errcode='40001';end if;
 return jsonb_build_object('id',w.id,'status',w.status,'version',w.version);end if;
 if w.version is distinct from p_expected_version then raise exception '提領狀態已更新，請重新整理' using errcode='40001';end if;
 if p_action='claim' and w.status='pending' then
 update public.instructor_reward_withdrawals set status='processing',processor_id=auth.uid(),processing_key=p_event_key,version=version+1,updated_at=now() where id=w.id returning * into w;
 elsif p_action in('paid','failed','unknown') and w.status in('processing','unknown') and w.processor_id=auth.uid() then
 if p_action='paid' then
 if (p_details->>'transfer_date') is null or (p_details->>'transfer_date')::date>(statement_timestamp() at time zone 'Asia/Taipei')::date or length(btrim(coalesce(p_details->>'reference','')))<1 or length(p_details->>'reference')>120 or (p_details->>'amount')::bigint is distinct from w.net_amount then raise exception '請填寫實際匯款日期、銀行交易序號與正確實匯金額' using errcode='22023';end if;
 update public.instructor_reward_withdrawals set status='paid',transfer_date=(p_details->>'transfer_date')::date,transfer_reference=btrim(p_details->>'reference'),transferred_amount=w.net_amount,fee_charged=15,version=version+1,updated_at=now() where id=w.id returning * into w;
 perform public.post_reward_withdrawal(w.id,'withdraw_complete');
 else
 if p_details->>'reason' is null or length(btrim(p_details->>'reason'))<1 or length(p_details->>'reason')>1000 or(p_action='failed' and p_details->'confirmed_unpaid' is distinct from 'true'::jsonb) then raise exception '請填寫原因；失敗須確認銀行未付款' using errcode='22023';end if;
 update public.instructor_reward_withdrawals set status=p_action,failure_reason=p_details->>'reason',version=version+1,updated_at=now() where id=w.id returning * into w;
 if p_action='failed' then perform public.post_reward_withdrawal(w.id,'withdraw_release');end if;
 end if;
 elsif p_action='correction' and w.status in('paid','failed') then
 if length(btrim(coalesce(p_details->>'reason','')))<1 or length(p_details->>'reason')>1000 then raise exception '更正需記錄原因' using errcode='22023';end if;
 else raise exception 'Invalid withdrawal transition or processor' using errcode='55000';end if;
 -- Whitelist excludes bank accounts, arbitrary PII and unknown client fields.
 if exists(select 1 from jsonb_object_keys(p_details) k where k not in('transfer_date','reference','amount','reason','confirmed_unpaid')) then raise exception 'Invalid management detail field' using errcode='22023';end if;
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id,details) values(w.id,p_event_key,p_action,auth.uid(),p_details);
 return jsonb_build_object('id',w.id,'status',w.status,'version',w.version);end $$;
create or replace function public.reward_withdrawal_projection(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',w.id,'user_id',w.user_id,'name',p.name,'amount',w.amount,'fee',w.fee,'net_amount',w.net_amount,'bank',w.bank_masked,
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
 'shopping_reserved_balance',coalesce((select reserved_balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'withdrawal_reserved_balance',coalesce((select withdrawal_reserved_balance from public.instructor_reward_accounts where user_id=auth.uid()),0),
 'bank',coalesce((select jsonb_build_object('version',version,'masked',masked) from public.instructor_reward_bank_profiles where user_id=auth.uid()),'null'),
 'total',(select count(*) from public.instructor_reward_withdrawals where user_id=auth.uid()),
 'withdrawals',coalesce((select jsonb_agg(public.reward_withdrawal_projection(id) order by created_at desc,id) from
 (select id,created_at from public.instructor_reward_withdrawals where user_id=auth.uid() order by created_at desc,id limit 20 offset p_offset) q),'[]'));end $$;
create or replace function public.get_admin_reward_withdrawals(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.assert_reward_withdrawal_admin(false);if p_offset is null or p_offset<0 then raise exception 'Invalid offset';end if;
 return jsonb_build_object('total',(select count(*) from public.instructor_reward_withdrawals),
 'withdrawals',coalesce((select jsonb_agg(public.reward_withdrawal_projection(id) order by created_at desc,id) from
 (select id,created_at from public.instructor_reward_withdrawals order by created_at desc,id limit 20 offset p_offset) q),'[]'));end $$;

-- Keep every existing financial row's running reserve snapshot accurate.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.append_instructor_reward_event(text,text)'::regprocedure);
 if position('actor_user_id,reserved_after)' in d)=0 then raise exception 'Stage 4 income source mismatch';end if;
 d:=replace(d,'actor_user_id,reserved_after)','actor_user_id,reserved_after,withdrawal_reserved_after)');
 d:=replace(d,'auth.uid(),account.reserved_balance);','auth.uid(),account.reserved_balance,account.withdrawal_reserved_balance);');execute d;
 d:=pg_get_functiondef('public.reward_credit_event(text,text)'::regprocedure);
 d:=replace(d,'reserved_after,reason_code)','reserved_after,withdrawal_reserved_after,reason_code)');
 d:=replace(d,'rd,a.reserved_balance,case p_event','rd,a.reserved_balance,a.withdrawal_reserved_balance,case p_event');execute d;
 d:=pg_get_functiondef('public.guard_instructor_reward_member_deletion()'::regprocedure);
 d:=replace(d,'account.reserved_balance<>0','account.reserved_balance<>0 or account.withdrawal_reserved_balance<>0');execute d;
 d:=pg_get_functiondef('public.instructor_reward_report_internal(uuid,integer,integer,integer)'::regprocedure);
 d:=replace(d,'''summary'',jsonb_build_object(','''summary'',jsonb_build_object(''withdrawal_reserved_balance'',coalesce((select withdrawal_reserved_balance from public.instructor_reward_accounts where user_id=p_instructor_id),0),');
 d:=replace(d,'''order_id'',l.order_id,','''withdrawal_id'',l.withdrawal_id,''withdrawal_reserved_after'',l.withdrawal_reserved_after,''order_id'',l.order_id,');execute d;
end $$;
create or replace function public.delete_reward_bank_profile_on_member_delete()
returns trigger language plpgsql security definer set search_path='' as $$ begin
 delete from public.instructor_reward_bank_profiles where user_id=old.id;return old;end $$;
create trigger reward_bank_profile_delete after delete on public.profiles for each row execute function public.delete_reward_bank_profile_on_member_delete();
revoke all on function public.assert_reward_withdrawal_admin(boolean),public.save_reward_bank_profile(uuid,jsonb,jsonb,bigint),public.read_reward_bank_cipher(uuid,uuid),
 public.reward_withdrawal_schedule(timestamptz),public.quote_my_reward_withdrawal(),public.guard_reward_withdrawal_history(),
 public.post_reward_withdrawal(uuid,text),public.request_my_reward_withdrawal(uuid,jsonb),public.manage_reward_withdrawal(uuid,uuid,text,bigint,jsonb),public.reward_withdrawal_projection(uuid),
 public.get_my_reward_withdrawals(integer),public.get_admin_reward_withdrawals(integer),public.delete_reward_bank_profile_on_member_delete() from public,anon,authenticated,service_role;
grant execute on function public.save_reward_bank_profile(uuid,jsonb,jsonb,bigint),public.read_reward_bank_cipher(uuid,uuid) to service_role;
grant execute on function public.quote_my_reward_withdrawal(),public.request_my_reward_withdrawal(uuid,jsonb),
 public.manage_reward_withdrawal(uuid,uuid,text,bigint,jsonb),public.get_my_reward_withdrawals(integer),public.get_admin_reward_withdrawals(integer) to authenticated;
notify pgrst,'reload schema';
$install5$;
end $stage5$;
commit;

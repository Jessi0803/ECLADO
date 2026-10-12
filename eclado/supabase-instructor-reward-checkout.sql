-- Phase 4 only: atomic versioned install. Never enables student pricing.
begin;
do $stage4$ begin
  if to_regprocedure('public.reward_credit_event(text,text)') is not null then
    if to_regprocedure('public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb)') is null then
      raise exception 'Partial stage 4 installation';end if;
    return;
  end if;
  execute $install$
do $$ begin
  if to_regprocedure('public.get_my_instructor_reward_report(integer,integer,integer)') is null
    or to_regprocedure('public.reserve_order_shopping_credit(uuid,text,bigint)') is null then
    raise exception 'Current 2A/2B/3 and shopping credit checkout are required'; end if;
  if has_function_privilege('authenticated','public.claim_order_payment(text,text)','EXECUTE') or has_function_privilege('anon','public.begin_order_payment_retry(text)','EXECUTE') then raise exception 'S1 ACL prerequisite failed';end if;
end $$;
alter table public.orders add column if not exists reward_credit_amount bigint not null default 0;
alter table public.instructor_reward_accounts add column if not exists reserved_balance bigint not null default 0 check(reserved_balance>=0);
alter table public.instructor_reward_ledger add column if not exists reservation_cycle integer not null default 0 check(reservation_cycle>=0),
  add column if not exists reason_code text,
  add column if not exists reserved_delta bigint not null default 0,
  add column if not exists reserved_after bigint not null default 0 check(reserved_after>=0);
alter table public.instructor_reward_ledger drop constraint if exists instructor_reward_ledger_event_type_check,
  drop constraint if exists instructor_reward_ledger_order_id_event_type_key;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.instructor_reward_ledger'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%balance_delta%' loop
    execute format('alter table public.instructor_reward_ledger drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.instructor_reward_ledger add constraint reward_ledger_events_check check(event_type in
  ('pending','credit','cancel','reverse','spend_reserve','spend_consume','spend_release','spend_refund'));
alter table public.instructor_reward_ledger add constraint reward_ledger_deltas_check check(
  (event_type='pending' and balance_delta=0 and pending_delta=amount and reserved_delta=0 and reservation_cycle=0)
  or(event_type='credit' and balance_delta=amount and pending_delta=-amount and reserved_delta=0 and reservation_cycle=0)
  or(event_type='cancel' and balance_delta=0 and pending_delta=-amount and reserved_delta=0 and reservation_cycle=0)
  or(event_type='reverse' and balance_delta=-amount and pending_delta=0 and reserved_delta=0 and reservation_cycle=0)
  or(event_type='spend_reserve' and balance_delta=-amount and pending_delta=0 and reserved_delta=amount and reservation_cycle>0)
  or(event_type='spend_consume' and balance_delta=0 and pending_delta=0 and reserved_delta=-amount and reservation_cycle>0)
  or(event_type='spend_release' and balance_delta=amount and pending_delta=0 and reserved_delta=-amount and reservation_cycle>0)
  or(event_type='spend_refund' and balance_delta=amount and pending_delta=0 and reserved_delta=0 and reservation_cycle>0));
create unique index if not exists reward_ledger_event_cycle_idx on public.instructor_reward_ledger(order_id,event_type,reservation_cycle);
create table public.instructor_reward_reservations(
  order_id text primary key,user_id uuid not null,amount bigint not null check(amount>0),
  cycle integer not null check(cycle>0),status text not null check(status in('reserved','consumed','released','refunded')),
  provider_order_no text,updated_at timestamptz not null default now());
create table public.instructor_reward_payment_exceptions(
  order_id text primary key,reason text not null check(reason in('payment_after_release','payment_after_termination')),
  created_at timestamptz not null default now());
alter table public.instructor_reward_reservations enable row level security;
alter table public.instructor_reward_payment_exceptions enable row level security;
revoke all on public.instructor_reward_reservations,public.instructor_reward_payment_exceptions from public,anon,authenticated,service_role;
create index reward_reservations_account_idx on public.instructor_reward_reservations(user_id,status);
create trigger reward_payment_exceptions_immutable before update or delete on public.instructor_reward_payment_exceptions
  for each row execute function public.reject_instructor_reward_history_changes();

-- Caller holds order before Auth/profile/account; income writers use the same
-- Auth-parent/account order. Each reservation cycle has exactly one event/type.
create or replace function public.reward_credit_event(p_order_id text,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;r public.instructor_reward_reservations%rowtype;
  a public.instructor_reward_accounts%rowtype;bd bigint:=0;rd bigint:=0;cy integer;
begin
  select * into target from public.orders where id=p_order_id for update;
  if not found or target.reward_credit_amount=0 then return;end if;
  select * into r from public.instructor_reward_reservations where order_id=p_order_id for update;
  perform 1 from auth.users where id=coalesce(r.user_id,target.user_id) for key share;
  if p_event='reserve' and r.status in('reserved','consumed') then return;end if;
  if p_event='reserve' then
    perform 1 from public.profiles where id=target.user_id and role='instructor' for share;
    if not found or target.order_source<>'online' or target.status not in('awaiting_confirm','unpaid') then
      raise exception '師資返饋金使用資格不足' using errcode='42501';end if;
  end if;
  select * into a from public.instructor_reward_accounts where user_id=coalesce(r.user_id,target.user_id) for update;
  if not found then raise exception '返饋金帳戶不存在' using errcode='22003';end if;
  if p_event='reserve' then
    if r.status in('reserved','consumed') then return;end if;
    if r.status='refunded' or a.status<>'active' or a.balance<target.reward_credit_amount then
      raise exception '可用返饋金不足或帳戶不可用' using errcode='22003';end if;
    cy:=coalesce(r.cycle,0)+1;bd:=-target.reward_credit_amount;rd:=target.reward_credit_amount;
    insert into public.instructor_reward_reservations(order_id,user_id,amount,cycle,status,provider_order_no)
      values(p_order_id,target.user_id,target.reward_credit_amount,cy,'reserved',
        (select provider_order_no from public.order_payment_authorizations where order_id=p_order_id))
      on conflict(order_id) do update set cycle=excluded.cycle,status='reserved',provider_order_no=excluded.provider_order_no,updated_at=now()
      returning * into r;
  else
    if r.order_id is null then raise exception '返饋金保留紀錄不存在' using errcode='23514';end if;
    if p_event='consume' then
      if r.status='consumed' then return;end if;
      if r.status<>'reserved' then raise exception '返饋金已釋放，付款須人工處理' using errcode='55000';end if;
      if not exists(select 1 from public.instructor_reward_payment_receipts where order_id=p_order_id and amount=target.payment_amount) then
        raise exception '有效收款證據不足' using errcode='42501';end if;
      rd:=-r.amount;
    elsif p_event='release' then
      if r.status in('released','refunded','consumed') then return;end if;bd:=r.amount;rd:=-r.amount;
    elsif p_event='refund' then
      if r.status='refunded' then return;end if;
      if r.status<>'consumed' then raise exception '返饋金尚未扣用' using errcode='55000';end if;bd:=r.amount;
    else raise exception 'Invalid reward wallet event';end if;
    if a.reserved_balance+rd<0 then raise exception '返饋金保留額不一致' using errcode='23514';end if;
    update public.instructor_reward_reservations set status=case p_event when 'consume' then 'consumed' when 'release' then 'released' else 'refunded' end,
      updated_at=now() where order_id=p_order_id;
  end if;
  update public.instructor_reward_accounts set balance=balance+bd,reserved_balance=reserved_balance+rd,
    version=version+1,updated_at=now() where user_id=r.user_id returning * into a;
  insert into public.instructor_reward_ledger(instructor_id,order_id,event_type,amount,balance_delta,pending_delta,balance_after,pending_after,
    actor_user_id,reservation_cycle,reserved_delta,reserved_after,reason_code)
    values(r.user_id,p_order_id,'spend_'||p_event,r.amount,bd,0,a.balance,a.pending_balance,auth.uid(),r.cycle,rd,a.reserved_balance,case p_event when 'reserve' then case when r.cycle=1 then 'order_checkout' else 'payment_retry' end when 'consume' then 'verified_payment' when 'refund' then 'order_return_or_cancel' else case when target.status in('cancelled','returned') then case when target.payment_due_at<=now() then 'order_expired' else 'order_cancelled' end else 'verified_payment_failed' end end);
end $$;

create or replace function public.settle_order_reward_credit(p_order_id text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;r public.instructor_reward_reservations%rowtype;
begin
  select * into target from public.orders where id=p_order_id for update;
  if not found or target.reward_credit_amount=0 then return;end if;
  select * into r from public.instructor_reward_reservations where order_id=p_order_id for update;
  if not exists(select 1 from public.instructor_reward_payment_receipts where order_id=p_order_id) then return;end if;
  if r.status='refunded' then return;end if;
  if target.status in('cancelled','returned') or r.status='released' then
    insert into public.instructor_reward_payment_exceptions(order_id,reason)
      values(p_order_id,case when target.status in('cancelled','returned') then 'payment_after_termination' else 'payment_after_release' end)
      on conflict do nothing;
    return;
  end if;
  if r.status='reserved' then perform public.reward_credit_event(p_order_id,'consume');end if;
end $$;
create or replace function public.sync_reward_credit_order()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.reward_credit_amount>0 and new.status in('cancelled','returned') then
    if exists(select 1 from public.instructor_reward_reservations where order_id=new.id and status='consumed') then
      perform public.reward_credit_event(new.id,'refund');
    else perform public.reward_credit_event(new.id,'release');end if;
  end if;
  return new;
end $$;
create trigger sync_reward_credit_order after update of status on public.orders for each row execute function public.sync_reward_credit_order();
create or replace function public.guard_reward_credit_order()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if tg_op='DELETE' and old.reward_credit_amount=0 then return old;end if;
  if old.reward_credit_amount>0 then
    if tg_op='DELETE' then raise exception '返饋金訂單必須保留帳務歷史' using errcode='55000';end if;
    if new.reward_credit_amount is distinct from old.reward_credit_amount then raise exception 'Order reward tender is immutable' using errcode='42501';end if;
    if old.status in('cancelled','returned') and new.status not in('cancelled','returned') then
      raise exception 'Cancelled reward wallet orders cannot reopen' using errcode='55000';end if;
    if new.status in('paid','preparing','ready_for_pickup','picked_up','shipped','delivered')
      and (not exists(select 1 from public.instructor_reward_payment_receipts where order_id=old.id)
        or exists(select 1 from public.instructor_reward_payment_exceptions where order_id=old.id)
        or not exists(select 1 from public.instructor_reward_reservations where order_id=old.id and status='consumed')) then
      raise exception '返饋金訂單須有效收款且完成扣用，異常須人工處理' using errcode='55000';end if;
  elsif new.reward_credit_amount is distinct from old.reward_credit_amount then
    raise exception 'Order reward tender is immutable' using errcode='42501';
  end if;
  return new;
end $$;
create trigger guard_reward_credit_order before update or delete on public.orders for each row execute function public.guard_reward_credit_order();

-- A failure marker only applies to the current provider attempt and cannot
-- override an already verified success. Network/unknown outcomes are not failure.
create or replace function public.record_reward_credit_payment_failure(p_order_id text,p_provider_order_no text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Payment service required' using errcode='42501';end if;
  select * into target from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found';end if;
  if target.reward_credit_amount=0 then return jsonb_build_object('applicable',false);end if;
  if exists(select 1 from public.order_payment_authorizations where order_id=p_order_id and provider_order_no=p_provider_order_no)
    and not exists(select 1 from public.instructor_reward_payment_receipts where order_id=p_order_id) then
    perform public.reward_credit_event(p_order_id,'release');
  end if;
  return jsonb_build_object('applicable',true);
end $$;

create or replace function public.get_my_reward_credit()
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then
    raise exception '師資資格不足' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('balance',balance,'available_balance',case when status='active' then greatest(0,balance) else 0 end,
    'reserved_balance',reserved_balance,'version',version) from public.instructor_reward_accounts where user_id=auth.uid()),
    jsonb_build_object('balance',0,'available_balance',0,'reserved_balance',0,'version',0));
end $$;

create or replace function public.quote_order_with_wallets(p_items jsonb,p_fulfillment_method text,p_coupon_code text,p_guest_email text,
  p_shopping_credit_amount bigint,p_reward_credit_amount bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q jsonb;maximum bigint;sc bigint:=coalesce(p_shopping_credit_amount,0);rc bigint:=coalesce(p_reward_credit_amount,0);a public.instructor_reward_accounts%rowtype;
begin
  if sc<0 or rc<0 then raise exception 'Wallet amount cannot be negative' using errcode='22023';end if;
  if rc>0 and (auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor')) then
    raise exception '師資返饋金使用資格不足' using errcode='42501';end if;
  q:=public.quote_order_pricing(p_items,p_fulfillment_method,p_coupon_code,p_guest_email);
  maximum:=greatest(0,least(floor((q->>'subtotal')::numeric-(q->>'discount')::numeric),floor((q->>'total')::numeric-1)))::bigint;
  if sc+rc>maximum then raise exception '雙錢包超過商品折抵上限或銀行最低 NT$1' using errcode='22003';end if;
  if sc>0 and (auth.uid() is null or not exists(select 1 from public.shopping_credit_accounts where user_id=auth.uid() and status='active' and available_balance>=sc)) then
    raise exception '可用購物金不足' using errcode='22003';end if;
  if rc>0 then
    perform 1 from public.profiles where id=auth.uid() and role='instructor';
    if not found then raise exception '師資返饋金使用資格不足' using errcode='42501';end if;
    select * into a from public.instructor_reward_accounts where user_id=auth.uid();
    if a.user_id is null or a.status<>'active' or a.balance<rc then raise exception '可用返饋金不足' using errcode='22003';end if;
  end if;
  return q||jsonb_build_object('shopping_credit_amount',sc,'reward_credit_amount',rc,'payment_amount',(q->>'total')::numeric-sc-rc,
    'wallet_maximum',maximum,'reward_account_version',coalesce(a.version,0));
end $$;
create or replace function public.create_order_with_wallets(
  p_items jsonb,p_member text,p_address text,p_phone text,p_email text,p_note text,p_payment_method text,p_fulfillment_method text,
  p_coupon_code text,p_invoice_type text,p_invoice_company_name text,p_invoice_tax_id text,
  p_shopping_credit_amount bigint,p_reward_credit_amount bigint,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb;result jsonb;rc bigint:=coalesce(p_reward_credit_amount,0);
begin
  if rc>0 then
    perform 1 from auth.users where id=auth.uid() for key share;
    perform 1 from public.profiles where id=auth.uid() for share;
    perform 1 from public.shopping_credit_accounts where user_id=auth.uid() for update;
    perform 1 from public.instructor_reward_accounts where user_id=auth.uid() for update;
  end if;
  q:=public.quote_order_with_wallets(p_items,p_fulfillment_method,p_coupon_code,p_email,p_shopping_credit_amount,rc);
  if p_expected_quote is null or public.student_price_confirmation(q) is distinct from public.student_price_confirmation(p_expected_quote)
    or q->'payment_amount' is distinct from p_expected_quote->'payment_amount'
    or q->'shopping_credit_amount' is distinct from p_expected_quote->'shopping_credit_amount'
    or q->'reward_credit_amount' is distinct from p_expected_quote->'reward_credit_amount'
    or (rc>0 and q->'reward_account_version' is distinct from p_expected_quote->'reward_account_version') then
    raise exception '錢包或報價已變動，請重新確認' using errcode='40001';end if;
  perform set_config('app.eclado_order_reward_credit_amount',rc::text,true);
  result:=public.create_order_with_pricing(p_items,p_member,p_address,p_phone,p_email,p_note,p_payment_method,p_fulfillment_method,
    p_coupon_code,p_invoice_type,p_invoice_company_name,p_invoice_tax_id,p_shopping_credit_amount,p_expected_quote);
  perform set_config('app.eclado_order_reward_credit_amount','0',true);
  if rc>0 then perform public.reward_credit_event(result->>'order_id','reserve');end if;
  return result||jsonb_build_object('reward_credit_amount',rc,'payment_amount',(result->>'total')::numeric-coalesce(p_shopping_credit_amount,0)-rc);
end $$;

-- Narrow, asserted patches retain installed wrappers, especially assisted
-- defaults and S1 service-only ACLs. Never rerun historical payment migrations.
do $patch$ declare d text;old text;begin
  d:=pg_get_functiondef('public.set_order_payment_amount_defaults()'::regprocedure);
  old:='new.payment_amount := new.total - requested_credit;';
  if position(old in d)=0 then raise exception 'Payment defaults source mismatch';end if;
  d:=replace(d,old,$r$new.reward_credit_amount:=coalesce(nullif(current_setting('app.eclado_order_reward_credit_amount',true),''),'0')::bigint;
  if new.reward_credit_amount<0 or requested_credit+new.reward_credit_amount>maximum_credit then raise exception '雙錢包超過商品折抵上限或銀行最低 NT$1' using errcode='22003';end if;
  if new.reward_credit_amount>0 and (new.user_id is distinct from auth.uid() or new.order_source<>'online'
    or not exists(select 1 from public.profiles where id=new.user_id and role='instructor')) then raise exception '師資返饋金使用資格不足' using errcode='42501';end if;
  new.payment_amount := new.total - requested_credit - new.reward_credit_amount;
  new.pricing_snapshot:=jsonb_set(coalesce(new.pricing_snapshot,'{}'::jsonb),'{reward_credit_amount}',to_jsonb(new.reward_credit_amount),true);$r$);
  execute d;
  d:=pg_get_functiondef('public.append_instructor_reward_event(text,text)'::regprocedure);
  d:=replace(d,'balance_after,pending_after,actor_user_id)','balance_after,pending_after,actor_user_id,reserved_after)');
  d:=replace(d,'account.balance,account.pending_balance,auth.uid());','account.balance,account.pending_balance,auth.uid(),account.reserved_balance);');execute d;
  d:=pg_get_functiondef('public.guard_instructor_reward_member_deletion()'::regprocedure);
  d:=replace(d,'account.balance<>0 or account.pending_balance<>0','account.balance<>0 or account.reserved_balance<>0 or account.pending_balance<>0');execute d;
  d:=pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure);
  old:='next_attempt := greatest';if position(old in d)=0 then raise exception 'Retry source mismatch';end if;
  d:=replace(d,old,$r$if target_order.reward_credit_amount>0 then
    if (payment_auth.claimed_at is not null and payment_auth.gateway_created_at is null)
      or (payment_auth.attempt_no>instruction.attempt_no and not exists(select 1 from public.order_payment_attempts where provider_order_no=payment_auth.provider_order_no and payment_state='failed')) then
      raise exception 'Reward payment retry result unresolved' using errcode='55P03';end if;
    if exists(select 1 from public.instructor_reward_payment_exceptions where order_id=p_order_id)
      or exists(select 1 from public.instructor_reward_payment_receipts where order_id=p_order_id) then
      raise exception '已收款或帳務異常，不可重試' using errcode='55000';end if;
    perform public.reward_credit_event(p_order_id,'reserve');
  end if;
  next_attempt := greatest$r$);
  d:=replace(d,'  return jsonb_build_object(','  update public.instructor_reward_reservations set provider_order_no=next_provider_order_no where order_id=p_order_id and status=''reserved'';
  return jsonb_build_object(');execute d;
  -- Existing proof entry points now cover instructor spending orders as well.
  foreach old in array array['public.record_verified_instructor_reward_payment(text,text,text)','public.confirm_admin_instructor_reward_payment(text,boolean)'] loop
    d:=pg_get_functiondef(old::regprocedure);
    d:=replace(d,'if not exists(select 1 from public.student_reward_snapshots where order_id=p_order_id) then',
      'if target.reward_credit_amount=0 and not exists(select 1 from public.student_reward_snapshots where order_id=p_order_id) then');
    d:=replace(d,$text$perform public.reconcile_instructor_reward_order(p_order_id);$text$,'perform public.reconcile_instructor_reward_order(p_order_id); perform public.settle_order_reward_credit(p_order_id);');
    d:=replace(d,$text$return jsonb_build_object('applicable',true,'confirmed',true);$text$, $text$return jsonb_build_object('applicable',true,'confirmed',true,'payment_blocked',exists(select 1 from public.instructor_reward_payment_exceptions where order_id=p_order_id));$text$);execute d;
  end loop;
  d:=pg_get_functiondef('public.get_admin_reward_payment_requirement(text)'::regprocedure);
  d:=replace(d,$text$'applicable',exists(select 1 from public.student_reward_snapshots where order_id=p_order_id)$text$,
    $text$'applicable',exists(select 1 from public.orders where id=p_order_id and reward_credit_amount>0) or exists(select 1 from public.student_reward_snapshots where order_id=p_order_id)$text$);execute d;
end $patch$;
alter table public.orders drop constraint if exists orders_payment_amount_consistency_check;
alter table public.orders add constraint orders_payment_amount_consistency_check check(payment_amount+shopping_credit_amount+reward_credit_amount=total),
  add constraint orders_reward_credit_amount_check check(reward_credit_amount>=0 and (reward_credit_amount=0 or (order_source='online' and payment_amount>=1)));

-- New service proof contract validates the bank-returned amount before
-- spending. Legacy 3-argument bank callers cannot consume reward tender.
create or replace function public.record_verified_reward_wallet_payment(
 p_order_id text,p_provider_order_no text,p_proof_kind text,p_bank_amount numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Payment service required' using errcode='42501';end if;
 select * into target from public.orders where id=p_order_id for update;
 if not found then raise exception 'Order not found';end if;
 if target.reward_credit_amount>0 then
   if p_bank_amount is null or (p_bank_amount<>target.payment_amount and p_bank_amount<>round(target.payment_amount*100)) then
     raise exception 'Bank payment amount missing or mismatched' using errcode='23514';end if;
   perform set_config('app.eclado_verified_reward_amount',target.payment_amount::text,true);
 end if;
 result:=public.record_verified_instructor_reward_payment(p_order_id,p_provider_order_no,p_proof_kind);
 perform set_config('app.eclado_verified_reward_amount','',true);
 return result;
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.record_verified_instructor_reward_payment(text,text,text)'::regprocedure);
 d:=replace(d,'  if not exists(select 1 from public.order_payment_attempts', $guard$  if target.reward_credit_amount>0 and nullif(current_setting('app.eclado_verified_reward_amount',true),'')::numeric is distinct from target.payment_amount then raise exception 'Reward wallet bank amount verification required' using errcode='42501';end if;
  if not exists(select 1 from public.order_payment_attempts$guard$);execute d;
end $$;
revoke all on function public.record_verified_reward_wallet_payment(text,text,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.record_verified_reward_wallet_payment(text,text,text,numeric) to service_role;

-- Explicitly reject unsupported assisted tender; existing AUTO/MANUAL and
-- ordinary shopping credit behavior remain unchanged.
do $$ declare d text;begin
  d:=pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure);
  if position(E'begin\n' in d)=0 then raise exception 'Assisted quote source mismatch';end if;
  d:=replace(d,E'begin\n',$guard$begin
  if coalesce(p_payload->>'reward_credit_amount','0')<>'0' then raise exception '代客訂單不支援返饋金折抵' using errcode='42501';end if;
$guard$);
  execute d;
end $$;

-- Extend read-only projections with reserve totals and scoped exception flags.
do $$ declare d text;begin
  d:=pg_get_functiondef('public.instructor_reward_report_internal(uuid,integer,integer,integer)'::regprocedure);
  d:=replace(d,$text$'summary',jsonb_build_object($text$,$text$'summary',jsonb_build_object('reserved_balance',coalesce((select reserved_balance from public.instructor_reward_accounts where user_id=p_instructor_id),0),$text$);
  d:=replace(d,$text$'order_count',$text$, $text$'payment_exceptions',coalesce((select jsonb_agg(jsonb_build_object('order_id',e.order_id,'reason',e.reason,'created_at',e.created_at)) from public.instructor_reward_payment_exceptions e join public.instructor_reward_reservations r on r.order_id=e.order_id where r.user_id=p_instructor_id),'[]'::jsonb),'order_count',$text$);
  d:=replace(d,$text$'pending_after',l.pending_after,$text$, $text$'pending_after',l.pending_after,'reserved_after',l.reserved_after,$text$);execute d;
  d:=pg_get_functiondef('public.get_admin_instructor_reward_accounts(integer,integer)'::regprocedure);
  d:=replace(d,'a.status account_status,',$text$a.reserved_balance,(select count(*) from public.instructor_reward_payment_exceptions e join public.instructor_reward_reservations r on r.order_id=e.order_id where r.user_id=ids.id) exception_count,a.status account_status,$text$);execute d;
end $$;

-- Record exact current authoritative return amount without changing S1 auth.
-- claim.total already equals payment_amount in the installed checkout wrapper.
do $$ declare d text;begin
  d:=pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure);
  if position('target_order.payment_amount' in d)=0 then raise exception 'Gateway amount contract mismatch';end if;
  d:=replace(d,'  update public.order_payment_authorizations','  if target_order.reward_credit_amount>0 and not exists(select 1 from public.instructor_reward_reservations where order_id=p_order_id and status=''reserved'') then raise exception ''返饋金已釋放，請使用付款重試重新保留'' using errcode=''55000'';end if;
  update public.order_payment_authorizations');execute d;
end $$;
revoke all on function public.reward_credit_event(text,text),public.settle_order_reward_credit(text),public.sync_reward_credit_order(),public.guard_reward_credit_order(),
  public.record_reward_credit_payment_failure(text,text),public.get_my_reward_credit(),public.quote_order_with_wallets(jsonb,text,text,text,bigint,bigint),
  public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_reward_credit_payment_failure(text,text) to service_role;
grant execute on function public.get_my_reward_credit() to authenticated;
grant execute on function public.quote_order_with_wallets(jsonb,text,text,text,bigint,bigint),
  public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb) to anon,authenticated;
notify pgrst,'reload schema';

$install$;
end $stage4$;
commit;

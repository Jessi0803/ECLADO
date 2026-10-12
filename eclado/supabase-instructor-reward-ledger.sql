-- Phase 2B only. Isolation first. Never enables student pricing.
begin;
do $$ begin
  if to_regclass('public.student_reward_snapshots') is null then raise exception '2A is required'; end if;
end $$;
create table if not exists public.instructor_reward_accounts(
  user_id uuid primary key,
  balance bigint not null default 0,
  pending_balance bigint not null default 0 check(pending_balance>=0),
  status text not null default 'active' check(status in('active','closed')),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.instructor_reward_order_states(
  order_id text primary key,
  instructor_id uuid not null,
  amount bigint not null check(amount>=0),
  status text not null check(status in('pending','credited','cancelled','reversed')),
  updated_at timestamptz not null default now()
);
create table if not exists public.instructor_reward_ledger(
  id bigint generated always as identity primary key,
  instructor_id uuid not null,
  order_id text not null,
  event_type text not null check(event_type in('pending','credit','cancel','reverse')),
  amount bigint not null check(amount>=0),
  balance_delta bigint not null,
  pending_delta bigint not null,
  balance_after bigint not null,
  pending_after bigint not null check(pending_after>=0),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  unique(order_id,event_type),
  check((event_type='pending' and balance_delta=0 and pending_delta=amount)
    or(event_type='credit' and balance_delta=amount and pending_delta=-amount)
    or(event_type='cancel' and balance_delta=0 and pending_delta=-amount)
    or(event_type='reverse' and balance_delta=-amount and pending_delta=0))
);
create index if not exists instructor_reward_ledger_account_idx on public.instructor_reward_ledger(instructor_id,id);
create table if not exists public.instructor_reward_payment_receipts(
  order_id text primary key,
  source text not null check(source in('bank','admin')),
  amount bigint not null check(amount>0),
  provider_order_no text,
  proof_kind text not null check(proof_kind in('order_query','pay_query','admin_confirmation')),
  actor_user_id uuid,
  confirmed_at timestamptz not null default now(),
  check((source='bank' and provider_order_no is not null and proof_kind in('order_query','pay_query'))
    or(source='admin' and actor_user_id is not null and proof_kind='admin_confirmation'))
);
do $$ declare t text; begin
  foreach t in array array['instructor_reward_accounts','instructor_reward_order_states','instructor_reward_ledger','instructor_reward_payment_receipts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
revoke all on sequence public.instructor_reward_ledger_id_seq from public,anon,authenticated,service_role;

create or replace function public.reject_instructor_reward_history_changes()
returns trigger language plpgsql set search_path='' as $$ begin
  raise exception 'Reward accounting history is immutable' using errcode='42501';
end $$;
drop trigger if exists trg_reward_ledger_immutable on public.instructor_reward_ledger;
create trigger trg_reward_ledger_immutable before update or delete on public.instructor_reward_ledger
  for each row execute function public.reject_instructor_reward_history_changes();
drop trigger if exists trg_reward_receipt_immutable on public.instructor_reward_payment_receipts;
create trigger trg_reward_receipt_immutable before update or delete on public.instructor_reward_payment_receipts
  for each row execute function public.reject_instructor_reward_history_changes();

-- All callers lock the order first. Auth parent precedes the account lock so
-- deletion cannot slip between the guard check and a new financial event.
create or replace function public.append_instructor_reward_event(p_order_id text,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare state public.instructor_reward_order_states%rowtype;
  account public.instructor_reward_accounts%rowtype; bd bigint:=0; pd bigint:=0;
begin
  select * into state from public.instructor_reward_order_states where order_id=p_order_id for update;
  if not found then raise exception 'Reward order state missing'; end if;
  if exists(select 1 from public.instructor_reward_ledger where order_id=p_order_id and event_type=p_event) then return; end if;
  perform 1 from auth.users where id=state.instructor_id for key share;
  insert into public.instructor_reward_accounts(user_id) values(state.instructor_id) on conflict do nothing;
  select * into account from public.instructor_reward_accounts where user_id=state.instructor_id for update;
  if p_event='pending' then
    if account.status<>'active' then raise exception 'Reward account is closed' using errcode='55000'; end if;
    pd:=state.amount;
  elsif p_event='credit' and state.status='pending' then bd:=state.amount;pd:=-state.amount;
  elsif p_event='cancel' and state.status='pending' then pd:=-state.amount;
  elsif p_event='reverse' and state.status='credited' then bd:=-state.amount;
  else raise exception 'Invalid reward accounting transition' using errcode='55000'; end if;
  update public.instructor_reward_accounts set balance=balance+bd,pending_balance=pending_balance+pd,
    version=version+1,updated_at=now() where user_id=state.instructor_id returning * into account;
  insert into public.instructor_reward_ledger(instructor_id,order_id,event_type,amount,balance_delta,pending_delta,
    balance_after,pending_after,actor_user_id)
  values(state.instructor_id,p_order_id,p_event,state.amount,bd,pd,account.balance,account.pending_balance,auth.uid());
  if p_event<>'pending' then
    update public.instructor_reward_order_states set status=case p_event when 'credit' then 'credited'
      when 'cancel' then 'cancelled' else 'reversed' end,updated_at=now() where order_id=p_order_id;
  end if;
end $$;

create or replace function public.reconcile_instructor_reward_order(p_order_id text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype; state public.instructor_reward_order_states%rowtype;
begin
  select * into target from public.orders where id=p_order_id for update;
  if not found then return; end if;
  select * into state from public.instructor_reward_order_states where order_id=p_order_id for update;
  if not found or state.status in('cancelled','reversed') then return; end if;
  if target.status in('cancelled','returned') then
    perform public.append_instructor_reward_event(p_order_id,case state.status when 'pending' then 'cancel' else 'reverse' end);
  elsif state.status='pending' and target.status=(case when target.fulfillment_method='onsite_pickup' then 'picked_up' else 'delivered' end)
    and exists(select 1 from public.instructor_reward_payment_receipts where order_id=p_order_id
      and amount=coalesce(target.payment_amount,target.total)) then
    perform public.append_instructor_reward_event(p_order_id,'credit');
  end if;
end $$;

create or replace function public.initialize_instructor_reward_order()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.orders where id=new.order_id for update;
  insert into public.instructor_reward_order_states(order_id,instructor_id,amount,status)
    values(new.order_id,new.instructor_id,new.total_reward,'pending');
  perform public.append_instructor_reward_event(new.order_id,'pending');
  perform public.reconcile_instructor_reward_order(new.order_id);
  return new;
end $$;
drop trigger if exists trg_initialize_reward_order on public.student_reward_snapshots;
create trigger trg_initialize_reward_order after insert on public.student_reward_snapshots
  for each row execute function public.initialize_instructor_reward_order();

create or replace function public.guard_instructor_reward_order_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.instructor_reward_order_states where order_id=old.id) then
    if tg_op='DELETE' then return old; end if;return new;
  end if;
  if tg_op='DELETE' then
    if exists(select 1 from public.instructor_reward_ledger where order_id=old.id and event_type='credit') then
      raise exception 'Paid reward orders must retain their accounting records' using errcode='55000';
    end if;
    if exists(select 1 from public.instructor_reward_order_states where order_id=old.id and status='pending') then
      perform public.append_instructor_reward_event(old.id,'cancel');
    end if;
    return old;
  end if;
  if old.status in('cancelled','returned') and new.status not in('cancelled','returned') then
    raise exception 'Cancelled or returned reward orders cannot reopen' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_reward_order on public.orders;
create trigger trg_guard_reward_order before update of status or delete on public.orders
  for each row execute function public.guard_instructor_reward_order_lifecycle();
create or replace function public.sync_instructor_reward_order_status()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  perform public.reconcile_instructor_reward_order(new.id);return new;
end $$;
drop trigger if exists trg_sync_reward_order_status on public.orders;
create trigger trg_sync_reward_order_status after update of status on public.orders
  for each row execute function public.sync_instructor_reward_order_status();

create or replace function public.record_verified_instructor_reward_payment(
  p_order_id text,p_provider_order_no text,p_proof_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Verified payment service required' using errcode='42501'; end if;
  if p_proof_kind is null or p_proof_kind not in('order_query','pay_query') then
    raise exception 'Invalid bank verification proof' using errcode='22023'; end if;
  select * into target from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.student_reward_snapshots where order_id=p_order_id) then
    return jsonb_build_object('applicable',false);
  end if;
  if not exists(select 1 from public.order_payment_attempts where order_id=p_order_id and provider_order_no=p_provider_order_no)
    and not exists(select 1 from public.order_payment_instructions where order_id=p_order_id and provider_order_no=p_provider_order_no)
    and not exists(select 1 from public.order_payment_authorizations where order_id=p_order_id and provider_order_no=p_provider_order_no) then
    raise exception 'Payment attempt does not belong to order' using errcode='22023'; end if;
  insert into public.instructor_reward_payment_receipts(order_id,source,amount,provider_order_no,proof_kind)
    values(p_order_id,'bank',coalesce(target.payment_amount,target.total)::bigint,p_provider_order_no,p_proof_kind)
    on conflict(order_id) do nothing;
  perform public.reconcile_instructor_reward_order(p_order_id);
  return jsonb_build_object('applicable',true,'confirmed',true);
end $$;

create or replace function public.get_admin_reward_payment_requirement(p_order_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if auth.uid() is null or not public.is_eclado_admin() or not public.has_backoffice_permission('orders.write') then
    raise exception 'Administrator order write permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.orders where id=p_order_id) then raise exception 'Order not found' using errcode='P0002'; end if;
  return jsonb_build_object('applicable',exists(select 1 from public.student_reward_snapshots where order_id=p_order_id),
    'confirmed',exists(select 1 from public.instructor_reward_payment_receipts where order_id=p_order_id));
end $$;
create or replace function public.confirm_admin_instructor_reward_payment(p_order_id text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_eclado_admin() or not public.has_backoffice_permission('orders.write') then
    raise exception 'Administrator order write permission required' using errcode='42501'; end if;
  if p_confirmed is distinct from true then raise exception 'Explicit receipt confirmation required' using errcode='22023'; end if;
  select * into target from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.student_reward_snapshots where order_id=p_order_id) then
    return jsonb_build_object('applicable',false);
  end if;
  if target.status in('cancelled','returned') then raise exception 'Order already terminated' using errcode='55000'; end if;
  insert into public.instructor_reward_payment_receipts(order_id,source,amount,proof_kind,actor_user_id)
    values(p_order_id,'admin',coalesce(target.payment_amount,target.total)::bigint,'admin_confirmation',auth.uid())
    on conflict(order_id) do nothing;
  perform public.reconcile_instructor_reward_order(p_order_id);
  return jsonb_build_object('applicable',true,'confirmed',true);
end $$;

-- A single DB transaction contains the deletion guard and account closure.
-- No changes to the existing shopping-credit guard or member deletion API.
create or replace function public.guard_instructor_reward_member_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
declare account public.instructor_reward_accounts%rowtype;
begin
  select * into account from public.instructor_reward_accounts where user_id=old.id for update;
  if found then
    if account.balance<>0 or account.pending_balance<>0
      or exists(select 1 from public.instructor_reward_order_states where instructor_id=old.id and status='pending') then
      raise exception 'Member still has reward balance or pending rewards' using errcode='55000'; end if;
    update public.instructor_reward_accounts set status='closed',version=version+1,updated_at=now() where user_id=old.id;
  end if;
  return old;
end $$;
drop trigger if exists trg_guard_reward_member_deletion on public.profiles;
create trigger trg_guard_reward_member_deletion before delete on public.profiles
  for each row execute function public.guard_instructor_reward_member_deletion();

-- Never silently reconcile pre-2B snapshots using today's evidence/status.
-- A non-empty pre-2B table requires a separately reviewed import, not a rerun.
do $$ begin
  if exists(select 1 from public.student_reward_snapshots s left join public.instructor_reward_order_states r
    on r.order_id=s.order_id where r.order_id is null) then
    raise exception 'Existing 2A snapshots require a separately reviewed reconciliation';
  end if;
end $$;
revoke all on function public.reject_instructor_reward_history_changes(),public.append_instructor_reward_event(text,text),
  public.reconcile_instructor_reward_order(text),public.initialize_instructor_reward_order(),
  public.guard_instructor_reward_order_lifecycle(),public.sync_instructor_reward_order_status(),
  public.guard_instructor_reward_member_deletion(),public.record_verified_instructor_reward_payment(text,text,text),
  public.get_admin_reward_payment_requirement(text),public.confirm_admin_instructor_reward_payment(text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.record_verified_instructor_reward_payment(text,text,text) to service_role;
grant execute on function public.get_admin_reward_payment_requirement(text),public.confirm_admin_instructor_reward_payment(text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;

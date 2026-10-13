-- Stage 6 findings only. This never calls a financial posting/reconcile RPC.
begin;
do $$ begin if to_regclass('public.instructor_reward_notification_outbox') is null then raise exception 'Stage 6 outbox required';end if;end $$;
create table if not exists public.instructor_reward_reconciliation_runs(
 id uuid primary key default extensions.gen_random_uuid(),request_key uuid not null unique,actor_user_id uuid,
 scope text not null default 'all_reward_finances',status text not null default 'complete' check(status in('complete','failed')),error_code text,
 snapshot_at timestamptz not null,checked_count bigint not null,finding_count bigint not null,created_at timestamptz not null default now());
create table if not exists public.instructor_reward_reconciliation_findings(
 id bigint generated always as identity primary key,rule text not null,source text not null,
 expected jsonb not null,actual jsonb not null,first_seen_at timestamptz not null,last_seen_at timestamptz not null,
 present boolean not null default true,last_run_id uuid not null,unique(rule,source));
alter table public.instructor_reward_reconciliation_runs enable row level security;
alter table public.instructor_reward_reconciliation_findings enable row level security;
revoke all on public.instructor_reward_reconciliation_runs,public.instructor_reward_reconciliation_findings from public,anon,authenticated,service_role;
revoke all on sequence public.instructor_reward_reconciliation_findings_id_seq from public,anon,authenticated,service_role;
drop trigger if exists reward_reconciliation_runs_immutable on public.instructor_reward_reconciliation_runs;
create trigger reward_reconciliation_runs_immutable before update or delete on public.instructor_reward_reconciliation_runs for each row execute function public.reject_instructor_reward_history_changes();
drop trigger if exists reward_reconciliation_findings_no_delete on public.instructor_reward_reconciliation_findings;
create trigger reward_reconciliation_findings_no_delete before delete on public.instructor_reward_reconciliation_findings for each row execute function public.reject_instructor_reward_history_changes();

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
select 'withdrawal_amount',w.id::text,jsonb_build_object('gross',w.amount,'quoted_fee',15,'net',w.amount-15,'charged_fee',case when w.status='paid' then 15 else 0 end),
 jsonb_build_object('quoted_fee',w.fee,'net',w.net_amount,'charged_fee',w.fee_charged,'transferred',w.transferred_amount)
 from public.instructor_reward_withdrawals w where w.amount<=15 or w.fee<>15 or w.net_amount<>w.amount-15 or
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

create or replace function public.run_reward_reconciliation(p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.instructor_reward_reconciliation_runs%rowtype;findings jsonb;checked bigint;stamp timestamptz:=statement_timestamp();
begin
 if auth.role() is distinct from 'service_role' then perform public.assert_instructor_reward_read_admin();perform public.assert_reward_withdrawal_admin(true);end if;
 if p_request_key is null then raise exception 'Run key required' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(18606,1) then raise exception 'Reconciliation already running' using errcode='55P03';end if;
 select * into r from public.instructor_reward_reconciliation_runs where request_key=p_request_key;
 if found then return jsonb_build_object('id',r.id,'status',r.status,'checked',r.checked_count,'findings',r.finding_count);end if;
 begin
 select count(*) into checked from (
 (select 1 from public.instructor_reward_ledger limit 50001) union all
 (select 1 from public.instructor_reward_accounts limit 50001) union all
 (select 1 from public.student_reward_snapshots limit 50001) union all
 (select 1 from public.instructor_reward_withdrawals limit 50001)) bounded;
 if checked>50000 then raise exception 'Reconciliation scope requires partition review' using errcode='54000';end if;
 -- The checks and count use a single statement snapshot, not independent reads
 -- of a wallet midway through somebody else's committed financial transaction.
 select (select count(*) from public.instructor_reward_ledger)+(select count(*) from public.instructor_reward_accounts)+
 (select count(*) from public.student_reward_snapshots)+(select count(*) from public.instructor_reward_withdrawals),
 coalesce((select jsonb_agg(to_jsonb(c)) from public.reward_financial_checks() c),'[]') into checked,findings;
 if checked>50000 or jsonb_array_length(findings)>10000 then raise exception 'Reconciliation exceeds local V1 bounded scope; review partitioning before larger runs' using errcode='54000';end if;
 insert into public.instructor_reward_reconciliation_runs(request_key,actor_user_id,snapshot_at,checked_count,finding_count)
 values(p_request_key,auth.uid(),stamp,checked,jsonb_array_length(findings)) returning * into r;
 insert into public.instructor_reward_reconciliation_findings(rule,source,expected,actual,first_seen_at,last_seen_at,last_run_id)
 select x.rule,x.source,x.expected,x.actual,stamp,stamp,r.id from jsonb_to_recordset(findings) x(rule text,source text,expected jsonb,actual jsonb)
 on conflict(rule,source) do update set expected=excluded.expected,actual=excluded.actual,last_seen_at=excluded.last_seen_at,present=true,last_run_id=excluded.last_run_id;
 update public.instructor_reward_reconciliation_findings set present=false,last_run_id=r.id where present and last_run_id<>r.id;
 return jsonb_build_object('id',r.id,'status','complete','checked',checked,'findings',jsonb_array_length(findings));
 exception when others then
 insert into public.instructor_reward_reconciliation_runs(request_key,actor_user_id,status,error_code,snapshot_at,checked_count,finding_count)
 values(p_request_key,auth.uid(),'failed',sqlstate,stamp,0,0) returning * into r;
 return jsonb_build_object('id',r.id,'status','failed','error_code',r.error_code);
 end;
end $$;

create or replace function public.get_admin_reward_reconciliation(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.assert_instructor_reward_read_admin();if p_offset is null or p_offset<0 then raise exception 'Invalid offset' using errcode='22023';end if;
 return jsonb_build_object('total',(select count(*) from public.instructor_reward_reconciliation_findings),
 'findings',coalesce((select jsonb_agg(to_jsonb(q) order by present desc,id desc) from(select id,rule,source,expected,actual,first_seen_at,last_seen_at,present,last_run_id
 from public.instructor_reward_reconciliation_findings order by present desc,id desc limit 20 offset p_offset) q),'[]'),
 'runs',coalesce((select jsonb_agg(to_jsonb(q) order by created_at desc,id) from(select id,scope,status,error_code,snapshot_at,checked_count,finding_count,created_at from public.instructor_reward_reconciliation_runs order by created_at desc,id limit 10) q),'[]'));
end $$;
revoke all on function public.reward_financial_checks(),public.run_reward_reconciliation(uuid),public.get_admin_reward_reconciliation(integer) from public,anon,authenticated,service_role;
grant execute on function public.run_reward_reconciliation(uuid) to authenticated,service_role;
grant execute on function public.get_admin_reward_reconciliation(integer) to authenticated;
notify pgrst,'reload schema';commit;

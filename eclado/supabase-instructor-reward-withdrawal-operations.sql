-- Additive, local/test validation first. Requires stage 5; does not change money or states.
begin;
create table if not exists public.instructor_reward_withdrawal_exports (
 id uuid primary key default extensions.gen_random_uuid(),actor_user_id uuid not null,
 batch_date date not null,created_at timestamptz not null default now(),
 row_count bigint not null,net_amount bigint not null,manifest jsonb not null
);
alter table public.instructor_reward_withdrawal_exports enable row level security;
revoke all on public.instructor_reward_withdrawal_exports from public,anon,authenticated,service_role;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.instructor_reward_withdrawal_exports'::regclass and tgname='reward_withdrawal_exports_immutable') then
 create trigger reward_withdrawal_exports_immutable before update or delete on public.instructor_reward_withdrawal_exports for each row execute function public.reject_instructor_reward_history_changes();
 end if;
end $$;
create index if not exists reward_withdrawal_batch_queue_idx on public.instructor_reward_withdrawals(batch_date,status,created_at desc,id);

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
 'batch_summary',case when p_batch_date is null then null else (select jsonb_build_object('batch_date',p_batch_date,'count',count(*),'amount',coalesce(sum(amount),0),'fee',coalesce(sum(fee),0),'net_amount',coalesce(sum(net_amount),0)) from public.instructor_reward_withdrawals where batch_date=p_batch_date and status in('pending','processing')) end) into result;
 return result;
end $$;

-- Service-only: actor comes from verified Auth in reward-bank API, never caller identity.
-- One statement snapshot selects eligible rows and records exactly that manifest.
create or replace function public.export_reward_withdrawal_batch(p_actor uuid,p_batch_date date)
returns jsonb language plpgsql security definer set search_path='' as $$ declare rows jsonb;manifest jsonb;n bigint;total bigint;export_id uuid;begin
 if auth.role() is distinct from 'service_role' or not exists(
 select 1 from public.admin_users a join public.backoffice_roles r on r.role=a.role and r.active
 join public.backoffice_role_permissions p on p.role=a.role and p.permission='rewards.withdrawals.manage'
 where a.user_id=p_actor and a.active and a.role in('admin','super_admin')) then raise exception 'Export management permission required' using errcode='42501';end if;
 if p_batch_date is null or extract(day from p_batch_date)<>10 then raise exception 'Select a monthly batch' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'user_id',w.user_id,'name',p.name,'cipher',w.bank_cipher,'net_amount',w.net_amount::text,'batch_date',w.batch_date) order by w.created_at,w.id),'[]'::jsonb),
 coalesce(jsonb_agg(jsonb_build_object('id',w.id,'version',w.version,'status',w.status,'net_amount',w.net_amount,'processor_id',w.processor_id) order by w.created_at,w.id),'[]'::jsonb),count(*),coalesce(sum(w.net_amount),0)
 into rows,manifest,n,total from public.instructor_reward_withdrawals w left join public.profiles p on p.id=w.user_id where w.batch_date=p_batch_date and w.status in('pending','processing');
 insert into public.instructor_reward_withdrawal_exports(actor_user_id,batch_date,row_count,net_amount,manifest) values(p_actor,p_batch_date,n,total,manifest) returning id into export_id;
 return jsonb_build_object('export_id',export_id,'batch_date',p_batch_date,'count',n,'net_amount',total::text,'rows',rows);
end $$;
revoke all on function public.get_admin_reward_withdrawal_queue(integer,date,text,text),public.export_reward_withdrawal_batch(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_reward_withdrawal_queue(integer,date,text,text) to authenticated;
grant execute on function public.export_reward_withdrawal_batch(uuid,date) to service_role;
notify pgrst,'reload schema';
commit;

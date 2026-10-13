-- Stage 6: local/isolated first. Never enables pricing or sends HTTP in SQL.
begin;
do $$ begin
 if to_regprocedure('public.manage_reward_withdrawal(uuid,uuid,text,bigint,jsonb)') is null then raise exception 'Stage 5 required';end if;
 if to_regclass('public.instructor_reward_notification_outbox') is null and exists(select 1 from public.instructor_reward_withdrawal_events where event_type in('requested','paid','failed','unknown')) then
 raise exception 'Historical withdrawal notifications require a separately approved import';end if;
end $$;
create table if not exists public.instructor_reward_notification_outbox(
 id uuid primary key default extensions.gen_random_uuid(),source_event_id bigint not null,
 withdrawal_id uuid not null,user_id uuid not null,event_type text not null check(event_type in('requested','paid','failed','unknown','correction')),
 audience text not null check(audience in('teacher','admin')),recipient_key text not null default '',
 version integer not null default 1 check(version>0),payload jsonb not null,
 status text not null default 'pending' check(status in('pending','sending','retry','sent','failed','unknown','blocked','expanded')),
 channel text check(channel in('line','email')),targets jsonb,recipient_mask text,
 line_key uuid not null default extensions.gen_random_uuid(),email_key uuid not null default extensions.gen_random_uuid(),
 line_attempts integer not null default 0 check(line_attempts between 0 and 6),email_attempts integer not null default 0 check(email_attempts between 0 and 6),
 line_started_at timestamptz,email_started_at timestamptz,
 lease_token uuid,lease_until timestamptz,next_retry_at timestamptz not null default now(),
 last_attempt_at timestamptz,last_error text,provider_id text,sent_at timestamptz,created_at timestamptz not null default now(),
 unique(source_event_id,audience,recipient_key,version));
create index if not exists reward_notice_due_idx on public.instructor_reward_notification_outbox(next_retry_at,id) where status in('pending','retry','sending','blocked');
-- Repeating the same business state with another audit key must not silently
-- become another initial notice. Explicit supplements use a new version.
create unique index if not exists reward_notice_business_version_idx on public.instructor_reward_notification_outbox(withdrawal_id,event_type,audience,recipient_key,version) where event_type<>'correction';
create table if not exists public.instructor_reward_notification_attempts(
 id bigint generated always as identity primary key,notification_id uuid not null,
 action text not null,actor_user_id uuid,channel text,lease_token uuid,result text,details jsonb not null default '{}',created_at timestamptz not null default now());
create index if not exists reward_notice_attempt_idx on public.instructor_reward_notification_attempts(notification_id,id);
drop trigger if exists reward_notice_attempt_immutable on public.instructor_reward_notification_attempts;
create trigger reward_notice_attempt_immutable before update or delete on public.instructor_reward_notification_attempts for each row execute function public.reject_instructor_reward_history_changes();
drop trigger if exists reward_notice_no_delete on public.instructor_reward_notification_outbox;
create trigger reward_notice_no_delete before delete on public.instructor_reward_notification_outbox for each row execute function public.reject_instructor_reward_history_changes();
alter table public.instructor_reward_notification_outbox enable row level security;
alter table public.instructor_reward_notification_attempts enable row level security;
revoke all on public.instructor_reward_notification_outbox,public.instructor_reward_notification_attempts from public,anon,authenticated,service_role;
revoke all on sequence public.instructor_reward_notification_attempts_id_seq from public,anon,authenticated,service_role;

create or replace function public.queue_reward_withdrawal_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare w public.instructor_reward_withdrawals%rowtype;p jsonb;
begin
 if new.event_type not in('requested','paid','failed','unknown') then return new;end if;
 select * into w from public.instructor_reward_withdrawals where id=new.withdrawal_id;
 p:=jsonb_build_object('template_version',1,'withdrawal_id',w.id,'user_id',w.user_id,'event_type',new.event_type,'at',new.created_at,
 'amount',w.amount,'fee',w.fee,'net_amount',w.net_amount,'scheduled_date',w.scheduled_date,
 'status',w.status,'transfer_date',w.transfer_date,'transferred_amount',w.transferred_amount,
 'returned_amount',case when new.event_type='failed' then w.amount else 0 end);
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,payload)
 values(new.id,w.id,w.user_id,new.event_type,'teacher',p) on conflict do nothing;
 if new.event_type='requested' then
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,payload)
 values(new.id,w.id,w.user_id,new.event_type,'admin',p) on conflict do nothing;end if;
 return new;
end $$;
drop trigger if exists reward_withdrawal_notice_enqueue on public.instructor_reward_withdrawal_events;
create trigger reward_withdrawal_notice_enqueue after insert on public.instructor_reward_withdrawal_events for each row execute function public.queue_reward_withdrawal_notice();

create or replace function public.clear_reward_notification_recipient_on_delete()
returns trigger language plpgsql security definer set search_path='' as $$ begin
 -- Preserve UUID, event and audit; a deleted profile is no channel,
 -- never an excuse to refill contact information from old orders.
 update public.instructor_reward_notification_outbox set targets=null,recipient_mask=null,
 status=case when status in('pending','retry','sending','blocked') then 'blocked' else status end,
 last_error=case when status in('pending','retry','sending','blocked') then 'member_deleted' else last_error end,
 lease_token=null,lease_until=null,next_retry_at=now()+interval '1 hour' where user_id=old.id and audience='teacher';
 return old;
end $$;
drop trigger if exists reward_notification_recipient_delete on public.profiles;
create trigger reward_notification_recipient_delete after delete on public.profiles for each row execute function public.clear_reward_notification_recipient_on_delete();

create or replace function public.claim_reward_notifications(p_limit integer,p_admin_emails text[] default '{}',p_email_from text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.instructor_reward_notification_outbox%rowtype;address text;t jsonb;c text;k uuid;result jsonb:='[]';started timestamptz;counted integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>20 or p_admin_emails is null or cardinality(p_admin_emails)>10 or length(coalesce(p_email_from,''))>254 or p_email_from ~ '[\r\n]' or exists(select 1 from unnest(p_admin_emails) x where x is null or x !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(x)>254) then raise exception 'Invalid worker batch' using errcode='22023';end if;
 -- Full routing addresses exist only while identical provider retries remain
 -- safe. Keep event/audit/masked history, remove expired transient routing PII.
 with expired as(select id from public.instructor_reward_notification_outbox where targets is not null and
 greatest(coalesce(line_started_at,'epoch'),coalesce(email_started_at,'epoch'))<now()-interval '23 hours' and(line_attempts+email_attempts)>0 order by id limit 1000 for update skip locked)
 update public.instructor_reward_notification_outbox expired_notice set targets=null,status=case when status in('sending','retry') then 'unknown' else status end,
 lease_token=null,lease_until=null from expired e where e.id=expired_notice.id;
 for n in select * from public.instructor_reward_notification_outbox where
 (status in('pending','retry','blocked') and next_retry_at<=now()) or(status='sending' and lease_until<=now())
 order by next_retry_at,id limit p_limit for update skip locked loop
 if n.audience='admin' and n.recipient_key='' then
 if cardinality(p_admin_emails)=0 then
 update public.instructor_reward_notification_outbox set status='blocked',last_error='admin_recipients_missing',next_retry_at=now()+interval '1 hour' where id=n.id;continue;end if;
 for address in select distinct lower(btrim(x)) from unnest(p_admin_emails) x loop
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,recipient_key,version,payload,targets,channel,recipient_mask)
 values(n.source_event_id,n.withdrawal_id,n.user_id,n.event_type,'admin',md5(address),n.version,n.payload,jsonb_build_object('email',address),'email',left(address,1)||'***@'||split_part(address,'@',2)) on conflict do nothing;end loop;
 update public.instructor_reward_notification_outbox set status='expanded' where id=n.id;continue;
 end if;
 t:=n.targets;c:=n.channel;
 if t is null and n.audience='admin' then
 select jsonb_build_object('email',lower(btrim(x))) into t from unnest(p_admin_emails) x where md5(lower(btrim(x)))=n.recipient_key limit 1;c:='email';
 elsif t is null then
 select jsonb_build_object('line',line_user_id,'email',case when email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then email else null end) into t from public.profiles where id=n.user_id;
 c:=case when coalesce(t->>'line','')<>'' then 'line' else 'email' end;
 end if;
 if c='email' and(n.email_attempts=0 or(n.last_error='configuration' and t->>'from' is null)) then t:=coalesce(t,'{}'::jsonb)||jsonb_build_object('from',p_email_from);end if;
 if coalesce(t->>c,'')='' then
 update public.instructor_reward_notification_outbox set status='blocked',targets=null,channel=null,last_error='no_channel',next_retry_at=now()+interval '1 hour' where id=n.id;continue;end if;
 started:=case c when 'line' then n.line_started_at else n.email_started_at end;
 counted:=case c when 'line' then n.line_attempts else n.email_attempts end;
 if counted>=6 or(started is not null and started<=now()-interval '23 hours') then
 update public.instructor_reward_notification_outbox set status='unknown',last_error='retry_window_or_limit',lease_token=null,lease_until=null where id=n.id;continue;end if;
 k:=extensions.gen_random_uuid();
 update public.instructor_reward_notification_outbox set status='sending',channel=c,targets=t,
 recipient_mask=coalesce(recipient_mask,case c when 'line' then 'LINE 綁定帳號' else left(t->>'email',1)||'***@'||split_part(t->>'email','@',2) end),
 lease_token=k,lease_until=now()+interval '2 minutes',last_attempt_at=now(),
 line_attempts=line_attempts+case when c='line' then 1 else 0 end,
 email_attempts=email_attempts+case when c='email' then 1 else 0 end,
 line_started_at=case when c='line' then coalesce(line_started_at,now()) else line_started_at end,
 email_started_at=case when c='email' then coalesce(email_started_at,now()) else email_started_at end where id=n.id returning * into n;
 insert into public.instructor_reward_notification_attempts(notification_id,action,channel,lease_token) values(n.id,'claim',c,k);
 result:=result||jsonb_build_array(jsonb_build_object('id',n.id,'lease_token',k,'channel',c,'target',t->>c,
 'key',case c when 'line' then n.line_key else n.email_key end,'from',t->>'from','payload',n.payload,'audience',n.audience));
 end loop;return result;
end $$;

create or replace function public.complete_reward_notification(p_id uuid,p_token uuid,p_result text,p_provider_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare n public.instructor_reward_notification_outbox%rowtype;a integer;delay integer;next_status text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501';end if;
 if p_result is null or p_result not in('accepted','line_rejected','line_unavailable','line_server_error','line_rate_limited','transient','ambiguous','permanent','configuration') or length(coalesce(p_provider_id,''))>120 then raise exception 'Invalid delivery result' using errcode='22023';end if;
 select * into n from public.instructor_reward_notification_outbox where id=p_id for update;
 if not found or n.status<>'sending' or n.lease_token is distinct from p_token or n.lease_until<=now() then return false;end if;
 a:=case n.channel when 'line' then n.line_attempts else n.email_attempts end;
 if p_result='accepted' then next_status:='sent';
 elsif p_result in('line_rejected','line_unavailable','line_server_error','line_rate_limited') and n.channel='line' then
 next_status:=case when coalesce(n.targets->>'email','')<>'' then 'retry' else 'blocked' end;
 elsif p_result='configuration' then next_status:='blocked';
 elsif p_result='permanent' then next_status:='failed';
 elsif a>=6 then next_status:=case when p_result='ambiguous' then 'unknown' else 'failed' end;
 else next_status:='retry';end if;
 delay:=case a when 1 then 1 when 2 then 5 when 3 then 15 when 4 then 60 else 360 end;
 update public.instructor_reward_notification_outbox set status=next_status,
 channel=case when p_result in('line_rejected','line_unavailable','line_server_error','line_rate_limited') and n.channel='line' then 'email' else channel end,
 next_retry_at=case when p_result in('line_rejected','line_unavailable','line_server_error','line_rate_limited') then now() when next_status='blocked' then now()+interval '1 hour' else now()+make_interval(mins=>delay) end,
 sent_at=case when next_status='sent' then now() else null end,
 provider_id=case when next_status='sent' then nullif(p_provider_id,'') else null end,
 last_error=case when next_status='sent' then null else p_result end,
 targets=case when next_status='sent' then null else targets end,lease_token=null,lease_until=null where id=n.id;
 insert into public.instructor_reward_notification_attempts(notification_id,action,channel,lease_token,result) values(n.id,'complete',n.channel,p_token,p_result);
 return true;
end $$;

create or replace function public.get_admin_reward_notifications(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.assert_reward_withdrawal_admin(false);
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset' using errcode='22023';end if;
 return jsonb_build_object('total',(select count(*) from public.instructor_reward_notification_outbox where status<>'expanded'),
 'summary',jsonb_build_object('counts',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from public.instructor_reward_notification_outbox where status<>'expanded' group by status) q),'{}'),
 'last_dispatch_attempt',(select max(last_attempt_at) from public.instructor_reward_notification_outbox)),
 'notifications',coalesce((select jsonb_agg(to_jsonb(q) order by created_at desc,id) from
 (select id,withdrawal_id,event_type,audience,recipient_mask,status,channel,line_attempts,email_attempts,last_attempt_at,last_error,next_retry_at,sent_at,created_at,version
 from public.instructor_reward_notification_outbox where status<>'expanded' order by created_at desc,id limit 20 offset p_offset) q),'[]'),
 'corrections',coalesce((select jsonb_agg(to_jsonb(q)) from(select e.id,e.withdrawal_id,e.created_at from public.instructor_reward_withdrawal_events e where e.event_type='correction' and not exists(select 1 from public.instructor_reward_notification_outbox n where n.source_event_id=e.id) order by e.id desc limit 20) q),'[]'),
 'attempts',coalesce((select jsonb_agg(to_jsonb(q)) from(select a.notification_id,a.action,a.channel,a.result,a.created_at from public.instructor_reward_notification_attempts a
 join (select id from public.instructor_reward_notification_outbox where status<>'expanded' order by created_at desc,id limit 20 offset p_offset) n on n.id=a.notification_id order by a.id desc limit 200) q),'[]'));
end $$;

create or replace function public.retry_reward_notification(p_id uuid,p_key uuid,p_new_version boolean,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare n public.instructor_reward_notification_outbox%rowtype;result_id uuid;v integer;d jsonb;old_details jsonb;
begin
 perform public.assert_reward_withdrawal_admin(true);
 if not public.has_backoffice_permission('notifications.send') then raise exception 'Notification send permission required' using errcode='42501';end if;
 if p_key is null or p_new_version is null or p_reason is null or length(btrim(p_reason)) not between 1 and 120 then raise exception 'Supplement requires reason/key' using errcode='22023';end if;
 -- Serialize the same actor/key before checking an earlier response.
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext(p_key::text));
 d:=jsonb_build_object('source_id',p_id,'new_version',p_new_version,'reason',p_reason);
 select notification_id,details into result_id,old_details from public.instructor_reward_notification_attempts where action='manual:'||p_key::text and actor_user_id=auth.uid();
 if found then if old_details is distinct from d then raise exception 'Supplement key conflict' using errcode='40001';end if;return result_id;end if;
 select * into n from public.instructor_reward_notification_outbox where id=p_id for update;
 if not found or n.status in('sending','expanded') then raise exception 'Notification unavailable' using errcode='55000';end if;
 if not p_new_version then
 if n.status in('sent','unknown') or (case n.channel when 'line' then n.line_attempts else n.email_attempts end)>=6 or
 (case n.channel when 'line' then n.line_started_at else n.email_started_at end)<=now()-interval '23 hours' then raise exception 'Unknown/expired/exhausted delivery requires explicit new-version confirmation' using errcode='55000';end if;
 update public.instructor_reward_notification_outbox set status='retry',next_retry_at=now() where id=n.id;result_id:=n.id;
 else
 if n.status not in('sent','unknown','failed','blocked') then raise exception 'New version requires terminal/manual status' using errcode='55000';end if;
 perform pg_advisory_xact_lock(hashtext(n.source_event_id::text),hashtext(n.audience||n.recipient_key));
 select max(version)+1 into v from public.instructor_reward_notification_outbox where source_event_id=n.source_event_id and audience=n.audience and recipient_key=n.recipient_key;
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,recipient_key,version,payload,targets,channel,recipient_mask)
 values(n.source_event_id,n.withdrawal_id,n.user_id,n.event_type,n.audience,n.recipient_key,v,n.payload,
 case when n.audience='admin' then n.targets else null end,case when n.audience='admin' then 'email' else null end,n.recipient_mask) returning instructor_reward_notification_outbox.id into result_id;
 end if;
 insert into public.instructor_reward_notification_attempts(notification_id,action,actor_user_id,result,details) values(result_id,'manual:'||p_key::text,auth.uid(),'requested',d);return result_id;
end $$;

create or replace function public.queue_reward_correction_notice(p_event_id bigint,p_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.instructor_reward_withdrawal_events%rowtype;w public.instructor_reward_withdrawals%rowtype;result_id uuid;
begin
 perform public.assert_reward_withdrawal_admin(true);if not public.has_backoffice_permission('notifications.send') or p_key is null then raise exception 'Notification permission/key required' using errcode='42501';end if;
 select * into e from public.instructor_reward_withdrawal_events where id=p_event_id and event_type='correction';if not found then raise exception 'Correction event required' using errcode='22023';end if;
 select * into w from public.instructor_reward_withdrawals where id=e.withdrawal_id;
 insert into public.instructor_reward_notification_outbox(source_event_id,withdrawal_id,user_id,event_type,audience,payload)
 values(e.id,w.id,w.user_id,'correction','teacher',jsonb_build_object('event_type','correction','withdrawal_id',w.id,'at',e.created_at,'status',w.status,'amount',w.amount,'fee',w.fee,'net_amount',w.net_amount))
 on conflict(source_event_id,audience,recipient_key,version) do nothing;
 select n.id into result_id from public.instructor_reward_notification_outbox n where source_event_id=e.id and audience='teacher' and version=1;
 if not exists(select 1 from public.instructor_reward_notification_attempts where notification_id=result_id and action='correction_confirmed') then
 insert into public.instructor_reward_notification_attempts(notification_id,action,actor_user_id,result) values(result_id,'correction_confirmed',auth.uid(),'requested');end if;
 return result_id;
end $$;

revoke all on function public.queue_reward_withdrawal_notice(),public.clear_reward_notification_recipient_on_delete(),public.claim_reward_notifications(integer,text[],text),public.complete_reward_notification(uuid,uuid,text,text),
 public.get_admin_reward_notifications(integer),public.retry_reward_notification(uuid,uuid,boolean,text),public.queue_reward_correction_notice(bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_reward_notifications(integer,text[],text),public.complete_reward_notification(uuid,uuid,text,text) to service_role;
grant execute on function public.get_admin_reward_notifications(integer),public.retry_reward_notification(uuid,uuid,boolean,text),public.queue_reward_correction_notice(bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

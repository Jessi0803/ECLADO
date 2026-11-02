-- Local-first: deploy SQL and worker/template together only after approval.
-- Separate from financial outboxes; no historical backfill or provider HTTP.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.save_instructor_student_binding(uuid,uuid,uuid,text)') is null
 or to_regprocedure('public.reject_instructor_reward_history_changes()') is null then
 raise exception 'Installed binding foundation and reward history guard required'; end if;
end $$;
create table if not exists public.instructor_student_notification_outbox (
 id uuid primary key default extensions.gen_random_uuid(),
 source_event_id bigint not null, student_id uuid not null, user_id uuid not null,
 event_type text not null check(event_type in('bind','rebind','unbind')),
 audience text not null check(audience in('student','teacher','former_teacher')),
 recipient_key text not null default '' check(recipient_key=''),
 version integer not null default 1 check(version>0), payload jsonb not null,
 status text not null default 'pending' check(status in('pending','sending','retry','sent','failed','unknown','blocked')),
 channel text check(channel in('line','email')),targets jsonb,recipient_mask text,
 line_key uuid not null default extensions.gen_random_uuid(),email_key uuid not null default extensions.gen_random_uuid(),
 line_attempts integer not null default 0 check(line_attempts between 0 and 6),email_attempts integer not null default 0 check(email_attempts between 0 and 6),
 line_started_at timestamptz,email_started_at timestamptz,lease_token uuid,lease_until timestamptz,
 next_retry_at timestamptz not null default now(),last_attempt_at timestamptz,last_error text,provider_id text,sent_at timestamptz,created_at timestamptz not null default now(),
 unique(source_event_id,audience,recipient_key,version));
create index if not exists student_notice_due_idx on public.instructor_student_notification_outbox(next_retry_at,id) where status in('pending','retry','sending','blocked');
create index if not exists student_notice_member_idx on public.instructor_student_notification_outbox(student_id,created_at desc);
create table if not exists public.instructor_student_notification_attempts (
 id bigint generated always as identity primary key,notification_id uuid not null,action text not null,
 actor_user_id uuid,channel text,lease_token uuid,result text,details jsonb not null default '{}',created_at timestamptz not null default now());
alter table public.instructor_student_notification_outbox enable row level security;
alter table public.instructor_student_notification_attempts enable row level security;
revoke all on public.instructor_student_notification_outbox,public.instructor_student_notification_attempts from public,anon,authenticated,service_role;
revoke all on sequence public.instructor_student_notification_attempts_id_seq from public,anon,authenticated,service_role;
drop trigger if exists student_notice_attempt_immutable on public.instructor_student_notification_attempts;
create trigger student_notice_attempt_immutable before update or delete on public.instructor_student_notification_attempts for each row execute function public.reject_instructor_reward_history_changes();
drop trigger if exists student_notice_no_delete on public.instructor_student_notification_outbox;
create trigger student_notice_no_delete before delete on public.instructor_student_notification_outbox for each row execute function public.reject_instructor_reward_history_changes();

create or replace function public.queue_instructor_student_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare student_name text; teacher_name text; previous_name text; p jsonb;
begin
 if new.event_type not in('bind','rebind','unbind') then return new; end if;
 select coalesce(nullif(btrim(name),''),'學生會員') into student_name from public.profiles where id=new.student_id;
 select coalesce(nullif(btrim(name),''),'您的師資') into teacher_name from public.profiles where id=new.instructor_id;
 select coalesce(nullif(btrim(name),''),'原師資') into previous_name from public.profiles where id=new.previous_instructor_id;
 p:=jsonb_build_object('kind','instructor_student','template_version',1,'event_type',new.event_type,
 'student_name',coalesce(student_name,'學生會員'),'at',new.created_at);
 -- Recipient-specific snapshots: the previous teacher never receives the new teacher name.
 insert into public.instructor_student_notification_outbox(source_event_id,student_id,user_id,event_type,audience,payload)
 values(new.id,new.student_id,new.student_id,new.event_type,'student',p||jsonb_strip_nulls(jsonb_build_object('instructor_name',teacher_name,'previous_instructor_name',previous_name)));
 if new.event_type in('bind','rebind') then
 insert into public.instructor_student_notification_outbox(source_event_id,student_id,user_id,event_type,audience,payload)
 values(new.id,new.student_id,new.instructor_id,new.event_type,'teacher',p);
 end if;
 if new.event_type in('rebind','unbind') then
 insert into public.instructor_student_notification_outbox(source_event_id,student_id,user_id,event_type,audience,payload)
 values(new.id,new.student_id,new.previous_instructor_id,new.event_type,'former_teacher',p);
 end if;
 return new;
end $$;
drop trigger if exists instructor_student_notice_enqueue on public.instructor_student_audit_logs;
create trigger instructor_student_notice_enqueue after insert on public.instructor_student_audit_logs for each row execute function public.queue_instructor_student_notice();

create or replace function public.clear_instructor_student_notice_recipient()
returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.instructor_student_notification_outbox set targets=null,recipient_mask=null,
 status=case when status in('pending','retry','sending','blocked') then 'blocked' else status end,
 last_error=case when status in('pending','retry','sending','blocked') then 'member_deleted' else last_error end,
 lease_token=null,lease_until=null,next_retry_at=now()+interval '1 hour' where user_id=old.id;
 return old;
end $$;
drop trigger if exists instructor_student_notice_recipient_delete on public.profiles;
create trigger instructor_student_notice_recipient_delete after delete on public.profiles for each row execute function public.clear_instructor_student_notice_recipient();

create or replace function public.claim_instructor_student_notifications(p_limit integer,p_admin_emails text[] default '{}',p_email_from text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.instructor_student_notification_outbox%rowtype;address text;t jsonb;c text;k uuid;result jsonb:='[]';started timestamptz;counted integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>20 or p_admin_emails is null or cardinality(p_admin_emails)>10 or length(coalesce(p_email_from,''))>254 or p_email_from ~ '[\r\n]' or exists(select 1 from unnest(p_admin_emails) x where x is null or x !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(x)>254) then raise exception 'Invalid worker batch' using errcode='22023';end if;
 -- Full routing addresses exist only while identical provider retries remain
 -- safe. Keep event/audit/masked history, remove expired transient routing PII.
 with expired as(select id from public.instructor_student_notification_outbox where targets is not null and
 greatest(coalesce(line_started_at,'epoch'),coalesce(email_started_at,'epoch'))<now()-interval '23 hours' and(line_attempts+email_attempts)>0 order by id limit 1000 for update skip locked)
 update public.instructor_student_notification_outbox expired_notice set targets=null,status=case when status in('sending','retry') then 'unknown' else status end,
 lease_token=null,lease_until=null from expired e where e.id=expired_notice.id;
 for n in select * from public.instructor_student_notification_outbox where
 (status in('pending','retry','blocked') and next_retry_at<=now()) or(status='sending' and lease_until<=now())
 order by next_retry_at,id limit p_limit for update skip locked loop
 t:=n.targets;c:=n.channel;
 if t is null then
 select jsonb_build_object('line',line_user_id,'email',case when email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then email else null end) into t from public.profiles where id=n.user_id;
 c:=case when coalesce(t->>'line','')<>'' then 'line' else 'email' end;
 end if;
 if c='email' and(n.email_attempts=0 or(n.last_error='configuration' and t->>'from' is null)) then t:=coalesce(t,'{}'::jsonb)||jsonb_build_object('from',p_email_from);end if;
 if coalesce(t->>c,'')='' then
 update public.instructor_student_notification_outbox set status='blocked',targets=null,channel=null,last_error='no_channel',next_retry_at=now()+interval '1 hour' where id=n.id;continue;end if;
 started:=case c when 'line' then n.line_started_at else n.email_started_at end;
 counted:=case c when 'line' then n.line_attempts else n.email_attempts end;
 if counted>=6 or(started is not null and started<=now()-interval '23 hours') then
 update public.instructor_student_notification_outbox set status='unknown',last_error='retry_window_or_limit',lease_token=null,lease_until=null where id=n.id;continue;end if;
 k:=extensions.gen_random_uuid();
 update public.instructor_student_notification_outbox set status='sending',channel=c,targets=t,
 recipient_mask=case c when 'line' then 'LINE 綁定帳號' else left(t->>'email',1)||'***@'||split_part(t->>'email','@',2) end,
 lease_token=k,lease_until=now()+interval '2 minutes',last_attempt_at=now(),
 line_attempts=line_attempts+case when c='line' then 1 else 0 end,
 email_attempts=email_attempts+case when c='email' then 1 else 0 end,
 line_started_at=case when c='line' then coalesce(line_started_at,now()) else line_started_at end,
 email_started_at=case when c='email' then coalesce(email_started_at,now()) else email_started_at end where id=n.id returning * into n;
 insert into public.instructor_student_notification_attempts(notification_id,action,channel,lease_token) values(n.id,'claim',c,k);
 result:=result||jsonb_build_array(jsonb_build_object('id',n.id,'lease_token',k,'channel',c,'target',t->>c,
 'key',case c when 'line' then n.line_key else n.email_key end,'from',t->>'from','payload',n.payload,'audience',n.audience));
 end loop;return result;
end $$;

create or replace function public.complete_instructor_student_notification(p_id uuid,p_token uuid,p_result text,p_provider_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare n public.instructor_student_notification_outbox%rowtype;a integer;delay integer;next_status text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501';end if;
 if p_result is null or p_result not in('accepted','line_rejected','line_unavailable','line_server_error','line_rate_limited','transient','ambiguous','permanent','configuration') or length(coalesce(p_provider_id,''))>120 then raise exception 'Invalid delivery result' using errcode='22023';end if;
 select * into n from public.instructor_student_notification_outbox where id=p_id for update;
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
 update public.instructor_student_notification_outbox set status=next_status,
 channel=case when p_result in('line_rejected','line_unavailable','line_server_error','line_rate_limited') and n.channel='line' then 'email' else channel end,
 next_retry_at=case when p_result in('line_rejected','line_unavailable','line_server_error','line_rate_limited') then now() when next_status='blocked' then now()+interval '1 hour' else now()+make_interval(mins=>delay) end,
 sent_at=case when next_status='sent' then now() else null end,
 provider_id=case when next_status='sent' then nullif(p_provider_id,'') else null end,
 last_error=case when next_status='sent' then null else p_result end,
 targets=case when next_status='sent' then null else targets end,lease_token=null,lease_until=null where id=n.id;
 insert into public.instructor_student_notification_attempts(notification_id,action,channel,lease_token,result) values(n.id,'complete',n.channel,p_token,p_result);
 return true;
end $$;

create or replace function public.get_admin_instructor_student_notifications(p_student_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.assert_instructor_student_admin(false);
 if p_student_id is null or p_offset is null or p_offset<0 then raise exception 'Invalid notification query' using errcode='22023'; end if;
 return jsonb_build_object('total',(select count(*) from public.instructor_student_notification_outbox where student_id=p_student_id),
 'notifications',coalesce((select jsonb_agg(to_jsonb(q) order by created_at desc,id) from (
 select id,event_type,audience,status,channel,recipient_mask,line_attempts,email_attempts,last_error,created_at,sent_at
 from public.instructor_student_notification_outbox where student_id=p_student_id order by created_at desc,id limit 20 offset p_offset) q),'[]'::jsonb));
end $$;
revoke all on function public.queue_instructor_student_notice(),public.clear_instructor_student_notice_recipient(),
 public.claim_instructor_student_notifications(integer,text[],text),public.complete_instructor_student_notification(uuid,uuid,text,text),
 public.get_admin_instructor_student_notifications(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_instructor_student_notifications(integer,text[],text),public.complete_instructor_student_notification(uuid,uuid,text,text) to service_role;
grant execute on function public.get_admin_instructor_student_notifications(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;

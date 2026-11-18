-- Install after supabase-member-carts.sql. Disabled until an authorized admin enables it.
begin;
set local lock_timeout='5s';
create table if not exists public.cart_reminder_settings (
  id boolean primary key default true check(id), enabled boolean not null default false,
  content text not null check(char_length(btrim(content)) between 1 and 2000 and position('[購物車連結]' in content)>0 and char_length(replace(content,'[購物車連結]','https://ecladotaiwan.com/cart'))<=3000),
  version integer not null default 0, enabled_at timestamptz, updated_at timestamptz not null default now()
);
insert into public.cart_reminder_settings(id,content) values(true,'ECLADO 提醒您：
您選購的商品尚未完成結帳，若已挑選好需要的保養品，點擊下方即可返回購物車。

如果對產品挑選、搭配方式或結帳操作有任何疑問，歡迎私訊我們。

🛒 繼續結帳：[購物車連結]

若已完成訂購，請忽略此則提醒。') on conflict do nothing;
alter table public.member_carts add column if not exists reminder_cycle uuid not null default gen_random_uuid();
create table if not exists public.cart_reminder_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.member_carts(user_id) on delete cascade,
  cycle uuid not null, cart_revision bigint, content text,
  status text not null default 'pending' check(status in('pending','sending','retry','sent','cancelled','failed','unknown')),
  channel text check(channel in('line','email')), targets jsonb, email_from text,
  line_key uuid not null default gen_random_uuid(), email_key uuid not null default gen_random_uuid(),
  attempts integer not null default 0 check(attempts between 0 and 6), started_at timestamptz,
  lease_token uuid, lease_until timestamptz, next_retry_at timestamptz not null default now(),
  last_error text, provider_id text, sent_at timestamptz, created_at timestamptz not null default now(),
  unique(user_id,cycle)
);
create index if not exists cart_reminder_jobs_due on public.cart_reminder_jobs(next_retry_at,id) where status in('pending','retry','sending');
create index if not exists member_carts_reminder_due on public.member_carts(updated_at,user_id) where items<>'[]'::jsonb;
create index if not exists orders_cart_reminder_lookup on public.orders(user_id,created_at) where user_id is not null;
alter table public.cart_reminder_settings enable row level security;
alter table public.cart_reminder_jobs enable row level security;
revoke all on public.cart_reminder_settings,public.cart_reminder_jobs from public,anon,authenticated,service_role;

create or replace function public.get_cart_reminder_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not coalesce(public.has_backoffice_permission('notifications.send'),false) then
    raise exception 'Notification settings access required' using errcode='42501';
  end if;
  select jsonb_build_object('enabled',enabled,'content',content,'version',version,'enabled_at',enabled_at)
    into result from public.cart_reminder_settings where id;
  return result;
end $$;
create or replace function public.save_cart_reminder_settings(p_enabled boolean,p_content text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.cart_reminder_settings%rowtype;
begin
  if not coalesce(public.has_backoffice_permission('notifications.send'),false) then
    raise exception 'Notification settings access required' using errcode='42501';
  end if;
  if p_enabled is null or p_content is null or char_length(btrim(p_content)) not between 1 and 2000
    or position('[購物車連結]' in p_content)=0 or char_length(replace(p_content,'[購物車連結]','https://ecladotaiwan.com/cart'))>3000 then
    raise exception '通知內容須為 1–2000 字並保留 [購物車連結]' using errcode='22023';
  end if;
  select * into s from public.cart_reminder_settings where id for update;
  if p_expected_version is distinct from s.version then
    raise exception '設定已被其他管理員修改' using errcode='40001';
  end if;
  if s.enabled is distinct from p_enabled or s.content is distinct from btrim(p_content) then
    update public.cart_reminder_settings set enabled=p_enabled,content=btrim(p_content),version=version+1,
      enabled_at=case when p_enabled and not s.enabled then now() else enabled_at end,updated_at=now() where id;
  end if;
  return public.get_cart_reminder_settings();
end $$;

-- A cart round ends when emptied or after a newly created online order.
-- Pure reads, focus refreshes and repeated operations never change this marker.
create or replace function public.track_cart_reminder_cycle()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.items is distinct from old.items and (old.items='[]'::jsonb or new.items='[]'::jsonb or exists(
    select 1 from public.orders o where o.user_id=new.user_id and coalesce(o.order_source,'online')='online' and o.created_at>=old.updated_at
  )) then new.reminder_cycle:=gen_random_uuid(); end if;
  return new;
end $$;
drop trigger if exists member_cart_reminder_cycle on public.member_carts;
create trigger member_cart_reminder_cycle before update of items on public.member_carts for each row execute function public.track_cart_reminder_cycle();

create or replace function public.claim_cart_reminder(p_line_available boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.cart_reminder_settings%rowtype; c record; n public.cart_reminder_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
  -- Provider deduplication expires after 24h: stop earlier, retaining only outcome metadata.
  update public.cart_reminder_jobs set status='unknown',targets=null,email_from=null,lease_token=null,lease_until=null,last_error='retry_window_expired'
    where status in('sending','retry') and started_at<=now()-interval '23 hours' and (lease_until is null or lease_until<=now());
  select * into s from public.cart_reminder_settings where id;
  if not s.enabled then return null; end if;
  for c in select mc.user_id,mc.reminder_cycle from public.member_carts mc
    join public.profiles p on p.id=mc.user_id join auth.users u on u.id=mc.user_id
    where mc.items<>'[]'::jsonb and greatest(mc.updated_at,s.enabled_at)<=now()-interval '24 hours'
    and not exists(select 1 from public.orders o where o.user_id=mc.user_id and coalesce(o.order_source,'online')='online' and o.created_at>=mc.updated_at)
    and not exists(select 1 from public.cart_reminder_jobs j where j.user_id=mc.user_id and j.cycle=mc.reminder_cycle)
    and ((p_line_available and p.line_user_id ~ '^U[0-9a-f]{32}$') or (u.email_confirmed_at is not null and lower(p.email)=lower(u.email)
      and p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and lower(p.email) not like 'line.%'))
    order by mc.updated_at,mc.user_id limit 10 for update of mc skip locked
  loop
    insert into public.cart_reminder_jobs(user_id,cycle) values(c.user_id,c.reminder_cycle) on conflict(user_id,cycle) do nothing;
  end loop;
  select * into n from public.cart_reminder_jobs where status in('pending','retry','sending') and next_retry_at<=now()
    and (status<>'sending' or lease_until<=now()) order by next_retry_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  if n.attempts>=6 then
    update public.cart_reminder_jobs set status='unknown',targets=null,email_from=null,lease_token=null,lease_until=null,last_error='attempts_exhausted' where id=n.id;
    return jsonb_build_object('skipped',true);
  end if;
  update public.cart_reminder_jobs set status='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    where id=n.id returning * into n;
  return jsonb_build_object('id',n.id,'lease_token',n.lease_token);
end $$;

create or replace function public.prepare_cart_reminder(p_id uuid,p_token uuid,p_line_available boolean,p_email_from text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.cart_reminder_jobs%rowtype;c public.member_carts%rowtype;s public.cart_reminder_settings%rowtype;t jsonb;due_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
  if p_email_from is null or char_length(p_email_from)>254 or p_email_from ~ '[\r\n]' then raise exception 'Invalid sender' using errcode='22023'; end if;
  select * into n from public.cart_reminder_jobs where id=p_id for update;
  if not found or n.status<>'sending' or n.lease_token is distinct from p_token or n.lease_until<=now() then return null; end if;
  select * into c from public.member_carts where user_id=n.user_id for update;
  select * into s from public.cart_reminder_settings where id;
  if c.reminder_cycle is distinct from n.cycle or c.items='[]'::jsonb
    or not exists(select 1 from public.profiles p where p.id=n.user_id)
    or (n.started_at is not null and c.revision is distinct from n.cart_revision)
    or exists(select 1 from public.orders o where o.user_id=c.user_id and coalesce(o.order_source,'online')='online' and o.created_at>=c.updated_at) then
    update public.cart_reminder_jobs set status='cancelled',targets=null,email_from=null,lease_token=null,lease_until=null,last_error='cart_or_order_changed' where id=n.id;
    return null;
  end if;
  due_at:=greatest(c.updated_at,s.enabled_at)+interval '24 hours';
  if not s.enabled or due_at>now() then
    update public.cart_reminder_jobs set status=case when started_at is null then 'pending' else 'retry' end,
      next_retry_at=greatest(due_at,now()+interval '10 minutes'),lease_token=null,lease_until=null where id=n.id;
    return null;
  end if;
  if n.started_at is null then
    select jsonb_strip_nulls(jsonb_build_object('line',case when p.line_user_id ~ '^U[0-9a-f]{32}$' then p.line_user_id end,
      'email',case when u.email_confirmed_at is not null and lower(p.email)=lower(u.email)
        and p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and lower(p.email) not like 'line.%' then p.email end))
      into t from public.profiles p join auth.users u on u.id=p.id where p.id=n.user_id;
    n.channel:=case when p_line_available and coalesce(t->>'line','')<>'' then 'line' when coalesce(t->>'email','')<>'' then 'email' end;
    if n.channel is null then
      update public.cart_reminder_jobs set status='retry',next_retry_at=now()+interval '1 hour',last_error='no_target',lease_token=null,lease_until=null where id=n.id;
      return null;
    end if;
    update public.cart_reminder_jobs set channel=n.channel,targets=t,email_from=p_email_from,content=s.content,
      cart_revision=c.revision,started_at=now() where id=n.id returning * into n;
  end if;
  update public.cart_reminder_jobs set attempts=attempts+1 where id=n.id returning * into n;
  return jsonb_build_object('id',n.id,'lease_token',n.lease_token,'channel',n.channel,'target',n.targets->>n.channel,
    'key',case n.channel when 'line' then n.line_key else n.email_key end,'from',n.email_from,
    'payload',jsonb_build_object('kind','cart_reminder','template_version',1,'content',n.content));
end $$;

create or replace function public.complete_cart_reminder(p_id uuid,p_token uuid,p_result text,p_provider_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare n public.cart_reminder_jobs%rowtype;next_status text;delay integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
  if p_result is null or p_result not in('accepted','line_rejected','transient','ambiguous','permanent','configuration')
    or (p_provider_id is not null and p_provider_id !~ '^[a-zA-Z0-9_-]{1,120}$') then raise exception 'Invalid delivery result' using errcode='22023'; end if;
  select * into n from public.cart_reminder_jobs where id=p_id for update;
  if not found or n.status<>'sending' or n.lease_token is distinct from p_token or n.lease_until<=now() then return false; end if;
  if p_result='accepted' then next_status:='sent';
  elsif p_result='line_rejected' and n.channel='line' and coalesce(n.targets->>'email','')<>'' and n.attempts<6 then next_status:='retry';
  elsif p_result in('permanent','line_rejected') then next_status:='failed';
  elsif n.attempts>=6 then next_status:=case when p_result='ambiguous' then 'unknown' else 'failed' end;
  else next_status:='retry'; end if;
  delay:=case n.attempts when 1 then 10 when 2 then 30 when 3 then 60 else 360 end;
  update public.cart_reminder_jobs set status=next_status,
    channel=case when p_result='line_rejected' and next_status='retry' then 'email' else channel end,
    next_retry_at=case when p_result='line_rejected' then now() else now()+make_interval(mins=>delay) end,
    sent_at=case when next_status='sent' then now() else sent_at end,
    provider_id=case when next_status='sent' then p_provider_id else provider_id end,
    last_error=case when next_status='sent' then null else p_result end,
    targets=case when next_status in('sent','cancelled','failed','unknown') then null else targets end,
    email_from=case when next_status in('sent','cancelled','failed','unknown') then null else email_from end,
    lease_token=null,lease_until=null where id=n.id;
  return true;
end $$;

revoke all on function public.get_cart_reminder_settings(),public.save_cart_reminder_settings(boolean,text,integer),public.track_cart_reminder_cycle(),
  public.claim_cart_reminder(boolean),public.prepare_cart_reminder(uuid,uuid,boolean,text),public.complete_cart_reminder(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_cart_reminder_settings(),public.save_cart_reminder_settings(boolean,text,integer) to authenticated;
grant execute on function public.claim_cart_reminder(boolean),public.prepare_cart_reminder(uuid,uuid,boolean,text),public.complete_cart_reminder(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;

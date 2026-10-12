-- Phase 1B only: settings and relationships. No pricing/order/payment changes.
-- Requires the current profiles, admin_users and backoffice permissions schema.
-- Do not apply to production without separate approval and metadata preflight.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.backoffice_role_permissions') is null
    or to_regprocedure('public.has_backoffice_permission(text)') is null
    or to_regprocedure('public.is_eclado_admin()') is null then
    raise exception 'Current member and backoffice permission schema is required';
  end if;
end;
$$;

-- Extend the installed whitelist instead of replacing earlier permissions.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='public.backoffice_role_permissions'::regclass
    and conname='backoffice_role_permissions_permission_check' and contype='c';
  if definition is null or definition not like 'CHECK (%)' then
    raise exception 'Expected backoffice permission whitelist is missing';
  end if;
  if position('instructor_students.manage' in definition)=0 then
    alter table public.backoffice_role_permissions
      drop constraint backoffice_role_permissions_permission_check;
    execute 'alter table public.backoffice_role_permissions add constraint '
      || 'backoffice_role_permissions_permission_check CHECK (permission = ''instructor_students.manage'' OR '
      || substring(definition from 7) || ')';
  end if;
end;
$$;
insert into public.backoffice_role_permissions(role,permission) values
  ('admin','instructor_students.manage'),('super_admin','instructor_students.manage')
on conflict do nothing;

create table if not exists public.student_pricing_settings (
  singleton boolean primary key default true check (singleton),
  student_1 numeric not null default 0.90
    check (student_1>0 and student_1<=1 and student_1=round(student_1,3)),
  student_2 numeric not null default 0.95
    check (student_2>0 and student_2<=1 and student_2=round(student_2,3)),
  version bigint not null default 0 check (version>=0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.student_pricing_settings(singleton) values(true) on conflict do nothing;

-- Durable UUID references intentionally do not cascade with Auth/profile deletion.
-- No names, emails, phones or addresses are copied into these tables.
create table if not exists public.instructor_student_settings (
  instructor_id uuid primary key,
  student_price_type text check (student_price_type in ('student_1','student_2')),
  version bigint not null default 0 check (version>=0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.instructor_student_bindings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  instructor_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  ended_at timestamptz,
  ended_by uuid,
  end_reason text check (end_reason in ('unbound','rebound','member_deleted')),
  check (student_id<>instructor_id),
  check ((ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and end_reason is not null))
);
create unique index if not exists instructor_student_one_active_student_idx
  on public.instructor_student_bindings(student_id) where ended_at is null;
create index if not exists instructor_student_active_instructor_idx
  on public.instructor_student_bindings(instructor_id,created_at) where ended_at is null;
create index if not exists instructor_student_history_idx
  on public.instructor_student_bindings(student_id,created_at desc,id);

create table if not exists public.instructor_student_audit_logs (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in
    ('global_settings','instructor_type','bind','unbind','rebind','member_deleted')),
  student_id uuid,
  instructor_id uuid,
  previous_instructor_id uuid,
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('admin','system')),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists instructor_student_audit_member_idx
  on public.instructor_student_audit_logs(student_id,created_at desc,id desc);

alter table public.student_pricing_settings enable row level security;
alter table public.instructor_student_settings enable row level security;
alter table public.instructor_student_bindings enable row level security;
alter table public.instructor_student_audit_logs enable row level security;
revoke all on table public.student_pricing_settings,public.instructor_student_settings,
  public.instructor_student_bindings,public.instructor_student_audit_logs
  from public,anon,authenticated;

create or replace function public.prevent_instructor_student_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Instructor/student audit history is append-only' using errcode='42501';
end;
$$;
drop trigger if exists trg_instructor_student_audit_immutable on public.instructor_student_audit_logs;
create trigger trg_instructor_student_audit_immutable before update or delete
  on public.instructor_student_audit_logs for each row
  execute function public.prevent_instructor_student_audit_mutation();

create or replace function public.assert_instructor_student_admin(p_write boolean)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_eclado_admin()
    or (p_write and not public.has_backoffice_permission('instructor_students.manage'))
    or (not p_write and not (public.has_backoffice_permission('members.read')
      or public.has_backoffice_permission('instructor_students.manage'))) then
    raise exception '師生管理權限不足' using errcode='42501';
  end if;
end;
$$;

create or replace function public.get_admin_student_pricing_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_instructor_student_admin(false);
  return (select jsonb_build_object('multipliers',jsonb_build_object('student_1',student_1,'student_2',student_2),
    'version',version,'updated_by',updated_by,'updated_at',updated_at,'prices_applied',false)
    from public.student_pricing_settings where singleton);
end;
$$;

create or replace function public.save_student_pricing_settings(p_multipliers jsonb,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.student_pricing_settings%rowtype; key text; multiplier numeric;
begin
  perform public.assert_instructor_student_admin(true);
  if p_multipliers is null or jsonb_typeof(p_multipliers)<>'object'
    or (select count(*) from jsonb_object_keys(p_multipliers))<>2 then
    raise exception '請提供學生1及學生2折數' using errcode='22023';
  end if;
  foreach key in array array['student_1','student_2'] loop
    if jsonb_typeof(p_multipliers->key) is distinct from 'number' then
      raise exception '折數必須是有效數值' using errcode='22023';
    end if;
    multiplier:=(p_multipliers->>key)::numeric;
    if not (multiplier>0 and multiplier<=1 and multiplier=round(multiplier,3)) then
      raise exception '折數須大於0、不超過10折，最多兩位折數小數' using errcode='22023';
    end if;
  end loop;
  select * into previous from public.student_pricing_settings where singleton for update;
  if not found then raise exception '學生全域設定尚未初始化' using errcode='55000'; end if;
  if p_expected_version is distinct from previous.version then
    raise exception '設定已被其他管理員修改，請重新載入' using errcode='40001';
  end if;
  if previous.student_1 is distinct from (p_multipliers->>'student_1')::numeric
    or previous.student_2 is distinct from (p_multipliers->>'student_2')::numeric then
    update public.student_pricing_settings set student_1=(p_multipliers->>'student_1')::numeric,
      student_2=(p_multipliers->>'student_2')::numeric,version=version+1,
      updated_by=auth.uid(),updated_at=now() where singleton;
    insert into public.instructor_student_audit_logs(event_type,actor_user_id,actor_kind,before_data,after_data)
    values('global_settings',auth.uid(),'admin',
      jsonb_build_object('student_1',previous.student_1,'student_2',previous.student_2,'version',previous.version),
      p_multipliers||jsonb_build_object('version',previous.version+1));
  end if;
  return public.get_admin_student_pricing_settings();
end;
$$;

-- Internal context is never granted directly. Public readers use explicit fields.
create or replace function public.instructor_student_context(p_student_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'binding_id',b.id,'instructor_id',b.instructor_id,'instructor_name',teacher.name,
    'has_binding',b.id is not null,'student_exists',student.id is not null,
    'instructor_exists',teacher.id is not null,
    'student_role_eligible',coalesce(student.role='pro',false),
    'instructor_role_eligible',coalesce(teacher.role='instructor',false),
    'instructor_type_set',settings.student_price_type is not null,
    'student_price_type',settings.student_price_type,'settings_version',coalesce(settings.version,0),
    'bound_at',b.created_at,'prices_applied',false,
    'student_pricing_eligible',coalesce(b.id is not null and student.role='pro'
      and teacher.role='instructor' and settings.student_price_type is not null,false))
  from (select p_student_id as id) identity_row
  left join public.profiles student on student.id=identity_row.id
  left join public.instructor_student_bindings b on b.student_id=identity_row.id and b.ended_at is null
  left join public.profiles teacher on teacher.id=b.instructor_id
  left join public.instructor_student_settings settings on settings.instructor_id=b.instructor_id;
$$;

create or replace function public.get_my_student_pricing_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode='42501'; end if;
  result:=public.instructor_student_context(auth.uid());
  return jsonb_build_object('has_binding',result->'has_binding','instructor_id',result->'instructor_id',
    'instructor_name',result->'instructor_name','student_price_type',result->'student_price_type',
    'student_role_eligible',result->'student_role_eligible','instructor_role_eligible',result->'instructor_role_eligible',
    'instructor_type_set',result->'instructor_type_set','student_pricing_eligible',result->'student_pricing_eligible',
    'prices_applied',false,'binding_id',result->'binding_id','settings_version',result->'settings_version');
end;
$$;

create or replace function public.get_my_instructor_students()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then
    raise exception '師資資格不足' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('binding_id',b.id,'student_name',s.name,
    'bound_at',b.created_at,'student_role_eligible',s.role='pro') order by b.created_at,b.id)
    from public.instructor_student_bindings b join public.profiles s on s.id=b.student_id
    where b.instructor_id=auth.uid() and b.ended_at is null),'[]'::jsonb);
end;
$$;

create or replace function public.get_admin_instructor_student_member(p_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_instructor_student_admin(false);
  return jsonb_build_object('context',public.instructor_student_context(p_member_id),
    'instructor_settings',(select jsonb_build_object('student_price_type',student_price_type,'version',version,
      'updated_at',updated_at,'updated_by',updated_by) from public.instructor_student_settings where instructor_id=p_member_id),
    'students',coalesce((select jsonb_agg(jsonb_build_object('student_id',b.student_id,'student_name',s.name,
      'binding_id',b.id,'context',public.instructor_student_context(b.student_id)) order by b.created_at,b.id)
      from public.instructor_student_bindings b left join public.profiles s on s.id=b.student_id
      where b.instructor_id=p_member_id and b.ended_at is null),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
      select * from public.instructor_student_audit_logs where student_id=p_member_id
        or instructor_id=p_member_id or previous_instructor_id=p_member_id
      order by created_at desc,id desc limit 100) h),'[]'::jsonb));
end;
$$;

create or replace function public.get_admin_student_pricing_history()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_instructor_student_admin(false);
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
    select * from public.instructor_student_audit_logs where event_type='global_settings'
    order by created_at desc,id desc limit 100) h),'[]'::jsonb);
end;
$$;

create or replace function public.set_instructor_student_price_type(
  p_instructor_id uuid,p_student_price_type text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.instructor_student_settings%rowtype;
begin
  perform public.assert_instructor_student_admin(true);
  perform 1 from public.profiles where id=p_instructor_id and role='instructor' for update;
  if not found then raise exception '老師不存在或目前不是師資' using errcode='22023'; end if;
  if p_student_price_type is not null and p_student_price_type not in ('student_1','student_2') then
    raise exception '學生價格類型無效' using errcode='22023';
  end if;
  insert into public.instructor_student_settings(instructor_id) values(p_instructor_id) on conflict do nothing;
  select * into previous from public.instructor_student_settings where instructor_id=p_instructor_id for update;
  if p_expected_version is distinct from previous.version then
    raise exception '老師設定已被其他管理員修改，請重新載入' using errcode='40001';
  end if;
  if previous.student_price_type is distinct from p_student_price_type then
    update public.instructor_student_settings set student_price_type=p_student_price_type,
      version=version+1,updated_by=auth.uid(),updated_at=now() where instructor_id=p_instructor_id;
    insert into public.instructor_student_audit_logs(event_type,instructor_id,actor_user_id,actor_kind,before_data,after_data)
    values('instructor_type',p_instructor_id,auth.uid(),'admin',
      jsonb_build_object('student_price_type',previous.student_price_type,'version',previous.version),
      jsonb_build_object('student_price_type',p_student_price_type,'version',previous.version+1));
  end if;
  return public.get_admin_instructor_student_member(p_instructor_id);
end;
$$;

create or replace function public.save_instructor_student_binding(
  p_student_id uuid,p_instructor_id uuid,p_expected_binding_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.instructor_student_bindings%rowtype; student_role text; new_binding_id uuid;
begin
  perform public.assert_instructor_student_admin(true);
  if p_action is null or p_action not in ('bind','unbind','rebind') or p_student_id is null
    or (p_action='unbind' and p_instructor_id is not null)
    or (p_action<>'unbind' and p_instructor_id is null) then
    raise exception '師生異動參數無效' using errcode='22023';
  end if;
  if p_student_id=p_instructor_id then raise exception '學生不能綁定自己' using errcode='22023'; end if;
  -- Same sorted profile locks serialize competing student writes, role changes
  -- and deletion. Deletion cleanup never acquires other profile locks.
  perform 1 from public.profiles where id in (p_student_id,p_instructor_id) order by id for update;
  select role into student_role from public.profiles where id=p_student_id;
  if not found then raise exception '學生會員不存在' using errcode='22023'; end if;
  select * into previous from public.instructor_student_bindings where student_id=p_student_id and ended_at is null for update;
  if p_expected_binding_id is distinct from previous.id then
    raise exception '綁定已被其他管理員修改，請重新載入' using errcode='40001';
  end if;
  if p_action='bind' and previous.id is not null then
    raise exception '學生已有有效老師，請使用更換老師' using errcode='22023';
  end if;
  if p_action<>'bind' and previous.id is null then raise exception '學生目前沒有綁定' using errcode='22023'; end if;
  if p_action='bind' and student_role<>'pro' then raise exception '學生必須是 pro 美容師' using errcode='22023'; end if;
  if p_action<>'unbind' then
    if not exists(select 1 from public.profiles where id=p_instructor_id and role='instructor') then
      raise exception '新老師目前不是師資' using errcode='22023';
    end if;
    if not exists(select 1 from public.instructor_student_settings where instructor_id=p_instructor_id and student_price_type is not null) then
      raise exception '老師尚未設定學生價格類型' using errcode='22023';
    end if;
    if previous.instructor_id=p_instructor_id then raise exception '新老師與原老師相同' using errcode='22023'; end if;
  end if;
  if previous.id is not null then
    update public.instructor_student_bindings set ended_at=now(),ended_by=auth.uid(),
      end_reason=case when p_action='unbind' then 'unbound' else 'rebound' end where id=previous.id;
  end if;
  if p_action<>'unbind' then
    insert into public.instructor_student_bindings(student_id,instructor_id,created_by)
    values(p_student_id,p_instructor_id,auth.uid()) returning id into new_binding_id;
  end if;
  insert into public.instructor_student_audit_logs(event_type,student_id,instructor_id,previous_instructor_id,
    actor_user_id,actor_kind,before_data,after_data)
  values(p_action,p_student_id,p_instructor_id,previous.instructor_id,auth.uid(),'admin',
    jsonb_build_object('binding_id',previous.id,'instructor_id',previous.instructor_id),
    jsonb_build_object('binding_id',new_binding_id,'instructor_id',p_instructor_id));
  return public.get_admin_instructor_student_member(p_student_id);
end;
$$;

-- Approved deletion behavior: end live bindings, retain UUID-only history.
-- Auth deletion cascades into profiles; no existing deletion API is changed.
create or replace function public.end_instructor_student_bindings_on_member_delete()
returns trigger language plpgsql security definer set search_path='' as $$
declare binding public.instructor_student_bindings%rowtype;
begin
  for binding in select * from public.instructor_student_bindings
    where ended_at is null and (student_id=old.id or instructor_id=old.id) order by id for update loop
    update public.instructor_student_bindings set ended_at=now(),ended_by=auth.uid(),end_reason='member_deleted'
      where id=binding.id;
    insert into public.instructor_student_audit_logs(event_type,student_id,instructor_id,previous_instructor_id,
      actor_user_id,actor_kind,before_data,after_data)
    values('member_deleted',binding.student_id,binding.instructor_id,binding.instructor_id,auth.uid(),
      case when auth.uid() is null then 'system' else 'admin' end,
      jsonb_build_object('binding_id',binding.id,'instructor_id',binding.instructor_id),
      jsonb_build_object('binding_id',binding.id,'deleted_member_id',old.id,'end_reason','member_deleted'));
  end loop;
  return old;
end;
$$;
drop trigger if exists trg_end_instructor_student_bindings on public.profiles;
create trigger trg_end_instructor_student_bindings before delete on public.profiles
  for each row execute function public.end_instructor_student_bindings_on_member_delete();

-- Revoke explicit client grants as well as PUBLIC defaults on every signature.
revoke all on function public.prevent_instructor_student_audit_mutation(),
  public.assert_instructor_student_admin(boolean),public.instructor_student_context(uuid),
  public.end_instructor_student_bindings_on_member_delete(),
  public.get_admin_student_pricing_settings(),public.save_student_pricing_settings(jsonb,bigint),
  public.get_my_student_pricing_context(),public.get_my_instructor_students(),
  public.get_admin_instructor_student_member(uuid),public.get_admin_student_pricing_history(),
  public.set_instructor_student_price_type(uuid,text,bigint),
  public.save_instructor_student_binding(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.get_admin_student_pricing_settings(),
  public.save_student_pricing_settings(jsonb,bigint),public.get_my_student_pricing_context(),
  public.get_my_instructor_students(),public.get_admin_instructor_student_member(uuid),
  public.get_admin_student_pricing_history(),public.set_instructor_student_price_type(uuid,text,bigint),
  public.save_instructor_student_binding(uuid,uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;

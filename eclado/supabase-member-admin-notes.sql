-- 會員內部備註：只給後台看的單一備註欄，會員本人無法讀寫。
-- 不放在 profiles：會員可讀寫自己的 profiles 列（profiles_select_own / profiles_update_own）。
-- 查看：members.read 或 orders.read；修改：members.write。
-- 依賴 supabase-backoffice-permissions.sql 與 supabase-admin-audit-logs.sql。

create table if not exists public.member_admin_notes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_member_admin_notes_updated_at on public.member_admin_notes;
create trigger trg_member_admin_notes_updated_at
  before update on public.member_admin_notes
  for each row execute function public.set_updated_at();

alter table public.member_admin_notes enable row level security;
revoke all on table public.member_admin_notes from anon, authenticated;

comment on table public.member_admin_notes is
  'Backoffice-only internal note per member; read via get_admin_member_notes, written via save_member_admin_note.';

create or replace function public.get_admin_member_notes()
returns table (
  user_id uuid,
  note text,
  updated_by_email text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.has_backoffice_permission('members.read')
    or public.has_backoffice_permission('orders.read')
  ) then
    raise exception 'Member or order read access required' using errcode = '42501';
  end if;

  return query
  select member_note.user_id, member_note.note, member_note.updated_by_email, member_note.updated_at
  from public.member_admin_notes member_note;
end;
$$;

create or replace function public.save_member_admin_note(
  p_user_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text := nullif(auth.jwt() ->> 'email', '');
  actor_role text;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  previous public.member_admin_notes%rowtype;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Note is longer than 1000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  select * into previous
  from public.member_admin_notes
  where user_id = p_user_id
  for update;

  if previous.note is not distinct from clean_note then
    return jsonb_build_object('user_id', p_user_id, 'note', clean_note, 'changed', false);
  end if;

  if clean_note is null then
    delete from public.member_admin_notes where user_id = p_user_id;
  else
    insert into public.member_admin_notes (user_id, note, updated_by, updated_by_email)
    values (p_user_id, clean_note, actor_id, actor_email)
    on conflict (user_id) do update
      set note = excluded.note,
          updated_by = excluded.updated_by,
          updated_by_email = excluded.updated_by_email;
  end if;

  select admin_user.role
    into actor_role
  from public.admin_users admin_user
  where admin_user.user_id = actor_id
    and admin_user.active = true;

  insert into public.audit_logs (
    actor_user_id, actor_email, actor_role, actor_type,
    action, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    actor_id,
    actor_email,
    actor_role,
    'admin',
    'profiles.admin_note_saved',
    'profiles',
    p_user_id::text,
    case when previous.user_id is null then null else jsonb_build_object('note', previous.note) end,
    case when clean_note is null then null else jsonb_build_object('note', clean_note) end,
    jsonb_build_object('source', 'member-admin-note')
  );

  return jsonb_build_object('user_id', p_user_id, 'note', clean_note, 'changed', true);
end;
$$;

revoke all on function public.get_admin_member_notes() from public, anon;
revoke all on function public.save_member_admin_note(uuid, text) from public, anon;
grant execute on function public.get_admin_member_notes() to authenticated;
grant execute on function public.save_member_admin_note(uuid, text) to authenticated;

notify pgrst, 'reload schema';

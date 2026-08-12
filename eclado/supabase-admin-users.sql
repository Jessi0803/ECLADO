-- ECLADO administrator authority migration
-- Run once in Supabase SQL Editor before deploying the matching frontend/API.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

comment on table public.admin_users is
  'Authoritative ECLADO administrator allow-list keyed by Supabase Auth user id.';

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

create or replace function public.is_eclado_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and active = true
  );
$$;

revoke all on function public.is_eclado_admin() from public;
grant execute on function public.is_eclado_admin() to authenticated;

comment on function public.is_eclado_admin() is
  'Returns true when auth.uid() is an active administrator without exposing the administrator list.';

insert into public.admin_users (user_id, role, active)
select id, 'admin', true
from auth.users
where lower(email) in (
  'baby90522@gmail.com',
  'ecladotaiwan@gmail.com',
  'k0919933386@gmail.com',
  'line.u6f71cfa36c3fb2188f54396a5cb58882@ecladotaiwan.com'
)
on conflict (user_id) do update set active = true;

-- Verification result is visible only to the SQL Editor operator.
select au.user_id, u.email, au.role, au.active, au.created_at
from public.admin_users au
join auth.users u on u.id = au.user_id
order by u.email;

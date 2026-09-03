-- ECLADO super administrator / backorder access boundary.
-- Run after supabase-backoffice-permissions.sql.

begin;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.backoffice_role_permissions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%permission%'
  loop
    execute format('alter table public.backoffice_role_permissions drop constraint %I', constraint_name);
  end loop;

  alter table public.backoffice_role_permissions
    add constraint backoffice_role_permissions_permission_check
    check (permission in (
      'catalog.read', 'catalog.write',
      'orders.read', 'orders.write',
      'members.read', 'members.write',
      'promotions.manage', 'procurement.manage',
      'analytics.read', 'audit_logs.read', 'notifications.send',
      'backorders.manage'
    ));
end;
$$;

delete from public.backoffice_role_permissions
where permission = 'backorders.manage'
  and role <> 'super_admin';

insert into public.backoffice_role_permissions (role, permission)
values ('super_admin', 'backorders.manage')
on conflict do nothing;

-- Preserve catalog_editor. Only normalize the two full-administrator roles.
update public.admin_users admin_user
set role = 'admin'
from auth.users auth_user
where auth_user.id = admin_user.user_id
  and admin_user.role in ('admin', 'super_admin')
  and lower(auth_user.email) <> 'k0919933386@gmail.com';

insert into public.admin_users (user_id, role, active)
select id, 'super_admin', true
from auth.users
where lower(email) = 'k0919933386@gmail.com'
on conflict (user_id) do update set
  role = excluded.role,
  active = true;

commit;

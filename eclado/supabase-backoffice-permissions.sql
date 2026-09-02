-- ECLADO scalable backoffice roles and permissions.
-- Run after supabase-admin-users.sql and before the catalog save/image RPCs.

create table if not exists public.backoffice_roles (
  role text primary key,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.backoffice_role_permissions (
  role text not null references public.backoffice_roles(role) on update cascade on delete cascade,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role, permission),
  check (permission in (
    'catalog.read', 'catalog.write',
    'orders.read', 'orders.write',
    'members.read', 'members.write',
    'promotions.manage', 'procurement.manage',
    'analytics.read', 'audit_logs.read', 'notifications.send'
  ))
);

insert into public.backoffice_roles (role, label, active) values
  ('super_admin', '最高管理員', true),
  ('admin', '管理員', true),
  ('catalog_editor', '商品小編', true)
on conflict (role) do update set label = excluded.label, active = excluded.active;

insert into public.backoffice_role_permissions (role, permission)
select role, permission
from (values ('super_admin'), ('admin')) roles(role)
cross join (values
  ('catalog.read'), ('catalog.write'),
  ('orders.read'), ('orders.write'),
  ('members.read'), ('members.write'),
  ('promotions.manage'), ('procurement.manage'),
  ('analytics.read'), ('audit_logs.read'), ('notifications.send')
) permissions(permission)
on conflict do nothing;

insert into public.backoffice_role_permissions (role, permission) values
  ('catalog_editor', 'catalog.read'),
  ('catalog_editor', 'catalog.write')
on conflict do nothing;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.admin_users drop constraint %I', constraint_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_users'::regclass
      and conname = 'admin_users_role_fkey'
  ) then
    alter table public.admin_users
      add constraint admin_users_role_fkey
      foreign key (role) references public.backoffice_roles(role)
      on update cascade;
  end if;
end;
$$;

alter table public.backoffice_roles enable row level security;
alter table public.backoffice_role_permissions enable row level security;
revoke all on table public.backoffice_roles from anon, authenticated;
revoke all on table public.backoffice_role_permissions from anon, authenticated;

create or replace function public.is_eclado_backoffice_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    join public.backoffice_roles backoffice_role
      on backoffice_role.role = admin_user.role
     and backoffice_role.active is true
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
  );
$$;

create or replace function public.has_backoffice_permission(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_permission is not null and exists (
    select 1
    from public.admin_users admin_user
    join public.backoffice_roles backoffice_role
      on backoffice_role.role = admin_user.role
     and backoffice_role.active is true
    join public.backoffice_role_permissions role_permission
      on role_permission.role = admin_user.role
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
      and role_permission.permission = requested_permission
  );
$$;

-- Backwards-compatible full-administrator check. Existing order/member/payment
-- policies and RPCs keep using this function and therefore reject editors.
create or replace function public.is_eclado_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
      and active = true
      and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.get_my_backoffice_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'role', admin_user.role,
      'permissions', coalesce((
        select jsonb_agg(role_permission.permission order by role_permission.permission)
        from public.backoffice_role_permissions role_permission
        where role_permission.role = admin_user.role
      ), '[]'::jsonb)
    )
    from public.admin_users admin_user
    join public.backoffice_roles backoffice_role
      on backoffice_role.role = admin_user.role
     and backoffice_role.active is true
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
  ), jsonb_build_object('role', '', 'permissions', '[]'::jsonb));
$$;

revoke all on function public.is_eclado_backoffice_user() from public;
revoke all on function public.has_backoffice_permission(text) from public;
revoke all on function public.is_eclado_admin() from public;
revoke all on function public.get_my_backoffice_access() from public;
grant execute on function public.is_eclado_backoffice_user() to authenticated;
grant execute on function public.has_backoffice_permission(text) to authenticated;
grant execute on function public.is_eclado_admin() to authenticated;
grant execute on function public.get_my_backoffice_access() to authenticated;

create or replace function public.get_admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  can_manage_procurement boolean;
begin
  if not public.has_backoffice_permission('catalog.read') then
    raise exception 'Catalog read access required' using errcode = '42501';
  end if;
  can_manage_procurement := public.has_backoffice_permission('procurement.manage');

  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(to_jsonb(product) order by product.id)
      from public.products product
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        case when can_manage_procurement
          then to_jsonb(variant)
          else to_jsonb(variant) - 'procurement_unit_cost_usd'
        end
        order by variant.product_id, variant.sort_order, variant.id
      )
      from public.product_variants variant
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(to_jsonb(image) order by image.product_id, image.sort_order, image.id)
      from public.product_images image
      where image.active is true
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;

create or replace function public.set_product_publication_status(
  p_product_id integer,
  p_publication_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_backoffice_permission('catalog.write') then
    raise exception 'Catalog write access required' using errcode = '42501';
  end if;
  if p_publication_status not in ('draft', 'active', 'archived') then
    raise exception 'Invalid publication status' using errcode = '22023';
  end if;
  update public.products
  set publication_status = p_publication_status
  where id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_admin_catalog() from public;
revoke all on function public.set_product_publication_status(integer, text) from public;
grant execute on function public.get_admin_catalog() to authenticated;
grant execute on function public.set_product_publication_status(integer, text) to authenticated;

-- Catalog editors may manage only objects in the product-images bucket.
drop policy if exists "product_images_storage_select_admin" on storage.objects;
drop policy if exists "product_images_storage_insert_admin" on storage.objects;
drop policy if exists "product_images_storage_update_admin" on storage.objects;
drop policy if exists "product_images_storage_delete_admin" on storage.objects;

create policy "product_images_storage_select_admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and public.has_backoffice_permission('catalog.read'));

create policy "product_images_storage_insert_admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = 'products'
    and public.has_backoffice_permission('catalog.write')
  );

create policy "product_images_storage_update_admin"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_backoffice_permission('catalog.write'))
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = 'products'
    and public.has_backoffice_permission('catalog.write')
  );

create policy "product_images_storage_delete_admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_backoffice_permission('catalog.write'));

comment on function public.is_eclado_admin() is
  'Full administrator check. Catalog editors intentionally return false.';
comment on function public.has_backoffice_permission(text) is
  'Returns true only when the active caller role has the requested explicit capability.';
comment on function public.get_my_backoffice_access() is
  'Returns only the authenticated caller role and effective permissions; never exposes the user allow-list.';

-- Run these updated files immediately after this migration so their SECURITY
-- DEFINER functions use the permission model and protect procurement cost:
--   supabase-save-product-with-variants.sql
--   supabase-save-product-images.sql
--   supabase-system-audit-logs.sql

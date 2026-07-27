-- ECLADO core RLS hardening
-- Run after supabase-authoritative-pricing.sql and supabase-promotions-secure-rls.sql.

-- Never trust role supplied through sign-up user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone',
    'consumer'
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(public.profiles.name, excluded.name),
    phone = coalesce(public.profiles.phone, excluded.phone),
    updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role'
    and not public.is_eclado_admin()
    and coalesce(current_setting('app.eclado_allow_profile_security_update', true), '') <> 'true'
    and (
      new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.role is distinct from old.role
      or new.line_user_id is distinct from old.line_user_id
    )
  then
    raise exception 'Profile security fields may only be changed by an administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_security_fields on public.profiles;
create trigger trg_protect_profile_security_fields
  before update on public.profiles
  for each row execute function public.protect_profile_security_fields();

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_insert_all" on public.profiles;
drop policy if exists "profiles_update_all" on public.profiles;
drop policy if exists "profiles_delete_all" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "profiles_select_admin"
  on public.profiles for select to authenticated
  using (public.is_eclado_admin());
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
create policy "profiles_update_admin"
  on public.profiles for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

alter table public.products enable row level security;
drop policy if exists "products_select_all" on public.products;
drop policy if exists "products_insert_all" on public.products;
drop policy if exists "products_update_all" on public.products;
drop policy if exists "products_delete_all" on public.products;
drop policy if exists "products_select_active" on public.products;
drop policy if exists "products_select_admin" on public.products;
drop policy if exists "products_insert_admin" on public.products;
drop policy if exists "products_update_admin" on public.products;

create policy "products_select_active"
  on public.products for select to anon, authenticated
  using (active is true);
create policy "products_select_admin"
  on public.products for select to authenticated
  using (public.is_eclado_admin());
create policy "products_insert_admin"
  on public.products for insert to authenticated
  with check (public.is_eclado_admin());
create policy "products_update_admin"
  on public.products for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

alter table public.product_variants enable row level security;
drop policy if exists "product_variants_select_all" on public.product_variants;
drop policy if exists "product_variants_insert_all" on public.product_variants;
drop policy if exists "product_variants_update_all" on public.product_variants;
drop policy if exists "product_variants_delete_all" on public.product_variants;
drop policy if exists "product_variants_select_active" on public.product_variants;
drop policy if exists "product_variants_select_admin" on public.product_variants;
drop policy if exists "product_variants_insert_admin" on public.product_variants;
drop policy if exists "product_variants_update_admin" on public.product_variants;

create policy "product_variants_select_active"
  on public.product_variants for select to anon, authenticated
  using (
    active is true
    and exists (
      select 1 from public.products product
      where product.id = product_variants.product_id
        and product.active is true
    )
  );
create policy "product_variants_select_admin"
  on public.product_variants for select to authenticated
  using (public.is_eclado_admin());
create policy "product_variants_insert_admin"
  on public.product_variants for insert to authenticated
  with check (public.is_eclado_admin());
create policy "product_variants_update_admin"
  on public.product_variants for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

alter table public.professional_applications enable row level security;
drop policy if exists "professional_applications_select_all" on public.professional_applications;
drop policy if exists "professional_applications_insert_all" on public.professional_applications;
drop policy if exists "professional_applications_update_all" on public.professional_applications;
drop policy if exists "professional_applications_delete_all" on public.professional_applications;
drop policy if exists "professional_applications_select_own" on public.professional_applications;
drop policy if exists "professional_applications_select_admin" on public.professional_applications;
drop policy if exists "professional_applications_update_admin" on public.professional_applications;

create policy "professional_applications_select_own"
  on public.professional_applications for select to authenticated
  using (user_id = auth.uid());
create policy "professional_applications_select_admin"
  on public.professional_applications for select to authenticated
  using (public.is_eclado_admin());
create policy "professional_applications_update_admin"
  on public.professional_applications for update to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

create or replace function public.submit_professional_application(
  p_studio_name text,
  p_contact_name text,
  p_phone text,
  p_address text,
  p_social_media text,
  p_certificate text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  application_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.professional_applications
    where user_id = current_user_id and status = 'pending'
  ) then
    raise exception 'A pending application already exists' using errcode = '23505';
  end if;
  if nullif(trim(p_studio_name), '') is null
    or nullif(trim(p_contact_name), '') is null
    or nullif(trim(p_phone), '') is null
    or nullif(trim(p_address), '') is null
    or nullif(trim(p_social_media), '') is null
    or nullif(trim(p_certificate), '') is null
  then
    raise exception 'All application fields are required' using errcode = '22023';
  end if;

  insert into public.professional_applications (
    studio_name, contact_name, phone, address, social_media, certificate,
    user_id, user_email, status, source
  )
  select
    trim(p_studio_name), trim(p_contact_name), trim(p_phone), trim(p_address),
    trim(p_social_media), trim(p_certificate), current_user_id, profile.email,
    'pending', 'standalone'
  from public.profiles profile
  where profile.id = current_user_id
  returning id into application_id;

  if application_id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  update public.profiles set role = 'pending' where id = current_user_id;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);
  return application_id;
end;
$$;

revoke all on function public.submit_professional_application(text, text, text, text, text, text) from public;
grant execute on function public.submit_professional_application(text, text, text, text, text, text) to authenticated;

alter table public.orders enable row level security;
drop policy if exists "orders_select_all" on public.orders;
drop policy if exists "orders_insert_all" on public.orders;
drop policy if exists "orders_update_all" on public.orders;
drop policy if exists "orders_delete_all" on public.orders;
drop policy if exists "orders_select_own" on public.orders;
drop policy if exists "orders_select_admin" on public.orders;
create policy "orders_select_own"
  on public.orders for select to authenticated
  using (user_id = auth.uid());
create policy "orders_select_admin"
  on public.orders for select to authenticated
  using (public.is_eclado_admin());

create or replace function public.get_public_sales_orders()
returns table(status text, items jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select orders.status, orders.items
  from public.orders
  where orders.status in ('paid', 'preparing', 'shipped', 'delivered')
  order by orders.created_at desc
  limit 1000;
$$;

revoke all on function public.get_public_sales_orders() from public;
grant execute on function public.get_public_sales_orders() to anon, authenticated;

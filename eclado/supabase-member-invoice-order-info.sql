-- ECLADO member salon defaults and order invoice snapshots.
-- Run once in Supabase SQL Editor after supabase-promotion-gifts-engine.sql.

alter table public.profiles
  add column if not exists studio_name text,
  add column if not exists studio_contact_name text,
  add column if not exists studio_phone text,
  add column if not exists studio_address text,
  add column if not exists default_invoice_company_name text,
  add column if not exists default_invoice_tax_id text;

alter table public.orders
  add column if not exists invoice_type text,
  add column if not exists invoice_company_name text,
  add column if not exists invoice_tax_id text,
  add column if not exists invoice_number text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_default_invoice_tax_id_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_default_invoice_tax_id_format_check
      check (
        default_invoice_tax_id is null
        or btrim(default_invoice_tax_id) = ''
        or btrim(default_invoice_tax_id) ~ '^[0-9]{8}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_invoice_type_check'
  ) then
    alter table public.orders
      add constraint orders_invoice_type_check
      check (invoice_type is null or invoice_type in ('personal', 'company'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_invoice_company_fields_check'
  ) then
    alter table public.orders
      add constraint orders_invoice_company_fields_check
      check (
        invoice_type is distinct from 'company'
        or (
          nullif(btrim(invoice_company_name), '') is not null
          and nullif(btrim(invoice_tax_id), '') is not null
          and btrim(invoice_tax_id) ~ '^[0-9]{8}$'
        )
      );
  end if;
end;
$$;

-- Preserve each application as an application-time snapshot. Only seed empty
-- profile fields from the newest application so no member edits are replaced.
with latest_application as (
  select distinct on (application.user_id)
    application.user_id,
    application.studio_name,
    application.contact_name,
    application.phone,
    application.address
  from public.professional_applications application
  where application.user_id is not null
  order by application.user_id, application.created_at desc, application.id desc
)
update public.profiles profile
set
  studio_name = coalesce(nullif(btrim(profile.studio_name), ''), nullif(btrim(application.studio_name), '')),
  studio_contact_name = coalesce(nullif(btrim(profile.studio_contact_name), ''), nullif(btrim(application.contact_name), '')),
  studio_phone = coalesce(nullif(btrim(profile.studio_phone), ''), nullif(btrim(application.phone), '')),
  studio_address = coalesce(nullif(btrim(profile.studio_address), ''), nullif(btrim(application.address), '')),
  updated_at = now()
from latest_application application
where profile.id = application.user_id
  and (
    nullif(btrim(profile.studio_name), '') is null
    or nullif(btrim(profile.studio_contact_name), '') is null
    or nullif(btrim(profile.studio_phone), '') is null
    or nullif(btrim(profile.studio_address), '') is null
  );

create or replace function public.seed_profile_salon_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    perform set_config('app.eclado_allow_profile_salon_seed', 'true', true);
    update public.profiles profile
    set
      studio_name = coalesce(nullif(btrim(profile.studio_name), ''), nullif(btrim(new.studio_name), '')),
      studio_contact_name = coalesce(nullif(btrim(profile.studio_contact_name), ''), nullif(btrim(new.contact_name), '')),
      studio_phone = coalesce(nullif(btrim(profile.studio_phone), ''), nullif(btrim(new.phone), '')),
      studio_address = coalesce(nullif(btrim(profile.studio_address), ''), nullif(btrim(new.address), '')),
      updated_at = now()
    where profile.id = new.user_id;
    perform set_config('app.eclado_allow_profile_salon_seed', 'false', true);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seed_profile_salon_from_application on public.professional_applications;
create trigger trg_seed_profile_salon_from_application
  after insert on public.professional_applications
  for each row execute function public.seed_profile_salon_from_application();

-- Salon data is application/backoffice-owned. Members cannot alter their
-- approved/application salon identity by calling the profiles REST endpoint
-- directly.
create or replace function public.protect_profile_salon_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role'
    and not public.is_eclado_admin()
    and coalesce(current_setting('app.eclado_allow_profile_salon_seed', true), '') <> 'true'
    and (
      new.studio_name is distinct from old.studio_name
      or new.studio_contact_name is distinct from old.studio_contact_name
      or new.studio_phone is distinct from old.studio_phone
      or new.studio_address is distinct from old.studio_address
    )
  then
    raise exception 'Salon profile fields may only be changed through an application or by an administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_salon_fields on public.profiles;
create trigger trg_protect_profile_salon_fields
  before update on public.profiles
  for each row execute function public.protect_profile_salon_fields();

-- Invoice defaults belong to professional accounts. Consumer and pending
-- accounts can still enter company invoice data for an individual order, but
-- cannot persist those values on their member profile by bypassing the UI.
create or replace function public.protect_profile_invoice_default_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role'
    and not public.is_eclado_admin()
    and coalesce(old.role, 'consumer') not in ('pro', 'instructor', 'distributor')
    and (
      new.default_invoice_company_name is distinct from old.default_invoice_company_name
      or new.default_invoice_tax_id is distinct from old.default_invoice_tax_id
    )
  then
    raise exception 'Invoice defaults are available only to professional members'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_invoice_default_fields on public.profiles;
create trigger trg_protect_profile_invoice_default_fields
  before update on public.profiles
  for each row execute function public.protect_profile_invoice_default_fields();

-- Keep the existing 9-argument order RPC for in-flight/older clients. The
-- checkout uses this overload so invoice data is written in the same DB
-- transaction as the authoritative order.
create or replace function public.create_order_with_pricing(
  p_items jsonb, p_member text, p_address text, p_phone text, p_email text,
  p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text,
  p_invoice_type text, p_invoice_company_name text, p_invoice_tax_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  result jsonb;
  normalized_invoice_type text := lower(btrim(coalesce(p_invoice_type, 'personal')));
  normalized_company_name text := nullif(btrim(coalesce(p_invoice_company_name, '')), '');
  normalized_tax_id text := nullif(btrim(coalesce(p_invoice_tax_id, '')), '');
  created_order_id text;
begin
  if normalized_invoice_type not in ('personal', 'company') then
    raise exception 'Invalid invoice type' using errcode = '22023';
  end if;
  if normalized_invoice_type = 'company' then
    if normalized_company_name is null then
      raise exception 'Company invoice name is required' using errcode = '22023';
    end if;
    if normalized_tax_id is null or normalized_tax_id !~ '^[0-9]{8}$' then
      raise exception 'Invalid company tax ID' using errcode = '22023';
    end if;
  else
    normalized_company_name := null;
    normalized_tax_id := null;
  end if;

  result := public.create_order_with_pricing(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, p_coupon_code
  );
  created_order_id := result ->> 'order_id';

  update public.orders
  set
    invoice_type = normalized_invoice_type,
    invoice_company_name = normalized_company_name,
    invoice_tax_id = normalized_tax_id
  where id = created_order_id;

  return result || jsonb_build_object(
    'invoice_type', normalized_invoice_type,
    'invoice_company_name', normalized_company_name,
    'invoice_tax_id', normalized_tax_id
  );
end;
$$;

revoke all on function public.create_order_with_pricing(
  jsonb,text,text,text,text,text,text,text,text,text,text,text
) from public;
grant execute on function public.create_order_with_pricing(
  jsonb,text,text,text,text,text,text,text,text,text,text,text
) to anon, authenticated;

create or replace function public.save_order_invoice_number(
  p_order_id text,
  p_invoice_number text
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_invoice_number text := nullif(upper(btrim(coalesce(p_invoice_number, ''))), '');
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write permission required' using errcode = '42501';
  end if;
  if normalized_invoice_number is not null and char_length(normalized_invoice_number) > 40 then
    raise exception 'Invoice number is too long' using errcode = '22023';
  end if;

  update public.orders
  set invoice_number = normalized_invoice_number
  where id = p_order_id;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  return normalized_invoice_number;
end;
$$;

revoke all on function public.save_order_invoice_number(text, text) from public;
grant execute on function public.save_order_invoice_number(text, text) to authenticated;

comment on function public.save_order_invoice_number(text, text) is
  'Records only the externally issued invoice number. It does not alter payment, inventory, notifications, totals, or order status.';

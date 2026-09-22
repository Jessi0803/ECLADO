-- Optional private certificate images for professional applications.
-- Run after supabase-core-rls-hardening.sql and supabase-backoffice-permissions.sql.

begin;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'professional-certificates',
  'professional-certificates',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Compatibility hardening for the existing public product-image policy.
-- Storage combines SELECT policies across buckets; the old inline subquery
-- could demand direct products-table permission while signing a certificate.
create or replace function public.is_public_product_image_storage_path(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.product_images image
    join public.products product on product.id = image.product_id
    where image.storage_path = p_storage_path
      and image.active is true
      and product.active is true
  );
$$;

revoke all on function public.is_public_product_image_storage_path(text) from public;
grant execute on function public.is_public_product_image_storage_path(text) to anon, authenticated;

drop policy if exists "product_images_storage_select_linked" on storage.objects;
create policy "product_images_storage_select_linked"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'product-images'
    and public.is_public_product_image_storage_path(storage.objects.name)
  );

create table if not exists public.professional_application_certificates (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.professional_applications(id) on delete cascade,
  storage_path text not null unique check (
    btrim(storage_path) <> ''
    and storage_path !~ '^/'
  ),
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size integer not null check (file_size between 1 and 5242880),
  sort_order integer not null check (sort_order between 0 and 2),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (application_id, sort_order)
);

create index if not exists professional_application_certificates_application_idx
  on public.professional_application_certificates(application_id, sort_order, id);

alter table public.professional_application_certificates enable row level security;

drop policy if exists "professional_certificates_select_own" on public.professional_application_certificates;
drop policy if exists "professional_certificates_select_admin" on public.professional_application_certificates;

create policy "professional_certificates_select_own"
  on public.professional_application_certificates for select to authenticated
  using (
    exists (
      select 1
      from public.professional_applications application
      where application.id = professional_application_certificates.application_id
        and application.user_id = auth.uid()
    )
  );

create policy "professional_certificates_select_admin"
  on public.professional_application_certificates for select to authenticated
  using (public.has_backoffice_permission('members.read'));

revoke all on table public.professional_application_certificates from public, anon;
grant select on table public.professional_application_certificates to authenticated;

drop policy if exists "professional_certificate_objects_insert_own" on storage.objects;
drop policy if exists "professional_certificate_objects_select_own" on storage.objects;
drop policy if exists "professional_certificate_objects_select_admin" on storage.objects;
drop policy if exists "professional_certificate_objects_delete_unlinked_own" on storage.objects;

create policy "professional_certificate_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'professional-certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

create policy "professional_certificate_objects_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'professional-certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "professional_certificate_objects_select_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'professional-certificates'
    and public.has_backoffice_permission('members.read')
  );

create policy "professional_certificate_objects_delete_unlinked_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'professional-certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1
      from public.professional_application_certificates certificate
      where certificate.storage_path = storage.objects.name
    )
  );

create or replace function public.submit_professional_application_with_certificates(
  p_studio_name text,
  p_contact_name text,
  p_phone text,
  p_address text,
  p_social_media text,
  p_certificate text,
  p_application_id uuid,
  p_certificates jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, storage, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  certificate_record record;
  certificate_count integer;
  certificate_path text;
  certificate_name text;
  certificate_mime text;
  certificate_size integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'Application id is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.professional_applications
    where user_id = current_user_id and status = 'pending'
  ) then
    raise exception 'A pending application already exists' using errcode = '23505';
  end if;
  if nullif(btrim(p_studio_name), '') is null
    or nullif(btrim(p_contact_name), '') is null
    or nullif(btrim(p_phone), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_social_media), '') is null
    or nullif(btrim(p_certificate), '') is null
  then
    raise exception 'All application fields are required' using errcode = '22023';
  end if;
  if p_certificates is null or jsonb_typeof(p_certificates) <> 'array' then
    raise exception 'Certificates must be an array' using errcode = '22023';
  end if;

  certificate_count := jsonb_array_length(p_certificates);
  if certificate_count > 3 then
    raise exception 'At most three certificate images are allowed' using errcode = '22023';
  end if;

  -- Verify every referenced private object before creating the application.
  for certificate_record in
    select value, ordinality
    from jsonb_array_elements(p_certificates) with ordinality
  loop
    certificate_path := btrim(certificate_record.value ->> 'storage_path');
    certificate_name := left(btrim(certificate_record.value ->> 'original_name'), 255);
    certificate_mime := btrim(certificate_record.value ->> 'mime_type');
    certificate_size := nullif(certificate_record.value ->> 'file_size', '')::integer;

    if certificate_path !~ ('^' || current_user_id::text || '/' || p_application_id::text || '/[^/]+$')
      or certificate_name = ''
      or certificate_mime not in ('image/jpeg', 'image/png', 'image/webp')
      or certificate_size is null
      or certificate_size not between 1 and 5242880
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'professional-certificates'
          and object.name = certificate_path
      )
    then
      raise exception 'Invalid certificate image metadata' using errcode = '22023';
    end if;
  end loop;

  insert into public.professional_applications (
    id, studio_name, contact_name, phone, address, social_media, certificate,
    user_id, user_email, status, source
  )
  select
    p_application_id, btrim(p_studio_name), btrim(p_contact_name), btrim(p_phone),
    btrim(p_address), btrim(p_social_media), btrim(p_certificate),
    current_user_id, profile.email, 'pending', 'standalone'
  from public.profiles profile
  where profile.id = current_user_id;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  insert into public.professional_application_certificates (
    application_id, storage_path, original_name, mime_type, file_size, sort_order, uploaded_by
  )
  select
    p_application_id,
    btrim(entry.value ->> 'storage_path'),
    left(btrim(entry.value ->> 'original_name'), 255),
    btrim(entry.value ->> 'mime_type'),
    (entry.value ->> 'file_size')::integer,
    (entry.ordinality - 1)::integer,
    current_user_id
  from jsonb_array_elements(p_certificates) with ordinality entry;

  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  update public.profiles set role = 'pending' where id = current_user_id;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);

  return p_application_id;
end;
$$;

revoke all on function public.submit_professional_application_with_certificates(
  text, text, text, text, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.submit_professional_application_with_certificates(
  text, text, text, text, text, text, uuid, jsonb
) to authenticated;

comment on table public.professional_application_certificates is
  'Private optional certificate-image metadata for professional applications; Storage paths are never public URLs.';
comment on function public.submit_professional_application_with_certificates(
  text, text, text, text, text, text, uuid, jsonb
) is 'Atomically creates a professional application and links up to three pre-uploaded private certificate images.';

commit;

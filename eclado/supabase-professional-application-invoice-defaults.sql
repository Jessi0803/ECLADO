-- Optional invoice defaults on professional applications.
-- Run after:
--   1. supabase-professional-application-certificates.sql
--   2. supabase-member-invoice-order-info.sql
-- Safe to run repeatedly.

begin;

alter table public.professional_applications
  add column if not exists invoice_company_name text,
  add column if not exists invoice_tax_id text;

alter table public.professional_applications
  drop constraint if exists professional_applications_invoice_fields_check;

alter table public.professional_applications
  add constraint professional_applications_invoice_fields_check
  check (
    (
      nullif(btrim(invoice_company_name), '') is null
      and nullif(btrim(invoice_tax_id), '') is null
    )
    or (
      nullif(btrim(invoice_company_name), '') is not null
      and btrim(invoice_tax_id) ~ '^[0-9]{8}$'
    )
  );

-- Keep the original eight-argument RPC available for older clients. The new
-- overload validates and stores the optional invoice snapshot in the same
-- transaction as the application and certificate metadata.
create or replace function public.submit_professional_application_with_certificates(
  p_studio_name text,
  p_contact_name text,
  p_phone text,
  p_address text,
  p_social_media text,
  p_certificate text,
  p_application_id uuid,
  p_certificates jsonb,
  p_invoice_company_name text,
  p_invoice_tax_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, storage, extensions, pg_temp
as $$
declare
  created_application_id uuid;
  normalized_company_name text := nullif(btrim(coalesce(p_invoice_company_name, '')), '');
  normalized_tax_id text := nullif(btrim(coalesce(p_invoice_tax_id, '')), '');
begin
  if (normalized_company_name is null) <> (normalized_tax_id is null) then
    raise exception 'Invoice company name and tax id must be provided together'
      using errcode = '22023';
  end if;
  if normalized_tax_id is not null and normalized_tax_id !~ '^[0-9]{8}$' then
    raise exception 'Invoice tax id must contain exactly eight digits'
      using errcode = '22023';
  end if;

  created_application_id := public.submit_professional_application_with_certificates(
    p_studio_name,
    p_contact_name,
    p_phone,
    p_address,
    p_social_media,
    p_certificate,
    p_application_id,
    coalesce(p_certificates, '[]'::jsonb)
  );

  update public.professional_applications
  set
    invoice_company_name = normalized_company_name,
    invoice_tax_id = normalized_tax_id
  where id = created_application_id;

  return created_application_id;
end;
$$;

revoke all on function public.submit_professional_application_with_certificates(
  text, text, text, text, text, text, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.submit_professional_application_with_certificates(
  text, text, text, text, text, text, uuid, jsonb, text, text
) to authenticated;

-- Approval is the point at which application-time invoice values become the
-- professional member's defaults. Blank application values preserve existing
-- defaults instead of erasing them.
create or replace function public.sync_approved_application_invoice_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status = 'approved'
    and case when tg_op = 'INSERT' then true else old.status is distinct from 'approved' end
    and new.user_id is not null
  then
    update public.profiles profile
    set
      default_invoice_company_name = coalesce(
        nullif(btrim(new.invoice_company_name), ''),
        profile.default_invoice_company_name
      ),
      default_invoice_tax_id = coalesce(
        nullif(btrim(new.invoice_tax_id), ''),
        profile.default_invoice_tax_id
      ),
      updated_at = now()
    where profile.id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_approved_application_invoice_defaults
  on public.professional_applications;
create trigger trg_sync_approved_application_invoice_defaults
  after insert or update of status on public.professional_applications
  for each row execute function public.sync_approved_application_invoice_defaults();

comment on column public.professional_applications.invoice_company_name is
  'Optional application-time company-name snapshot copied to profile defaults upon approval.';
comment on column public.professional_applications.invoice_tax_id is
  'Optional application-time tax-id snapshot copied to profile defaults upon approval.';

notify pgrst, 'reload schema';

commit;

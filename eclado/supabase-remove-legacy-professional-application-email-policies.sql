-- Remove legacy hard-coded email RLS policies.
-- Administrator access is now exclusively determined by admin_users through
-- public.is_eclado_admin().

drop policy if exists "admin can read"
  on public.professional_applications;

drop policy if exists "admin can update"
  on public.professional_applications;


-- Coupon member targeting.
-- Run after supabase-promotions-coupons-foundation.sql, then re-run
-- supabase-coupon-discount-engine.sql and supabase-promotion-gifts-engine.sql
-- in that order so the public pricing wrappers keep gift evaluation enabled.

begin;

alter table public.coupon_campaigns
  add column if not exists audience_mode text not null default 'roles';

alter table public.coupon_campaigns
  drop constraint if exists coupon_campaigns_audience_check,
  drop constraint if exists coupon_campaigns_audience_mode_check;

alter table public.coupon_campaigns
  add constraint coupon_campaigns_audience_mode_check check (
    (
      audience_mode = 'roles'
      and cardinality(audience_roles) > 0
      and audience_roles <@ array['consumer', 'pro', 'instructor', 'distributor']::text[]
    )
    or (
      audience_mode = 'members'
      and cardinality(audience_roles) = 0
      and allow_guest is false
    )
  );

comment on column public.coupon_campaigns.audience_mode is
  'roles uses audience_roles and optional guests; members allows only explicitly linked authenticated profiles.';

create table if not exists public.coupon_campaign_members (
  id bigint generated always as identity primary key,
  coupon_campaign_id uuid not null references public.coupon_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (coupon_campaign_id, user_id)
);

create index if not exists coupon_campaign_members_user_idx
  on public.coupon_campaign_members (user_id, coupon_campaign_id);

alter table public.coupon_campaign_members enable row level security;
revoke all on table public.coupon_campaign_members from anon, authenticated;
grant select, insert, delete on table public.coupon_campaign_members to authenticated;
grant usage, select on sequence public.coupon_campaign_members_id_seq to authenticated;

drop policy if exists "coupon_campaign_members_manage" on public.coupon_campaign_members;
create policy "coupon_campaign_members_manage"
  on public.coupon_campaign_members for all to authenticated
  using (public.has_backoffice_permission('promotions.manage'))
  with check (public.has_backoffice_permission('promotions.manage'));

create or replace function public.coupon_campaign_allows_identity(
  p_campaign_id uuid,
  p_member_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case campaign.audience_mode
      when 'members' then auth.uid() is not null and exists (
        select 1
        from public.coupon_campaign_members target
        where target.coupon_campaign_id = campaign.id
          and target.user_id = auth.uid()
      )
      else p_member_role = any(campaign.audience_roles)
        and (auth.uid() is not null or campaign.allow_guest is true)
    end
    from public.coupon_campaigns campaign
    where campaign.id = p_campaign_id
  ), false);
$$;

revoke all on function public.coupon_campaign_allows_identity(uuid, text) from public;

create or replace function public.search_coupon_members(
  p_query text,
  p_limit integer default 20
)
returns table (
  user_id uuid,
  name text,
  email text,
  phone text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query_text text := btrim(coalesce(p_query, ''));
  result_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management access required' using errcode = '42501';
  end if;
  if length(query_text) < 2 then
    return;
  end if;

  return query
  select profile.id, profile.name, profile.email, profile.phone, profile.role
  from public.profiles profile
  where coalesce(profile.name, '') ilike '%' || query_text || '%'
    or coalesce(profile.email, '') ilike '%' || query_text || '%'
    or coalesce(profile.phone, '') ilike '%' || query_text || '%'
  order by profile.name nulls last, profile.created_at desc, profile.id
  limit result_limit;
end;
$$;

create or replace function public.get_coupon_campaign_members(
  p_coupon_campaign_id uuid
)
returns table (
  user_id uuid,
  name text,
  email text,
  phone text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management access required' using errcode = '42501';
  end if;

  return query
  select profile.id, profile.name, profile.email, profile.phone, profile.role
  from public.coupon_campaign_members target
  join public.profiles profile on profile.id = target.user_id
  where target.coupon_campaign_id = p_coupon_campaign_id
  order by profile.name nulls last, profile.created_at desc, profile.id;
end;
$$;

revoke all on function public.search_coupon_members(text, integer) from public, anon;
revoke all on function public.get_coupon_campaign_members(uuid) from public, anon;
grant execute on function public.search_coupon_members(text, integer) to authenticated;
grant execute on function public.get_coupon_campaign_members(uuid) to authenticated;

drop trigger if exists trg_audit_coupon_campaign_members on public.coupon_campaign_members;
create trigger trg_audit_coupon_campaign_members
  after insert or update or delete on public.coupon_campaign_members
  for each row execute function public.capture_promotion_configuration_audit();

notify pgrst, 'reload schema';

commit;

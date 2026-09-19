-- 優惠券「指定會員」：顯示並可搜尋美容師申請的聯絡人 / 皮膚管理院名稱
-- 每位會員取一筆申請：優先已核准，其次最新一筆。
-- 不限最少字元；空白查詢會依排序列出前 p_limit 位會員。

drop function if exists public.search_coupon_members(text, integer);
drop function if exists public.get_coupon_campaign_members(uuid);

create or replace function public.search_coupon_members(
  p_query text,
  p_limit integer default 20
)
returns table (
  user_id uuid,
  name text,
  email text,
  phone text,
  role text,
  contact_name text,
  studio_name text
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
  return query
  select profile.id, profile.name, profile.email, profile.phone, profile.role,
    application.contact_name, application.studio_name
  from public.profiles profile
  left join lateral (
    select app.contact_name, app.studio_name
    from public.professional_applications app
    where app.user_id = profile.id
      or (app.user_id is null and lower(app.user_email) = lower(profile.email))
    order by (app.status = 'approved') desc, app.created_at desc
    limit 1
  ) application on true
  where coalesce(profile.name, '') ilike '%' || query_text || '%'
    or coalesce(profile.email, '') ilike '%' || query_text || '%'
    or coalesce(profile.phone, '') ilike '%' || query_text || '%'
    or coalesce(application.contact_name, '') ilike '%' || query_text || '%'
    or coalesce(application.studio_name, '') ilike '%' || query_text || '%'
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
  role text,
  contact_name text,
  studio_name text
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
  select profile.id, profile.name, profile.email, profile.phone, profile.role,
    application.contact_name, application.studio_name
  from public.coupon_campaign_members target
  join public.profiles profile on profile.id = target.user_id
  left join lateral (
    select app.contact_name, app.studio_name
    from public.professional_applications app
    where app.user_id = profile.id
      or (app.user_id is null and lower(app.user_email) = lower(profile.email))
    order by (app.status = 'approved') desc, app.created_at desc
    limit 1
  ) application on true
  where target.coupon_campaign_id = p_coupon_campaign_id
  order by profile.name nulls last, profile.created_at desc, profile.id;
end;
$$;

revoke all on function public.search_coupon_members(text, integer) from public, anon;
revoke all on function public.get_coupon_campaign_members(uuid) from public, anon;
grant execute on function public.search_coupon_members(text, integer) to authenticated;
grant execute on function public.get_coupon_campaign_members(uuid) to authenticated;

notify pgrst, 'reload schema';

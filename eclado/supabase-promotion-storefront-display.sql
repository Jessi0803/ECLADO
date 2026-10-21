-- Apply after all existing promotion engines and automatic-promotion-audience.
begin;
alter table public.promotions
  add column if not exists label_text text not null default '',
  add column if not exists label_color text not null default '#C94A3F',
  add column if not exists storefront_scope_type text;
alter table public.promotions drop constraint if exists promotions_storefront_label_check;
alter table public.promotions add constraint promotions_storefront_label_check check (
  char_length(label_text) <= 20 and label_color ~ '^#[0-9a-fA-F]{6}$'
  and (storefront_scope_type is null or storefront_scope_type in ('products','all_regular','all_sellable'))
);

-- Full-store activities may retain product_ids: inspect the actual benefit scope.
create or replace function public.promotion_storefront_scope(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists(select 1 from public.promotion_scopes where promotion_id=p_id and scope_role='benefit' and mode='include' and target_type='all_sellable') then 'all_sellable'
    when exists(select 1 from public.promotion_scopes where promotion_id=p_id and scope_role='benefit' and mode='include' and target_type='all_regular') then 'all_regular'
    when exists(select 1 from public.promotion_scopes where promotion_id=p_id and scope_role='benefit' and mode='include' and target_type='product') then 'products'
    else null end;
$$;
revoke all on function public.promotion_storefront_scope(uuid) from public, anon, authenticated;
update public.promotions set storefront_scope_type=public.promotion_storefront_scope(id);

-- Wrap the installed editor to preserve pricing, gift, audience and audit rules.
do $$
declare definition text;
begin
  if to_regprocedure('public.save_discount_promotion_before_storefront_20261021(jsonb)') is null then
    alter function public.save_discount_promotion(jsonb) rename to save_discount_promotion_before_storefront_20261021;
  else
    definition := pg_get_functiondef('public.save_discount_promotion(jsonb)'::regprocedure);
    if position('public.save_discount_promotion_before_storefront_20261021(p_payload)' in definition) = 0 then
      execute replace(definition, 'FUNCTION public.save_discount_promotion(',
        'FUNCTION public.save_discount_promotion_before_storefront_20261021(');
    end if;
  end if;
end;
$$;
revoke all on function public.save_discount_promotion_before_storefront_20261021(jsonb) from public, anon, authenticated;
create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management access required' using errcode='42501';
  end if;
  if p_payload ? 'label_text' and (jsonb_typeof(p_payload->'label_text') is distinct from 'string' or char_length(btrim(p_payload->>'label_text')) > 20) then
    raise exception 'Activity label must be at most 20 characters' using errcode='22023';
  end if;
  if p_payload ? 'label_color' and (jsonb_typeof(p_payload->'label_color') is distinct from 'string' or (p_payload->>'label_color') !~ '^#[0-9a-fA-F]{6}$') then
    raise exception 'Invalid activity label color' using errcode='22023';
  end if;
  target_id := public.save_discount_promotion_before_storefront_20261021(p_payload);
  update public.promotions set
    label_text=case when p_payload ? 'label_text' then btrim(p_payload->>'label_text') else label_text end,
    label_color=case when p_payload ? 'label_color' then p_payload->>'label_color' else label_color end,
    storefront_scope_type=public.promotion_storefront_scope(target_id)
  where id=target_id;
  return target_id;
end;
$$;
revoke all on function public.save_discount_promotion(jsonb) from public, anon;
grant execute on function public.save_discount_promotion(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

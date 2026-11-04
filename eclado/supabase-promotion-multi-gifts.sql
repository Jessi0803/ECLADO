-- Install after gifts, assisted benefits, audience, BOGO, display and student policy.
-- Existing order snapshots/reservations are unchanged. Run the whole transaction.
begin;

create table if not exists public.promotion_gift_rewards (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  variant_id bigint not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (promotion_id, variant_id),
  unique (promotion_id, sort_order)
);
alter table public.promotion_gift_rewards enable row level security;
revoke all on public.promotion_gift_rewards from public, anon, authenticated;
grant select on public.promotion_gift_rewards to authenticated;
drop policy if exists promotion_gift_rewards_admin_read on public.promotion_gift_rewards;
create policy promotion_gift_rewards_admin_read on public.promotion_gift_rewards
  for select to authenticated using (public.has_backoffice_permission('promotions.manage'));

insert into public.promotion_gift_rewards(promotion_id,variant_id,quantity,sort_order)
select id,gift_variant_id,gift_quantity,0 from public.promotions
where benefit_type in ('amount_gift','quantity_gift')
  and not exists(select 1 from public.promotion_gift_rewards r where r.promotion_id=promotions.id)
on conflict do nothing;

-- Preserve the complete installed editor chain (audience, labels, student policy,
-- BOGO, scope validation); only the first reward is mirrored into legacy columns.
do $$ begin
  if to_regprocedure('public.save_discount_promotion_before_multi_gifts(jsonb)') is null then
    alter function public.save_discount_promotion(jsonb) rename to save_discount_promotion_before_multi_gifts;
  end if;
end $$;
revoke all on function public.save_discount_promotion_before_multi_gifts(jsonb) from public,anon,authenticated;

create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare target_id uuid; rewards jsonb; reward jsonb; i integer:=0;
begin
  if auth.uid() is null or not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management authorization required' using errcode='42501';
  end if;
  -- Serialize edits of one activity, including writes made through older clients.
  if nullif(p_payload->>'id','') is not null then
    perform 1 from public.promotions where id=(p_payload->>'id')::uuid for update;
  end if;
  if p_payload->>'benefit_type' in ('amount_gift','quantity_gift') then
    rewards:=p_payload->'gift_rewards';
    if not (p_payload ? 'gift_rewards') then
      if (select count(*) from public.promotion_gift_rewards where promotion_id=nullif(p_payload->>'id','')::uuid)>1 then
        raise exception '請重新整理後編輯多項贈品活動' using errcode='22023';
      end if;
      rewards:=jsonb_build_array(jsonb_build_object('variant_id',p_payload->'gift_variant_id','quantity',p_payload->'gift_quantity'));
    end if;
    if jsonb_typeof(rewards) is distinct from 'array' then
      raise exception '贈品必須為清單' using errcode='22023';
    end if;
    if jsonb_array_length(rewards) not between 1 and 100 then
      raise exception '請設定 1 至 100 項贈品' using errcode='22023';
    end if;
    for reward in select value from jsonb_array_elements(rewards) loop
      if jsonb_typeof(reward->'variant_id') is distinct from 'number'
        or coalesce(reward->>'variant_id','') !~ '^[1-9][0-9]{0,18}$'
        or jsonb_typeof(reward->'quantity') is distinct from 'number'
        or coalesce(reward->>'quantity','') !~ '^[1-9][0-9]{0,9}$' then
        raise exception '贈品規格與數量必須為正整數' using errcode='22023';
      end if;
      if (reward->>'variant_id')::numeric>9223372036854775807 or (reward->>'quantity')::numeric>2147483647 then
        raise exception '贈品數量超出範圍' using errcode='22023';
      end if;
      if not exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id
        where v.id=(reward->>'variant_id')::bigint and v.active and v.gift_enabled
          and p.publication_status in ('active','event_only','gift_only')) then
        raise exception '贈品必須使用已啟用的贈品庫存' using errcode='22023';
      end if;
    end loop;
    if (select count(distinct (value->>'variant_id')::bigint) from jsonb_array_elements(rewards))<>jsonb_array_length(rewards) then
      raise exception '同一贈品規格請合併為一列' using errcode='22023';
    end if;
    p_payload:=p_payload || jsonb_build_object('gift_variant_id',rewards->0->'variant_id','gift_quantity',rewards->0->'quantity');
  end if;
  target_id:=public.save_discount_promotion_before_multi_gifts(p_payload);
  delete from public.promotion_gift_rewards where promotion_id=target_id;
  if p_payload->>'benefit_type' in ('amount_gift','quantity_gift') then
    for reward in select value from jsonb_array_elements(rewards) loop
      insert into public.promotion_gift_rewards(promotion_id,variant_id,quantity,sort_order)
      values(target_id,(reward->>'variant_id')::bigint,(reward->>'quantity')::integer,i);
      i:=i+1;
    end loop;
  end if;
  return target_id;
end $$;
revoke all on function public.save_discount_promotion(jsonb) from public,anon;
grant execute on function public.save_discount_promotion(jsonb) to authenticated;

-- Guard every replacement: abort on an unknown installed definition, retaining
-- all existing audience, price, coupon ordering and assisted identity rules.
create or replace function pg_temp.multi_gift_replace(source text, anchor text, replacement text)
returns text language plpgsql as $$ begin
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'Multi gift migration source mismatch at: %',left(anchor,120);
  end if;
  return replace(source,anchor,replacement);
end $$;

do $migration$
declare d text; signature text;
begin
  foreach signature in array array[
    'public.quote_order_pricing(jsonb,text,text,text)',
    'public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean)'
  ] loop
    d:=pg_get_functiondef(signature::regprocedure);
    if position('multi_gift_reward record' in d)>0 then continue; end if;
    d:=pg_temp.multi_gift_replace(d,'candidate record;', 'candidate record; multi_gift_reward record; campaign_gift_qualified boolean := false;');
    d:=pg_temp.multi_gift_replace(d,'    awarded_quantity := candidate.gift_quantity * greatest(repeat_count, 1);', $r$
    if candidate.coupon_campaign_id = campaign_id then campaign_gift_qualified := true; end if;
    for multi_gift_reward in
      select r.variant_id, r.quantity from public.promotion_gift_rewards r
      where r.promotion_id=candidate.id order by r.sort_order,r.variant_id
    loop
    -- Use numeric multiplication before capping to avoid integer overflow.
    awarded_quantity := least(2147483647::numeric, multi_gift_reward.quantity::numeric * greatest(repeat_count, 1))::integer;$r$);
    d:=replace(d,'candidate.gift_variant_id','multi_gift_reward.variant_id');
    d:=pg_temp.multi_gift_replace(d,$a$    if not found then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券指定的贈品庫存目前不可使用' using errcode = '22023';
      end if;
      continue;
    end if;$a$,$r$    if not found then continue; end if;$r$);
    d:=pg_temp.multi_gift_replace(d,$a$    if available_quantity < awarded_quantity then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券贈品已兌換完畢' using errcode = '22023';
      end if;
      continue;
    end if;$a$,$r$    awarded_quantity := least(awarded_quantity, available_quantity);
    if awarded_quantity <= 0 then continue; end if;$r$);
    d:=pg_temp.multi_gift_replace(d,$a$  end loop;

  if campaign_id is not null$a$,$r$    end loop; -- multi_gift_reward
  end loop;

  if campaign_id is not null and not campaign_gift_qualified$r$);
    execute d;
  end loop;
end $migration$;

-- Assisted creation computes its final quote while these deterministic locks are
-- held. Include every reward, rather than only the legacy first reward.
do $migration$
declare d text;
begin
  d:=pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure);
  if position('select r.variant_id from public.promotion_gift_rewards r join public.promotions p' in d)=0 then
    d:=pg_temp.multi_gift_replace(d,
      $a$select gift_variant_id from public.promotions where active and benefit_type in ('amount_gift','quantity_gift')$a$,
      $r$select r.variant_id from public.promotion_gift_rewards r join public.promotions p on p.id=r.promotion_id where p.active and p.benefit_type in ('amount_gift','quantity_gift')$r$);
    execute d;
  end if;
end $migration$;

notify pgrst, 'reload schema';
commit;

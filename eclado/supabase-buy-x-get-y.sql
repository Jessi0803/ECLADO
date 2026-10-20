-- Run AFTER current coupon/gift, shipping, assisted-order and automatic-audience migrations.
-- Incremental only: preserve installed pricing, payment, member pricing and reward wrappers.
-- X paid + Y free requires X+Y selected units. No per-order award cap.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.promotions add column if not exists buy_quantity integer;
alter table public.promotions drop constraint if exists promotions_benefit_type_check;
alter table public.promotions add constraint promotions_benefit_type_check check (
  benefit_type in ('legacy_discount','percentage_discount','fixed_discount','amount_gift','quantity_gift','buy_x_get_y'));
alter table public.promotions drop constraint if exists promotions_gift_configuration_check;
alter table public.promotions add constraint promotions_gift_configuration_check check (
  (benefit_type in ('amount_gift','quantity_gift') and threshold_value is not null
    and gift_variant_id is not null and gift_quantity is not null and gift_quantity > 0)
  or (benefit_type = 'buy_x_get_y' and gift_variant_id is null and gift_quantity is not null and gift_quantity > 0)
  or (benefit_type not in ('amount_gift','quantity_gift','buy_x_get_y') and gift_variant_id is null and gift_quantity is null));
alter table public.promotions drop constraint if exists promotions_buy_x_get_y_check;
alter table public.promotions add constraint promotions_buy_x_get_y_check check (
  (benefit_type = 'buy_x_get_y' and buy_quantity is not null and buy_quantity > 0
    and threshold_type = 'quantity' and threshold_value is not null
    and threshold_value = buy_quantity::bigint + gift_quantity::bigint
    and buy_quantity::bigint + gift_quantity::bigint <= 2147483647 and threshold_basis is null)
  or (benefit_type <> 'buy_x_get_y' and buy_quantity is null));
alter table public.order_adjustments drop constraint if exists order_adjustments_adjustment_type_check;
alter table public.order_adjustments add constraint order_adjustments_adjustment_type_check check (
  adjustment_type in ('percentage_discount','fixed_discount','amount_gift','quantity_gift','free_shipping','buy_x_get_y'));

-- Private arithmetic, authoritative quote lines only. Process line quantities in
-- batches rather than expanding potentially millions of units into rows.
-- Previously free units cannot be selected again by another coupon benefit.
create or replace function public.calculate_buy_x_get_y(p_promotion_id uuid,p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  promotion public.promotions%rowtype; available bigint; free_count bigint; left_count bigint;
  line record; take_count bigint; unit_amount numeric; discount_amount numeric := 0;
  rounded_discount numeric; rounding_delta numeric; correction numeric; eligible_total numeric;
  selected jsonb := '[]'; result_lines jsonb := p_lines; updated_line jsonb;
begin
  select * into promotion from public.promotions where id=p_promotion_id;
  if not found or promotion.benefit_type <> 'buy_x_get_y' then
    raise exception 'Invalid buy X get Y promotion' using errcode='22023';
  end if;
  select coalesce(sum(greatest(0,(item->>'qty')::bigint-coalesce((item->>'bogo_free_quantity')::bigint,0))),0)
    into available from jsonb_array_elements(p_lines) item
    where coalesce(item->>'line_type','merchandise') <> 'gift'
      and public.promotion_item_matches_scope(promotion.id,item,'qualification')
      and public.promotion_item_matches_scope(promotion.id,item,'benefit');
  free_count := case when available < promotion.threshold_value then 0
    when promotion.repeat_mode='repeat' then (available / promotion.threshold_value::bigint) * promotion.gift_quantity
    else promotion.gift_quantity end;
  left_count := free_count;
  for line in
    select item,ordinality,
      greatest(0,(item->>'qty')::bigint-coalesce((item->>'bogo_free_quantity')::bigint,0)) qty,
      coalesce((item->>'remaining_total')::numeric,(item->>'line_total')::numeric) remaining
    from jsonb_array_elements(p_lines) with ordinality rows(item,ordinality)
    where coalesce(item->>'line_type','merchandise') <> 'gift'
      and public.promotion_item_matches_scope(promotion.id,item,'qualification')
      and public.promotion_item_matches_scope(promotion.id,item,'benefit')
    order by coalesce((item->>'remaining_total')::numeric,(item->>'line_total')::numeric)
      / nullif(greatest(0,(item->>'qty')::bigint-coalesce((item->>'bogo_free_quantity')::bigint,0)),0),
      (item->>'product_id')::integer,(item->>'variant_id')::bigint,ordinality
  loop
    exit when left_count=0;
    if line.qty=0 then continue; end if;
    take_count := least(left_count,line.qty);
    unit_amount := line.remaining / line.qty;
    discount_amount := discount_amount + unit_amount*take_count;
    selected := selected || jsonb_build_array(jsonb_build_object(
      'product_id',line.item->'product_id','variant_id',line.item->'variant_id',
      'quantity',take_count,'unit_amount',unit_amount,'amount',unit_amount*take_count));
    updated_line := line.item || jsonb_build_object('remaining_total',greatest(0,line.remaining-unit_amount*take_count),
      'bogo_free_quantity',coalesce((line.item->>'bogo_free_quantity')::bigint,0)+take_count);
    result_lines := jsonb_set(result_lines,array[(line.ordinality-1)::text],updated_line);
    left_count := left_count-take_count;
  end loop;
  -- Coupon bundles can leave fractional per-unit bases. Charge whole NT dollars
  -- and place the rounding difference on payable units, never resurrect free units.
  select coalesce(sum(coalesce((item->>'remaining_total')::numeric,(item->>'line_total')::numeric)),0)
    into eligible_total from jsonb_array_elements(p_lines) item
    where coalesce(item->>'line_type','merchandise') <> 'gift'
      and public.promotion_item_matches_scope(promotion.id,item,'qualification')
      and public.promotion_item_matches_scope(promotion.id,item,'benefit');
  rounded_discount:=least(round(discount_amount),floor(eligible_total));
  rounding_delta:=discount_amount-rounded_discount;
  for line in
    select item,ordinality from jsonb_array_elements(result_lines) with ordinality rows(item,ordinality)
    where (item->>'qty')::bigint > coalesce((item->>'bogo_free_quantity')::bigint,0)
      and coalesce(item->>'line_type','merchandise') <> 'gift'
      and public.promotion_item_matches_scope(promotion.id,item,'qualification')
      and public.promotion_item_matches_scope(promotion.id,item,'benefit')
    order by ordinality
  loop
    exit when rounding_delta=0;
    correction:=case when rounding_delta>0 then rounding_delta
      else greatest(rounding_delta,-coalesce((line.item->>'remaining_total')::numeric,(line.item->>'line_total')::numeric)) end;
    result_lines:=jsonb_set(result_lines,array[(line.ordinality-1)::text],line.item || jsonb_build_object(
      'remaining_total',coalesce((line.item->>'remaining_total')::numeric,(line.item->>'line_total')::numeric)+correction));
    rounding_delta:=rounding_delta-correction;
  end loop;
  return jsonb_build_object('amount',rounded_discount,'rounding_adjustment',rounded_discount-discount_amount,'free_quantity',free_count,
    'free_items',selected,'lines',result_lines,'buy_quantity',promotion.buy_quantity,
    'gift_quantity',promotion.gift_quantity,'repeat_mode',promotion.repeat_mode);
end $$;
revoke all on function public.calculate_buy_x_get_y(uuid,jsonb) from public,anon,authenticated;

-- Fail on unknown source shapes, leaving the entire migration rolled back.
create or replace function pg_temp.bogo_replace_once(source text,anchor text,replacement text)
returns text language plpgsql as $$
begin
  if (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 then
    raise exception 'Buy X get Y migration source mismatch at: %',left(anchor,120);
  end if;
  return replace(source,anchor,replacement);
end $$;

do $migration$
declare d text; signature text; editor regprocedure;
begin
  -- Keep the public audience wrapper and its ACL intact; extend its private editor.
  editor := 'public.save_discount_promotion_before_audience_20261017(jsonb)'::regprocedure;
  d := pg_get_functiondef(editor);
  if position('buy_x_get_y' in d)=0 then
    d:=pg_temp.bogo_replace_once(d,'begin', $r$begin
  if benefit='buy_x_get_y' then
    if jsonb_typeof(p_payload->'buy_quantity') is distinct from 'number'
      or jsonb_typeof(p_payload->'gift_quantity') is distinct from 'number' then
      raise exception '買入與免費件數必須為正整數' using errcode='22023';
    end if;
    if (p_payload->>'buy_quantity')::numeric not between 1 and 2147483647
      or (p_payload->>'gift_quantity')::numeric not between 1 and 2147483647
      or (p_payload->>'buy_quantity')::numeric <> trunc((p_payload->>'buy_quantity')::numeric)
      or (p_payload->>'gift_quantity')::numeric <> trunc((p_payload->>'gift_quantity')::numeric)
      or (p_payload->>'buy_quantity')::numeric+(p_payload->>'gift_quantity')::numeric>2147483647 then
      raise exception '買入與免費件數必須為正整數且組合件數不可超出整數範圍' using errcode='22023';
    end if;
    p_payload:=p_payload || jsonb_build_object('threshold_type','quantity',
      'threshold_value',(p_payload->>'buy_quantity')::integer+(p_payload->>'gift_quantity')::integer);
  end if;$r$);
    d:=pg_temp.bogo_replace_once(d,$q$when benefit = 'quantity_gift' then 'quantity'$q$,$q$when benefit in ('quantity_gift','buy_x_get_y') then 'quantity'$q$);
    d:=pg_temp.bogo_replace_once(d,$q$if benefit not in ('percentage_discount','fixed_discount','amount_gift','quantity_gift')$q$,
      $q$if benefit not in ('percentage_discount','fixed_discount','amount_gift','quantity_gift','buy_x_get_y')$q$);
    if (length(d)-length(replace(d,$q$case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end$q$,'')))
      /length($q$case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end$q$)<>2 then
      raise exception 'Buy X get Y editor quantity source mismatch';
    end if;
    d:=replace(d,$q$case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end$q$,
      $q$case when benefit in ('amount_gift','quantity_gift','buy_x_get_y') then (p_payload->>'gift_quantity')::integer end$q$);
    d:=pg_temp.bogo_replace_once(d,'gift_quantity,repeat_mode,priority)', 'gift_quantity,buy_quantity,repeat_mode,priority)');
    d:=pg_temp.bogo_replace_once(d,$q$end,coalesce(nullif(p_payload->>'repeat_mode',''),'once')$q$,
      $q$end,case when benefit='buy_x_get_y' then (p_payload->>'buy_quantity')::integer end,coalesce(nullif(p_payload->>'repeat_mode',''),'once')$q$);
    d:=pg_temp.bogo_replace_once(d,$q$repeat_mode=coalesce(nullif(p_payload->>'repeat_mode',''),'once')$q$,
      $q$buy_quantity=case when benefit='buy_x_get_y' then (p_payload->>'buy_quantity')::integer end,repeat_mode=coalesce(nullif(p_payload->>'repeat_mode',''),'once')$q$);
    execute d;
  end if;

  foreach signature in array array[
    'public.quote_order_pricing_discount_v2(jsonb,text,text,text)',
    'public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'
  ] loop
    d:=pg_get_functiondef(signature::regprocedure);
    if position('public.calculate_buy_x_get_y' in d)>0 then continue; end if;
    -- All these lists intentionally classify the new benefit as a PRICE discount.
    if (length(d)-length(replace(d,$q$in ('percentage_discount', 'fixed_discount')$q$,'')))
      /length($q$in ('percentage_discount', 'fixed_discount')$q$)<>3 then
      raise exception 'Buy X get Y discount classification source mismatch: %',signature;
    end if;
    d:=replace(d,$q$in ('percentage_discount', 'fixed_discount')$q$,$q$in ('percentage_discount', 'fixed_discount', 'buy_x_get_y')$q$);
    d:=pg_temp.bogo_replace_once(d,'  activity_discount numeric;', '  activity_discount numeric; bogo_result jsonb;');
    d:=pg_temp.bogo_replace_once(d,$q$when 'fixed_discount' then least(eligible_subtotal, candidate.discount_amount)$q$,
      $q$when 'fixed_discount' then least(eligible_subtotal, candidate.discount_amount)$q$||E'\n'||
      $q$        when 'buy_x_get_y' then (public.calculate_buy_x_get_y(candidate.id,pricing_lines)->>'amount')::numeric$q$);
    d:=pg_temp.bogo_replace_once(d,$q$when 'fixed_discount' then least(eligible_subtotal, activity.discount_amount)$q$,
      $q$when 'fixed_discount' then least(eligible_subtotal, activity.discount_amount)$q$||E'\n'||
      $q$          when 'buy_x_get_y' then (public.calculate_buy_x_get_y(activity.id,pricing_lines)->>'amount')::numeric$q$);
    d:=pg_temp.bogo_replace_once(d,$q$'threshold', automatic_threshold_value$q$,
      $r$'threshold', automatic_threshold_value,
        'buy_x_get_y',case when automatic_type='buy_x_get_y' then public.calculate_buy_x_get_y(automatic_id,pricing_lines)-'lines' end$r$);
    d:=pg_temp.bogo_replace_once(d,$q$'threshold_basis', activity.threshold_basis$q$,
      $r$'threshold_basis', activity.threshold_basis,
              'buy_x_get_y',case when activity.benefit_type='buy_x_get_y' then public.calculate_buy_x_get_y(activity.id,pricing_lines)-'lines' end$r$);
    d:=pg_temp.bogo_replace_once(d,'      if automatic_discount > 0 then', $r$      if automatic_discount > 0 then
        if automatic_type='buy_x_get_y' then
          bogo_result:=public.calculate_buy_x_get_y(automatic_id,pricing_lines);
          pricing_lines:=bogo_result->'lines';
        else$r$);
    d:=pg_temp.bogo_replace_once(d,E'      end if;\n    end if;\n\n    for activity in',
      E'        end if; -- automatic buy X get Y branch\n      end if;\n    end if;\n\n    for activity in');
    d:=pg_temp.bogo_replace_once(d,$q$          -- Preserve each line's share$q$, $r$          if activity.benefit_type='buy_x_get_y' then
            bogo_result:=public.calculate_buy_x_get_y(activity.id,pricing_lines);
            pricing_lines:=bogo_result->'lines';
          else
          -- Preserve each line's share$r$);
    d:=pg_temp.bogo_replace_once(d,E'        end if;\n      end if;\n    end loop;',
      E'          end if; -- coupon buy X get Y branch\n        end if;\n      end if;\n    end loop;');
    execute d;
  end loop;
  -- Existing order creator must persist the new immutable discount adjustment.
  signature:='public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)';
  d:=pg_get_functiondef(signature::regprocedure);
  if position($q$'buy_x_get_y'$q$ in d)=0 then
    d:=pg_temp.bogo_replace_once(d,$q$in ('percentage_discount', 'fixed_discount')$q$,
      $q$in ('percentage_discount', 'fixed_discount', 'buy_x_get_y')$q$);
    execute d;
  end if;
end $migration$;

-- Existing test/real catalog IDs can have ten digits. Keep positive int32
-- bounds and the installed product/variant authorization checks intact.
do $product_id_compat$
declare signature text; d text;
  old_guard text := $q$coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'$q$;
  new_guard text := $q$(case when coalesce(entry->>'product_id','') ~ '^[0-9]{1,10}$'
      then (entry->>'product_id')::bigint not between 1 and 2147483647 else true end)$q$;
begin
  foreach signature in array array['public.quote_assisted_order(jsonb)',
    'public.create_assisted_order_base_v1(uuid,jsonb)','public.create_assisted_order(uuid,jsonb)'] loop
    d:=pg_get_functiondef(signature::regprocedure);
    if position(new_guard in d)>0 then continue;end if;
    d:=pg_temp.bogo_replace_once(d,old_guard,new_guard);
    execute d;
  end loop;
end $product_id_compat$;

notify pgrst,'reload schema';
commit;

-- After buy-X-get-Y and current student/reward wrappers. Installs OFF.
-- Enable only after staging acceptance and a separate production release.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table if not exists public.automatic_price_allocation_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  base_source_hash text,
  version integer not null default 1 check(version=1)
);
insert into public.automatic_price_allocation_settings(singleton) values(true) on conflict do nothing;
alter table public.automatic_price_allocation_settings enable row level security;
revoke all on public.automatic_price_allocation_settings from public,anon,authenticated;

create or replace function public.automatic_price_allocation_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare settings public.automatic_price_allocation_settings%rowtype;
begin
  select * into settings from public.automatic_price_allocation_settings where singleton;
  if not coalesce(settings.enabled,false) then return false; end if;
  if settings.base_source_hash is distinct from md5(pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure)) then
    raise exception '計價版本更新中，請重新確認報價。' using errcode='40001';
  end if;
  return true;
end;
$$;
revoke all on function public.automatic_price_allocation_enabled() from public,anon,authenticated;

-- Evaluate one quantity allocation. Counts are flattened line-major, activity-minor.
-- All arithmetic uses PostgreSQL numeric; no floating point or per-unit expansion.
create or replace function public.evaluate_automatic_price_allocation(p_lines jsonb,p_activities jsonb,p_counts integer[])
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  i integer; j integer; n integer; own integer; qty integer; qsum numeric; qcount bigint; base numeric;
  used bigint; pool bigint; groups bigint; free_left bigint; free_take integer;
  benefit boolean; activity jsonb; item jsonb; entries jsonb; free_items jsonb;
  amount numeric; raw_amount numeric; total numeric:=0; subtotal numeric; discount_vector numeric[]:='{}';
  amounts numeric[]; free_counts integer[]; adjustments jsonb:='[]'; result_lines jsonb:='[]';
  entry_amount numeric; delta numeric; correction numeric; order_row record; score numeric[]; base_left numeric;
begin
  amounts:=array_fill(0::numeric,array[lc]); free_counts:=array_fill(0,array[lc]);
  for j in 0..ac-1 loop
    activity:=p_activities->j; qsum:=0; qcount:=0; base:=0; used:=0; pool:=0;
    for i in 0..lc-1 loop
      item:=p_lines->i; own:=p_counts[i*ac+j+1]; qty:=(item->>'qty')::integer;
      used:=used+own;
      if (activity->'q'->>i)::boolean then qsum:=qsum+own*(item->>'unit_price')::numeric; qcount:=qcount+own; end if;
      if (activity->'b'->>i)::boolean then base:=base+own*(item->>'unit_price')::numeric; end if;
      if (activity->'e'->>i)::boolean then
        n:=0; for k in 0..ac-1 loop n:=n+p_counts[i*ac+k+1]; end loop;
        pool:=pool+qty-n+own;
      end if;
    end loop;
    if used=0 then discount_vector:=array_append(discount_vector,0); continue; end if;
    if activity->>'benefit_type'<>'legacy_discount' then
      if (case when activity->>'threshold_type'='quantity' then qcount else qsum end)<=0
        or (case when activity->>'threshold_type'='quantity' then qcount else qsum end)<coalesce((activity->>'threshold_value')::numeric,0) then return null; end if;
    end if;
    free_items:='[]'; entries:='[]'; raw_amount:=0;
    if activity->>'benefit_type'='buy_x_get_y' then
      n:=(activity->>'buy_quantity')::integer+(activity->>'gift_quantity')::integer;
      if used%n<>0 then return null; end if;
      groups:=used/n;
      if (case when activity->>'repeat_mode'='repeat' then groups<>pool/n else groups<>1 end) then return null; end if;
      free_left:=groups*(activity->>'gift_quantity')::integer;
      for order_row in select value,ordinality::integer-1 as idx from jsonb_array_elements(p_lines) with ordinality
        order by (value->>'unit_price')::numeric,(value->>'product_id')::integer,(value->>'variant_id')::bigint loop
        exit when free_left=0;
        i:=order_row.idx; item:=order_row.value;
        if not (activity->'e'->>i)::boolean then continue; end if;
        own:=p_counts[i*ac+j+1]; n:=0;
        for k in 0..ac-1 loop n:=n+p_counts[i*ac+k+1]; end loop;
        free_take:=least(free_left,(item->>'qty')::integer-n+own);
        if free_take>own then return null; end if;
        free_counts[i+1]:=free_counts[i+1]+free_take;
        raw_amount:=raw_amount+free_take*(item->>'unit_price')::numeric;
        free_left:=free_left-free_take;
        if free_take>0 then free_items:=free_items||jsonb_build_array(jsonb_build_object('product_id',item->'product_id',
          'variant_id',item->'variant_id','quantity',free_take,'unit_amount',item->'unit_price','amount',free_take*(item->>'unit_price')::numeric)); end if;
      end loop;
      if free_left<>0 then return null; end if;
      amount:=least(round(raw_amount),floor(base));
    elsif activity->>'benefit_type'='fixed_discount' then
      amount:=least(base,(activity->>'discount_amount')::numeric);
    elsif activity->>'benefit_type'='percentage_discount' then
      amount:=least(base,round(base*(1-(activity->>'discount_rate')::numeric)));
    else
      amount:=least(base,round(base-greatest(0,case when activity->>'discount_order'='amount_then_rate' then
        (base-(activity->>'discount_amount')::numeric)*(activity->>'discount_rate')::numeric
        else base*(activity->>'discount_rate')::numeric-(activity->>'discount_amount')::numeric end)));
    end if;
    if amount is null or amount<=0 then return null; end if;
    -- Attribute the actual amount only to benefited owned units. BOGO removes
    -- exact free units; any rounding difference is placed on payable owned units.
    delta:=case when activity->>'benefit_type'='buy_x_get_y' then amount-raw_amount else amount end;
    base_left:=base;
    for i in 0..lc-1 loop
      item:=p_lines->i; own:=p_counts[i*ac+j+1];
      if own=0 then continue; end if;
      benefit:=(activity->'b'->>i)::boolean;
      free_take:=coalesce((select (value->>'quantity')::integer from jsonb_array_elements(free_items)
        where value->'product_id'=item->'product_id' and value->'variant_id'=item->'variant_id' and value->'unit_amount'=item->'unit_price'),0);
      entry_amount:=case when not benefit then 0 when activity->>'benefit_type'='buy_x_get_y'
        then free_take*(item->>'unit_price')::numeric else amount*own*(item->>'unit_price')::numeric/nullif(base,0) end;
      if benefit and activity->>'benefit_type'<>'buy_x_get_y' then
        if own*(item->>'unit_price')::numeric=base_left then entry_amount:=delta; end if;
        delta:=delta-entry_amount; base_left:=base_left-own*(item->>'unit_price')::numeric;
      end if;
      if activity->>'benefit_type'='buy_x_get_y' and own>free_take and delta<>0 then
        correction:=case when delta>0 then least(delta,(own-free_take)*(item->>'unit_price')::numeric) else delta end;
        entry_amount:=entry_amount+correction; delta:=delta-correction;
      end if;
      amounts[i+1]:=amounts[i+1]+entry_amount;
      entries:=entries||jsonb_build_array(jsonb_build_object('product_id',item->'product_id','variant_id',item->'variant_id',
        'quantity',own,'free_quantity',free_take,'paid_quantity',own-free_take,'unit_price',item->'unit_price',
        'amount',entry_amount,'qualification', (activity->'q'->>i)::boolean,'benefit',benefit));
    end loop;
    if delta<>0 then return null; end if;
    adjustments:=adjustments||jsonb_build_array(jsonb_build_object('promotion_id',activity->'id','coupon_campaign_id',null,
      'adjustment_type',activity->'benefit_type','name',activity->'name','amount',amount,'sort_order',j,
      'qualification',jsonb_build_object('basis',activity->'threshold_type','value',case when activity->>'threshold_type'='quantity' then qcount else qsum end,
        'subtotal',qsum,'quantity',qcount,'eligible_subtotal',base,'threshold',activity->'threshold_value',
        'allocation_version',1,'allocation',entries,'rule',jsonb_build_object('discount_rate',activity->'discount_rate',
          'discount_amount',activity->'discount_amount','discount_order',activity->'discount_order'),
        'buy_x_get_y',case when activity->>'benefit_type'='buy_x_get_y' then jsonb_build_object(
          'buy_quantity',activity->'buy_quantity','gift_quantity',activity->'gift_quantity','repeat_mode',activity->'repeat_mode',
          'free_quantity',groups*(activity->>'gift_quantity')::integer,'free_items',free_items,'rounding_adjustment',amount-raw_amount) end)));
    total:=total+amount; discount_vector:=array_append(discount_vector,amount);
  end loop;
  for i in 0..lc-1 loop
    item:=p_lines->i; subtotal:=(item->>'line_total')::numeric;
    -- Rounding a fractional BOGO award down refunds <=0.5 to paid units,
    -- matching calculate_buy_x_get_y; that line may carry a rounding credit.
    if amounts[i+1]>subtotal then return null; end if;
    result_lines:=result_lines||jsonb_build_array(item||jsonb_build_object('remaining_total',subtotal-amounts[i+1],'bogo_free_quantity',free_counts[i+1]));
  end loop;
  score:=array[total]||discount_vector;
  foreach n in array p_counts loop score:=array_append(score,n); end loop;
  return jsonb_build_object('discount',total,'adjustments',adjustments,'lines',result_lines,'score',score);
end;
$$;

-- Optimistic bound for branch pruning, including rounding and tie ordering.
-- It may overestimate a feasible result, but must never underestimate one.
create or replace function public.bound_automatic_price_allocation(p_lines jsonb,p_activities jsonb,p_counts integer[],p_remaining integer[],p_after_cell integer)
returns numeric[] language plpgsql immutable set search_path='' as $$
declare
  lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  i integer; j integer; cell integer; potential integer; a jsonb; price numeric; coefficient numeric;
  base numeric; quantity bigint; max_price numeric; constant numeric; fractional boolean; upper numeric;
  linear_bound numeric:=0; independent_bound numeric:=0; max_coefficients numeric[];
  activity_bounds numeric[]:='{}'; ownership_bounds numeric[]:='{}';
begin
  max_coefficients:=array_fill(0::numeric,array[lc]);
  for j in 0..ac-1 loop
    a:=p_activities->j; base:=0; quantity:=0; max_price:=0; fractional:=false;
    coefficient:=case a->>'benefit_type' when 'fixed_discount' then 1 when 'buy_x_get_y' then
      (div((a->>'gift_quantity')::numeric*100000000000000000000,((a->>'buy_quantity')::numeric+(a->>'gift_quantity')::numeric))
        +case when mod((a->>'gift_quantity')::numeric*100000000000000000000,((a->>'buy_quantity')::numeric+(a->>'gift_quantity')::numeric))<>0 then 1 else 0 end)/100000000000000000000
      else 1-(a->>'discount_rate')::numeric end;
    for i in 0..lc-1 loop
      cell:=i*ac+j+1; potential:=p_counts[cell];
      if cell>p_after_cell and (a->'e'->>i)::boolean then potential:=potential+p_remaining[i+1]; end if;
      if not (a->'b'->>i)::boolean then continue; end if;
      price:=(p_lines->i->>'unit_price')::numeric;
      base:=base+potential*price; quantity:=quantity+potential; max_price:=greatest(max_price,price);
      linear_bound:=linear_bound+p_counts[cell]*price*coefficient;
      if cell>p_after_cell then max_coefficients[i+1]:=greatest(max_coefficients[i+1],price*coefficient); end if;
      fractional:=fractional or case when a->>'benefit_type'='buy_x_get_y' then price<>trunc(price)
        else price*coefficient<>trunc(price*coefficient) end;
    end loop;
    if base=0 then upper:=0; constant:=0;
    elsif a->>'benefit_type'='percentage_discount' then
      upper:=least(base,round(base*coefficient)); constant:=case when fractional then 0.5 else 0 end;
    elsif a->>'benefit_type'='fixed_discount' then upper:=least(base,(a->>'discount_amount')::numeric); constant:=0;
    elsif a->>'benefit_type'='buy_x_get_y' then
      potential:=case when a->>'repeat_mode'='repeat' then quantity/((a->>'buy_quantity')::integer+(a->>'gift_quantity')::integer)
        else least(1,quantity/((a->>'buy_quantity')::integer+(a->>'gift_quantity')::integer)) end;
      upper:=least(base,round(potential*(a->>'gift_quantity')::numeric*max_price));
      constant:=case when fractional then 0.5 else 0 end;
    else
      constant:=(a->>'discount_amount')::numeric*case when a->>'discount_order'='amount_then_rate' then (a->>'discount_rate')::numeric else 1 end;
      upper:=least(base,round(base-greatest(0,base*(a->>'discount_rate')::numeric-constant)));
      constant:=case when fractional then constant+0.5 else round(constant) end;
    end if;
    linear_bound:=linear_bound+constant;
    independent_bound:=independent_bound+upper; activity_bounds:=array_append(activity_bounds,upper);
  end loop;
  for i in 0..lc-1 loop
    linear_bound:=linear_bound+p_remaining[i+1]*max_coefficients[i+1];
    for j in 0..ac-1 loop
      cell:=i*ac+j+1;
      ownership_bounds:=array_append(ownership_bounds,p_counts[cell]+case when cell>p_after_cell and (p_activities->j->'e'->>i)::boolean then p_remaining[i+1] else 0 end);
    end loop;
  end loop;
  return array[least(linear_bound,independent_bound)]||activity_bounds||ownership_bounds;
end;
$$;

-- Resolve scope/identity once, then split the bipartite activity/line graph.
create or replace function public.allocate_automatic_prices(p_lines jsonb,p_role text,p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  lines jsonb; activities jsonb:='[]'; candidate record; item jsonb; q boolean; b boolean;
  qs jsonb; bs jsonb; es jsonb; any_eligible boolean; component_lines jsonb; component_activities jsonb;
  activity jsonb; chosen_activities integer[]; chosen_lines integer[]; seen integer[]:='{}';
  i integer; j integer; k integer; old_size integer; result jsonb; adjusted jsonb:='[]';
  returned_lines jsonb:='[]'; total numeric:=0; nodes integer:=0; lc integer; ac integer;
begin
  -- Canonicalize duplicate variants independent of input order. Authoritative
  -- engines give a single unit price per variant; reject inconsistent callers.
  if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'variant_id'
    having count(distinct (x->>'unit_price')::numeric)>1) then raise exception '同一規格的權威單價不一致' using errcode='22023'; end if;
  select coalesce(jsonb_agg(merged.item||jsonb_build_object('qty',merged.qty,'line_total',merged.amount,'remaining_total',merged.amount,'bogo_free_quantity',0)
    order by (merged.item->>'product_id')::integer,(merged.item->>'variant_id')::bigint),'[]') into lines from (
    select (jsonb_agg(x order by x::text)->0) item,sum((x->>'qty')::integer) qty,sum((x->>'line_total')::numeric) amount
    from jsonb_array_elements(p_lines) x group by x->>'product_id',x->>'variant_id') merged;
  lc:=jsonb_array_length(lines);
  for candidate in select * from public.promotions p where p.active and p.activation_type='automatic'
    and p.benefit_type in ('percentage_discount','fixed_discount','buy_x_get_y','legacy_discount')
    and p.archived_at is null and (p.start_at is null or p.start_at<=now()) and (p.end_at is null or p.end_at>now())
    and public.automatic_promotion_allows_identity(p.id,p_role,p_customer_id)
    and (p.benefit_type<>'legacy_discount' or (p.discount_rate between 0 and 1 and p.discount_amount>=0))
    order by p.priority,p.created_at,p.id loop
    qs:='[]'; bs:='[]'; es:='[]'; any_eligible:=false;
    for item in select value from jsonb_array_elements(lines) loop
      if candidate.benefit_type='legacy_discount' then
        q:=coalesce((item->>'product_id')::integer=any(candidate.product_ids) and item->>'publication_status'='active',false); b:=q;
      else
        q:=public.promotion_item_matches_scope(candidate.id,item,'qualification');
        b:=public.promotion_item_matches_scope(candidate.id,item,'benefit');
      end if;
      if candidate.benefit_type='buy_x_get_y' then q:=q and b; b:=q; end if;
      qs:=qs||jsonb_build_array(q); bs:=bs||jsonb_build_array(b); es:=es||jsonb_build_array(q or b); any_eligible:=any_eligible or (q or b);
    end loop;
    if any_eligible then activities:=activities||jsonb_build_array(to_jsonb(candidate)||jsonb_build_object('q',qs,'b',bs,'e',es)); end if;
  end loop;
  ac:=jsonb_array_length(activities);
  if ac=0 then return jsonb_build_object('discount',0,'adjustments','[]'::jsonb,'lines',lines,'version',1,'search_nodes',0); end if;
  for j in 0..ac-1 loop
    if j=any(seen) then continue; end if;
    chosen_activities:=array[j]; chosen_lines:='{}';
    loop
      old_size:=cardinality(chosen_activities)+cardinality(chosen_lines);
      for i in 0..lc-1 loop
        if i=any(chosen_lines) then continue; end if;
        foreach k in array chosen_activities loop
          if (activities->k->'e'->>i)::boolean then chosen_lines:=array_append(chosen_lines,i); exit; end if;
        end loop;
      end loop;
      for k in 0..ac-1 loop
        if k=any(chosen_activities) then continue; end if;
        foreach i in array chosen_lines loop
          if (activities->k->'e'->>i)::boolean then chosen_activities:=array_append(chosen_activities,k); exit; end if;
        end loop;
      end loop;
      exit when cardinality(chosen_activities)+cardinality(chosen_lines)=old_size;
    end loop;
    select jsonb_agg(lines->idx order by idx) into component_lines from unnest(chosen_lines) idx;
    component_activities:='[]';
    for k in select idx from unnest(chosen_activities) idx order by idx loop
      activity:=activities->k;
      select jsonb_agg(activity->'q'->idx order by idx),jsonb_agg(activity->'b'->idx order by idx),jsonb_agg(activity->'e'->idx order by idx)
        into qs,bs,es from unnest(chosen_lines) idx;
      component_activities:=component_activities||jsonb_build_array(activity||jsonb_build_object('q',qs,'b',bs,'e',es));
    end loop;
    result:=public.solve_automatic_price_component(component_lines,component_activities,20000-nodes);
    adjusted:=adjusted||(result->'adjustments'); returned_lines:=returned_lines||(result->'lines');
    total:=total+(result->>'discount')::numeric; nodes:=nodes+(result->>'search_nodes')::integer;
    seen:=seen||chosen_activities;
  end loop;
  -- Include merchandise that matches no automatic price activity.
  for i in 0..lc-1 loop
    if not exists(select 1 from jsonb_array_elements(returned_lines) x where x->'variant_id'=lines->i->'variant_id') then
      returned_lines:=returned_lines||jsonb_build_array(lines->i);
    end if;
  end loop;
  select coalesce(jsonb_agg(x order by p.priority,p.created_at,p.id),'[]') into adjusted
    from jsonb_array_elements(adjusted) x join public.promotions p on p.id=(x->>'promotion_id')::uuid;
  select coalesce(jsonb_agg(x order by (x->>'product_id')::integer,(x->>'variant_id')::bigint),'[]') into returned_lines from jsonb_array_elements(returned_lines) x;
  return jsonb_build_object('discount',total,'adjustments',adjusted,'lines',returned_lines,'version',1,'search_nodes',nodes);
end;
$$;

-- Exact compressed quantity search within one connected overlap component.
-- Disjoint components and single-activity components do not incur this search.
create or replace function public.solve_automatic_price_component(p_lines jsonb,p_activities jsonb,p_node_budget integer default 20000)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  counts integer[]; remaining integer[]; cells integer[]:='{}'; next_qty integer[]; cell integer;
  i integer; j integer; pos integer; selected integer; nodes integer:=0; best jsonb; result jsonb;
  score numeric[]; best_score numeric[]; total bigint; wanted bigint; free_left bigint; take integer; row record;
begin
  if p_node_budget<1 then raise exception '活動組合超出計算範圍，請聯絡客服確認優惠。' using errcode='54000'; end if;
  counts:=array_fill(0,array[lc*ac]); remaining:=array_fill(0,array[lc]);
  for i in 0..lc-1 loop
    remaining[i+1]:=(p_lines->i->>'qty')::integer;
    for j in 0..ac-1 loop if (p_activities->j->'e'->>i)::boolean then cells:=array_append(cells,i*ac+j+1); end if; end loop;
  end loop;
  if ac=1 then
    for i in 0..lc-1 loop if not (p_activities->0->'e'->>i)::boolean then remaining[i+1]:=0; end if; end loop;
    if p_activities->0->>'benefit_type'='buy_x_get_y' then
      select sum(value::integer) into total from unnest(remaining) value;
      wanted:=case when p_activities->0->>'repeat_mode'='repeat' then total/((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer)
        else least(1,total/((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer)) end;
      free_left:=wanted*(p_activities->0->>'gift_quantity')::integer;
      wanted:=wanted*((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer);
      for row in select value,ordinality::integer idx from jsonb_array_elements(p_lines) with ordinality
        order by (value->>'unit_price')::numeric,(value->>'product_id')::integer,(value->>'variant_id')::bigint loop
        take:=least(free_left,remaining[row.idx]); counts[row.idx]:=take; remaining[row.idx]:=remaining[row.idx]-take;
        wanted:=wanted-take; free_left:=free_left-take;
      end loop;
      for i in 1..lc loop take:=least(wanted,remaining[i]); counts[i]:=counts[i]+take; wanted:=wanted-take; end loop;
    else counts:=remaining; end if;
    result:=public.evaluate_automatic_price_allocation(p_lines,p_activities,counts);
    if result is not null then return result||jsonb_build_object('search_nodes',1); end if;
    return public.evaluate_automatic_price_allocation(p_lines,p_activities,array_fill(0,array[lc]))||jsonb_build_object('search_nodes',1);
  end if;
  if cardinality(cells)>128 then raise exception '活動重疊範圍過大，請聯絡客服確認優惠。' using errcode='54000'; end if;
  -- Seed with feasible whole-scope alternatives. The final result is still
  -- proven by exact search; these alternatives only establish pruning bounds.
  best:=public.evaluate_automatic_price_allocation(p_lines,p_activities,counts);
  select array_agg(value::numeric order by ordinality) into best_score from jsonb_array_elements_text(best->'score') with ordinality;
  for j in 0..ac-1 loop
    if p_activities->j->>'benefit_type'='buy_x_get_y' then continue; end if;
    counts:=array_fill(0,array[lc*ac]);
    for i in 0..lc-1 loop if (p_activities->j->'e'->>i)::boolean then counts[i*ac+j+1]:=remaining[i+1]; end if; end loop;
    result:=public.evaluate_automatic_price_allocation(p_lines,p_activities,counts);
    if result is not null then
      select array_agg(value::numeric order by ordinality) into score from jsonb_array_elements_text(result->'score') with ordinality;
      if score>best_score then best:=result; best_score:=score; end if;
    end if;
  end loop;
  counts:=array_fill(0,array[lc*ac]);
  pos:=1; next_qty:=array_fill(-2,array[cardinality(cells)]);
  while pos>0 loop
    nodes:=nodes+1;
    if nodes>p_node_budget then raise exception '活動組合超出計算範圍，請聯絡客服確認優惠。' using errcode='54000'; end if;
    if pos>cardinality(cells) then
      result:=public.evaluate_automatic_price_allocation(p_lines,p_activities,counts);
      if result is not null then
        select array_agg(value::numeric order by ordinality) into score from jsonb_array_elements_text(result->'score') with ordinality;
        if best is null or score>best_score then best:=result; best_score:=score; end if;
      end if;
      pos:=pos-1;
      if pos>0 then cell:=cells[pos]; i:=(cell-1)/ac+1; remaining[i]:=remaining[i]+counts[cell]; counts[cell]:=0; end if;
      continue;
    end if;
    cell:=cells[pos]; i:=(cell-1)/ac+1;
    if next_qty[pos]=-2 then next_qty[pos]:=remaining[i]; end if;
    selected:=next_qty[pos];
    if selected<0 then
      next_qty[pos]:=-2; pos:=pos-1;
      if pos>0 then cell:=cells[pos]; i:=(cell-1)/ac+1; remaining[i]:=remaining[i]+counts[cell]; counts[cell]:=0; end if;
    else
      next_qty[pos]:=selected-1; counts[cell]:=selected; remaining[i]:=remaining[i]-selected;
      if public.bound_automatic_price_allocation(p_lines,p_activities,counts,remaining,cell)<=best_score then
        remaining[i]:=remaining[i]+selected; counts[cell]:=0; continue;
      end if;
      pos:=pos+1;
      if pos<=cardinality(cells) then next_qty[pos]:=-2; end if;
    end if;
  end loop;
  return best||jsonb_build_object('search_nodes',nodes);
end;
$$;

-- Guarded, rerunnable edits preserve installed wrappers and ACLs. No historical
-- order is rewritten. OFF uses the installed single-winner branch verbatim.
create or replace function pg_temp.allocation_replace_once(source text,anchor text,replacement text)
returns text language plpgsql as $$
begin
  if anchor='' or (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'Automatic allocation source mismatch: %',left(anchor,120);
  end if;
  return replace(source,anchor,replacement);
end $$;

do $migration$
declare d text; original_block text; start_pos integer; stop_pos integer; signature text; apply_expression text; creator record;
begin
  -- Clone the installed authority with its member/student pricing and validation.
  -- Defer legacy selection/minimum to the final combined-price evaluator.
  if to_regprocedure('public.quote_order_pricing_allocation_base(jsonb,text)') is null then
    d:=pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure);
    if position('public.apply_student_price' in d)=0 then raise exception 'Current student-price authority required'; end if;
    d:=pg_temp.allocation_replace_once(d,'FUNCTION public.quote_order_pricing_internal_20260916(', 'FUNCTION public.quote_order_pricing_allocation_base(');
    d:=pg_temp.allocation_replace_once(d,$q$promotion.activation_type = 'automatic'$q$,$q$promotion.activation_type = 'automatic' and false -- allocation base excludes legacy selection$q$);
    d:=pg_temp.allocation_replace_once(d,'and subtotal_amount - discount_amount < 5000','and false -- final allocation engine validates professional minimum');
    execute d;
    update public.automatic_price_allocation_settings set base_source_hash=md5(pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure)) where singleton;
  elsif (select base_source_hash from public.automatic_price_allocation_settings where singleton) is distinct from md5(pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure)) then
    raise exception 'Base authority changed: refresh allocation clone before reinstalling';
  end if;
  foreach signature in array array['public.quote_order_pricing_discount_v2(jsonb,text,text,text)',
    'public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'] loop
    d:=pg_get_functiondef(signature::regprocedure);
    if position('allocation_result jsonb' in d)>0 then continue; end if;
    if position('public.calculate_buy_x_get_y' in d)=0 then raise exception 'Buy-X-get-Y prerequisite missing'; end if;
    apply_expression:=case when signature like '%assisted%' then 'p_apply_automatic' else 'true' end;
    d:=pg_temp.allocation_replace_once(d,'  base_quote jsonb;',
      '  base_quote jsonb; allocation_result jsonb; allocation_enabled boolean := public.automatic_price_allocation_enabled();');
    if signature not like '%assisted%' then
      d:=pg_temp.allocation_replace_once(d,'base_quote := public.quote_order_pricing(p_items, normalized_fulfillment);',
        'base_quote := case when allocation_enabled then public.sanitize_public_order_quote(public.quote_order_pricing_allocation_base(p_items, normalized_fulfillment)) else public.quote_order_pricing(p_items, normalized_fulfillment) end;');
    end if;
    start_pos:=position('  -- Compare every atomic automatic discount' in d);
    stop_pos:=position($q$  if normalized_code <> '' then$q$ in d);
    if start_pos=0 or stop_pos<=start_pos then raise exception 'Unknown automatic selection block'; end if;
    original_block:=substring(d from start_pos for stop_pos-start_pos);
    d:=pg_temp.allocation_replace_once(d,original_block,
      '  if allocation_enabled then'||E'\n'||
      '    if '||apply_expression||$r$ and (normalized_code='' or exists(select 1 from public.coupon_campaigns c
        where c.code_normalized=normalized_code and c.stacking_policy='allow_all')) then
      allocation_result:=public.allocate_automatic_prices(pricing_lines,member_role,current_user_id);
      pricing_lines:=allocation_result->'lines';
      automatic_adjustments:=allocation_result->'adjustments';
      automatic_discount:=(allocation_result->>'discount')::numeric;
      if jsonb_array_length(automatic_adjustments)=1 then
        automatic_id:=(automatic_adjustments->0->>'promotion_id')::uuid;
        automatic_name:=automatic_adjustments->0->>'name';
        automatic_type:=automatic_adjustments->0->>'adjustment_type';
      end if;
    end if;
  else
$r$||original_block||E'  end if;\n\n');
    start_pos:=position('      -- Reduce all lines proportionally' in d);
    stop_pos:=position('    for activity in' in d);
    if start_pos=0 or stop_pos<=start_pos then raise exception 'Unknown automatic/coupon reduction block'; end if;
    original_block:=substring(d from start_pos for stop_pos-start_pos);
    -- Keep the outer stacking IF's closing END IF outside the new guard.
    if right(original_block,length(E'    end if;\n\n'))<>E'    end if;\n\n' then raise exception 'Unknown stacking terminator'; end if;
    d:=pg_temp.allocation_replace_once(d,original_block,'      if not allocation_enabled then'||E'\n'||
      left(original_block,length(original_block)-length(E'    end if;\n\n'))||E'      end if;\n    end if;\n\n');
    d:=pg_temp.allocation_replace_once(d,E'\n' || $q$    'promotion_id', automatic_id,$q$,
      E'\n' || $q$    'automatic_allocation_version',case when allocation_enabled then 1 end,
    'promotion_id', automatic_id,$q$);
    d:=pg_temp.allocation_replace_once(d,$q$      'automatic_promotion', case when automatic_id is null$q$,
      $q$      'automatic_allocation_version',case when allocation_enabled then 1 end,
      'automatic_allocations',case when allocation_enabled then automatic_adjustments end,
      'automatic_promotion', case when automatic_id is null$q$);
    execute d;
  end loop;
  -- Include legacy adjustments in the existing immutable adjustment table.
  signature:='public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)';
  d:=pg_get_functiondef(signature::regprocedure);
  if position('automatic_allocation_version' in d)=0 then
    d:=pg_temp.allocation_replace_once(d,$q$if adjustment ->> 'adjustment_type' in ('percentage_discount', 'fixed_discount', 'buy_x_get_y') then$q$,
      $q$if adjustment ->> 'adjustment_type' in ('percentage_discount', 'fixed_discount', 'buy_x_get_y')
        or (adjustment->>'adjustment_type'='legacy_discount' and quote_result->>'automatic_allocation_version'='1') then$q$);
    execute d;
  end if;
  -- New-engine checkout requires an expected quote. Existing no-confirmation
  -- overloads stay compatible while OFF, and reject old clients while ON.
  -- The confirmed overload calls private copies of the same installed wrappers;
  -- no client-set session flag can bypass this boundary.
  for creator in select oid,pronargs,pg_get_functiondef(oid) definition,pg_get_function_identity_arguments(oid) arguments,prosrc,
      (select lanname from pg_language where oid=prolang) as language_name
    from pg_proc where pronamespace='public'::regnamespace and proname='create_order_with_pricing' and pronargs<14 order by pronargs desc loop
    if position('allocation_confirmation_required' in creator.definition)>0 then continue; end if;
    d:=replace(creator.definition,'public.create_order_with_pricing(', 'public.create_order_with_allocation_confirmation_base(');
    execute d;
    execute 'revoke all on function public.create_order_with_allocation_confirmation_base('||creator.arguments||') from public,anon,authenticated';
    if creator.language_name='sql' then
      d:=pg_temp.allocation_replace_once(creator.definition,'LANGUAGE sql','LANGUAGE plpgsql');
      d:=pg_temp.allocation_replace_once(d,creator.prosrc,E'\nbegin\n  -- allocation_confirmation_required\n  if public.automatic_price_allocation_enabled() then raise exception ''請更新頁面並重新取得報價後下單'' using errcode=''40001''; end if;\n  return ('||rtrim(creator.prosrc,E' ;\n\r\t')||E');\nend;\n');
    else
      d:=pg_temp.allocation_replace_once(creator.definition,E'begin\n',E'begin\n  -- allocation_confirmation_required\n  if public.automatic_price_allocation_enabled() then raise exception ''請更新頁面並重新取得報價後下單'' using errcode=''40001''; end if;\n');
    end if;
    execute d;
  end loop;
  signature:='public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb)';
  d:=pg_get_functiondef(signature::regprocedure);
  if position('public.create_order_with_allocation_confirmation_base' in d)=0 then
    original_block:=$q$result:=public.create_order_with_pricing(p_items,p_member,p_address,p_phone,p_email,p_note,
    p_payment_method,p_fulfillment_method,p_coupon_code,p_invoice_type,p_invoice_company_name,
    p_invoice_tax_id,p_shopping_credit_amount);$q$;
    d:=pg_temp.allocation_replace_once(d,original_block,'if public.automatic_price_allocation_enabled() then '||
      replace(original_block,'public.create_order_with_pricing(', 'public.create_order_with_allocation_confirmation_base(')||E'\n  else '||original_block||E'\n  end if;');
    execute d;
  end if;
  d:=pg_get_functiondef('public.persist_assisted_benefits(text,jsonb,uuid,text)'::regprocedure);
  if position('automatic_allocation_version' in d)=0 then
    d:=pg_temp.allocation_replace_once(d,$q$if adjustment->>'adjustment_type'='legacy_discount' then continue; end if;$q$,
      $q$if adjustment->>'adjustment_type'='legacy_discount' and p_quote->>'automatic_allocation_version' is distinct from '1' then continue; end if;$q$);
    execute d;
  end if;
  d:=pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure);
  if position($q$'automatic_allocations',benefit_quote$q$ in d)=0 then
    d:=pg_temp.allocation_replace_once(d,$q$'apply_automatic',p_payload->'apply_automatic'$q$,
      $q$'apply_automatic',p_payload->'apply_automatic','automatic_allocation_version',benefit_quote->'automatic_allocation_version',
      'automatic_allocations',benefit_quote#>'{pricing_snapshot,automatic_allocations}'$q$);
    execute d;
  end if;
  -- The same total with changed allocation is a changed offer too.
  d:=pg_get_functiondef('public.student_price_confirmation(jsonb)'::regprocedure);
  if position('automatic_allocation_version' in d)=0 then
    d:=pg_temp.allocation_replace_once(d,$q$select jsonb_build_object('subtotal'$q$,
      $q$select (case when p_quote->>'automatic_allocation_version'='1' or p_quote#>>'{pricing_snapshot,automatic_allocation_version}'='1'
        then jsonb_build_object('automatic_allocation_version',1,'automatic_allocations',p_quote#>'{pricing_snapshot,automatic_allocations}')
        else '{}'::jsonb end)||jsonb_build_object('subtotal'$q$);
    execute d;
  end if;
  d:=pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure);
  if position($q$'automatic_allocations',result$q$ in d)=0 then
    d:=pg_temp.allocation_replace_once(d,$q$'coupon_campaign_id',result->'coupon_campaign_id','items',confirmation_items$q$,
      $q$'coupon_campaign_id',result->'coupon_campaign_id','items',confirmation_items,
      'automatic_allocation_version',result->'automatic_allocation_version','automatic_allocations',result#>'{pricing_snapshot,automatic_allocations}'$q$);
    execute d;
  end if;
end $migration$;

alter table public.order_adjustments drop constraint if exists order_adjustments_adjustment_type_check;
alter table public.order_adjustments add constraint order_adjustments_adjustment_type_check check (
  adjustment_type in ('legacy_discount','percentage_discount','fixed_discount','amount_gift','quantity_gift','free_shipping','buy_x_get_y'));
revoke all on function public.quote_order_pricing_allocation_base(jsonb,text),
  public.evaluate_automatic_price_allocation(jsonb,jsonb,integer[]),public.solve_automatic_price_component(jsonb,jsonb,integer),
  public.bound_automatic_price_allocation(jsonb,jsonb,integer[],integer[],integer),
  public.allocate_automatic_prices(jsonb,text,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

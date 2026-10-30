-- Incremental installation, OFF by default. No activity or historical order is changed.
-- Requires the installed automatic allocation and immutable student reward snapshots.
begin;
do $$ begin
  if to_regprocedure('public.allocate_automatic_prices(jsonb,text,uuid)') is null
    or to_regprocedure('public.persist_student_reward_snapshot(text,jsonb)') is null then
    raise exception 'Automatic allocation and reward snapshots are required';
  end if;
end $$;

alter table public.promotions add column if not exists allow_student_price_stacking boolean not null default true;
alter table public.promotions add column if not exists instructor_reward_eligible boolean not null default true;
create table if not exists public.promotion_student_policy_settings(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false, version bigint not null default 1 check(version>0)
);
insert into public.promotion_student_policy_settings(singleton) values(true) on conflict do nothing;
alter table public.promotion_student_policy_settings enable row level security;
revoke all on public.promotion_student_policy_settings from public,anon,authenticated,service_role;

create or replace function public.promotion_student_policy_enabled()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from public.promotion_student_policy_settings where singleton),false)
    and public.automatic_price_allocation_enabled();
$$;

-- Only authoritative callers may supply lines. Private comparison prices are
-- used for tie-breaking and are removed before returning the allocation result.
create or replace function public.student_policy_price_lines(p_lines jsonb,p_role text,p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare multiplier numeric; item jsonb; result jsonb:='[]'; product public.products%rowtype;
  variant public.product_variants%rowtype; base numeric; teacher_default numeric;
begin
  if p_role<>'pro' or not public.promotion_student_policy_enabled() then return p_lines; end if;
  multiplier:=public.student_pricing_multiplier(p_customer);
  if multiplier is null then return p_lines; end if;
  select professional_price_multiplier into teacher_default from public.membership_tiers where role='instructor' and active;
  for item in select value from jsonb_array_elements(p_lines) loop
    if coalesce((item->>'student_policy_auto')::boolean,true) then
      select * into product from public.products where id=(item->>'product_id')::integer;
      select * into variant from public.product_variants where id=(item->>'variant_id')::bigint and product_id=product.id;
      base:=public.assisted_auto_unit_price(p_customer,'pro',product,variant,null);
      if public.apply_student_price(base,multiplier) is distinct from (item->>'unit_price')::numeric then
        raise exception '商品價格已變動，請重新報價' using errcode='40001';
      end if;
      item:=item||jsonb_build_object('_student_policy_base',base,
        '_student_policy_reward',greatest(0,(item->>'unit_price')::numeric-round(
          case when product.instructor_price_multiplier=1 then variant.pro_price else coalesce(nullif(variant.pro_price,0),variant.price) end
          *public.resolve_product_price_multiplier(product,'instructor',coalesce(teacher_default,0.70)))));
    end if;
    result:=result||jsonb_build_array(item);
  end loop;
  return result;
end $$;

-- Reuse the established threshold, numeric rounding and lowest-free-item rules
-- separately for each activity at its own price basis. Other activities' owned
-- quantities are excluded from that activity's BOGO comparison pool.
create or replace function public.evaluate_student_policy_allocation(p_lines jsonb,p_activities jsonb,p_counts integer[])
returns jsonb language plpgsql immutable set search_path='' as $$
declare lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  i integer; j integer; k integer; own integer; used integer; pool_qty integer; price numeric; loss numeric;
  lost numeric; net numeric:=0; gross numeric; reward_removed numeric:=0; any_activity integer:=0;
  activity jsonb; item jsonb; evaluated jsonb; adjustment jsonb; entries jsonb; entry jsonb;
  single_lines jsonb; single_counts integer[]; adjustments jsonb:='[]'; lines jsonb:='[]';
  amounts numeric[]; free_counts integer[]; vector numeric[]:='{}'; score numeric[];
begin
  amounts:=array_fill(0::numeric,array[lc]); free_counts:=array_fill(0,array[lc]);
  for i in 0..lc-1 loop
    used:=0;
    for j in 0..ac-1 loop
      own:=p_counts[i*ac+j+1];
      if own<0 or (own>0 and not (p_activities->j->'e'->>i)::boolean) then return null; end if;
      used:=used+own;
    end loop;
    if used>(p_lines->i->>'qty')::integer then return null; end if;
  end loop;
  for j in 0..ac-1 loop
    activity:=p_activities->j; single_lines:='[]'; single_counts:='{}'; lost:=0; used:=0;
    for i in 0..lc-1 loop
      item:=p_lines->i; own:=p_counts[i*ac+j+1]; used:=used+own;
      pool_qty:=(item->>'qty')::integer;
      for k in 0..ac-1 loop if k<>j then pool_qty:=pool_qty-p_counts[i*ac+k+1]; end if; end loop;
      price:=(item->>'unit_price')::numeric;
      if not coalesce((activity->>'allow_student_price_stacking')::boolean,true) and item ? '_student_policy_base' then
        price:=(item->>'_student_policy_base')::numeric;
      end if;
      lost:=lost+own*(price-(item->>'unit_price')::numeric);
      single_lines:=single_lines||jsonb_build_array(item||jsonb_build_object('qty',pool_qty,'unit_price',price,'line_total',pool_qty*price));
      single_counts:=array_append(single_counts,own);
    end loop;
    if used=0 then vector:=array_append(vector,0); continue; end if;
    evaluated:=public.evaluate_automatic_price_allocation(single_lines,jsonb_build_array(activity),single_counts);
    if evaluated is null or jsonb_array_length(evaluated->'adjustments')<>1 then return null; end if;
    adjustment:=evaluated->'adjustments'->0; gross:=(adjustment->>'amount')::numeric;
    entries:='[]';
    for entry in select value from jsonb_array_elements(adjustment#>'{qualification,allocation}') loop
      select ordinality::integer-1 into i from jsonb_array_elements(p_lines) with ordinality
        where value->'product_id'=entry->'product_id' and value->'variant_id'=entry->'variant_id';
      item:=p_lines->i; own:=(entry->>'quantity')::integer;
      loss:=own*((entry->>'unit_price')::numeric-(item->>'unit_price')::numeric);
      amounts[i+1]:=amounts[i+1]+(entry->>'amount')::numeric-loss;
      free_counts[i+1]:=free_counts[i+1]+(entry->>'free_quantity')::integer;
      if item ? '_student_policy_base' and not coalesce((activity->>'instructor_reward_eligible')::boolean,true) then
        reward_removed:=reward_removed+own*(item->>'_student_policy_reward')::numeric;
      end if;
      entries:=entries||jsonb_build_array(entry||jsonb_build_object(
        'student_unit_price',item->'unit_price','student_price_applied',
          not (item ? '_student_policy_base') or coalesce((activity->>'allow_student_price_stacking')::boolean,true),
        'reward_excluded',item ? '_student_policy_base' and not coalesce((activity->>'instructor_reward_eligible')::boolean,true)));
    end loop;
    adjustment:=jsonb_set(adjustment,'{qualification}',(adjustment->'qualification')||jsonb_build_object(
      'student_policy_version',1,'allow_student_price_stacking',coalesce((activity->>'allow_student_price_stacking')::boolean,true),
      'instructor_reward_eligible',coalesce((activity->>'instructor_reward_eligible')::boolean,true),
      'student_discount_replaced',lost,'allocation',entries));
    adjustments:=adjustments||jsonb_build_array(adjustment);
    if lost>0 then
      adjustments:=adjustments||jsonb_build_array(jsonb_build_object('promotion_id',activity->'id','coupon_campaign_id',null,
        'adjustment_type','student_price_restoration','name','活動商品不適用學生價','amount',lost,'sort_order',j,
        'qualification',jsonb_build_object('student_policy_version',1,'activity_name',activity->'name')));
    end if;
    net:=net+gross-lost; any_activity:=1; vector:=array_append(vector,gross-lost);
  end loop;
  for i in 0..lc-1 loop
    item:=p_lines->i;
    if (item->>'line_total')::numeric-amounts[i+1]<0 then return null; end if;
    lines:=lines||jsonb_build_array((item-'_student_policy_base'-'_student_policy_reward')||jsonb_build_object(
      'remaining_total',(item->>'line_total')::numeric-amounts[i+1],'bogo_free_quantity',free_counts[i+1]));
  end loop;
  -- Private score: net customer saving, activity over student-only, lower reward,
  -- followed by the established activity order and stable ownership vector.
  score:=array[net,any_activity::numeric,reward_removed]||vector;
  foreach own in array p_counts loop score:=array_append(score,own); end loop;
  return jsonb_build_object('discount',net,'adjustments',adjustments,'lines',lines,'score',score);
end $$;

-- Exact bounded quantity enumeration. The old solver's gross-discount pruning
-- and whole-scope fast path cannot be used for mutually exclusive student prices.
create or replace function public.solve_student_policy_component(p_lines jsonb,p_activities jsonb,p_node_budget integer default 20000)
returns jsonb language plpgsql immutable set search_path='' as $$
declare lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  counts integer[]; remaining integer[]; cells integer[]:='{}'; next_qty integer[]; cell integer;
  i integer; j integer; pos integer; selected integer; nodes integer:=0; best jsonb; result jsonb;
  score numeric[]; best_score numeric[]; total bigint; wanted bigint; free_left bigint; take integer; row record;
begin
  if not exists(select 1 from jsonb_array_elements(p_lines) x where x ? '_student_policy_base')
    or not exists(select 1 from jsonb_array_elements(p_activities) x
      where not coalesce((x->>'allow_student_price_stacking')::boolean,true)
        or not coalesce((x->>'instructor_reward_eligible')::boolean,true)) then
    result:=public.solve_automatic_price_component(p_lines,p_activities,p_node_budget);
    select jsonb_agg(value-'_student_policy_base'-'_student_policy_reward' order by ordinality) into best
      from jsonb_array_elements(result->'lines') with ordinality;
    return jsonb_set(result,'{lines}',best);
  end if;
  if p_node_budget<1 then raise exception '活動組合超出計算範圍，請聯絡客服確認優惠。' using errcode='54000'; end if;
  counts:=array_fill(0,array[lc*ac]); remaining:=array_fill(0,array[lc]);
  for i in 0..lc-1 loop
    remaining[i+1]:=(p_lines->i->>'qty')::integer;
    for j in 0..ac-1 loop if (p_activities->j->'e'->>i)::boolean then cells:=array_append(cells,i*ac+j+1); end if; end loop;
  end loop;
  if cardinality(cells)>128 then raise exception '活動重疊範圍過大，請聯絡客服確認優惠。' using errcode='54000'; end if;
  best:=public.evaluate_student_policy_allocation(p_lines,p_activities,counts);
  select array_agg(value::numeric order by ordinality) into best_score from jsonb_array_elements_text(best->'score') with ordinality;
  -- One BOGO: the free units are fixed by the complete eligible comparison pool.
  -- Choose paid units by least forgone student discount, then most excluded reward.
  -- Quantity compression makes even 9999 units constant in the number of variants.
  if ac=1 and p_activities->0->>'benefit_type'='buy_x_get_y'
    and p_activities->0->>'threshold_type'='quantity'
    and coalesce((p_activities->0->>'threshold_value')::numeric,0)
      <=(p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer then
    select coalesce(sum((p_lines->idx->>'qty')::integer),0) into total from generate_series(0,lc-1) idx where (p_activities->0->'e'->>idx)::boolean;
    wanted:=total/((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer);
    if p_activities->0->>'repeat_mode'<>'repeat' then wanted:=least(1,wanted); end if;
    free_left:=wanted*(p_activities->0->>'gift_quantity')::integer;
    wanted:=wanted*((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer);
    for row in select value,ordinality::integer idx from jsonb_array_elements(p_lines) with ordinality
      where (p_activities->0->'e'->>(ordinality::integer-1))::boolean
      order by case when not coalesce((p_activities->0->>'allow_student_price_stacking')::boolean,true)
        then coalesce((value->>'_student_policy_base')::numeric,(value->>'unit_price')::numeric) else (value->>'unit_price')::numeric end,
        (value->>'product_id')::integer,(value->>'variant_id')::bigint loop
      take:=least(free_left,remaining[row.idx]); counts[row.idx]:=take; remaining[row.idx]:=remaining[row.idx]-take;
      free_left:=free_left-take; wanted:=wanted-take;
    end loop;
    for row in select value,ordinality::integer idx from jsonb_array_elements(p_lines) with ordinality
      where (p_activities->0->'e'->>(ordinality::integer-1))::boolean
      order by case when not coalesce((p_activities->0->>'allow_student_price_stacking')::boolean,true)
        then coalesce((value->>'_student_policy_base')::numeric,(value->>'unit_price')::numeric)-(value->>'unit_price')::numeric else 0 end,
        case when not coalesce((p_activities->0->>'instructor_reward_eligible')::boolean,true) then coalesce((value->>'_student_policy_reward')::numeric,0) else 0 end desc,
        (value->>'product_id')::integer,(value->>'variant_id')::bigint loop
      take:=least(wanted,remaining[row.idx]); counts[row.idx]:=counts[row.idx]+take; wanted:=wanted-take;
    end loop;
    result:=public.evaluate_student_policy_allocation(p_lines,p_activities,counts);
    if result is not null then
      select array_agg(value::numeric order by ordinality) into score from jsonb_array_elements_text(result->'score') with ordinality;
      if score>best_score then best:=result; end if;
    end if;
    return best||jsonb_build_object('search_nodes',1);
  end if;
  pos:=1; next_qty:=array_fill(-2,array[cardinality(cells)]);
  while pos>0 loop
    nodes:=nodes+1;
    if nodes>p_node_budget then raise exception '活動組合超出計算範圍，請聯絡客服確認優惠。' using errcode='54000'; end if;
    if pos>cardinality(cells) then
      result:=public.evaluate_student_policy_allocation(p_lines,p_activities,counts);
      if result is not null then
        select array_agg(value::numeric order by ordinality) into score from jsonb_array_elements_text(result->'score') with ordinality;
        if score>best_score then best:=result; best_score:=score; end if;
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
      next_qty[pos]:=selected-1; counts[cell]:=selected; remaining[i]:=remaining[i]-selected; pos:=pos+1;
      if pos<=cardinality(cells) then next_qty[pos]:=-2; end if;
    end if;
  end loop;
  return best||jsonb_build_object('search_nodes',nodes);
end $$;

create or replace function pg_temp.student_policy_replace(source text,anchor text,replacement text)
returns text language plpgsql as $$ begin
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'Student policy source mismatch: %',left(anchor,100);
  end if;
  return replace(source,anchor,replacement);
end $$;

do $migration$
declare d text; signature text;
begin
  d:=pg_get_functiondef('public.allocate_automatic_prices(jsonb,text,uuid)'::regprocedure);
  if position('public.student_policy_price_lines' in d)=0 then
    d:=pg_temp.student_policy_replace(d,'  lc:=jsonb_array_length(lines);',
      '  lines:=public.student_policy_price_lines(lines,p_role,p_customer_id);'||E'\n  lc:=jsonb_array_length(lines);');
    d:=pg_temp.student_policy_replace(d,'public.solve_automatic_price_component(component_lines,component_activities,20000-nodes)',
      'public.solve_student_policy_component(component_lines,component_activities,20000-nodes)');
    d:=pg_temp.student_policy_replace(d,'jsonb_agg(x order by p.priority,p.created_at,p.id)',
      $q$jsonb_agg(x order by p.priority,p.created_at,p.id,(x->>'adjustment_type'='student_price_restoration'))$q$);
    -- Non-matching lines and empty-candidate results must not leak private fields.
    d:=replace(d,$q$'lines',lines$q$,$q$'lines',public.strip_student_policy_lines(lines)$q$);
    d:=replace(d,$q$'lines',returned_lines$q$,$q$'lines',public.strip_student_policy_lines(returned_lines)$q$);
    execute d;
  end if;
  foreach signature in array array['public.quote_order_pricing_discount_v2(jsonb,text,text,text)',
    'public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'] loop
    d:=pg_get_functiondef(signature::regprocedure);
    if position('student_price_restoration' in d)=0 then
      d:=pg_temp.student_policy_replace(d,$q$sum((adjustment ->> 'amount')::numeric)$q$,
        $q$sum((case when adjustment->>'adjustment_type'='student_price_restoration' then -1 else 1 end)*(adjustment ->> 'amount')::numeric)$q$);
      d:=pg_temp.student_policy_replace(d,'if jsonb_array_length(automatic_adjustments)=1 then',
        $q$if (select count(*) from jsonb_array_elements(automatic_adjustments) x where x->>'adjustment_type'<>'student_price_restoration')=1 then$q$);
      execute d;
    end if;
  end loop;
  d:=pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure);
  if position($q$'student_policy_auto'$q$ in d)=0 then
    d:=pg_temp.student_policy_replace(d,$q$'price',price,'unit_price',price$q$,
      $q$'student_policy_auto',coalesce(entry->>'price_mode','MANUAL')='AUTO','price',price,'unit_price',price$q$);
    execute d;
  end if;
  d:=pg_get_functiondef('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  if position($q$'buy_x_get_y', 'student_price_restoration'$q$ in d)=0 then
    d:=pg_temp.student_policy_replace(d,$q$'percentage_discount', 'fixed_discount', 'buy_x_get_y'$q$,
      $q$'percentage_discount', 'fixed_discount', 'buy_x_get_y', 'student_price_restoration'$q$);
    execute d;
  end if;
end $migration$;

do $migration$
declare d text;
begin
  if to_regprocedure('public.save_discount_promotion_student_policy_base(jsonb)') is null then
    d:=pg_get_functiondef('public.save_discount_promotion(jsonb)'::regprocedure);
    execute replace(d,'FUNCTION public.save_discount_promotion(', 'FUNCTION public.save_discount_promotion_student_policy_base(');
    revoke all on function public.save_discount_promotion_student_policy_base(jsonb) from public,anon,authenticated,service_role;
  end if;
end $migration$;

create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
  if auth.uid() is null or not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management authorization required' using errcode='42501';
  end if;
  if (p_payload ? 'allow_student_price_stacking' and jsonb_typeof(p_payload->'allow_student_price_stacking') is distinct from 'boolean')
    or (p_payload ? 'instructor_reward_eligible' and jsonb_typeof(p_payload->'instructor_reward_eligible') is distinct from 'boolean') then
    raise exception 'Invalid student policy' using errcode='22023';
  end if;
  if (coalesce(p_payload->>'activation_type','')<>'automatic'
    or coalesce(p_payload->>'benefit_type','') not in ('percentage_discount','fixed_discount','buy_x_get_y'))
    and (not coalesce((p_payload->>'allow_student_price_stacking')::boolean,true)
      or not coalesce((p_payload->>'instructor_reward_eligible')::boolean,true)) then
    raise exception 'Student policy applies only to automatic price activities' using errcode='22023';
  end if;
  -- Clear policies before the existing editor switches to an unsupported kind;
  -- its UPDATE must satisfy the scope constraint too. Failure rolls this back.
  if p_payload->>'activation_type'<>'automatic' or p_payload->>'benefit_type' not in ('percentage_discount','fixed_discount','buy_x_get_y') then
    update public.promotions set allow_student_price_stacking=true,instructor_reward_eligible=true
      where id=nullif(p_payload->>'id','')::uuid;
  end if;
  target_id:=public.save_discount_promotion_student_policy_base(p_payload);
  update public.promotions set
    allow_student_price_stacking=case when p_payload ? 'allow_student_price_stacking' then (p_payload->>'allow_student_price_stacking')::boolean else allow_student_price_stacking end,
    instructor_reward_eligible=case when p_payload ? 'instructor_reward_eligible' then (p_payload->>'instructor_reward_eligible')::boolean else instructor_reward_eligible end
  where id=target_id;
  return target_id;
end $$;

alter table public.promotions drop constraint if exists promotions_student_policy_scope_check;
alter table public.promotions add constraint promotions_student_policy_scope_check check(
  (allow_student_price_stacking and instructor_reward_eligible) or
  (activation_type='automatic' and benefit_type in ('legacy_discount','percentage_discount','fixed_discount','buy_x_get_y')));

create or replace function public.strip_student_policy_lines(p_lines jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(value-'_student_policy_base'-'_student_policy_reward' order by ordinality),'[]'::jsonb)
    from jsonb_array_elements(p_lines) with ordinality;
$$;

alter table public.order_adjustments drop constraint if exists order_adjustments_adjustment_type_check;
alter table public.order_adjustments add constraint order_adjustments_adjustment_type_check check(
  adjustment_type in ('legacy_discount','percentage_discount','fixed_discount','amount_gift','quantity_gift','free_shipping','buy_x_get_y','student_price_restoration'));

-- Compute excluded quantities from the immutable order allocation, never from
-- today's activity settings. Reward snapshots still contain every purchased line.
create or replace function public.student_reward_excluded_quantity(p_snapshot jsonb,p_product integer,p_variant bigint)
returns integer language sql immutable set search_path='' as $$
  select coalesce(sum((entry->>'quantity')::integer),0)::integer
  from jsonb_array_elements(coalesce(nullif(p_snapshot->'automatic_allocations','null'::jsonb),'[]'::jsonb)) adjustment
  cross join lateral jsonb_array_elements(coalesce(adjustment#>'{qualification,allocation}','[]'::jsonb)) entry
  where adjustment#>>'{qualification,student_policy_version}'='1'
    and coalesce((entry->>'reward_excluded')::boolean,false)
    and (entry->>'product_id')::integer=p_product and (entry->>'variant_id')::bigint=p_variant;
$$;

do $migration$
declare d text;
begin
  d:=pg_get_functiondef('public.persist_student_reward_snapshot(text,jsonb)'::regprocedure);
  if position('public.student_reward_excluded_quantity' in d)=0 then
    d:=pg_temp.student_policy_replace(d,'qty integer; unit_price numeric;', 'qty integer; excluded_qty integer; excluded_used jsonb:=''{}''; excluded_key text; unit_price numeric;');
    d:=pg_temp.student_policy_replace(d,
      $q$    amount:=public.calculate_student_reward_line(unit_price,(basis->>'instructor_unit_price')::numeric,qty);$q$,
      $q$    excluded_key:=basis->>'variant_id';
    excluded_qty:=case when basis->>'price_mode'='AUTO' then least(qty,greatest(0,public.student_reward_excluded_quantity(target.pricing_snapshot,(basis->>'product_id')::integer,(basis->>'variant_id')::bigint)-coalesce((excluded_used->>excluded_key)::integer,0))) else 0 end;
    excluded_used:=jsonb_set(excluded_used,array[excluded_key],to_jsonb(coalesce((excluded_used->>excluded_key)::integer,0)+excluded_qty));
    if excluded_qty<0 or excluded_qty>qty then raise exception 'Invalid excluded reward quantity' using errcode='22023'; end if;
    amount:=public.calculate_student_reward_line(unit_price,(basis->>'instructor_unit_price')::numeric,qty);
    amount:=(amount/qty)*(qty-excluded_qty);$q$);
    d:=pg_temp.student_policy_replace(d,$q$'instructor_multiplier',basis->'instructor_multiplier','instructor_unit_price'$q$,
      $q$'reward_eligible_quantity',qty-excluded_qty,'reward_excluded_quantity',excluded_qty,
      'reward_exclusion_reason',case when excluded_qty>0 then 'promotion_policy' end,
      'instructor_multiplier',basis->'instructor_multiplier','instructor_unit_price'$q$);
    execute d;
  end if;
end $migration$;

do $migration$
declare d text;
begin
  if to_regprocedure('public.instructor_reward_report_internal(uuid,integer,integer,integer)') is not null then
    d:=pg_get_functiondef('public.instructor_reward_report_internal(uuid,integer,integer,integer)'::regprocedure);
    if position($q$'reward_excluded_quantity'$q$ in d)=0 then
      d:=pg_temp.student_policy_replace(d,$q$'unit_price',i->'basis_unit_price','reward',i->'reward'$q$,
        $q$'unit_price',i->'basis_unit_price','reward',i->'reward',
          'reward_eligible_quantity',coalesce(i->'reward_eligible_quantity',i->'qty'),
          'reward_excluded_quantity',coalesce(i->'reward_excluded_quantity','0'::jsonb),
          'reward_exclusion_reason',i->'reward_exclusion_reason'$q$);
      execute d;
    end if;
  end if;
end $migration$;

-- Dedicated policy writer also supports legacy read-only activities, without
-- rewriting their scopes, formulas, audiences or lifecycle fields.
create or replace function public.save_promotion_student_policy(p_id uuid,p_allow_stacking boolean,p_reward_eligible boolean,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare target public.promotions%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management authorization required' using errcode='42501';
  end if;
  select * into target from public.promotions where id=p_id for update;
  if not found then raise exception 'Activity not found' using errcode='22023'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '活動已變更，請重新載入' using errcode='40001';
  end if;
  if target.activation_type<>'automatic' or target.benefit_type not in ('legacy_discount','percentage_discount','fixed_discount','buy_x_get_y')
    or p_allow_stacking is null or p_reward_eligible is null then
    raise exception 'Student policy applies only to automatic price activities' using errcode='22023';
  end if;
  update public.promotions set allow_student_price_stacking=p_allow_stacking,instructor_reward_eligible=p_reward_eligible,updated_at=clock_timestamp() where id=p_id;
end $$;

revoke all on function public.promotion_student_policy_enabled(),public.student_policy_price_lines(jsonb,text,uuid),
  public.evaluate_student_policy_allocation(jsonb,jsonb,integer[]),public.solve_student_policy_component(jsonb,jsonb,integer),
  public.strip_student_policy_lines(jsonb),public.student_reward_excluded_quantity(jsonb,integer,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz) from public,anon,service_role;
grant execute on function public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;

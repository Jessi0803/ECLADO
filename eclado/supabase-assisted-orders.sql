-- Admin-assisted online orders. Run AFTER member pricing, historical orders,
-- shopping credit checkout, inventory allocations and payment retry migrations.
-- Deploy Payment API + frontend after SQL. Never rerun older source constraints
-- or shipping/inventory trigger migrations afterwards without merging this change.
begin;
do $$
begin
  if to_regprocedure('public.resolve_product_price_multiplier(public.products,text,numeric)') is null
    or to_regprocedure('public.allocate_inventory_for_paid_order(text,jsonb)') is null
    or to_regprocedure('public.release_inventory_for_order(text)') is null
    or to_regclass('public.order_payment_authorizations') is null then
    raise exception 'Assisted orders prerequisites missing';
  end if;
end;
$$;

-- Keep existing allowed sources, only append the new one.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_order_source_check' and contype='c';
  if definition is null then raise exception 'Order source constraint missing'; end if;
  if position('admin_assisted' in definition)=0 then
    alter table public.orders drop constraint orders_order_source_check;
    execute 'alter table public.orders add constraint orders_order_source_check CHECK (order_source = ''admin_assisted'' OR '
      || substring(definition from 7) || ')';
  end if;
end;
$$;
alter table public.orders add column if not exists assisted_payment_method text;
-- Also upgrade installations that already ran the card/ATM-only version.
alter table public.orders drop constraint if exists orders_assisted_payment_method_check;
alter table public.orders add constraint orders_assisted_payment_method_check
  check (assisted_payment_method in ('card','atm','apple','google'));

create table if not exists public.assisted_order_requests (
  request_key uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  payload jsonb not null,
  order_id text unique references public.orders(id) on delete restrict,
  payment_token text not null,
  link_token text not null unique,
  created_at timestamptz not null default now()
);
-- Credentials and internal exception reasons must never be selected by browsers.
alter table public.assisted_order_requests enable row level security;
revoke all on table public.assisted_order_requests from public, anon, authenticated;
grant all on table public.assisted_order_requests to service_role;
alter table public.assisted_order_requests add column if not exists pricing_context jsonb not null default '[]'::jsonb;

create or replace function public.protect_assisted_order()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.order_source='admin_assisted' then
      raise exception 'Assisted orders must remain for audit; cancel instead' using errcode='55000';
    end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if new.order_source='admin_assisted' and coalesce(current_setting('app.assisted_order_create',true),'')<>'1' then
      raise exception 'Assisted orders require admin RPC' using errcode='42501';
    end if;
  elsif new.order_source='admin_assisted' and old.order_source<>'admin_assisted' then
    raise exception 'Existing orders cannot become assisted orders' using errcode='55000';
  elsif old.order_source='admin_assisted' then
    if new.order_source is distinct from old.order_source
      or new.user_id is distinct from old.user_id or new.member is distinct from old.member
      or new.address is distinct from old.address or new.phone is distinct from old.phone
      or new.email is distinct from old.email or new.note is distinct from old.note
      or new.date is distinct from old.date or new.type is distinct from old.type
      or new.fulfillment_method is distinct from old.fulfillment_method
      or new.shipping_group_id is distinct from old.shipping_group_id
      or new.assisted_payment_method is distinct from old.assisted_payment_method
      or new.invoice_type is distinct from old.invoice_type
      or new.invoice_company_name is distinct from old.invoice_company_name
      or new.invoice_tax_id is distinct from old.invoice_tax_id
      or new.payment_due_at is distinct from old.payment_due_at then
      raise exception 'Assisted order information is locked; cancel and recreate' using errcode='55000';
    end if;
    if old.status in ('cancelled','returned') and new.status not in ('cancelled','returned')
      and not (old.status='cancelled' and new.status='paid' and auth.role()='service_role') then
      raise exception 'Cancelled assisted orders cannot be reopened' using errcode='55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_assisted_order() from public, anon, authenticated;
drop trigger if exists trg_protect_assisted_order on public.orders;
create trigger trg_protect_assisted_order before insert or update or delete on public.orders
for each row execute function public.protect_assisted_order();

-- Only assisted orders allocate before payment. The normal allocation trigger
-- stays intact for storefront orders; historical orders remain excluded.
drop trigger if exists trg_orders_inventory_allocation_sync on public.orders;
create trigger trg_orders_inventory_allocation_sync before insert or update of status,items on public.orders
for each row when (new.order_source not in ('historical_manual','admin_assisted'))
execute function public.sync_inventory_allocation_for_order();
create or replace function public.sync_assisted_inventory()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform public.allocate_inventory_for_paid_order(new.id,new.items);
  elsif new.items is distinct from old.items then
    raise exception 'Assisted order items are locked' using errcode='55000';
  elsif old.status='cancelled' and new.status='paid' then
    -- Verified late gateway payments follow the existing storefront recovery
    -- semantics. Released allocations are replaced once, shortages stay visible.
    perform public.allocate_inventory_for_paid_order(new.id,new.items);
  elsif new.status in ('cancelled','returned') and old.status not in ('cancelled','returned') then
    perform public.release_inventory_for_order(new.id);
  end if;
  if new.status in ('ready_for_pickup','picked_up','shipped','delivered') then
    perform public.close_backorders_for_fulfillment(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.sync_assisted_inventory() from public, anon, authenticated;
drop trigger if exists trg_assisted_inventory on public.orders;
create trigger trg_assisted_inventory before insert or update of status,items on public.orders
for each row when (new.order_source='admin_assisted') execute function public.sync_assisted_inventory();

-- If combined-shipping is installed, preserve its code and add an early exit.
-- No group is created even on later payment, no shipping-credit refund occurs.
do $$
declare function_name text; definition text;
begin
  foreach function_name in array array['assign_shipping_group_to_additional_order',
    'prepare_shipping_group_for_order_status','sync_shipping_group_from_order_status'] loop
    if to_regprocedure('public.'||function_name||'()') is not null then
      definition := pg_get_functiondef(to_regprocedure('public.'||function_name||'()'));
      if position('admin_assisted' in definition)=0 then
        if position(E'\nbegin\n' in definition)=0 then raise exception 'Shipping trigger format differs: %',function_name; end if;
        definition := replace(definition,E'\nbegin\n',E'\nbegin\n  if new.order_source = ''admin_assisted'' then return new; end if;\n');
        execute definition;
      end if;
    end if;
  end loop;
end;
$$;

-- Pending assisted allocations are still physically onsite. Include them in
-- physical count snapshots and shortage reconciliation, not sales totals/FIFO.
do $$
declare function_name text; definition text; marker text := 'target_order.status in (''paid'', ''preparing'', ''ready_for_pickup'')';
begin
  foreach function_name in array array['create_inventory_count(text)','complete_inventory_count(uuid)'] loop
    if to_regprocedure('public.'||function_name) is not null then
      definition := pg_get_functiondef(to_regprocedure('public.'||function_name));
      if position('admin_assisted' in definition)=0 then
        if position(marker in definition)=0 then raise exception 'Inventory count format differs: %',function_name; end if;
        definition := replace(definition,marker,'(target_order.status in (''paid'', ''preparing'', ''ready_for_pickup'') OR (target_order.order_source=''admin_assisted'' AND target_order.status in (''unpaid'',''awaiting_confirm'')))');
        execute definition;
      end if;
    end if;
  end loop;
end;
$$;

-- Existing failed-card retry rotates the provider order number. Assisted orders
-- must not rotate again while the previous retry is unresolved or in progress.
do $$
declare definition text; marker text := '  next_attempt := greatest';
begin
  if to_regprocedure('public.begin_order_payment_retry(text)') is null then raise exception 'Payment retry prerequisite missing'; end if;
  definition := pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure);
  if position('Assisted payment retry result unresolved' in definition)=0 then
    if position(marker in definition)=0 then raise exception 'Payment retry function format differs'; end if;
    definition := replace(definition,marker,$guard$
  if target_order.order_source='admin_assisted' and (
    (payment_auth.claimed_at is not null and payment_auth.gateway_created_at is null)
    or (payment_auth.attempt_no > instruction.attempt_no and not exists(
      select 1 from public.order_payment_attempts attempt
      where attempt.provider_order_no=payment_auth.provider_order_no and attempt.payment_state='failed'))
  ) then
    raise exception 'Assisted payment retry result unresolved; confirm previous bank attempt first' using errcode='55P03';
  end if;
  next_attempt := greatest$guard$);
    execute definition;
  end if;
end;
$$;

create or replace function public.create_assisted_order(p_request_key uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  request_row public.assisted_order_requests%rowtype;
  member_id uuid; member_role text := 'consumer';
  target_variant public.product_variants%rowtype; target_product public.products%rowtype;
  item jsonb; lines jsonb := '[]'::jsonb; quantity integer; unit_price numeric;
  suggested_price numeric; suggested_prices jsonb := '[]'::jsonb; subtotal_amount numeric := 0; shipping_amount numeric;
  default_shipping numeric; method text; delivery text; all_custom boolean := true; all_free boolean := true;
  created_order_id text; snapshot jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.read')
    or not public.has_backoffice_permission('catalog.read') then
    raise exception 'Admin order authorization required' using errcode='42501';
  end if;
  if p_request_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or (p_payload - array['customer_type','member_id','member','phone','email','address','note','items',
      'payment_method','fulfillment_method','invoice_type','invoice_company_name','invoice_tax_id',
      'shipping_mode','shipping_amount','shipping_reason','minimum_reason'])<>'{}'::jsonb then
    raise exception 'Invalid assisted order payload' using errcode='22023';
  end if;
  insert into public.assisted_order_requests(request_key,actor_user_id,payload,payment_token,link_token)
  values (p_request_key,auth.uid(),p_payload,encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'))
  on conflict(request_key) do nothing;
  select * into request_row from public.assisted_order_requests where request_key=p_request_key for update;
  if request_row.actor_user_id<>auth.uid() then raise exception 'Request owner mismatch' using errcode='42501'; end if;
  if request_row.payload is distinct from p_payload then
    raise exception '同一次開單內容不同，請找回原單確認後取消重建。' using errcode='22023';
  end if;
  if request_row.order_id is not null then
    return jsonb_build_object('order_id',request_row.order_id,'link_token',request_row.link_token,'recovered',true);
  end if;
  if p_payload->>'customer_type'='member' then
    member_id := (p_payload->>'member_id')::uuid;
    select role into member_role from public.profiles where id=member_id;
    if not found then raise exception 'Member not found' using errcode='22023'; end if;
    if member_role not in ('pro','instructor','distributor','staff') then member_role := 'consumer'; end if;
  elsif p_payload->>'customer_type'='guest' and nullif(p_payload->>'member_id','') is null then
    member_id := null;
  else raise exception 'Select member or guest' using errcode='22023'; end if;
  method := p_payload->>'payment_method'; delivery := p_payload->>'fulfillment_method';
  if method is null or method not in ('card','atm','apple','google') or delivery is null or delivery not in ('delivery','onsite_pickup') then
    raise exception 'Invalid payment or fulfillment method' using errcode='22023';
  end if;
  if coalesce(length(btrim(p_payload->>'member')),0) not between 1 and 100
    or coalesce(p_payload->>'phone','') !~ '^[0-9+() -]{9,20}$'
    or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_payload->>'email')>254
    or (delivery='delivery' and coalesce(length(btrim(p_payload->>'address')),0) not between 1 and 500)
    or length(coalesce(p_payload->>'note',''))>1000 then
    raise exception '請完整填寫收件姓名、手機、Email 與地址。' using errcode='22023';
  end if;
  if coalesce(p_payload->>'invoice_type','') not in ('personal','company')
    or (p_payload->>'invoice_type'='company' and (
      coalesce(length(btrim(p_payload->>'invoice_company_name')),0) not between 1 and 200
      or coalesce(p_payload->>'invoice_tax_id','') !~ '^[0-9]{8}$')) then
    raise exception 'Invalid invoice snapshot' using errcode='22023';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Invalid item count' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'items') entry where
    coalesce(entry->>'variant_id','') !~ '^[0-9]{1,18}$' or coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'
    or coalesce(entry->>'qty','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'unit_price','') !~ '^[0-9]{1,7}$') then
    raise exception 'Invalid item quantity or unit price' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items')) <> (select count(distinct entry->>'variant_id') from jsonb_array_elements(p_payload->'items') entry) then
    raise exception '同一規格請合併為一列。' using errcode='22023';
  end if;
  -- Deterministic locks used by payment/FIFO allocation too.
  perform 1 from public.product_variants where id in (select (entry->>'variant_id')::bigint
    from jsonb_array_elements(p_payload->'items') entry) order by id for update;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    quantity := (item->>'qty')::integer; unit_price := (item->>'unit_price')::numeric;
    if quantity<1 then raise exception 'Quantity must be positive' using errcode='22023'; end if;
    select * into target_variant from public.product_variants where id=(item->>'variant_id')::bigint
      and product_id=(item->>'product_id')::integer and active is true;
    if not found then raise exception 'Product variant unavailable' using errcode='22023'; end if;
    select * into target_product from public.products where id=target_variant.product_id
      and active is true and publication_status='active';
    if not found or (target_product.is_pro_only and member_role='consumer') then
      raise exception 'Product unavailable for this customer' using errcode='22023';
    end if;
    if not target_variant.is_custom_order and target_variant.stock<quantity then
      raise exception '商品 % % 現貨不足，請調整數量。',target_product.name_zh,target_variant.size using errcode='22023';
    end if;
    all_custom := all_custom and coalesce(target_variant.is_custom_order,false);
    all_free := all_free and target_product.id=9;
    suggested_price := case when member_role='consumer' then target_variant.price else
      round((case when (member_role='instructor' and target_product.instructor_price_multiplier=1)
        or (member_role='distributor' and target_product.distributor_price_multiplier=1)
        or (member_role='staff' and target_product.staff_price_multiplier=1)
        or (member_role='pro' and target_product.instructor_price_multiplier=1
          and target_product.distributor_price_multiplier=1 and target_product.staff_price_multiplier=1)
        then coalesce(target_variant.pro_price,0) else coalesce(nullif(target_variant.pro_price,0),target_variant.price) end)
        *public.resolve_product_price_multiplier(
        target_product,member_role,coalesce((select professional_price_multiplier from public.membership_tiers where role=member_role and active),1))) end;
    suggested_prices := suggested_prices || jsonb_build_array(jsonb_build_object('variant_id',target_variant.id,
      'suggested_unit_price',suggested_price,'final_unit_price',unit_price,'member_role',member_role));
    subtotal_amount := subtotal_amount+unit_price*quantity;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'product_id',target_product.id,'id',target_product.id,'variant_id',target_variant.id,
      'sku',target_variant.sku,'name',target_product.name_zh,'nameZh',target_product.name_zh,
      'size',target_variant.size,'qty',quantity,'price',unit_price,'unit_price',unit_price,'line_total',unit_price*quantity,
      'is_custom_order',target_variant.is_custom_order,'stock_at_order',target_variant.stock,
      'fulfillment_type',case when target_variant.stock>=quantity then 'in_stock' else 'preorder' end));
  end loop;
  if subtotal_amount<1 then raise exception 'Order requires at least NT$1 payment' using errcode='22023'; end if;
  if delivery='onsite_pickup' and not all_custom then raise exception 'Only custom-order products support pickup' using errcode='22023'; end if;
  if member_role in ('pro','instructor','distributor') and subtotal_amount<5000
    and coalesce(length(btrim(p_payload->>'minimum_reason')),0) not between 1 and 1000 then
    raise exception '低於最低訂購額，請填寫例外原因。' using errcode='22023';
  end if;
  default_shipping := case when delivery='onsite_pickup' or member_role='staff' or all_free
    or (member_role in ('pro','instructor','distributor') and subtotal_amount>=15000) then 0 else 120 end;
  case p_payload->>'shipping_mode'
    when 'default' then shipping_amount := default_shipping;
    when 'free' then shipping_amount := 0;
    when 'custom' then
      if coalesce(p_payload->>'shipping_amount','') !~ '^[0-9]{1,7}$' then raise exception 'Invalid shipping amount' using errcode='22023'; end if;
      shipping_amount := (p_payload->>'shipping_amount')::numeric;
    else raise exception 'Invalid shipping mode' using errcode='22023';
  end case;
  if shipping_amount<>default_shipping and coalesce(length(btrim(p_payload->>'shipping_reason')),0) not between 1 and 1000 then
    raise exception '運費異動需填寫原因。' using errcode='22023';
  end if;
  created_order_id := 'ECL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  snapshot := jsonb_build_object('version',1,'source','admin_assisted','member_role',member_role,
    'subtotal',subtotal_amount,'discount',0,'shipping',shipping_amount,'total',subtotal_amount+shipping_amount,
    'shopping_credit_amount',0,'payment_amount',subtotal_amount+shipping_amount,'items',lines);
  perform set_config('app.assisted_order_create','1',true);
  perform set_config('app.eclado_order_shopping_credit_amount','0',true);
  insert into public.orders(id,user_id,member,type,items,subtotal,discount,total,payment_amount,shopping_credit_amount,
    status,date,address,phone,email,note,fulfillment_method,invoice_type,invoice_company_name,invoice_tax_id,
    pricing_snapshot,order_source,assisted_payment_method,payment_due_at)
  values (created_order_id,member_id,btrim(p_payload->>'member'),member_role,lines,subtotal_amount,0,subtotal_amount+shipping_amount,
    subtotal_amount+shipping_amount,0,case when method='atm' then 'awaiting_confirm' else 'unpaid' end,
    (now() at time zone 'Asia/Taipei')::date::text,coalesce(p_payload->>'address',''),p_payload->>'phone',p_payload->>'email',
    coalesce(p_payload->>'note',''),delivery,p_payload->>'invoice_type',
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_company_name' end,
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_tax_id' end,
    snapshot,'admin_assisted',method,now()+interval '48 hours');
  perform set_config('app.assisted_order_create','0',true);
  insert into public.order_payment_authorizations(order_id,token_hash,provider_order_no,attempt_no)
    values(created_order_id,encode(digest(request_row.payment_token,'sha256'),'hex'),created_order_id,1);
  update public.assisted_order_requests set order_id=created_order_id,pricing_context=suggested_prices where request_key=p_request_key;
  return jsonb_build_object('order_id',created_order_id,'link_token',request_row.link_token,'recovered',false);
end;
$$;
revoke all on function public.create_assisted_order(uuid,jsonb) from public,anon;
grant execute on function public.create_assisted_order(uuid,jsonb) to authenticated;

create or replace function public.get_admin_assisted_link(p_order_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then raise exception 'Admin required' using errcode='42501'; end if;
  select jsonb_build_object('order_id',order_id,'link_token',link_token,
    'actor_user_id',actor_user_id,'created_at',created_at,'pricing_context',pricing_context,
    'minimum_reason',payload->>'minimum_reason','shipping_reason',payload->>'shipping_reason') into result
    from public.assisted_order_requests where order_id=p_order_id;
  if result is null then raise exception 'Assisted order not found' using errcode='22023'; end if;
  return result;
end;
$$;
revoke all on function public.get_admin_assisted_link(text) from public,anon;
grant execute on function public.get_admin_assisted_link(text) to authenticated;

create or replace function public.get_admin_assisted_request(p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then raise exception 'Admin required' using errcode='42501'; end if;
  if exists(select 1 from public.assisted_order_requests where request_key=p_request_key and actor_user_id<>auth.uid()) then
    raise exception '此開單紀錄屬於其他管理員，請使用原帳號找回或在訂單管理確認。' using errcode='42501';
  end if;
  select jsonb_build_object('order_id',order_id,'link_token',link_token) into result
    from public.assisted_order_requests where request_key=p_request_key and actor_user_id=auth.uid();
  return result;
end;
$$;
revoke all on function public.get_admin_assisted_request(uuid) from public,anon;
grant execute on function public.get_admin_assisted_request(uuid) to authenticated;

-- Server-only credential exchange. Never grant this RPC to browsers.
create or replace function public.authorize_assisted_link(p_order_id text,p_link_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_row public.assisted_order_requests%rowtype; target_order public.orders%rowtype;
begin
  if coalesce(p_link_token,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid order link' using errcode='42501'; end if;
  select * into request_row from public.assisted_order_requests where order_id=p_order_id and link_token=p_link_token;
  if not found then raise exception 'Invalid order link' using errcode='42501'; end if;
  select * into target_order from public.orders where id=p_order_id and order_source='admin_assisted';
  if not found or target_order.payment_due_at<=now() then raise exception '訂單連結已到期，請使用原有訂單查詢入口。' using errcode='42501'; end if;
  return jsonb_build_object('payment_token',request_row.payment_token,'payment_method',target_order.assisted_payment_method);
end;
$$;
revoke all on function public.authorize_assisted_link(text,text) from public,anon,authenticated;
grant execute on function public.authorize_assisted_link(text,text) to service_role;

-- A new assisted payment claim is never released on ambiguous network failure.
-- Only an explicit gateway rejection permits another attempt of the same ID.
create or replace function public.resolve_assisted_payment_claim(p_order_id text,p_payment_token text,p_outcome text)
returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if p_outcome not in ('success','rejected') or p_outcome is null then raise exception 'Invalid claim outcome'; end if;
  update public.order_payment_authorizations payment_auth set
    claimed_at=case when p_outcome='rejected' then null else claimed_at end,
    gateway_created_at=case when p_outcome='success' then coalesce(gateway_created_at,now()) else gateway_created_at end
  where payment_auth.order_id=p_order_id and payment_auth.token_hash=encode(digest(p_payment_token,'sha256'),'hex')
    and exists(select 1 from public.orders where id=p_order_id and order_source='admin_assisted');
  if not found then raise exception 'Invalid assisted payment claim' using errcode='42501'; end if;
end;
$$;
revoke all on function public.resolve_assisted_payment_claim(text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_assisted_payment_claim(text,text,text) to service_role;
notify pgrst,'reload schema';
commit;

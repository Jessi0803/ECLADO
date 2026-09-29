-- 修正：get_my_appendable_shipping_group 內的變數名稱與保留字 current_role 相撞。
-- PL/pgSQL 讀取運算式時會把 current_role 解析成保留字（連線角色名稱，例如
-- authenticated），而不是宣告的變數，導致身分檢查永遠不成立、函式一律回傳 null。
-- 變數改名為 member_role。此檔可重複執行。

create or replace function public.get_my_appendable_shipping_group()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  member_role text;
  group_count integer;
  target_group public.shipping_groups%rowtype;
  effective_total numeric;
  valid_order_count integer;
  pending_order_count integer;
  legacy_candidate_count integer;
  legacy_order_id text;
  legacy_order public.orders%rowtype;
  created_group_id uuid;
begin
  if current_user_id is null then
    return null;
  end if;

  select profile.role into member_role
  from public.profiles profile
  where profile.id = current_user_id;

  if not public.is_professional_shipping_role(member_role) then
    return null;
  end if;

  -- Safe lazy compatibility for a single pre-migration paid order. Multiple
  -- candidates are deliberately not guessed or merged.
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  if not exists (
    select 1 from public.shipping_groups existing_group
    where existing_group.user_id = current_user_id
      and existing_group.status = 'open'
  ) then
    select count(*), min(target_order.id)
    into legacy_candidate_count, legacy_order_id
    from public.orders target_order
    where target_order.user_id = current_user_id
      and target_order.shipping_group_id is null
      and target_order.fulfillment_method = 'delivery'
      and target_order.status = 'paid'
      and public.shipping_group_effective_amount(target_order) >= 5000;

    if legacy_candidate_count > 1 then
      raise exception '此會員有多張可追加的舊訂單，請聯繫客服確認出貨批次'
        using errcode = '55000';
    elsif legacy_candidate_count = 1 then
      select * into legacy_order
      from public.orders target_order
      where target_order.id = legacy_order_id
      for update;

      insert into public.shipping_groups (
        user_id, status, fulfillment_method, original_order_id,
        original_shipping_amount
      ) values (
        current_user_id, 'open', 'delivery', legacy_order.id,
        floor(greatest(0, coalesce((legacy_order.pricing_snapshot ->> 'shipping')::numeric, 0)))::bigint
      )
      returning id into created_group_id;

      perform set_config('app.eclado_shipping_group_write', '1', true);
      update public.orders
      set shipping_group_id = created_group_id
      where id = legacy_order.id
        and shipping_group_id is null;
      perform set_config('app.eclado_shipping_group_write', '0', true);
    end if;
  end if;

  select count(*) into group_count
  from public.shipping_groups shipping_group
  where shipping_group.user_id = current_user_id
    and shipping_group.status = 'open'
    and exists (
      select 1
      from public.orders target_order
      where target_order.shipping_group_id = shipping_group.id
        and public.is_shipping_group_valid_order_status(target_order.status)
    );

  if group_count > 1 then
    raise exception '此會員有多個可追加出貨批次，請聯繫客服確認'
      using errcode = '55000';
  end if;
  if group_count = 0 then
    return null;
  end if;

  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.user_id = current_user_id
    and shipping_group.status = 'open'
    and exists (
      select 1
      from public.orders target_order
      where target_order.shipping_group_id = shipping_group.id
        and public.is_shipping_group_valid_order_status(target_order.status)
    )
  order by shipping_group.created_at, shipping_group.id
  limit 1;

  select
    coalesce(sum(
      case
        when public.is_shipping_group_valid_order_status(target_order.status)
          then public.shipping_group_effective_amount(target_order)
        else 0
      end
    ), 0),
    count(*) filter (
      where public.is_shipping_group_valid_order_status(target_order.status)
    ),
    count(*) filter (
      where target_order.status in ('awaiting_confirm', 'unpaid')
    )
  into effective_total, valid_order_count, pending_order_count
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id;

  return jsonb_build_object(
    'id', target_group.id,
    'status', target_group.status,
    'original_order_id', target_group.original_order_id,
    'original_shipping_amount', target_group.original_shipping_amount,
    'effective_total', effective_total,
    'valid_order_count', valid_order_count,
    'pending_order_count', pending_order_count,
    'free_shipping', effective_total >= 15000,
    'shipping_refunded', target_group.shipping_refund_ledger_id is not null
  );
end;
$$;
revoke all on function public.get_my_appendable_shipping_group() from public, anon;
grant execute on function public.get_my_appendable_shipping_group() to authenticated;

notify pgrst, 'reload schema';

-- 批次出貨：把同一個出貨批次內可出貨的訂單，在一次交易內一起標記為已出貨。
-- 單張出貨流程不受影響，仍可照舊使用。
--
-- 規則（全部在資料庫判斷，前端只負責顯示）：
--   已取消 / 退貨            → 忽略，不計入也不更動
--   等待匯款 / 未付款        → 擋下整批（未付款的追加單日後會免運單獨寄出，運費由公司吸收）
--   已出貨 / 已到貨 / 已取貨 → 跳過，只出剩下的
--   已付款 / 備貨中          → 這次要出貨的對象
-- 任何一步失敗整批不變；沒有可出貨的訂單也會擋下。
-- 出貨時間與物流商由既有的 trg_orders_shipment_metadata 補上。

create or replace function public.ship_shipping_group(
  p_group_id uuid,
  p_tracking text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group public.shipping_groups%rowtype;
  normalized_tracking text := nullif(btrim(coalesce(p_tracking, '')), '');
  unpaid_ids text[];
  shipped_ids text[];
  skipped_ids text[];
begin
  if not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write access required' using errcode = '42501';
  end if;
  if normalized_tracking is null then
    raise exception '請輸入順豐托運單號' using errcode = '22023';
  end if;

  select * into target_group
  from public.shipping_groups
  where id = p_group_id
  for update;
  if not found then
    raise exception '找不到出貨批次' using errcode = 'P0002';
  end if;

  select
    coalesce(array_agg(target_order.id) filter (
      where target_order.status in ('awaiting_confirm', 'unpaid')
    ), '{}'),
    coalesce(array_agg(target_order.id) filter (
      where target_order.status in ('paid', 'preparing')
    ), '{}'),
    coalesce(array_agg(target_order.id) filter (
      where target_order.status in ('shipped', 'delivered', 'picked_up', 'ready_for_pickup')
    ), '{}')
  into unpaid_ids, shipped_ids, skipped_ids
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id;

  if cardinality(unpaid_ids) > 0 then
    raise exception '此批次還有 % 張未付款訂單，請先確認付款或取消後再出貨',
      cardinality(unpaid_ids)
      using errcode = '22023';
  end if;
  if cardinality(shipped_ids) = 0 then
    raise exception '此批次沒有可出貨的訂單' using errcode = '22023';
  end if;

  update public.orders
  set status = 'shipped',
      tracking = normalized_tracking,
      shipping_carrier = 'sf_express'
  where id = any(shipped_ids);

  return jsonb_build_object(
    'group_id', target_group.id,
    'tracking', normalized_tracking,
    'shipped_order_ids', to_jsonb(shipped_ids),
    'skipped_order_ids', to_jsonb(skipped_ids)
  );
end;
$$;

revoke all on function public.ship_shipping_group(uuid, text) from public, anon;
grant execute on function public.ship_shipping_group(uuid, text) to authenticated;

comment on function public.ship_shipping_group(uuid, text) is
  'Ships every shippable order in a professional shipping group in one transaction. Blocks while unpaid orders remain; already shipped orders are skipped.';

notify pgrst, 'reload schema';

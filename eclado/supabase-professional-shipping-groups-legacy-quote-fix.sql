-- 修正：追加單在建單時仍被舊版「專業會員單筆最低 NT$5,000」擋下。
--
-- quote_order_pricing_discount_v2 會先呼叫 quote_order_pricing(p_items, fulfillment)
-- 取得基礎報價，而該路徑底層的 quote_order_pricing_internal_20260916 仍保有舊的
-- 最低金額檢查。v2 還沒判斷追加單資格，底層就已經丟出例外。
--
-- 正式資料庫的 internal 版本與本專案任何檔案都不相同（曾被後續調整修改），
-- 因此這裡不重寫整支函式，而是讀出當下定義後只替換那一段檢查，其餘保持原樣。
-- 找不到預期片段就直接中止，不做任何修改。可重複執行：已修正過會略過。
--
-- 例外條件刻意使用唯讀查詢，而不是 get_my_appendable_shipping_group()：後者會
-- 取得 advisory lock、補建群組，並在會員有多張舊訂單時丟例外，不適合放在報價路徑。

do $migration$
declare
  target regprocedure := 'public.quote_order_pricing_internal_20260916(jsonb,text)';
  definition text;
  patched text;
  guard constant text := 'shipping_groups';
begin
  if to_regprocedure(target::text) is null then
    raise exception '找不到 % ，請確認定價 migration 已執行', target;
  end if;

  definition := pg_get_functiondef(target::oid);

  if position(guard in definition) > 0 then
    raise notice '% 已包含追加單例外，略過', target;
    return;
  end if;

  patched := regexp_replace(
    definition,
    $pattern$raise\s+exception\s+'Professional member order minimum is TWD 5000'\s*using\s+errcode\s*=\s*'22023'\s*;$pattern$,
    $replacement$if not exists (
      select 1
      from public.shipping_groups appendable_group
      where appendable_group.user_id = auth.uid()
        and appendable_group.status = 'open'
        and exists (
          select 1
          from public.orders grouped_order
          where grouped_order.shipping_group_id = appendable_group.id
            and grouped_order.status in (
              'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
            )
        )
    ) then
      raise exception 'Professional member order minimum is TWD 5000' using errcode = '22023';
    end if;$replacement$,
    'gi'
  );

  if patched = definition then
    raise exception '找不到預期的最低金額檢查片段，未修改 %', target;
  end if;

  execute patched;
  raise notice '% 已加入追加單例外', target;
end;
$migration$;

-- 權限沿用原定義（create or replace 不會改變 ACL），這裡再確認一次。
revoke all on function public.quote_order_pricing_internal_20260916(jsonb, text)
  from public, anon, authenticated;

comment on function public.quote_order_pricing_internal_20260916(jsonb, text) is
  'Internal authoritative pricing implementation. Direct client execution is forbidden; use quote_order_pricing wrappers. Professional minimum is waived while the member has an appendable shipping group.';

notify pgrst, 'reload schema';

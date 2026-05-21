-- ============================================================================
-- ECLADO 活動折扣計算順序欄位
-- 既有 promotions 表請執行本檔一次
-- ============================================================================

alter table public.promotions
  add column if not exists discount_order text not null default 'rate_then_amount';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'promotions_discount_order_check'
      and conrelid = 'public.promotions'::regclass
  ) then
    alter table public.promotions
      add constraint promotions_discount_order_check
      check (discount_order in ('rate_then_amount', 'amount_then_rate'));
  end if;
end $$;

comment on column public.promotions.discount_order is
  'rate_then_amount=先打折再減金額；amount_then_rate=先減金額再打折';

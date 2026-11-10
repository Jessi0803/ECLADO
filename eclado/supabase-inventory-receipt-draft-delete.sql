begin;

create or replace function public.delete_inventory_receipt_draft(p_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  source_order_id bigint;
  receipt public.inventory_receipts%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('procurement.manage') then
    raise exception '沒有入庫管理權限。' using errcode = '42501';
  end if;

  -- Use the same purchase-order lock as opening a linked draft.
  select purchase_order_id into source_order_id from public.inventory_receipts where id = p_id;
  if source_order_id is not null then
    perform 1 from public.purchase_orders where id = source_order_id for update;
  end if;
  select * into receipt from public.inventory_receipts where id = p_id for update;
  if not found then
    raise exception '找不到入庫單。' using errcode = 'P0002';
  end if;
  if receipt.posted_at is not null then
    raise exception '已確認入庫的單據不可刪除。' using errcode = '22023';
  end if;
  if receipt.version is distinct from p_version then
    raise exception '入庫單已更新，請重新開啟後再刪除。' using errcode = '40001';
  end if;

  delete from public.inventory_receipt_items where receipt_id = p_id;
  delete from public.inventory_receipts where id = p_id;
end;
$$;

revoke all on function public.delete_inventory_receipt_draft(uuid,integer) from public, anon, authenticated;
grant execute on function public.delete_inventory_receipt_draft(uuid,integer) to authenticated;
notify pgrst, 'reload schema';

commit;

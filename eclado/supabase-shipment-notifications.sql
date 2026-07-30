-- ECLADO shipment and shipment-notification audit fields.
-- Run once in the Supabase SQL editor before deploying the matching frontend.

alter table public.orders
  add column if not exists shipping_carrier text,
  add column if not exists shipped_at timestamptz,
  add column if not exists shipment_notification_sent_at timestamptz,
  add column if not exists shipment_notification_channel text,
  add column if not exists shipment_notification_error text;

alter table public.orders
  drop constraint if exists orders_shipment_notification_channel_check;

alter table public.orders
  add constraint orders_shipment_notification_channel_check
  check (
    shipment_notification_channel is null
    or shipment_notification_channel in ('line', 'email')
  );

update public.orders
set
  shipping_carrier = coalesce(shipping_carrier, 'sf_express'),
  shipped_at = coalesce(shipped_at, updated_at, created_at)
where status in ('shipped', 'delivered')
  and tracking is not null
  and btrim(tracking) <> '';

create or replace function public.set_order_shipment_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    new.shipped_at := coalesce(new.shipped_at, now());
    if new.tracking is not null and btrim(new.tracking) <> '' then
      new.shipping_carrier := coalesce(new.shipping_carrier, 'sf_express');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_shipment_metadata on public.orders;
create trigger trg_orders_shipment_metadata
  before update of status, tracking on public.orders
  for each row execute function public.set_order_shipment_metadata();

create index if not exists idx_orders_shipment_notification
  on public.orders (status, shipment_notification_sent_at)
  where status = 'shipped';

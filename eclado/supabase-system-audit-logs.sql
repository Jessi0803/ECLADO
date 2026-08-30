-- ECLADO system/API audit log — phase 2
-- Run once in Supabase SQL Editor after supabase-admin-audit-logs.sql.
--
-- Extends the phase-1 administrator trail to successful service-role order
-- operations. Only order lifecycle fields are retained; request headers,
-- payment tokens, customer details and gateway secrets are never stored.

create or replace function public.audit_log_projection(
  table_name text,
  row_data jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case table_name
    when 'orders' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'status', row_data -> 'status',
      'tracking', row_data -> 'tracking',
      'shipping_carrier', row_data -> 'shipping_carrier',
      'shipped_at', row_data -> 'shipped_at',
      'payment_due_at', row_data -> 'payment_due_at',
      'payment_reminded_at', row_data -> 'payment_reminded_at',
      'payment_second_reminded_at', row_data -> 'payment_second_reminded_at',
      'shipment_notification_sent_at', row_data -> 'shipment_notification_sent_at',
      'shipment_notification_channel', row_data -> 'shipment_notification_channel'
    ))
    when 'order_payment_authorizations' then jsonb_strip_nulls(jsonb_build_object(
      'order_id', row_data -> 'order_id',
      'claimed_at', row_data -> 'claimed_at',
      'gateway_created_at', row_data -> 'gateway_created_at'
    ))
    when 'products' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'name', row_data -> 'name',
      'name_zh', row_data -> 'name_zh',
      'subtitle', row_data -> 'subtitle',
      'category', row_data -> 'category',
      'series', row_data -> 'series',
      'min_stock', row_data -> 'min_stock',
      'is_pro_only', row_data -> 'is_pro_only',
      'publication_status', row_data -> 'publication_status',
      'active', row_data -> 'active',
      'product_list_image_scale', row_data -> 'product_list_image_scale'
    ))
    when 'product_variants' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'product_id', row_data -> 'product_id',
      'sku', row_data -> 'sku',
      'size', row_data -> 'size',
      'price', row_data -> 'price',
      'pro_price', row_data -> 'pro_price',
      'stock', row_data -> 'stock',
      'is_default', row_data -> 'is_default',
      'sort_order', row_data -> 'sort_order',
      'active', row_data -> 'active'
    ))
    when 'product_images' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'product_id', row_data -> 'product_id',
      'storage_path', row_data -> 'storage_path',
      'original_name', row_data -> 'original_name',
      'alt_text', row_data -> 'alt_text',
      'sort_order', row_data -> 'sort_order',
      'is_primary', row_data -> 'is_primary',
      'active', row_data -> 'active'
    ))
    when 'profiles' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'name', row_data -> 'name',
      'role', row_data -> 'role'
    ))
    when 'professional_applications' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'user_id', row_data -> 'user_id',
      'status', row_data -> 'status',
      'source', row_data -> 'source'
    ))
    when 'promotions' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'name', row_data -> 'name',
      'product_ids', row_data -> 'product_ids',
      'discount_rate', row_data -> 'discount_rate',
      'discount_amount', row_data -> 'discount_amount',
      'discount_order', row_data -> 'discount_order',
      'start_at', row_data -> 'start_at',
      'end_at', row_data -> 'end_at',
      'active', row_data -> 'active'
    ))
    when 'admin_users' then jsonb_strip_nulls(jsonb_build_object(
      'user_id', row_data -> 'user_id',
      'role', row_data -> 'role',
      'active', row_data -> 'active',
      'created_by', row_data -> 'created_by'
    ))
    else '{}'::jsonb
  end;
$$;

revoke all on function public.audit_log_projection(text, jsonb) from public;

create or replace function public.capture_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  jwt_role text := coalesce(nullif(auth.role(), ''), auth.jwt() ->> 'role');
  actor_admin_role text;
  actor_kind text;
  is_admin_action boolean := false;
  is_system_action boolean := false;
  old_projection jsonb;
  new_projection jsonb;
  entity_row jsonb;
  entity_key text := tg_argv[0];
  entity_name text := tg_table_name;
  action_name text := tg_table_name || '.' || lower(tg_op);
  request_headers jsonb := '{}'::jsonb;
  audit_source text := 'database_trigger';
begin
  is_admin_action := actor_id is not null and public.is_eclado_admin();
  is_system_action := jwt_role = 'service_role'
    and tg_table_name in ('orders', 'order_payment_authorizations');

  if not is_admin_action and not is_system_action then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- PostgREST makes request headers available as a transaction setting. Read
  -- only the explicit audit source label; never persist the complete headers.
  begin
    request_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    request_headers := '{}'::jsonb;
  end;
  audit_source := coalesce(
    nullif(request_headers ->> 'x-eclado-audit-source', ''),
    case when is_system_action then 'service-role' else 'database-trigger' end
  );

  if is_admin_action then
    select role into actor_admin_role
    from public.admin_users
    where user_id = actor_id and active = true;
    actor_kind := 'admin';
  else
    actor_admin_role := jwt_role;
    actor_kind := case
      when audit_source in ('sinopac-notify', 'payment-api', 'payment-return', 'sinopac-webhook') then 'api'
      else 'system'
    end;
  end if;

  old_projection := case when tg_op = 'INSERT' then null
    else public.audit_log_projection(tg_table_name, to_jsonb(old)) end;
  new_projection := case when tg_op = 'DELETE' then null
    else public.audit_log_projection(tg_table_name, to_jsonb(new)) end;

  if tg_op = 'UPDATE' and old_projection is not distinct from new_projection then
    return new;
  end if;

  -- Transient gateway claims are intentionally omitted. A record is created
  -- only after the gateway payment order was successfully established.
  if tg_table_name = 'order_payment_authorizations' then
    if tg_op <> 'UPDATE'
      or (old_projection -> 'gateway_created_at') is not distinct from (new_projection -> 'gateway_created_at')
      or (new_projection -> 'gateway_created_at') is null
    then
      return new;
    end if;
    entity_name := 'orders';
    entity_key := 'order_id';
    action_name := 'orders.payment_created';
  elsif tg_table_name = 'orders' and tg_op = 'UPDATE' then
    if (old_projection -> 'status') is distinct from (new_projection -> 'status')
      and new_projection ->> 'status' = 'paid'
    then
      action_name := 'orders.payment_paid';
    elsif (old_projection -> 'status') is distinct from (new_projection -> 'status')
      and new_projection ->> 'status' = 'cancelled'
    then
      action_name := case
        when audit_source in ('cancel-expired-orders', 'vultr-expire-overdue')
          then 'orders.expired_cancelled'
        else 'orders.cancelled'
      end;
    elsif (old_projection -> 'payment_second_reminded_at')
      is distinct from (new_projection -> 'payment_second_reminded_at')
    then
      action_name := 'orders.payment_second_reminder_sent';
    elsif (old_projection -> 'payment_reminded_at')
      is distinct from (new_projection -> 'payment_reminded_at')
    then
      action_name := 'orders.payment_reminder_sent';
    elsif (old_projection -> 'shipment_notification_sent_at')
      is distinct from (new_projection -> 'shipment_notification_sent_at')
    then
      action_name := 'orders.shipment_notification_sent';
    end if;
  end if;

  entity_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    case when is_admin_action then actor_id else null end,
    case when is_admin_action then nullif(auth.jwt() ->> 'email', '') else null end,
    actor_admin_role,
    actor_kind,
    action_name,
    entity_name,
    coalesce(entity_row ->> entity_key, 'unknown'),
    old_projection,
    new_projection,
    jsonb_build_object('source', audit_source)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.capture_admin_audit_log() from public;

drop trigger if exists trg_audit_order_payment_authorizations
  on public.order_payment_authorizations;
create trigger trg_audit_order_payment_authorizations
  after insert or update or delete on public.order_payment_authorizations
  for each row execute function public.capture_admin_audit_log('order_id');

-- Verification: the query remains admin-only through phase-1 RLS.
select id, created_at, actor_type, action, entity_type, entity_id, metadata
from public.audit_logs
order by created_at desc
limit 20;

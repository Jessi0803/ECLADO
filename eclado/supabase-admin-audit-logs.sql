-- ECLADO administrator audit log — phase 1
-- Run once in Supabase SQL Editor after supabase-admin-users.sql and the core tables exist.
--
-- Records successful authenticated administrator changes to orders, catalog,
-- member roles, professional applications and promotions. Sensitive customer,
-- authentication and payment fields are intentionally excluded.

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  actor_type text not null default 'admin' check (actor_type in ('admin', 'system', 'api')),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  request_id uuid not null default gen_random_uuid()
);

comment on table public.audit_logs is
  'Append-only audit trail for successful ECLADO administrator and system actions.';

create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_user_id, created_at desc);
create index if not exists idx_audit_logs_action
  on public.audit_logs (action, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin"
  on public.audit_logs for select to authenticated
  using (public.is_eclado_admin());

-- Keep the log append-only, including for service-role requests. A future
-- retention migration must explicitly disable this trigger during cleanup.
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit logs are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.prevent_audit_log_mutation() from public;

drop trigger if exists trg_prevent_audit_log_mutation on public.audit_logs;
create trigger trg_prevent_audit_log_mutation
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();

-- Only retain fields required to understand the administrative change.
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
      'shipment_notification_sent_at', row_data -> 'shipment_notification_sent_at',
      'shipment_notification_channel', row_data -> 'shipment_notification_channel'
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
  actor_admin_role text;
  old_projection jsonb;
  new_projection jsonb;
  entity_row jsonb;
  entity_key text := tg_argv[0];
begin
  -- Customer and service-role changes belong to later system-event phases.
  if actor_id is null or not public.is_eclado_backoffice_user() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select role into actor_admin_role
  from public.admin_users
  where user_id = actor_id and active = true;

  old_projection := case when tg_op = 'INSERT' then null
    else public.audit_log_projection(tg_table_name, to_jsonb(old)) end;
  new_projection := case when tg_op = 'DELETE' then null
    else public.audit_log_projection(tg_table_name, to_jsonb(new)) end;

  -- Skip updates where only non-audited fields (for example updated_at) changed.
  if tg_op = 'UPDATE' and old_projection is not distinct from new_projection then
    return new;
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
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_admin_role,
    'admin',
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(entity_row ->> entity_key, 'unknown'),
    old_projection,
    new_projection,
    jsonb_build_object('source', 'database_trigger')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.capture_admin_audit_log() from public;

drop trigger if exists trg_audit_orders on public.orders;
create trigger trg_audit_orders after insert or update or delete on public.orders
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_products on public.products;
create trigger trg_audit_products after insert or update or delete on public.products
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_product_variants on public.product_variants;
create trigger trg_audit_product_variants after insert or update or delete on public.product_variants
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_product_images on public.product_images;
create trigger trg_audit_product_images after insert or update or delete on public.product_images
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_professional_applications on public.professional_applications;
create trigger trg_audit_professional_applications after insert or update or delete on public.professional_applications
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_promotions on public.promotions;
create trigger trg_audit_promotions after insert or update or delete on public.promotions
  for each row execute function public.capture_admin_audit_log('id');

drop trigger if exists trg_audit_admin_users on public.admin_users;
create trigger trg_audit_admin_users after insert or update or delete on public.admin_users
  for each row execute function public.capture_admin_audit_log('user_id');

-- Verification: only administrators should receive rows.
select id, created_at, actor_email, action, entity_type, entity_id
from public.audit_logs
order by created_at desc
limit 20;

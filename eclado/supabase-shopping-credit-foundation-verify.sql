-- Read-only verification for supabase-shopping-credit-foundation.sql.

select
  to_regclass('public.shopping_credit_accounts') is not null as accounts_ready,
  to_regclass('public.shopping_credit_ledger') is not null as ledger_ready,
  to_regclass('public.shopping_credit_order_reservations') is not null as reservations_ready,
  to_regprocedure('public.adjust_member_shopping_credit(uuid,text,bigint,text,text,uuid)') is not null as adjust_rpc_ready,
  to_regprocedure('public.get_my_shopping_credit()') is not null as member_query_ready,
  to_regprocedure('public.get_member_shopping_credit(uuid)') is not null as admin_query_ready,
  to_regprocedure('public.reconcile_member_shopping_credit(uuid)') is not null as reconciliation_ready,
  to_regprocedure('public.reserve_order_shopping_credit(uuid,text,bigint)') is not null as reserve_helper_ready,
  to_regprocedure('public.consume_order_shopping_credit(text)') is not null as consume_helper_ready,
  to_regprocedure('public.release_order_shopping_credit(text,text)') is not null as release_helper_ready,
  to_regprocedure('public.refund_order_shopping_credit(text)') is not null as refund_helper_ready;

select role, permission
from public.backoffice_role_permissions
where permission = 'shopping_credit.manage'
order by role;

select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where oid in (
  'public.shopping_credit_accounts'::regclass,
  'public.shopping_credit_ledger'::regclass,
  'public.shopping_credit_order_reservations'::regclass
)
order by relname;

select
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.shopping_credit_ledger'::regclass
      and tgname = 'trg_prevent_shopping_credit_ledger_mutation'
      and not tgisinternal
  ) as ledger_append_only_trigger_ready,
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'shopping_credit_ledger_order_event_unique_idx'
  ) as order_event_idempotency_index_ready;

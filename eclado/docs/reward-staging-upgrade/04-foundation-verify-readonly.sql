-- TEST ONLY: consolidated 1B check results
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object('schema',(SELECT to_jsonb(c) FROM (select
  to_regclass('public.student_pricing_settings') is not null as global_settings_ready,
  to_regclass('public.instructor_student_settings') is not null as instructor_settings_ready,
  to_regclass('public.instructor_student_bindings') is not null as bindings_ready,
  to_regclass('public.instructor_student_audit_logs') is not null as audit_ready,
  exists(select 1 from pg_indexes where schemaname='public'
    and indexname='instructor_student_one_active_student_idx'
    and indexdef like 'CREATE UNIQUE INDEX%WHERE (ended_at IS NULL)') as student_unique,
  not exists(select 1 from pg_class c where c.oid in (
    'public.student_pricing_settings'::regclass,'public.instructor_student_settings'::regclass,
    'public.instructor_student_bindings'::regclass,'public.instructor_student_audit_logs'::regclass)
    and (not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')
      or has_table_privilege('anon',c.oid,'SELECT')
      or has_table_privilege('anon',c.oid,'INSERT')
      or has_table_privilege('anon',c.oid,'UPDATE')
      or has_table_privilege('anon',c.oid,'DELETE'))) as direct_clients_denied,
  exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
    and tgname='trg_end_instructor_student_bindings' and tgenabled='O') as deletion_cleanup_ready,
  exists(select 1 from pg_trigger where tgrelid='public.instructor_student_audit_logs'::regclass
    and tgname='trg_instructor_student_audit_immutable' and tgenabled='O') as audit_immutable,
  exists(select 1 from public.backoffice_role_permissions where role='admin' and permission='instructor_students.manage')
    and exists(select 1 from public.backoffice_role_permissions where role='super_admin' and permission='instructor_students.manage') as admin_permissions_ready) c),'rpc_acl',(SELECT jsonb_agg(to_jsonb(c)) FROM (select signature,not has_function_privilege('anon',signature,'EXECUTE') as anon_denied,
  has_function_privilege('authenticated',signature,'EXECUTE')=client_allowed as client_acl_correct
from (values
  ('public.get_admin_student_pricing_settings()',true),
  ('public.save_student_pricing_settings(jsonb,bigint)',true),
  ('public.get_admin_instructor_student_member(uuid)',true),
  ('public.get_admin_student_pricing_history()',true),
  ('public.set_instructor_student_price_type(uuid,text,bigint)',true),
  ('public.save_instructor_student_binding(uuid,uuid,uuid,text)',true),
  ('public.get_my_student_pricing_context()',true),
  ('public.get_my_instructor_students()',true),
  ('public.assert_instructor_student_admin(boolean)',false),
  ('public.instructor_student_context(uuid)',false),
  ('public.end_instructor_student_bindings_on_member_delete()',false),
  ('public.prevent_instructor_student_audit_mutation()',false)
) targets(signature,client_allowed)) c)) payload;
ROLLBACK;

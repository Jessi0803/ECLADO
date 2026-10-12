-- Phase 2A metadata only. No reward creation or feature activation.
begin transaction read only;
select jsonb_build_object(
  'student_prices_off',(select enabled=false from public.student_pricing_feature_settings where singleton),
  'snapshot_rls',(select relrowsecurity from pg_class where oid='public.student_reward_snapshots'::regclass),
  'no_client_or_service_table_access',(select bool_and(not has_table_privilege(role_name,
    'public.student_reward_snapshots','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    from unnest(array['anon','authenticated','service_role']) role_name),
  'no_direct_helper_access',(select bool_and(not has_function_privilege(role_name,signature,'EXECUTE'))
    from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array[
      'public.capture_student_reward_context(uuid,jsonb,text)',
      'public.calculate_student_reward_line(numeric,numeric,integer)',
      'public.persist_student_reward_snapshot(text,jsonb)',
      'public.reject_student_reward_snapshot_changes()']) signature),
  'no_snapshot_policies',not exists(select 1 from pg_policies where schemaname='public' and tablename='student_reward_snapshots'),
  'no_cascading_foreign_keys',not exists(select 1 from pg_constraint where conrelid='public.student_reward_snapshots'::regclass and contype='f'),
  'immutable_trigger',exists(select 1 from pg_trigger where tgrelid='public.student_reward_snapshots'::regclass
    and tgname='trg_student_reward_snapshot_immutable' and tgenabled='O'),
  'ordinary_capture_and_persist',position('public.capture_student_reward_context' in pg_get_functiondef(
    'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure))>0
    and position('public.persist_student_reward_snapshot' in pg_get_functiondef(
    'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure))>0,
  'assisted_capture_and_persist',position('public.capture_student_reward_context' in pg_get_functiondef(
    'public.create_assisted_order(uuid,jsonb)'::regprocedure))>0
    and position('public.persist_student_reward_snapshot' in pg_get_functiondef(
    'public.create_assisted_order(uuid,jsonb)'::regprocedure))>0
) as verification;
rollback;

-- Read-only post-install checks. Does not claim, enqueue or deliver notifications.
select jsonb_build_object(
 'outbox_ready',to_regclass('public.instructor_student_notification_outbox') is not null,
 'audit_trigger_ready',exists(select 1 from pg_trigger where tgrelid='public.instructor_student_audit_logs'::regclass and tgname='instructor_student_notice_enqueue' and tgenabled='O'),
 'rls_enabled',(select relrowsecurity from pg_class where oid='public.instructor_student_notification_outbox'::regclass),
 'no_member_table_access',not has_table_privilege('authenticated','public.instructor_student_notification_outbox','SELECT,INSERT,UPDATE,DELETE'),
 'no_worker_table_access',not has_table_privilege('service_role','public.instructor_student_notification_outbox','SELECT,INSERT,UPDATE,DELETE'),
 'worker_claim_only',has_function_privilege('service_role','public.claim_instructor_student_notifications(integer,text[],text)','EXECUTE') and not has_function_privilege('authenticated','public.claim_instructor_student_notifications(integer,text[],text)','EXECUTE'),
 'worker_completion_only',has_function_privilege('service_role','public.complete_instructor_student_notification(uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.complete_instructor_student_notification(uuid,uuid,text,text)','EXECUTE'),
 'admin_rpc_only',has_function_privilege('authenticated','public.get_admin_instructor_student_notifications(uuid,integer)','EXECUTE') and not has_function_privilege('anon','public.get_admin_instructor_student_notifications(uuid,integer)','EXECUTE')
) as verification;

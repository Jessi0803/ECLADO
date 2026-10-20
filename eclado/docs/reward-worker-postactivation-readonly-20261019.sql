begin transaction read only;
set local statement_timeout='10s';
select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'student_prices_enabled',(select enabled from public.student_pricing_feature_settings limit 1),
 'notice_total',(select count(*) from public.instructor_reward_notification_outbox),
 'withdrawal_total',(select count(*) from public.instructor_reward_withdrawals),
 'reconciliation_runs',(select count(*) from public.instructor_reward_reconciliation_runs),
 'latest_run',(select jsonb_build_object('status',status,'checked',checked_count,'findings',finding_count,'error_code',error_code,'snapshot_at',snapshot_at) from public.instructor_reward_reconciliation_runs order by created_at desc limit 1)
) as worker_post_activation;
rollback;

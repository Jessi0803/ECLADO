begin transaction read only;
set local statement_timeout='10s';
select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'student_prices_enabled',(select enabled from public.student_pricing_feature_settings limit 1),
 'notice_total',count(*),
 'notice_pending_or_retry',count(*) filter(where status in ('pending','retry')),
 'notice_due',count(*) filter(where status in ('pending','retry') and next_retry_at<=now()),
 'notice_sending',count(*) filter(where status='sending'),
 'notice_unknown',count(*) filter(where status='unknown'),
 'withdrawal_total',(select count(*) from public.instructor_reward_withdrawals),
 'withdrawal_open',(select count(*) from public.instructor_reward_withdrawals where status in ('pending','processing','unknown')),
 'reconciliation_runs',(select count(*) from public.instructor_reward_reconciliation_runs)
) as worker_preflight from public.instructor_reward_notification_outbox;
rollback;

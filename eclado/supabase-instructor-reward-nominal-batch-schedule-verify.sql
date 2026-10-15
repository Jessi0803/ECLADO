begin read only;
do $$
declare
 before_cutoff jsonb:=public.reward_withdrawal_schedule('2026-11-09 23:59:59+08');
 at_cutoff jsonb:=public.reward_withdrawal_schedule('2026-11-10 00:00:00+08');
 weekend jsonb:=public.reward_withdrawal_schedule('2026-10-09 00:00:00+08');
begin
 if before_cutoff<>jsonb_build_object('batch_date','2026-11-10','scheduled_date','2026-11-10') then raise exception 'Before-cutoff verification failed';end if;
 if at_cutoff<>jsonb_build_object('batch_date','2026-12-10','scheduled_date','2026-12-10') then raise exception 'Cutoff verification failed';end if;
 if weekend->>'scheduled_date'<>'2026-10-10' then raise exception 'Weekend must keep nominal date';end if;
 if to_regclass('public.instructor_reward_bank_calendar_versions') is not null or to_regprocedure('public.publish_reward_bank_calendar(integer,date[],text)') is not null then raise exception 'Calendar artifacts still exist';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='instructor_reward_withdrawals' and column_name='calendar_versions') then raise exception 'Legacy calendar snapshot still exists';end if;
 if position('calendar_versions' in pg_get_functiondef('public.request_my_reward_withdrawal(uuid,jsonb)'::regprocedure))>0 then raise exception 'Request RPC still references removed calendar column';end if;
end $$;
select jsonb_build_object('nominal_schedule',true,'calendar_artifacts_removed',true,'cutoff_timezone','Asia/Taipei','cutoff_day',10) verification;
rollback;

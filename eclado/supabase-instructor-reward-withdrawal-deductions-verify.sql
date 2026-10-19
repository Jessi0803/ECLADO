-- Run after withdrawal-deductions.sql. Read-only; no test financial rows.
begin read only;
do $$
declare q jsonb; c record;
begin
 for c in select * from (values (19999,0,0,19984),(20000,0,422,19563),(20001,2000,422,17564),(30000,3000,633,26352),(20166,2016,426,17709)) as cases(amount,tax,premium,net) loop
 q:=public.calculate_reward_withdrawal_deductions(c.amount);
 if (q->>'income_tax')::bigint is distinct from c.tax or (q->>'supplementary_premium')::bigint is distinct from c.premium
 or (q->>'net_amount')::bigint is distinct from c.net then raise exception 'Deduction boundary failed: %',c.amount;end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.instructor_reward_withdrawals'::regclass and conname='reward_withdrawal_deductions_check' and convalidated) then raise exception 'Deduction constraint missing';end if;
 if exists(select 1 from public.instructor_reward_withdrawals where net_amount<>amount-fee-income_tax-supplementary_premium) then raise exception 'Withdrawal total mismatch';end if;
 if has_function_privilege('anon','public.calculate_reward_withdrawal_deductions(bigint)','execute')
 or has_function_privilege('authenticated','public.calculate_reward_withdrawal_deductions(bigint)','execute') then raise exception 'Private calculator exposed';end if;
 if (position('calculate_reward_withdrawal_deductions' in pg_get_functiondef('public.quote_my_reward_withdrawal()'::regprocedure))=0
 and coalesce(position('calculate_reward_withdrawal_deductions' in pg_get_functiondef(to_regprocedure('public.quote_my_reward_withdrawal(bigint)'))),0)=0)
 or position('deduction_snapshot' in pg_get_functiondef('public.request_my_reward_withdrawal(uuid,jsonb)'::regprocedure))=0
 or position('income_tax' in pg_get_functiondef('public.export_reward_withdrawal_batch(uuid,date)'::regprocedure))=0
 or position('supplementary_premium' in pg_get_functiondef('public.queue_reward_withdrawal_notice()'::regprocedure))=0 then raise exception 'Deduction integration missing';end if;
end $$;
select 'withdrawal deduction verification passed' as result;
rollback;

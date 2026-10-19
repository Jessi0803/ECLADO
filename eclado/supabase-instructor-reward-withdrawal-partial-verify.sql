-- Run last; read-only verification, no bank calls or financial fixture writes.
begin read only;
do $$ begin
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
 where c.relname='reward_withdrawal_single_batch_idx' and i.indrelid='public.instructor_reward_withdrawals'::regclass
 and i.indisunique and i.indisvalid and i.indisready and pg_get_indexdef(i.indexrelid) like '%(user_id, batch_date)%'
 and pg_get_expr(i.indpred,i.indrelid) like '%status <>%failed%') then raise exception 'Single effective withdrawal per batch index missing';end if;
 if exists(select 1 from public.instructor_reward_withdrawals where status<>'failed' group by user_id,batch_date having count(*)>1) then raise exception 'Duplicate effective withdrawals';end if;
 if position('a.balance>=w.amount' in pg_get_functiondef('public.post_reward_withdrawal(uuid,text)'::regprocedure))=0
 or position('single_per_batch_v1' in pg_get_functiondef('public.quote_my_reward_withdrawal(bigint)'::regprocedure))=0
 or position('withdrawal_batch' in pg_get_functiondef('public.get_my_reward_withdrawals(integer)'::regprocedure))=0
 or position('p_expected_quote->' in pg_get_functiondef('public.request_my_reward_withdrawal(uuid,jsonb)'::regprocedure))=0 then raise exception 'Partial amount integration missing';end if;
 if has_function_privilege('anon','public.quote_my_reward_withdrawal(bigint)','execute')
 or has_function_privilege('service_role','public.quote_my_reward_withdrawal(bigint)','execute')
 or not has_function_privilege('authenticated','public.quote_my_reward_withdrawal(bigint)','execute')
 or has_function_privilege('authenticated','public.post_reward_withdrawal(uuid,text)','execute') then raise exception 'Withdrawal ACL mismatch';end if;
 if exists(select 1 from public.instructor_reward_withdrawals where net_amount<>amount-fee-income_tax-supplementary_premium) then raise exception 'Withdrawal total mismatch';end if;
end $$;
select 'partial withdrawal verification passed' as result;
rollback;

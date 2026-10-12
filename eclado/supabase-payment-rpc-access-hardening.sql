-- Payment RPC access repair. Apply after the current payment/assisted migrations.
-- ACL-only: preserve installed function bodies, signatures and payment guards.
-- Do not rerun historical payment migrations to repair production permissions.
begin;

revoke all on function public.begin_order_payment_retry(text)
  from public, anon, authenticated;
revoke all on function public.claim_order_payment(text, text)
  from public, anon, authenticated;

grant execute on function public.begin_order_payment_retry(text) to service_role;
grant execute on function public.claim_order_payment(text, text) to service_role;

-- Abort rather than silently leave an inherited client grant in effect.
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.begin_order_payment_retry(text)',
    'public.claim_order_payment(text,text)'
  ] loop
    if has_function_privilege('anon', signature, 'EXECUTE')
      or has_function_privilege('authenticated', signature, 'EXECUTE')
      or not has_function_privilege('service_role', signature, 'EXECUTE') then
      raise exception 'Payment RPC access invariant failed: %', signature;
    end if;
  end loop;
end;
$$;

commit;

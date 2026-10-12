-- Read-only deployment verification; no business RPC is executed.
begin transaction read only;
select signature,
  not has_function_privilege('anon', signature, 'EXECUTE') as anon_denied,
  not has_function_privilege('authenticated', signature, 'EXECUTE') as authenticated_denied,
  has_function_privilege('service_role', signature, 'EXECUTE') as service_role_allowed
from (values
  ('public.begin_order_payment_retry(text)'),
  ('public.claim_order_payment(text,text)')
) targets(signature);
rollback;

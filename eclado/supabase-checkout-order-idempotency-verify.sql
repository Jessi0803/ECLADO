-- Read-only installation check; does not create orders or expose capabilities.
select
  exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='checkout_order_requests' and c.relrowsecurity) as request_rls,
  not has_table_privilege('anon','public.checkout_order_requests','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.checkout_order_requests','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role','public.checkout_order_requests','SELECT,INSERT,UPDATE,DELETE') as private_rows,
  not has_function_privilege('anon','public.create_checkout_order_once(uuid,text,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.create_checkout_order_once(uuid,text,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.create_checkout_order_once(uuid,text,uuid,jsonb)','EXECUTE') as private_creator,
  has_function_privilege('anon','public.recover_checkout_order(uuid,text)','EXECUTE')
    and has_function_privilege('authenticated','public.recover_checkout_order(uuid,text)','EXECUTE') as recovery_entry,
  has_function_privilege('anon','public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb,uuid,text,uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb,uuid,text,uuid)','EXECUTE') as protected_creators,
  not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname='public' and p.proname in ('create_checkout_order_once','recover_checkout_order')
      and a.grantee=0 and a.privilege_type='EXECUTE') as no_public_helper_grants;

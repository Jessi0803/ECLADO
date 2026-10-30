-- PREPARED ONLY. Functional rollback; no schema or historical accounting changes.
-- Recheck the current version if this guard no longer matches.
begin;
set local lock_timeout='5s';
do $rollback$
begin
 if (select enabled from public.automatic_price_allocation_settings where singleton) is distinct from true then raise exception 'Allocation baseline differs';end if;
 perform 1 from public.promotion_student_policy_settings where singleton and enabled and version=2 for update;
 if not found then raise exception 'Policy version changed; review before rollback';end if;
 update public.promotion_student_policy_settings set enabled=false,version=version+1 where singleton;
end $rollback$;
commit;
select public.promotion_student_policy_enabled() as new_policy_enabled,public.automatic_price_allocation_enabled() as existing_allocation_enabled;

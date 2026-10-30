-- Production ilvdvlkdpntwmaijncaz. User requested rewards ON for nine pro Double Eleven activities.
-- Only instructor_reward_eligible and updated_at may change. No historical reward recalculation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.promotions in share row exclusive mode;
do $rewards$
declare ids uuid[]:=array['06906fd2-a796-4db2-9bd8-8397e9360f2e','130e6ba0-4111-4e17-9564-f2ac14d24d8a','1876ed80-ca9c-44ee-bb05-4c47ddae6799','49572111-a383-4cd4-a116-ad9ff30d3f47','9be5e4f9-f0d4-460e-a054-7a1aba1ca4ca','bc5aea6c-088b-46ab-addb-fb4071412f90','ced451c6-c8e7-4bdd-8835-35398e5e04a1','daf857ba-df5f-48ee-9875-ade66941edda','e1ac15b9-8050-47ce-9046-5f0b83e7e38a']::uuid[]; baseline jsonb; before_targets jsonb; after_targets jsonb; original jsonb; observed jsonb; changed integer;
begin
 if (select count(*)<>9 or not bool_and(audience_roles=array['pro']::text[] and active and archived_at is null and activation_type='automatic' and benefit_type='buy_x_get_y' and name ilike '11.11%' and not allow_student_price_stacking and not instructor_reward_eligible) from public.promotions where id=any(ids)) then raise exception 'Target policy or identity changed; recheck before update';end if;
 select jsonb_agg(to_jsonb(p) order by id) into baseline from public.promotions p;
 select jsonb_agg(to_jsonb(p) order by id) into before_targets from public.promotions p where id=any(ids);
 update public.promotions set instructor_reward_eligible=true,updated_at=clock_timestamp() where id=any(ids) and not instructor_reward_eligible;
 get diagnostics changed=row_count;
 if changed<>9 then raise exception 'Expected exactly nine reward changes';end if;
 for original in select value from jsonb_array_elements(baseline) loop
  select to_jsonb(p) into observed from public.promotions p where id=(original->>'id')::uuid;
  if (original->>'id')::uuid=any(ids) then
   if observed-'instructor_reward_eligible'-'updated_at' is distinct from original-'instructor_reward_eligible'-'updated_at' then raise exception 'Other target settings changed';end if;
  elsif observed is distinct from original then raise exception 'Other activity changed';end if;
 end loop;
 if (select count(*) from public.promotions where id=any(ids) and not allow_student_price_stacking and instructor_reward_eligible)<>9 then raise exception 'Final policy mismatch';end if;
 select jsonb_agg(to_jsonb(p) order by id) into after_targets from public.promotions p where id=any(ids);
 perform set_config('release.double_eleven_rewards',jsonb_build_object('captured_at',clock_timestamp(),'project_ref','ilvdvlkdpntwmaijncaz','changed_count',changed,'student_stacking_preserved',true,'other_activity_fields_preserved',true,'other_activities_preserved',true,'before',before_targets,'after',after_targets,'new_policy_enabled',public.promotion_student_policy_enabled(),'allocation_enabled',public.automatic_price_allocation_enabled())::text,true);
end $rewards$;
select current_setting('release.double_eleven_rewards')::jsonb as report;
commit;

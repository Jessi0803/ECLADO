-- Minimal compatibility patch for member-targeted coupons during storefront order creation.
-- Run after coupon member targeting and the installed coupon/gift order creator.
-- This does not change quote arithmetic, usage limits, inventory, payments, or rewards.
begin;

do $migration$
declare
  target_signature constant regprocedure :=
    'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
  legacy_predicate constant text :=
    $legacy$      and (quote_result ->> 'member_role') = any(target.audience_roles)
      and (current_user_id is not null or target.allow_guest = true)$legacy$;
  canonical_predicate constant text :=
    $canonical$      and public.coupon_campaign_allows_identity(target.id, quote_result ->> 'member_role')$canonical$;
  owner_before oid;
  acl_before aclitem[];
  owner_after oid;
  acl_after aclitem[];
begin
  if to_regprocedure('public.coupon_campaign_allows_identity(uuid,text)') is null then
    raise exception 'Coupon identity helper is required';
  end if;

  select proowner, proacl
    into owner_before, acl_before
  from pg_proc
  where oid = target_signature;

  definition := pg_get_functiondef(target_signature);

  if position(canonical_predicate in definition) = 0 then
    if position(legacy_predicate in definition) = 0 then
      raise exception 'Storefront coupon creator differs; compatibility patch stopped';
    end if;

    definition := replace(definition, legacy_predicate, canonical_predicate);
    if position(legacy_predicate in definition) > 0
      or position(canonical_predicate in definition) = 0 then
      raise exception 'Storefront coupon creator patch was not singular';
    end if;
    execute definition;
  elsif position(legacy_predicate in definition) > 0 then
    raise exception 'Storefront coupon creator contains mixed identity predicates';
  end if;

  select proowner, proacl
    into owner_after, acl_after
  from pg_proc
  where oid = target_signature;

  if owner_after is distinct from owner_before
    or acl_after is distinct from acl_before then
    raise exception 'Storefront coupon creator owner or ACL changed';
  end if;

  definition := pg_get_functiondef(target_signature);
  if position(canonical_predicate in definition) = 0
    or position(legacy_predicate in definition) > 0 then
    raise exception 'Storefront coupon creator compatibility verification failed';
  end if;
end
$migration$;

notify pgrst, 'reload schema';

commit;

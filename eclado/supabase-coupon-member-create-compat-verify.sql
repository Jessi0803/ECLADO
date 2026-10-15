begin read only;

do $verify$
declare
  definition text;
begin
  if to_regprocedure('public.coupon_campaign_allows_identity(uuid,text)') is null
    or to_regprocedure(
      'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'
    ) is null then
    raise exception 'Coupon compatibility dependencies are missing';
  end if;

  definition := pg_get_functiondef(
    'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure
  );

  if position(
    $expected$public.coupon_campaign_allows_identity(target.id, quote_result ->> 'member_role')$expected$
    in definition
  ) = 0 then
    raise exception 'Storefront creator does not use the coupon identity helper';
  end if;

  if position(
    $legacy$(quote_result ->> 'member_role') = any(target.audience_roles)$legacy$
    in definition
  ) > 0 then
    raise exception 'Legacy storefront coupon audience predicate remains';
  end if;
end
$verify$;

rollback;

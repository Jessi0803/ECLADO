-- Staff: discounted merchandise must reach NT$5,000 for NEW orders.
-- Preserve fixed free shipping, no shipping groups, and assisted-order exceptions.
-- Run after assisted-order benefits; do not rerun old pricing/assisted migrations afterward.
begin;
do $migration$
declare
  signature text;
  definition text;
  updated_definition text;
  minimum_pattern text := $pattern$(member_role in \('pro',[[:space:]]*'instructor',[[:space:]]*'distributor')\)([[:space:]]+and[[:space:]]+(effective_merchandise_amount|subtotal_amount)([[:space:]]*-[[:space:]]*(benefit_discount|total_discount))?[[:space:]]*<[[:space:]]*5000)$pattern$;
begin
  foreach signature in array array[
    'public.quote_order_pricing_discount_v2(jsonb,text,text,text)',
    'public.create_assisted_order(uuid,jsonb)',
    'public.create_assisted_order_base_v1(uuid,jsonb)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Required function missing: %', signature;
    end if;
    definition := pg_get_functiondef(to_regprocedure(signature));
    updated_definition := regexp_replace(definition, minimum_pattern, $replacement$\1,'staff')\2$replacement$, 'g');
    if updated_definition = definition and definition !~ $ready$member_role in \('pro',[[:space:]]*'instructor',[[:space:]]*'distributor',[[:space:]]*'staff'\)[[:space:]]+and[[:space:]]+(effective_merchandise_amount|subtotal_amount)$ready$ then
      raise exception 'Minimum guard differs: %; migration rolled back', signature;
    end if;
    if updated_definition <> definition then execute updated_definition; end if;
  end loop;
end;
$migration$;
commit;

select
  pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure) ~ $ready$member_role in \('pro',[[:space:]]*'instructor',[[:space:]]*'distributor',[[:space:]]*'staff'\)[[:space:]]+and[[:space:]]+(effective_merchandise_amount|subtotal_amount)$ready$ as staff_checkout_minimum_ready,
  pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure) ~ $ready$member_role in \('pro',[[:space:]]*'instructor',[[:space:]]*'distributor',[[:space:]]*'staff'\)[[:space:]]+and[[:space:]]+subtotal_amount$ready$ as staff_assisted_minimum_ready;

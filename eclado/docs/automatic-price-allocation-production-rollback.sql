-- Production acceptance: quotes only. No orders, stock, coupons or wallet writes.
-- Only the feature flag is toggled inside an exception-rolled-back subtransaction.
-- Concurrent sessions continue to see committed OFF; all changes finally ROLLBACK.
rollback;
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function pg_temp.allocation_assert(ok boolean,label text)
returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Allocation production acceptance failed: %',label; end if;
end $$;
do $accept$
declare actor uuid; variant bigint; product integer; cart jsonb; old_quote jsonb; new_quote jsonb;
 before_settings jsonb; result jsonb; cases jsonb:='[]'; field text;
begin
 select to_jsonb(s) into strict before_settings from public.automatic_price_allocation_settings s where singleton;
 perform pg_temp.allocation_assert(before_settings->>'enabled'='false','committed switch OFF before acceptance');
 result:=public.solve_automatic_price_component('[{"product_id": 1, "variant_id": 1, "qty": 1, "unit_price": 1000, "line_total": 1000}, {"product_id": 2, "variant_id": 2, "qty": 1, "unit_price": 1000, "line_total": 1000}]'::jsonb,'[{"id": "00000000-0000-0000-0000-000000000001", "name": "SQL quote-only probe", "benefit_type": "fixed_discount", "q": [true, false], "b": [true, false], "e": [true, false], "threshold_type": "quantity", "threshold_value": null, "discount_amount": 100}, {"id": "00000000-0000-0000-0000-000000000002", "name": "SQL quote-only probe", "benefit_type": "fixed_discount", "q": [false, true], "b": [false, true], "e": [false, true], "threshold_type": "quantity", "threshold_value": null, "discount_amount": 200}]'::jsonb);
 perform pg_temp.allocation_assert((result->>'discount')::numeric=300,'disjoint_products_sum_300');
 cases:=cases||jsonb_build_array('disjoint_products_sum_300');
 result:=public.solve_automatic_price_component('[{"product_id": 1, "variant_id": 1, "qty": 2, "unit_price": 1000, "line_total": 2000}]'::jsonb,'[{"id": "00000000-0000-0000-0000-000000000001", "name": "SQL quote-only probe", "benefit_type": "percentage_discount", "q": [true], "b": [true], "e": [true], "threshold_type": "quantity", "threshold_value": null, "discount_amount": 0, "discount_rate": 0.9}, {"id": "00000000-0000-0000-0000-000000000002", "name": "SQL quote-only probe", "benefit_type": "percentage_discount", "q": [true], "b": [true], "e": [true], "threshold_type": "quantity", "threshold_value": null, "discount_amount": 0, "discount_rate": 0.8}]'::jsonb);
 perform pg_temp.allocation_assert((result->>'discount')::numeric=400,'same_units_percentage_best');
 cases:=cases||jsonb_build_array('same_units_percentage_best');
 result:=public.solve_automatic_price_component('[{"product_id": 1, "variant_id": 1, "qty": 1, "unit_price": 1000, "line_total": 1000}, {"product_id": 2, "variant_id": 2, "qty": 1, "unit_price": 2000, "line_total": 2000}, {"product_id": 3, "variant_id": 3, "qty": 6, "unit_price": 3000, "line_total": 18000}]'::jsonb,'[{"id": "00000000-0000-0000-0000-000000000001", "name": "SQL quote-only probe", "benefit_type": "buy_x_get_y", "q": [true, true, true], "b": [true, true, true], "e": [true, true, true], "threshold_type": "quantity", "threshold_value": null, "discount_amount": 0, "buy_quantity": 3, "gift_quantity": 1, "repeat_mode": "repeat"}]'::jsonb);
 perform pg_temp.allocation_assert((result->>'discount')::numeric=3000,'bogo_8_second_cheapest_repeat');
 cases:=cases||jsonb_build_array('bogo_8_second_cheapest_repeat');
 result:=public.solve_automatic_price_component('[{"product_id": 1, "variant_id": 1, "qty": 1, "unit_price": 1000, "line_total": 1000}, {"product_id": 2, "variant_id": 2, "qty": 1, "unit_price": 2000, "line_total": 2000}, {"product_id": 3, "variant_id": 3, "qty": 6, "unit_price": 3000, "line_total": 18000}]'::jsonb,'[{"id": "00000000-0000-0000-0000-000000000001", "name": "SQL quote-only probe", "benefit_type": "buy_x_get_y", "q": [true, true, true], "b": [true, true, true], "e": [true, true, true], "threshold_type": "quantity", "threshold_value": null, "discount_amount": 0, "buy_quantity": 3, "gift_quantity": 1, "repeat_mode": "once"}]'::jsonb);
 perform pg_temp.allocation_assert((result->>'discount')::numeric=1000,'bogo_8_second_cheapest_once');
 cases:=cases||jsonb_build_array('bogo_8_second_cheapest_once');
 -- Resolve one existing professional identity entirely inside SQL. Do not export
 -- identity/contact details; do not update profile or customer data.
 select p.id into strict actor from public.profiles p join auth.users u on u.id=p.id where p.role='pro' order by p.id limit 1;
 select v.id,v.product_id into strict variant,product from public.product_variants v join public.products p on p.id=v.product_id
 where p.id in (107,108,109,110) and p.active and p.publication_status='active' and v.active order by p.id,v.is_default desc,v.id limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 cart:=jsonb_build_array(jsonb_build_object('product_id',product,'variant_id',variant,'qty',99));
 old_quote:=public.quote_order_pricing_discount_v2(cart,'delivery','','');
 begin
  update public.automatic_price_allocation_settings set enabled=true where singleton;
  perform pg_temp.allocation_assert(public.automatic_price_allocation_enabled(),'transactional switch ON / authority hash');
  new_quote:=public.quote_order_pricing_discount_v2(cart,'delivery','','');
  foreach field in array array['subtotal','discount','shipping','total'] loop
   perform pg_temp.allocation_assert((old_quote->>field)::numeric=(new_quote->>field)::numeric,'existing promotion quote / '||field);
  end loop;
  perform pg_temp.allocation_assert(new_quote->>'automatic_allocation_version'='1','new version marker');
  perform pg_temp.allocation_assert((new_quote->>'discount')::numeric=300,'current 3-box promotion remains 300');
  cases:=cases||jsonb_build_array('real_professional_quote_current_activity_matches_OFF','transactional_ON_authority_guard');
  raise exception using errcode='ZX001',message='rollback quote-only feature switch';
 exception when sqlstate 'ZX001' then null;
 end;
 perform pg_temp.allocation_assert((select to_jsonb(s) from public.automatic_price_allocation_settings s where singleton)=before_settings,'switch restored by subtransaction rollback');
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 perform set_config('allocation.production_report',jsonb_build_object('passed',true,'cases',cases,'case_count',jsonb_array_length(cases),'enabled_after',false,'created_orders',0,'bank_calls',0,'modified_profiles',0,'modified_activities',0,'sequence_advanced',false)::text,true);
end $accept$;
select current_setting('allocation.production_report')::jsonb as report;
rollback;

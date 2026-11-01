-- Add display-only error details. Keep the original rejection, minimum,
-- additional-order exception, public quote contracts, and create-order guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare target regprocedure:='public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure;
  source text; anchor text; replacement text; original_owner oid; original_acl aclitem[];
begin
 select pg_get_functiondef(p.oid),p.proowner,p.proacl into source,original_owner,original_acl from pg_proc p where p.oid=target;
 if position('cart_minimum_preview' in source)>0 then return; end if;
 anchor:=$anchor$raise exception '專業會員單筆訂單最低金額為 NT$ 5,000' using errcode = '22023';$anchor$;
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1
   or position('and effective_merchandise_amount < 5000' in source)=0
   or position('and not is_additional_order' in source)=0
   or position('student_price_restoration' in source)=0 then
   raise exception 'Unknown quote/minimum source; review before installing cart preview';
 end if;
 replacement:=$replacement$raise exception '專業會員單筆訂單最低金額為 NT$ 5,000' using errcode = '22023',
      detail = jsonb_build_object('kind','cart_minimum_preview','version',1,
        'subtotal',subtotal_amount,'discount',total_discount,
        'merchandise_amount',effective_merchandise_amount,'minimum',5000,
        'remaining',5000-effective_merchandise_amount,
        'adjustments',(select coalesce(jsonb_agg(jsonb_build_object(
          'name',value->'name','amount',value->'amount','adjustment_type',value->'adjustment_type') order by ordinality),'[]'::jsonb)
          from jsonb_array_elements(all_adjustments) with ordinality
          where value->>'adjustment_type' in ('legacy_discount','percentage_discount','fixed_discount','buy_x_get_y','student_price_restoration'))
      )::text;$replacement$;
 execute replace(source,anchor,replacement);
 if exists(select 1 from pg_proc p where p.oid=target and (p.proowner is distinct from original_owner or p.proacl is distinct from original_acl)) then
   raise exception 'Quote owner/ACL changed';
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;

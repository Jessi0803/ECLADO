-- Read-only installation check. Behavioral guards are covered by DB integration.
select
 position('cart_minimum_preview' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as preview_details_present,
 position('and effective_merchandise_amount < 5000' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as post_discount_minimum_preserved,
 position('and not is_additional_order' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as additional_order_exception_preserved,
 position('raise exception ''專業會員單筆訂單最低金額為 NT$ 5,000''' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as quote_still_rejected;

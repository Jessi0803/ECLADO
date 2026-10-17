-- Read-only verification against production function snapshots from 2026-10-17.
with expected(signature, added_clause, original_md5, original_acl) as (values
('public.quote_order_pricing_internal_20260916(jsonb,text)',' and public.automatic_promotion_allows_identity(promotion.id, member_role, auth.uid())','e4d26703ec7e834f1d1d4e9bd548aa45','{postgres=X/postgres,service_role=X/postgres}'),
('public.quote_order_pricing_discount_v2(jsonb,text,text,text)',' and public.automatic_promotion_allows_identity(promotion.id, member_role, current_user_id)','0cea93f7e794ec24796860e4c019c0cf','{postgres=X/postgres,service_role=X/postgres}'),
('public.quote_order_pricing(jsonb,text,text,text)',' and public.automatic_promotion_allows_identity(promotion.id, (result ->> ''member_role''), auth.uid())','dcccb7292bf9e47e5ce5bac3554f8806','{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)',' and public.automatic_promotion_allows_identity(promotion.id, member_role, current_user_id)','c60dff3e798253703bf23b99100ce793','{postgres=X/postgres,service_role=X/postgres}'),
('public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean)',' and public.automatic_promotion_allows_identity(promotion.id, (result ->> ''member_role''), p_customer_id)','d0660c2795507888bc1903f6446b38ae','{postgres=X/postgres,service_role=X/postgres}'),
('public.quote_assisted_order(jsonb)',' and public.automatic_promotion_allows_identity(p.id, customer_role, customer_id)','0764c15f924eaee5adb20b3a9a7b58c5','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
)
select signature as check_name,
  md5(replace(pg_get_functiondef(to_regprocedure(signature)),added_clause,''))=original_md5 as original_logic_preserved,
  p.proacl::text=original_acl as original_permissions_preserved
from expected join pg_proc p on p.oid=to_regprocedure(signature);

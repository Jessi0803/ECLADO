-- READ ONLY: production ilvdvlkdpntwmaijncaz. No pricing RPCs, orders, bank calls or writes.
begin read only;
set local statement_timeout='30s';
select jsonb_build_object(
 'project_ref','ilvdvlkdpntwmaijncaz','captured_at',clock_timestamp(),'server_version',current_setting('server_version'),
 'new_policy_table_exists',to_regclass('public.promotion_student_policy_settings') is not null,
 'new_policy_columns',(select coalesce(jsonb_agg(column_name order by column_name),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name='promotions' and column_name in('allow_student_price_stacking','instructor_reward_eligible')),
 'allocation_settings',(select to_jsonb(s) from public.automatic_price_allocation_settings s where singleton),
 'student_feature_settings',(select to_jsonb(s) from public.student_pricing_feature_settings s where singleton),
 'student_pricing',(select to_jsonb(s)-'updated_by' from public.student_pricing_settings s where singleton),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c where c.conrelid in('public.promotions'::regclass,'public.order_adjustments'::regclass)),
 'promotions',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
   'scope_digest',(select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'[]')) from public.promotion_scopes s where s.promotion_id=p.id),
   'scopes',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('product_name',prod.name_zh,'variant_sku',v.sku,'variant_product_name',vp.name_zh) order by s.id),'[]'::jsonb) from public.promotion_scopes s left join public.products prod on prod.id=s.product_id left join public.product_variants v on v.id=s.product_variant_id left join public.products vp on vp.id=v.product_id where s.promotion_id=p.id),
   'gift',(select jsonb_build_object('variant_id',v.id,'sku',v.sku,'product',gp.name_zh,'gift_enabled',v.gift_enabled,'gift_stock',v.gift_stock) from public.product_variants v join public.products gp on gp.id=v.product_id where v.id=p.gift_variant_id),
   'coupon_links',(select coalesce(jsonb_agg(jsonb_build_object('campaign_id',c.id,'name',c.name,'active',c.active,'stacking_policy',c.stacking_policy) order by c.id),'[]'::jsonb) from public.coupon_promotions l join public.coupon_campaigns c on c.id=l.coupon_campaign_id where l.promotion_id=p.id)) order by p.name,p.id),'[]'::jsonb) from public.promotions p where p.archived_at is null and p.name ilike '%11.11%'),
 'other_active_promotions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.id),'[]'::jsonb) from public.promotions p where p.archived_at is null and p.active and p.name not ilike '%11.11%'),
 'business_counts',jsonb_build_object('orders',(select count(*) from public.orders),'snapshots',(select count(*) from public.student_reward_snapshots),'ledger',(select count(*) from public.instructor_reward_ledger),'adjustments',(select count(*) from public.order_adjustments))
) as preflight;
rollback;

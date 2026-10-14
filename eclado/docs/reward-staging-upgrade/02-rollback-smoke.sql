-- TEST ONLY: qqlgqasbmbicnmvnlqbr. No bank/LINE/Email requests.
-- SQL identities simulate JWT claims; this is NOT real Auth/PostgREST login.
-- All fake users/products/orders/financial rows ROLLBACK. Sequence gaps may remain.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $smoke$
DECLARE
 admin_id uuid:='77777777-7777-4777-8777-777777777701';
 teacher_id uuid:='77777777-7777-4777-8777-777777777702';
 student_id uuid:='77777777-7777-4777-8777-777777777703';
 items jsonb:='[{"product_id":900001,"variant_id":900001,"qty":20}]';
 q jsonb; online_order jsonb; snap public.student_reward_snapshots%rowtype;
 payload jsonb; assisted_order jsonb; wallet_order jsonb; bank_amount numeric; bank_no text;
BEGIN
 IF (SELECT enabled FROM public.student_pricing_feature_settings) THEN RAISE EXCEPTION 'Expected feature OFF before test'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id IN(admin_id,teacher_id,student_id))
 OR EXISTS(SELECT 1 FROM public.products WHERE id=900001) THEN RAISE EXCEPTION 'Fake fixture IDs already in use'; END IF;
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (admin_id,'admin@example.test','{"name":"隔離假管理員"}'),
 (teacher_id,'teacher@example.test','{"name":"隔離假老師"}'),
 (student_id,'student@example.test','{"name":"隔離假學生"}');
 INSERT INTO public.admin_users(user_id,role,active) VALUES(admin_id,'super_admin',true);
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM public.set_member_role_with_membership(teacher_id,'instructor',current_date,'test-only rollback smoke');
 PERFORM public.set_member_role_with_membership(student_id,'pro',current_date,'test-only rollback smoke');
 PERFORM public.set_instructor_student_price_type(teacher_id,'student_1',0);
 PERFORM public.save_instructor_student_binding(student_id,teacher_id,NULL,'bind');
 INSERT INTO public.products(id,name,name_zh,category,slug,price,pro_price,active,publication_status)
 VALUES(900001,'stage7-fake-product','隔離假商品','face','stage7-fake-product',800,500,true,'active');
 INSERT INTO public.product_variants(id,product_id,sku,size,price,pro_price,stock,is_default)
 VALUES(900001,900001,'FAKE-7A-001','100ml',800,500,1000,true);
 PERFORM set_config('request.jwt.claim.sub',student_id::text,true);
 q:=public.quote_order_with_wallets(items,'delivery','','',0,0);
 IF (q->>'subtotal')::numeric IS DISTINCT FROM 10000 THEN RAISE EXCEPTION 'OFF price mismatch'; END IF;
 -- Only this uncommitted transaction sees ON; global flag remains OFF.
 UPDATE public.student_pricing_feature_settings SET enabled=true;
 q:=public.quote_order_with_wallets(items,'delivery','','',0,0);
 IF (q->>'subtotal')::numeric IS DISTINCT FROM 9000 THEN RAISE EXCEPTION 'ON price mismatch'; END IF;
 online_order:=public.create_order_with_wallets(items,'隔離假學生','隔離測試地址','0900000000','student@example.test','','atm','delivery','','personal',NULL,NULL,0,0,q);
 SELECT * INTO snap FROM public.student_reward_snapshots WHERE order_id=online_order->>'order_id';
 IF snap.instructor_id IS DISTINCT FROM teacher_id OR snap.total_reward IS DISTINCT FROM 2000 THEN RAISE EXCEPTION 'Online snapshot mismatch'; END IF;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM public.confirm_admin_instructor_reward_payment(online_order->>'order_id',true);
 UPDATE public.orders SET status='delivered' WHERE id=online_order->>'order_id';
 IF (SELECT balance FROM public.instructor_reward_accounts WHERE user_id=teacher_id) IS DISTINCT FROM 2000 THEN RAISE EXCEPTION 'Posting mismatch'; END IF;
 payload:=jsonb_build_object('customer_type','member','member_id',student_id,'member','隔離假學生','phone','0900000000','email','student@example.test','address','隔離測試地址','note','','payment_method','atm','fulfillment_method','delivery','invoice_type','personal','shipping_mode','default','shipping_amount',NULL,'shipping_reason','','minimum_reason','','items',jsonb_build_array(jsonb_build_object('product_id',900001,'variant_id',900001,'qty',20,'unit_price',999999,'price_mode','AUTO')));
 q:=public.quote_assisted_order(payload);
 assisted_order:=public.create_assisted_order('77777777-7777-4777-8777-777777777704',payload||jsonb_build_object('expected_quote',q->'confirmation'));
 SELECT * INTO snap FROM public.student_reward_snapshots WHERE order_id=assisted_order->>'order_id';
 IF snap.total_reward IS DISTINCT FROM 2000 THEN RAISE EXCEPTION 'Assisted AUTO snapshot mismatch'; END IF;
 payload:=jsonb_set(payload,'{items}','[{"product_id":900001,"variant_id":900001,"qty":20,"unit_price":600,"price_mode":"MANUAL"}]');
 q:=public.quote_assisted_order(payload);
 assisted_order:=public.create_assisted_order('77777777-7777-4777-8777-777777777705',payload||jsonb_build_object('expected_quote',q->'confirmation'));
 SELECT * INTO snap FROM public.student_reward_snapshots WHERE order_id=assisted_order->>'order_id';
 IF snap.total_reward IS DISTINCT FROM 5000 THEN RAISE EXCEPTION 'Assisted MANUAL snapshot mismatch'; END IF;
 PERFORM set_config('request.jwt.claim.sub',teacher_id::text,true);
 q:=public.quote_order_with_wallets(items,'delivery','','',0,500);
 wallet_order:=public.create_order_with_wallets(items,'隔離假老師','隔離測試地址','0900000000','teacher@example.test','','atm','delivery','','personal',NULL,NULL,0,500,q);
 SELECT o.payment_amount,coalesce(a.provider_order_no,o.id) INTO bank_amount,bank_no FROM public.orders o LEFT JOIN public.order_payment_authorizations a ON a.order_id=o.id WHERE o.id=wallet_order->>'order_id';
 IF (SELECT reserved_balance FROM public.instructor_reward_accounts WHERE user_id=teacher_id) IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'Reserve mismatch'; END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM public.record_verified_reward_wallet_payment(wallet_order->>'order_id',bank_no,'order_query',bank_amount);
 UPDATE public.orders SET status='paid' WHERE id=wallet_order->>'order_id';
 UPDATE public.orders SET status='returned' WHERE id=wallet_order->>'order_id';
 IF (SELECT balance FROM public.instructor_reward_accounts WHERE user_id=teacher_id) IS DISTINCT FROM 2000
 OR (SELECT reserved_balance FROM public.instructor_reward_accounts WHERE user_id=teacher_id) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Refund mismatch'; END IF;
END $smoke$;
SELECT jsonb_build_object(
 'online_snapshot',(SELECT total_reward FROM public.student_reward_snapshots WHERE order_source='online' AND student_id='77777777-7777-4777-8777-777777777703'),
 'delivered_balance',(SELECT balance FROM public.instructor_reward_accounts WHERE user_id='77777777-7777-4777-8777-777777777702'),
 'assisted_auto_snapshot',(SELECT min(total_reward) FROM public.student_reward_snapshots WHERE order_source='admin_assisted'),
 'assisted_manual_snapshot',(SELECT max(total_reward) FROM public.student_reward_snapshots WHERE order_source='admin_assisted'),
 'assisted_snapshots',(SELECT count(*) FROM public.student_reward_snapshots WHERE order_source='admin_assisted'),
 'wallet_status',(SELECT status FROM public.instructor_reward_reservations WHERE user_id='77777777-7777-4777-8777-777777777702'),
 'real_bank',false,'auth','SQL claims simulation','cleanup','ROLLBACK follows') AS result;
ROLLBACK;

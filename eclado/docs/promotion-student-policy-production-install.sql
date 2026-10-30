-- PREPARED ONLY; not executed. Production ilvdvlkdpntwmaijncaz.
-- First save a private full function/ACL/config backup. No test setup replay.
-- Installs OFF and preserves existing allocation ON. Never changes activity policy.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('eclado:promotion-student-policy-install'));
lock table public.promotions in share row exclusive mode;
create temporary table student_policy_install_baseline on commit drop as
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) as promotions from public.promotions p;
do $guard$
declare f jsonb; target jsonb; o oid; observed jsonb; digest text;
begin
 if to_regclass('public.promotion_student_policy_settings') is not null then raise exception 'New policy already exists; recheck installation state';end if;
 if (select enabled from public.automatic_price_allocation_settings where singleton) is distinct from true then raise exception 'Existing allocation switch differs';end if;
 for f in select value from jsonb_array_elements('[{"acl":["postgres=X/postgres","service_role=X/postgres"],"md5":"5a79b606b5aa9bc8684b087410fb6d72","owner":"postgres","signature":"allocate_automatic_prices(jsonb,text,uuid)"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"md5":"c44d173aac6d50afae52eb3fc591fa17","owner":"postgres","signature":"assisted_discount_quote(jsonb,text,text,text,uuid,boolean)"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"md5":"188403d77c2c5e63e608130d622fdb05","owner":"postgres","signature":"create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)"},{"acl":["postgres=X/postgres"],"md5":"ddda524cdf68da621c2760c7a49ba7da","owner":"postgres","signature":"instructor_reward_report_internal(uuid,integer,integer,integer)"},{"acl":["postgres=X/postgres"],"md5":"162a02312a75f3d41b368dfff7be338f","owner":"postgres","signature":"persist_student_reward_snapshot(text,jsonb)"},{"acl":["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"],"md5":"3b8ef6207fb29a6e31f9d4ded31b8efb","owner":"postgres","signature":"quote_assisted_order(jsonb)"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"md5":"d1b3fa40a662e2c24fe91e9e328182f0","owner":"postgres","signature":"quote_order_pricing_discount_v2(jsonb,text,text,text)"},{"acl":["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"],"md5":"e6a7723a713dbfa6823554dde3681e12","owner":"postgres","signature":"save_discount_promotion(jsonb)"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"md5":"4f053df263fa6ec5d818492c9f5a7db7","owner":"postgres","signature":"solve_automatic_price_component(jsonb,jsonb,integer)"}]'::jsonb) loop
  o:=to_regprocedure('public.'||(f->>'signature'));
  if o is null or md5(pg_get_functiondef(o)) is distinct from f->>'md5' then raise exception 'Source changed: %',f->>'signature';end if;
  if exists(select 1 from pg_proc p where p.oid=o and (pg_get_userbyid(p.proowner) is distinct from f->>'owner' or to_jsonb(p.proacl) is distinct from f->'acl')) then raise exception 'Owner/ACL changed: %',f->>'signature';end if;
 end loop;
 for target in select value from jsonb_array_elements('[{"id":"06906fd2-a796-4db2-9bd8-8397e9360f2e","updated_at":"2026-10-29T17:26:49.750294+00:00","scope_digest":"1c064d55b49bca32f8eac3886a0cc7ae","configuration":{"id":"06906fd2-a796-4db2-9bd8-8397e9360f2e","name":"11.11 \u9650\u5b9a\uff5cTOP\u71b1\u92b7\u5546\u54c1-\u8cb73\u90011","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:00:00+00:00","created_at":"2026-10-22T03:19:27.03849+00:00","label_text":"\u8cb73\u90011","updated_at":"2026-10-29T17:26:49.750294+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u540c\u5546\u54c1\u8cb7 3 \u4ef6\uff0c\u8d08 1 \u4ef6\uff01\n\nC.P 50\u5b89\u74f6\u7d44\u3001\u6975\u7dfb\u73cd\u73e0\u7dde\u9762\u819c\u3001\u4e73\u9178\u83cc\u4fee\u8b77\u9762\u819c\u3001\u8a18\u61b6\u4fee\u8b77\u971c\uff0850g\uff0f200g\uff09\u3001\u4fdd\u6fd5\u88dc\u6c34\u971c\u53ca\u6eab\u548c\u589e\u6548\u6d17\u9762\u4e73\uff08200ml\uff0f500ml\uff09\u7686\u540c\u4eab\u6b64\u512a\u60e0\u3002\n\n\u8acb\u76f4\u63a5\u5c07 4 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#942192","product_ids":[132],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":3,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":4,"storefront_scope_type":"products"}},{"id":"130e6ba0-4111-4e17-9564-f2ac14d24d8a","updated_at":"2026-10-29T17:27:07.001816+00:00","scope_digest":"7253271a999f0bed74081390c5f7690c","configuration":{"id":"130e6ba0-4111-4e17-9564-f2ac14d24d8a","name":"11.11 \u9650\u5b9a\uff5cTOP\u71b1\u92b7\u5546\u54c1-\u8cb73\u90011","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:01:00+00:00","created_at":"2026-10-29T17:16:15.245399+00:00","label_text":"\u8cb73\u90011","updated_at":"2026-10-29T17:27:07.001816+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u540c\u5546\u54c1\u8cb7 3 \u4ef6\uff0c\u8d08 1 \u4ef6\uff01\nC.P 50\u5b89\u74f6\u7d44\u3001\u6975\u7dfb\u73cd\u73e0\u7dde\u9762\u819c\u3001\u4e73\u9178\u83cc\u4fee\u8b77\u9762\u819c\u3001\u8a18\u61b6\u4fee\u8b77\u971c\uff0850g\uff0f200g\uff09\u3001\u4fdd\u6fd5\u88dc\u6c34\u971c\u53ca\u6eab\u548c\u589e\u6548\u6d17\u9762\u4e73\uff08200ml\uff0f500ml\uff09\u7686\u540c\u4eab\u6b64\u512a\u60e0\u3002\n\u8acb\u76f4\u63a5\u5c07 4 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#942192","product_ids":[106],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":3,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":4,"storefront_scope_type":"products"}},{"id":"1876ed80-ca9c-44ee-bb05-4c47ddae6799","updated_at":"2026-10-29T17:26:55.689732+00:00","scope_digest":"2878a1603d45927393a7cf35f49498d5","configuration":{"id":"1876ed80-ca9c-44ee-bb05-4c47ddae6799","name":"11.11 \u9650\u5b9a\uff5cTOP\u71b1\u92b7\u5546\u54c1-\u8cb73\u90011","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:01:00+00:00","created_at":"2026-10-29T17:04:38.542216+00:00","label_text":"\u8cb73\u90011","updated_at":"2026-10-29T17:26:55.689732+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u540c\u5546\u54c1\u8cb7 3 \u4ef6\uff0c\u8d08 1 \u4ef6\uff01\nC.P 50\u5b89\u74f6\u7d44\u3001\u6975\u7dfb\u73cd\u73e0\u7dde\u9762\u819c\u3001\u4e73\u9178\u83cc\u4fee\u8b77\u9762\u819c\u3001\u8a18\u61b6\u4fee\u8b77\u971c\uff0850g\uff0f200g\uff09\u3001\u4fdd\u6fd5\u88dc\u6c34\u971c\u53ca\u6eab\u548c\u589e\u6548\u6d17\u9762\u4e73\uff08200ml\uff0f500ml\uff09\u7686\u540c\u4eab\u6b64\u512a\u60e0\u3002\n\u8acb\u76f4\u63a5\u5c07 4 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#942192","product_ids":[102],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":3,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":4,"storefront_scope_type":"products"}},{"id":"49572111-a383-4cd4-a116-ad9ff30d3f47","updated_at":"2026-10-30T02:53:10.341452+00:00","scope_digest":"bb5b2a1a407d6b88ac3fea640b72b8b0","configuration":{"id":"49572111-a383-4cd4-a116-ad9ff30d3f47","name":"11.11 \u9650\u5b9a\uff5cTOP\u71b1\u92b7\u5546\u54c1-\u8cb73\u90011","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:01:00+00:00","created_at":"2026-10-29T17:17:23.153441+00:00","label_text":"\u8cb73\u90011","updated_at":"2026-10-30T02:53:10.341452+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u540c\u5546\u54c1\u8cb7 3 \u4ef6\uff0c\u8d08 1 \u4ef6\uff01\nC.P 50\u5b89\u74f6\u7d44\u3001\u6975\u7dfb\u73cd\u73e0\u7dde\u9762\u819c\u3001\u4e73\u9178\u83cc\u4fee\u8b77\u9762\u819c\u3001\u8a18\u61b6\u4fee\u8b77\u971c\uff0850g\uff0f200g\uff09\u3001\u4fdd\u6fd5\u88dc\u6c34\u971c\u53ca\u6eab\u548c\u589e\u6548\u6d17\u9762\u4e73\uff08200ml\uff0f500ml\uff09\u7686\u540c\u4eab\u6b64\u512a\u60e0\u3002\n\u8acb\u76f4\u63a5\u5c07 4 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#942192","product_ids":[124],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":3,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":4,"storefront_scope_type":"products"}},{"id":"daf857ba-df5f-48ee-9875-ade66941edda","updated_at":"2026-10-29T17:27:00.90316+00:00","scope_digest":"19cd5161b3abf4c04c6abb8f8c5e624c","configuration":{"id":"daf857ba-df5f-48ee-9875-ade66941edda","name":"11.11 \u9650\u5b9a\uff5cTOP\u71b1\u92b7\u5546\u54c1-\u8cb73\u90011","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:01:00+00:00","created_at":"2026-10-29T17:05:48.619507+00:00","label_text":"\u8cb73\u90011","updated_at":"2026-10-29T17:27:00.90316+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u540c\u5546\u54c1\u8cb7 3 \u4ef6\uff0c\u8d08 1 \u4ef6\uff01\nC.P 50\u5b89\u74f6\u7d44\u3001\u6975\u7dfb\u73cd\u73e0\u7dde\u9762\u819c\u3001\u4e73\u9178\u83cc\u4fee\u8b77\u9762\u819c\u3001\u8a18\u61b6\u4fee\u8b77\u971c\uff0850g\uff0f200g\uff09\u3001\u4fdd\u6fd5\u88dc\u6c34\u971c\u53ca\u6eab\u548c\u589e\u6548\u6d17\u9762\u4e73\uff08200ml\uff0f500ml\uff09\u7686\u540c\u4eab\u6b64\u512a\u60e0\u3002\n\u8acb\u76f4\u63a5\u5c07 4 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#942192","product_ids":[116],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":3,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":4,"storefront_scope_type":"products"}},{"id":"e1ac15b9-8050-47ce-9046-5f0b83e7e38a","updated_at":"2026-10-29T17:26:36.353346+00:00","scope_digest":"c97b0f34f1ede77bb13d64d5efbd2115","configuration":{"id":"e1ac15b9-8050-47ce-9046-5f0b83e7e38a","name":"11.11 \u9650\u5b9a\uff5cTOP\u71b1\u92b7\u5546\u54c1-\u8cb73\u90011","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:01:00+00:00","created_at":"2026-10-29T17:03:06.966767+00:00","label_text":"\u8cb73\u90011","updated_at":"2026-10-29T17:26:36.353346+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u540c\u5546\u54c1\u8cb7 3 \u4ef6\uff0c\u8d08 1 \u4ef6\uff01\nC.P 50\u5b89\u74f6\u7d44\u3001\u6975\u7dfb\u73cd\u73e0\u7dde\u9762\u819c\u3001\u4e73\u9178\u83cc\u4fee\u8b77\u9762\u819c\u3001\u8a18\u61b6\u4fee\u8b77\u971c\uff0850g\uff0f200g\uff09\u3001\u4fdd\u6fd5\u88dc\u6c34\u971c\u53ca\u6eab\u548c\u589e\u6548\u6d17\u9762\u4e73\uff08200ml\uff0f500ml\uff09\u7686\u540c\u4eab\u6b64\u512a\u60e0\u3002\n\u8acb\u76f4\u63a5\u5c07 4 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#942192","product_ids":[123],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":3,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":4,"storefront_scope_type":"products"}},{"id":"bc5aea6c-088b-46ab-addb-fb4071412f90","updated_at":"2026-10-29T17:14:40.892766+00:00","scope_digest":"131a549398dc57ec8983d6b16fd3786b","configuration":{"id":"bc5aea6c-088b-46ab-addb-fb4071412f90","name":"11.11 \u9650\u5b9a\uff5cVONO \u559a\u819a\u8abf\u7406\u7d444+1 \uff08\u6bcf\u76d2\u52a0\u8d08\u54c1\u724c\u77fd\u81a0\u5237\uff09","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:00:00+00:00","created_at":"2026-10-22T03:10:05.978202+00:00","label_text":"\u8cb74\u90011","updated_at":"2026-10-29T17:14:40.892766+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u8cfc\u5165 4 \u76d2\uff0c\u5373\u8d08 1 \u76d2\u514d\u8cbb\uff01\n\u4e26\u4e14\u6bcf\u76d2\u52a0\u8d08\u9001\u300cEclado\u77fd\u81a0\u5237\u300d\uff08\u539f\u50f9140$)\n\u8acb\u76f4\u63a5\u5c07 5 \u76d2\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5 1 \u76d2\u91d1\u984d\u3002","label_color":"#b05d27","product_ids":[136],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":4,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":5,"storefront_scope_type":"products"}},{"id":"ced451c6-c8e7-4bdd-8835-35398e5e04a1","updated_at":"2026-10-29T16:56:35.721045+00:00","scope_digest":"a1a04dfcc0aefc7175d852618bea7361","configuration":{"id":"ced451c6-c8e7-4bdd-8835-35398e5e04a1","name":"11.11 \u9650\u5b9a\uff5c\u547c\u5438\u7cfb\u5217 \u4efb5\u4ef6\u8d08\u90011\u4ef6 \uff08\u6bcf\u74f6\u547c\u5438\u723d\u819a\u6c34\u52a0\u8d08\u62c9\u4f38\u5316\u599d\u68c9*1\uff09","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:00:00+00:00","created_at":"2026-10-22T03:14:39.665249+00:00","label_text":"\u4efb\u90785+1","updated_at":"2026-10-29T16:56:35.721045+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u4efb\u9078\u547c\u5438\u7cfb\u5217\u5546\u54c1\u6eff 6 \u4ef6\uff0c\u5373\u4eab\u5176\u4e2d 1 \u4ef6\u514d\u8cbb\uff01\n\u547c\u5438\u723d\u819a\u6c34\u3001\u547c\u5438\u7cbe\u83ef\u6db2\u3001\u547c\u5438\u5b89\u74f6\u53ca\u547c\u5438\u96ea\u971c\u7686\u53ef\u81ea\u7531\u642d\u914d\u6578\u91cf\u3002\n\u53e6\u5916\uff0c\u6bcf\u74f6\u547c\u5438\u723d\u819a\u6c34\u52a0\u8d08\u62c9\u4f38\u5316\u599d\u68c9* 1\u3002\n\u8acb\u76f4\u63a5\u5c07 6 \u4ef6\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5\u5176\u4e2d\u6700\u4f4e\u50f9\u5546\u54c1\u7684\u91d1\u984d\u3002","label_color":"#bd1000","product_ids":[140,139,138,141],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":5,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":6,"storefront_scope_type":"products"}},{"id":"9be5e4f9-f0d4-460e-a054-7a1aba1ca4ca","updated_at":"2026-10-29T16:51:25.862812+00:00","scope_digest":"6830813e8e0cfb6784fc07b3384f5830","configuration":{"id":"9be5e4f9-f0d4-460e-a054-7a1aba1ca4ca","name":"11.11 \u9650\u5b9a\uff5c\u68c9\u82b1\u6c34\u5149\u7ba1\u74064+1 \uff08\u6bcf\u76d2\u52a0\u8d08\u54c1\u724c\u77fd\u81a0\u5237\uff09","active":true,"end_at":"2026-11-11T15:59:00+00:00","priority":100,"start_at":"2026-10-31T16:00:00+00:00","created_at":"2026-10-22T03:07:18.076179+00:00","label_text":"\u8cb74\u90011","updated_at":"2026-10-29T16:51:25.862812+00:00","allow_guest":false,"archived_at":null,"description":"\u6d3b\u52d5\u671f\u9593\u5167\uff0c\u8cfc\u5165 4 \u76d2\uff0c\u5373\u8d08 1 \u76d2\u514d\u8cbb\uff01\n\u4e26\u4e14\u6bcf\u76d2\u52a0\u8d08\u9001\u300cEclado\u77fd\u81a0\u5237\u300d\uff08\u539f\u50f9140$)\n\u8acb\u76f4\u63a5\u5c07 5 \u76d2\u5546\u54c1\u52a0\u5165\u8cfc\u7269\u8eca\uff0c\u7b26\u5408\u6d3b\u52d5\u512a\u60e0\u5f8c\uff0c\u7cfb\u7d71\u5c07\u65bc\u7d50\u5e33\u6642\u81ea\u52d5\u6298\u62b5 1 \u76d2\u91d1\u984d\u3002","label_color":"#041384","product_ids":[120],"repeat_mode":"repeat","benefit_type":"buy_x_get_y","buy_quantity":4,"discount_rate":1,"gift_quantity":1,"audience_roles":["pro"],"discount_order":"rate_then_amount","threshold_type":"quantity","activation_type":"automatic","discount_amount":0,"exclusive_group":null,"gift_variant_id":null,"threshold_basis":null,"threshold_value":5,"storefront_scope_type":"products"}}]'::jsonb) loop
  select to_jsonb(p) into observed from public.promotions p where p.id=(target->>'id')::uuid;
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'[]')) into digest from public.promotion_scopes s where s.promotion_id=(target->>'id')::uuid;
  if observed is distinct from target->'configuration' or digest is distinct from target->>'scope_digest' or exists(select 1 from public.coupon_promotions where promotion_id=(target->>'id')::uuid) then raise exception 'Activity changed: %',target->>'id';end if;
 end loop;
end $guard$;
-- Incremental installation, OFF by default. No activity or historical order is changed.
-- Requires the installed automatic allocation and immutable student reward snapshots.
do $$ begin
  if to_regprocedure('public.allocate_automatic_prices(jsonb,text,uuid)') is null
    or to_regprocedure('public.persist_student_reward_snapshot(text,jsonb)') is null then
    raise exception 'Automatic allocation and reward snapshots are required';
  end if;
end $$;

alter table public.promotions add column if not exists allow_student_price_stacking boolean not null default true;
alter table public.promotions add column if not exists instructor_reward_eligible boolean not null default true;
create table if not exists public.promotion_student_policy_settings(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false, version bigint not null default 1 check(version>0)
);
insert into public.promotion_student_policy_settings(singleton) values(true) on conflict do nothing;
alter table public.promotion_student_policy_settings enable row level security;
revoke all on public.promotion_student_policy_settings from public,anon,authenticated,service_role;

create or replace function public.promotion_student_policy_enabled()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from public.promotion_student_policy_settings where singleton),false)
    and public.automatic_price_allocation_enabled();
$$;

-- Only authoritative callers may supply lines. Private comparison prices are
-- used for tie-breaking and are removed before returning the allocation result.
create or replace function public.student_policy_price_lines(p_lines jsonb,p_role text,p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare multiplier numeric; item jsonb; result jsonb:='[]'; product public.products%rowtype;
  variant public.product_variants%rowtype; base numeric; teacher_default numeric;
begin
  if p_role<>'pro' or not public.promotion_student_policy_enabled() then return p_lines; end if;
  multiplier:=public.student_pricing_multiplier(p_customer);
  if multiplier is null then return p_lines; end if;
  select professional_price_multiplier into teacher_default from public.membership_tiers where role='instructor' and active;
  for item in select value from jsonb_array_elements(p_lines) loop
    if coalesce((item->>'student_policy_auto')::boolean,true) then
      select * into product from public.products where id=(item->>'product_id')::integer;
      select * into variant from public.product_variants where id=(item->>'variant_id')::bigint and product_id=product.id;
      base:=public.assisted_auto_unit_price(p_customer,'pro',product,variant,null);
      if public.apply_student_price(base,multiplier) is distinct from (item->>'unit_price')::numeric then
        raise exception '商品價格已變動，請重新報價' using errcode='40001';
      end if;
      item:=item||jsonb_build_object('_student_policy_base',base,
        '_student_policy_reward',greatest(0,(item->>'unit_price')::numeric-round(
          case when product.instructor_price_multiplier=1 then variant.pro_price else coalesce(nullif(variant.pro_price,0),variant.price) end
          *public.resolve_product_price_multiplier(product,'instructor',coalesce(teacher_default,0.70)))));
    end if;
    result:=result||jsonb_build_array(item);
  end loop;
  return result;
end $$;

-- Reuse the established threshold, numeric rounding and lowest-free-item rules
-- separately for each activity at its own price basis. Other activities' owned
-- quantities are excluded from that activity's BOGO comparison pool.
create or replace function public.evaluate_student_policy_allocation(p_lines jsonb,p_activities jsonb,p_counts integer[])
returns jsonb language plpgsql immutable set search_path='' as $$
declare lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  i integer; j integer; k integer; own integer; used integer; pool_qty integer; price numeric; loss numeric;
  lost numeric; net numeric:=0; gross numeric; reward_removed numeric:=0; any_activity integer:=0;
  activity jsonb; item jsonb; evaluated jsonb; adjustment jsonb; entries jsonb; entry jsonb;
  single_lines jsonb; single_counts integer[]; adjustments jsonb:='[]'; lines jsonb:='[]';
  amounts numeric[]; free_counts integer[]; vector numeric[]:='{}'; score numeric[];
begin
  amounts:=array_fill(0::numeric,array[lc]); free_counts:=array_fill(0,array[lc]);
  for i in 0..lc-1 loop
    used:=0;
    for j in 0..ac-1 loop
      own:=p_counts[i*ac+j+1];
      if own<0 or (own>0 and not (p_activities->j->'e'->>i)::boolean) then return null; end if;
      used:=used+own;
    end loop;
    if used>(p_lines->i->>'qty')::integer then return null; end if;
  end loop;
  for j in 0..ac-1 loop
    activity:=p_activities->j; single_lines:='[]'; single_counts:='{}'; lost:=0; used:=0;
    for i in 0..lc-1 loop
      item:=p_lines->i; own:=p_counts[i*ac+j+1]; used:=used+own;
      pool_qty:=(item->>'qty')::integer;
      for k in 0..ac-1 loop if k<>j then pool_qty:=pool_qty-p_counts[i*ac+k+1]; end if; end loop;
      price:=(item->>'unit_price')::numeric;
      if not coalesce((activity->>'allow_student_price_stacking')::boolean,true) and item ? '_student_policy_base' then
        price:=(item->>'_student_policy_base')::numeric;
      end if;
      lost:=lost+own*(price-(item->>'unit_price')::numeric);
      single_lines:=single_lines||jsonb_build_array(item||jsonb_build_object('qty',pool_qty,'unit_price',price,'line_total',pool_qty*price));
      single_counts:=array_append(single_counts,own);
    end loop;
    if used=0 then vector:=array_append(vector,0); continue; end if;
    evaluated:=public.evaluate_automatic_price_allocation(single_lines,jsonb_build_array(activity),single_counts);
    if evaluated is null or jsonb_array_length(evaluated->'adjustments')<>1 then return null; end if;
    adjustment:=evaluated->'adjustments'->0; gross:=(adjustment->>'amount')::numeric;
    entries:='[]';
    for entry in select value from jsonb_array_elements(adjustment#>'{qualification,allocation}') loop
      select ordinality::integer-1 into i from jsonb_array_elements(p_lines) with ordinality
        where value->'product_id'=entry->'product_id' and value->'variant_id'=entry->'variant_id';
      item:=p_lines->i; own:=(entry->>'quantity')::integer;
      loss:=own*((entry->>'unit_price')::numeric-(item->>'unit_price')::numeric);
      amounts[i+1]:=amounts[i+1]+(entry->>'amount')::numeric-loss;
      free_counts[i+1]:=free_counts[i+1]+(entry->>'free_quantity')::integer;
      if item ? '_student_policy_base' and not coalesce((activity->>'instructor_reward_eligible')::boolean,true) then
        reward_removed:=reward_removed+own*(item->>'_student_policy_reward')::numeric;
      end if;
      entries:=entries||jsonb_build_array(entry||jsonb_build_object(
        'student_unit_price',item->'unit_price','student_price_applied',
          not (item ? '_student_policy_base') or coalesce((activity->>'allow_student_price_stacking')::boolean,true),
        'reward_excluded',item ? '_student_policy_base' and not coalesce((activity->>'instructor_reward_eligible')::boolean,true)));
    end loop;
    adjustment:=jsonb_set(adjustment,'{qualification}',(adjustment->'qualification')||jsonb_build_object(
      'student_policy_version',1,'allow_student_price_stacking',coalesce((activity->>'allow_student_price_stacking')::boolean,true),
      'instructor_reward_eligible',coalesce((activity->>'instructor_reward_eligible')::boolean,true),
      'student_discount_replaced',lost,'allocation',entries));
    adjustments:=adjustments||jsonb_build_array(adjustment);
    if lost>0 then
      adjustments:=adjustments||jsonb_build_array(jsonb_build_object('promotion_id',activity->'id','coupon_campaign_id',null,
        'adjustment_type','student_price_restoration','name','活動商品不適用學生價','amount',lost,'sort_order',j,
        'qualification',jsonb_build_object('student_policy_version',1,'activity_name',activity->'name')));
    end if;
    net:=net+gross-lost; any_activity:=1; vector:=array_append(vector,gross-lost);
  end loop;
  for i in 0..lc-1 loop
    item:=p_lines->i;
    if (item->>'line_total')::numeric-amounts[i+1]<0 then return null; end if;
    lines:=lines||jsonb_build_array((item-'_student_policy_base'-'_student_policy_reward')||jsonb_build_object(
      'remaining_total',(item->>'line_total')::numeric-amounts[i+1],'bogo_free_quantity',free_counts[i+1]));
  end loop;
  -- Private score: net customer saving, activity over student-only, lower reward,
  -- followed by the established activity order and stable ownership vector.
  score:=array[net,any_activity::numeric,reward_removed]||vector;
  foreach own in array p_counts loop score:=array_append(score,own); end loop;
  return jsonb_build_object('discount',net,'adjustments',adjustments,'lines',lines,'score',score);
end $$;

-- Exact bounded quantity enumeration. The old solver's gross-discount pruning
-- and whole-scope fast path cannot be used for mutually exclusive student prices.
create or replace function public.solve_student_policy_component(p_lines jsonb,p_activities jsonb,p_node_budget integer default 20000)
returns jsonb language plpgsql immutable set search_path='' as $$
declare lc integer:=jsonb_array_length(p_lines); ac integer:=jsonb_array_length(p_activities);
  counts integer[]; remaining integer[]; cells integer[]:='{}'; next_qty integer[]; cell integer;
  i integer; j integer; pos integer; selected integer; nodes integer:=0; best jsonb; result jsonb;
  score numeric[]; best_score numeric[]; total bigint; wanted bigint; free_left bigint; take integer; row record;
begin
  if not exists(select 1 from jsonb_array_elements(p_lines) x where x ? '_student_policy_base')
    or not exists(select 1 from jsonb_array_elements(p_activities) x
      where not coalesce((x->>'allow_student_price_stacking')::boolean,true)
        or not coalesce((x->>'instructor_reward_eligible')::boolean,true)) then
    result:=public.solve_automatic_price_component(p_lines,p_activities,p_node_budget);
    select jsonb_agg(value-'_student_policy_base'-'_student_policy_reward' order by ordinality) into best
      from jsonb_array_elements(result->'lines') with ordinality;
    return jsonb_set(result,'{lines}',best);
  end if;
  if p_node_budget<1 then raise exception '活動組合超出計算範圍，請聯絡客服確認優惠。' using errcode='54000'; end if;
  counts:=array_fill(0,array[lc*ac]); remaining:=array_fill(0,array[lc]);
  for i in 0..lc-1 loop
    remaining[i+1]:=(p_lines->i->>'qty')::integer;
    for j in 0..ac-1 loop if (p_activities->j->'e'->>i)::boolean then cells:=array_append(cells,i*ac+j+1); end if; end loop;
  end loop;
  if cardinality(cells)>128 then raise exception '活動重疊範圍過大，請聯絡客服確認優惠。' using errcode='54000'; end if;
  best:=public.evaluate_student_policy_allocation(p_lines,p_activities,counts);
  select array_agg(value::numeric order by ordinality) into best_score from jsonb_array_elements_text(best->'score') with ordinality;
  -- One BOGO: the free units are fixed by the complete eligible comparison pool.
  -- Choose paid units by least forgone student discount, then most excluded reward.
  -- Quantity compression makes even 9999 units constant in the number of variants.
  if ac=1 and p_activities->0->>'benefit_type'='buy_x_get_y'
    and p_activities->0->>'threshold_type'='quantity'
    and coalesce((p_activities->0->>'threshold_value')::numeric,0)
      <=(p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer then
    select coalesce(sum((p_lines->idx->>'qty')::integer),0) into total from generate_series(0,lc-1) idx where (p_activities->0->'e'->>idx)::boolean;
    wanted:=total/((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer);
    if p_activities->0->>'repeat_mode'<>'repeat' then wanted:=least(1,wanted); end if;
    free_left:=wanted*(p_activities->0->>'gift_quantity')::integer;
    wanted:=wanted*((p_activities->0->>'buy_quantity')::integer+(p_activities->0->>'gift_quantity')::integer);
    for row in select value,ordinality::integer idx from jsonb_array_elements(p_lines) with ordinality
      where (p_activities->0->'e'->>(ordinality::integer-1))::boolean
      order by case when not coalesce((p_activities->0->>'allow_student_price_stacking')::boolean,true)
        then coalesce((value->>'_student_policy_base')::numeric,(value->>'unit_price')::numeric) else (value->>'unit_price')::numeric end,
        (value->>'product_id')::integer,(value->>'variant_id')::bigint loop
      take:=least(free_left,remaining[row.idx]); counts[row.idx]:=take; remaining[row.idx]:=remaining[row.idx]-take;
      free_left:=free_left-take; wanted:=wanted-take;
    end loop;
    for row in select value,ordinality::integer idx from jsonb_array_elements(p_lines) with ordinality
      where (p_activities->0->'e'->>(ordinality::integer-1))::boolean
      order by case when not coalesce((p_activities->0->>'allow_student_price_stacking')::boolean,true)
        then coalesce((value->>'_student_policy_base')::numeric,(value->>'unit_price')::numeric)-(value->>'unit_price')::numeric else 0 end,
        case when not coalesce((p_activities->0->>'instructor_reward_eligible')::boolean,true) then coalesce((value->>'_student_policy_reward')::numeric,0) else 0 end desc,
        (value->>'product_id')::integer,(value->>'variant_id')::bigint loop
      take:=least(wanted,remaining[row.idx]); counts[row.idx]:=counts[row.idx]+take; wanted:=wanted-take;
    end loop;
    result:=public.evaluate_student_policy_allocation(p_lines,p_activities,counts);
    if result is not null then
      select array_agg(value::numeric order by ordinality) into score from jsonb_array_elements_text(result->'score') with ordinality;
      if score>best_score then best:=result; end if;
    end if;
    return best||jsonb_build_object('search_nodes',1);
  end if;
  pos:=1; next_qty:=array_fill(-2,array[cardinality(cells)]);
  while pos>0 loop
    nodes:=nodes+1;
    if nodes>p_node_budget then raise exception '活動組合超出計算範圍，請聯絡客服確認優惠。' using errcode='54000'; end if;
    if pos>cardinality(cells) then
      result:=public.evaluate_student_policy_allocation(p_lines,p_activities,counts);
      if result is not null then
        select array_agg(value::numeric order by ordinality) into score from jsonb_array_elements_text(result->'score') with ordinality;
        if score>best_score then best:=result; best_score:=score; end if;
      end if;
      pos:=pos-1;
      if pos>0 then cell:=cells[pos]; i:=(cell-1)/ac+1; remaining[i]:=remaining[i]+counts[cell]; counts[cell]:=0; end if;
      continue;
    end if;
    cell:=cells[pos]; i:=(cell-1)/ac+1;
    if next_qty[pos]=-2 then next_qty[pos]:=remaining[i]; end if;
    selected:=next_qty[pos];
    if selected<0 then
      next_qty[pos]:=-2; pos:=pos-1;
      if pos>0 then cell:=cells[pos]; i:=(cell-1)/ac+1; remaining[i]:=remaining[i]+counts[cell]; counts[cell]:=0; end if;
    else
      next_qty[pos]:=selected-1; counts[cell]:=selected; remaining[i]:=remaining[i]-selected; pos:=pos+1;
      if pos<=cardinality(cells) then next_qty[pos]:=-2; end if;
    end if;
  end loop;
  return best||jsonb_build_object('search_nodes',nodes);
end $$;

create or replace function pg_temp.student_policy_replace(source text,anchor text,replacement text)
returns text language plpgsql as $$ begin
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'Student policy source mismatch: %',left(anchor,100);
  end if;
  return replace(source,anchor,replacement);
end $$;

do $migration$
declare d text; signature text;
begin
  d:=pg_get_functiondef('public.allocate_automatic_prices(jsonb,text,uuid)'::regprocedure);
  if position('public.student_policy_price_lines' in d)=0 then
    d:=pg_temp.student_policy_replace(d,'  lc:=jsonb_array_length(lines);',
      '  lines:=public.student_policy_price_lines(lines,p_role,p_customer_id);'||E'\n  lc:=jsonb_array_length(lines);');
    d:=pg_temp.student_policy_replace(d,'public.solve_automatic_price_component(component_lines,component_activities,20000-nodes)',
      'public.solve_student_policy_component(component_lines,component_activities,20000-nodes)');
    d:=pg_temp.student_policy_replace(d,'jsonb_agg(x order by p.priority,p.created_at,p.id)',
      $q$jsonb_agg(x order by p.priority,p.created_at,p.id,(x->>'adjustment_type'='student_price_restoration'))$q$);
    -- Non-matching lines and empty-candidate results must not leak private fields.
    d:=replace(d,$q$'lines',lines$q$,$q$'lines',public.strip_student_policy_lines(lines)$q$);
    d:=replace(d,$q$'lines',returned_lines$q$,$q$'lines',public.strip_student_policy_lines(returned_lines)$q$);
    execute d;
  end if;
  foreach signature in array array['public.quote_order_pricing_discount_v2(jsonb,text,text,text)',
    'public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'] loop
    d:=pg_get_functiondef(signature::regprocedure);
    if position('student_price_restoration' in d)=0 then
      d:=pg_temp.student_policy_replace(d,$q$sum((adjustment ->> 'amount')::numeric)$q$,
        $q$sum((case when adjustment->>'adjustment_type'='student_price_restoration' then -1 else 1 end)*(adjustment ->> 'amount')::numeric)$q$);
      d:=pg_temp.student_policy_replace(d,'if jsonb_array_length(automatic_adjustments)=1 then',
        $q$if (select count(*) from jsonb_array_elements(automatic_adjustments) x where x->>'adjustment_type'<>'student_price_restoration')=1 then$q$);
      execute d;
    end if;
  end loop;
  d:=pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure);
  if position($q$'student_policy_auto'$q$ in d)=0 then
    d:=pg_temp.student_policy_replace(d,$q$'price',price,'unit_price',price$q$,
      $q$'student_policy_auto',coalesce(entry->>'price_mode','MANUAL')='AUTO','price',price,'unit_price',price$q$);
    execute d;
  end if;
  d:=pg_get_functiondef('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure);
  if position($q$'buy_x_get_y', 'student_price_restoration'$q$ in d)=0 then
    d:=pg_temp.student_policy_replace(d,$q$'percentage_discount', 'fixed_discount', 'buy_x_get_y'$q$,
      $q$'percentage_discount', 'fixed_discount', 'buy_x_get_y', 'student_price_restoration'$q$);
    execute d;
  end if;
end $migration$;

do $migration$
declare d text;
begin
  if to_regprocedure('public.save_discount_promotion_student_policy_base(jsonb)') is null then
    d:=pg_get_functiondef('public.save_discount_promotion(jsonb)'::regprocedure);
    execute replace(d,'FUNCTION public.save_discount_promotion(', 'FUNCTION public.save_discount_promotion_student_policy_base(');
    revoke all on function public.save_discount_promotion_student_policy_base(jsonb) from public,anon,authenticated,service_role;
  end if;
end $migration$;

create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
  if auth.uid() is null or not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management authorization required' using errcode='42501';
  end if;
  if (p_payload ? 'allow_student_price_stacking' and jsonb_typeof(p_payload->'allow_student_price_stacking') is distinct from 'boolean')
    or (p_payload ? 'instructor_reward_eligible' and jsonb_typeof(p_payload->'instructor_reward_eligible') is distinct from 'boolean') then
    raise exception 'Invalid student policy' using errcode='22023';
  end if;
  if (coalesce(p_payload->>'activation_type','')<>'automatic'
    or coalesce(p_payload->>'benefit_type','') not in ('percentage_discount','fixed_discount','buy_x_get_y'))
    and (not coalesce((p_payload->>'allow_student_price_stacking')::boolean,true)
      or not coalesce((p_payload->>'instructor_reward_eligible')::boolean,true)) then
    raise exception 'Student policy applies only to automatic price activities' using errcode='22023';
  end if;
  -- Clear policies before the existing editor switches to an unsupported kind;
  -- its UPDATE must satisfy the scope constraint too. Failure rolls this back.
  if p_payload->>'activation_type'<>'automatic' or p_payload->>'benefit_type' not in ('percentage_discount','fixed_discount','buy_x_get_y') then
    update public.promotions set allow_student_price_stacking=true,instructor_reward_eligible=true
      where id=nullif(p_payload->>'id','')::uuid;
  end if;
  target_id:=public.save_discount_promotion_student_policy_base(p_payload);
  update public.promotions set
    allow_student_price_stacking=case when p_payload ? 'allow_student_price_stacking' then (p_payload->>'allow_student_price_stacking')::boolean else allow_student_price_stacking end,
    instructor_reward_eligible=case when p_payload ? 'instructor_reward_eligible' then (p_payload->>'instructor_reward_eligible')::boolean else instructor_reward_eligible end
  where id=target_id;
  return target_id;
end $$;

alter table public.promotions drop constraint if exists promotions_student_policy_scope_check;
alter table public.promotions add constraint promotions_student_policy_scope_check check(
  (allow_student_price_stacking and instructor_reward_eligible) or
  (activation_type='automatic' and benefit_type in ('legacy_discount','percentage_discount','fixed_discount','buy_x_get_y')));

create or replace function public.strip_student_policy_lines(p_lines jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(value-'_student_policy_base'-'_student_policy_reward' order by ordinality),'[]'::jsonb)
    from jsonb_array_elements(p_lines) with ordinality;
$$;

alter table public.order_adjustments drop constraint if exists order_adjustments_adjustment_type_check;
alter table public.order_adjustments add constraint order_adjustments_adjustment_type_check check(
  adjustment_type in ('legacy_discount','percentage_discount','fixed_discount','amount_gift','quantity_gift','free_shipping','buy_x_get_y','student_price_restoration'));

-- Compute excluded quantities from the immutable order allocation, never from
-- today's activity settings. Reward snapshots still contain every purchased line.
create or replace function public.student_reward_excluded_quantity(p_snapshot jsonb,p_product integer,p_variant bigint)
returns integer language sql immutable set search_path='' as $$
  select coalesce(sum((entry->>'quantity')::integer),0)::integer
  from jsonb_array_elements(coalesce(nullif(p_snapshot->'automatic_allocations','null'::jsonb),'[]'::jsonb)) adjustment
  cross join lateral jsonb_array_elements(coalesce(adjustment#>'{qualification,allocation}','[]'::jsonb)) entry
  where adjustment#>>'{qualification,student_policy_version}'='1'
    and coalesce((entry->>'reward_excluded')::boolean,false)
    and (entry->>'product_id')::integer=p_product and (entry->>'variant_id')::bigint=p_variant;
$$;

do $migration$
declare d text;
begin
  d:=pg_get_functiondef('public.persist_student_reward_snapshot(text,jsonb)'::regprocedure);
  if position('public.student_reward_excluded_quantity' in d)=0 then
    d:=pg_temp.student_policy_replace(d,'qty integer; unit_price numeric;', 'qty integer; excluded_qty integer; excluded_used jsonb:=''{}''; excluded_key text; unit_price numeric;');
    d:=pg_temp.student_policy_replace(d,
      $q$    amount:=public.calculate_student_reward_line(unit_price,(basis->>'instructor_unit_price')::numeric,qty);$q$,
      $q$    excluded_key:=basis->>'variant_id';
    excluded_qty:=case when basis->>'price_mode'='AUTO' then least(qty,greatest(0,public.student_reward_excluded_quantity(target.pricing_snapshot,(basis->>'product_id')::integer,(basis->>'variant_id')::bigint)-coalesce((excluded_used->>excluded_key)::integer,0))) else 0 end;
    excluded_used:=jsonb_set(excluded_used,array[excluded_key],to_jsonb(coalesce((excluded_used->>excluded_key)::integer,0)+excluded_qty));
    if excluded_qty<0 or excluded_qty>qty then raise exception 'Invalid excluded reward quantity' using errcode='22023'; end if;
    amount:=public.calculate_student_reward_line(unit_price,(basis->>'instructor_unit_price')::numeric,qty);
    amount:=(amount/qty)*(qty-excluded_qty);$q$);
    d:=pg_temp.student_policy_replace(d,$q$'instructor_multiplier',basis->'instructor_multiplier','instructor_unit_price'$q$,
      $q$'reward_eligible_quantity',qty-excluded_qty,'reward_excluded_quantity',excluded_qty,
      'reward_exclusion_reason',case when excluded_qty>0 then 'promotion_policy' end,
      'instructor_multiplier',basis->'instructor_multiplier','instructor_unit_price'$q$);
    execute d;
  end if;
end $migration$;

do $migration$
declare d text;
begin
  if to_regprocedure('public.instructor_reward_report_internal(uuid,integer,integer,integer)') is not null then
    d:=pg_get_functiondef('public.instructor_reward_report_internal(uuid,integer,integer,integer)'::regprocedure);
    if position($q$'reward_excluded_quantity'$q$ in d)=0 then
      d:=pg_temp.student_policy_replace(d,$q$'unit_price',i->'basis_unit_price','reward',i->'reward'$q$,
        $q$'unit_price',i->'basis_unit_price','reward',i->'reward',
          'reward_eligible_quantity',coalesce(i->'reward_eligible_quantity',i->'qty'),
          'reward_excluded_quantity',coalesce(i->'reward_excluded_quantity','0'::jsonb),
          'reward_exclusion_reason',i->'reward_exclusion_reason'$q$);
      execute d;
    end if;
  end if;
end $migration$;

-- Dedicated policy writer also supports legacy read-only activities, without
-- rewriting their scopes, formulas, audiences or lifecycle fields.
create or replace function public.save_promotion_student_policy(p_id uuid,p_allow_stacking boolean,p_reward_eligible boolean,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare target public.promotions%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management authorization required' using errcode='42501';
  end if;
  select * into target from public.promotions where id=p_id for update;
  if not found then raise exception 'Activity not found' using errcode='22023'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '活動已變更，請重新載入' using errcode='40001';
  end if;
  if target.activation_type<>'automatic' or target.benefit_type not in ('legacy_discount','percentage_discount','fixed_discount','buy_x_get_y')
    or p_allow_stacking is null or p_reward_eligible is null then
    raise exception 'Student policy applies only to automatic price activities' using errcode='22023';
  end if;
  update public.promotions set allow_student_price_stacking=p_allow_stacking,instructor_reward_eligible=p_reward_eligible,updated_at=clock_timestamp() where id=p_id;
end $$;

revoke all on function public.promotion_student_policy_enabled(),public.student_policy_price_lines(jsonb,text,uuid),
  public.evaluate_student_policy_allocation(jsonb,jsonb,integer[]),public.solve_student_policy_component(jsonb,jsonb,integer),
  public.strip_student_policy_lines(jsonb),public.student_reward_excluded_quantity(jsonb,integer,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz) from public,anon,service_role;
grant execute on function public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz) to authenticated;
notify pgrst,'reload schema';

do $post$
declare ok boolean; observed jsonb;
begin
 if (select enabled from public.promotion_student_policy_settings where singleton) is distinct from false or (select enabled from public.automatic_price_allocation_settings where singleton) is distinct from true then raise exception 'Unexpected pricing switches';end if;
 select coalesce(jsonb_agg(to_jsonb(p)-'allow_student_price_stacking'-'instructor_reward_eligible' order by p.id),'[]'::jsonb) into observed from public.promotions p;
 if observed is distinct from (select promotions from student_policy_install_baseline) or exists(select 1 from public.promotions where not allow_student_price_stacking or not instructor_reward_eligible) then raise exception 'Existing promotion data changed';end if;
 select bool_and(value::boolean) into ok from jsonb_each((select to_jsonb(v) from (select
  (select count(*)=1 from public.promotion_student_policy_settings where singleton and version=1) as settings_present,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='promotions' and column_name='allow_student_price_stacking' and is_nullable='NO') as policy_column_present,
  position('public.student_policy_price_lines' in pg_get_functiondef('public.allocate_automatic_prices(jsonb,text,uuid)'::regprocedure))>0 as allocation_integrated,
  position('student_price_restoration' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as storefront_signed_total,
  position('student_price_restoration' in pg_get_functiondef('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'::regprocedure))>0 as assisted_signed_total,
  position('public.student_reward_excluded_quantity' in pg_get_functiondef('public.persist_student_reward_snapshot(text,jsonb)'::regprocedure))>0 as reward_integrated,
  not has_function_privilege('authenticated','public.student_policy_price_lines(jsonb,text,uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.solve_student_policy_component(jsonb,jsonb,integer)','EXECUTE') as helpers_private,
  not has_table_privilege('authenticated','public.promotion_student_policy_settings','UPDATE') as switch_private,
  not has_function_privilege('anon','public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz)','EXECUTE')
    and has_function_privilege('authenticated','public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz)','EXECUTE') as editor_acl) v));
 if ok is distinct from true then raise exception 'Post-install verification failed';end if;
end $post$;
commit;
select
  (select count(*)=1 from public.promotion_student_policy_settings where singleton and version=1) as settings_present,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='promotions' and column_name='allow_student_price_stacking' and is_nullable='NO') as policy_column_present,
  position('public.student_policy_price_lines' in pg_get_functiondef('public.allocate_automatic_prices(jsonb,text,uuid)'::regprocedure))>0 as allocation_integrated,
  position('student_price_restoration' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as storefront_signed_total,
  position('student_price_restoration' in pg_get_functiondef('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'::regprocedure))>0 as assisted_signed_total,
  position('public.student_reward_excluded_quantity' in pg_get_functiondef('public.persist_student_reward_snapshot(text,jsonb)'::regprocedure))>0 as reward_integrated,
  not has_function_privilege('authenticated','public.student_policy_price_lines(jsonb,text,uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.solve_student_policy_component(jsonb,jsonb,integer)','EXECUTE') as helpers_private,
  not has_table_privilege('authenticated','public.promotion_student_policy_settings','UPDATE') as switch_private,
  not has_function_privilege('anon','public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz)','EXECUTE')
    and has_function_privilege('authenticated','public.save_promotion_student_policy(uuid,boolean,boolean,timestamptz)','EXECUTE') as editor_acl;
select (select enabled from public.promotion_student_policy_settings where singleton) as student_policy_enabled,(select enabled from public.automatic_price_allocation_settings where singleton) as allocation_enabled;

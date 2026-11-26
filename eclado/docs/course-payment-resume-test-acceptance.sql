-- Only run in qqlgqasbmbicnmvnlqbr (ECLADO Test). Bank evidence is simulated; ALL scenario changes roll back.
begin;
create temp table course_resume_acceptance(result text);
do $$
declare actor uuid; cid uuid:=gen_random_uuid(); order_data jsonb; first_attempt jsonb; next_attempt jsonb; paid jsonb;
 method text; notice jsonb; n integer; notice_order uuid; free_order jsonb; teacher uuid;
begin
 select id into actor from public.profiles where role='pro' limit 1;
 select id into teacher from public.profiles where role='instructor' limit 1;
 if actor is null or teacher is null then raise exception 'TEST pro/instructor fixture missing'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 insert into public.courses(id,name,description,image_path,starts_at,ends_at,price_twd,published)
 values(cid,'TEST｜課程續付驗收（交易回滾）','僅供測試',cid::text||'.webp',now()+interval '31 days',now()+interval '31 days 2 hours',1000,true);
 foreach method in array array['card','apple','google','atm'] loop
  -- Reuse TEST teacher and a simulated guest, never touch any real course registration.
  perform set_config('request.jwt.claim.sub',teacher::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  order_data:=public.create_course_registration(cid,gen_random_uuid(),false,'[{"family_name":"驗收","given_name":"參加者"}]',1000);
  if (order_data->>'payment_due_at')::timestamptz is distinct from (select starts_at from public.courses where id=cid) then raise exception 'Deadline mismatch'; end if;
  first_attempt:=public.claim_course_payment((order_data->>'id')::uuid,teacher,true,method);
  perform public.store_course_payment_link(first_attempt->>'provider_order_no','https://bank.example.test/original','old-'||method,
    case when method='atm' then '12345678901234' end);
  if (public.claim_course_payment((order_data->>'id')::uuid,teacher,true,method)->>'payment_url')<>'https://bank.example.test/original' then raise exception 'Live payment not reused'; end if;
  update public.course_payment_attempts set link_expires_at=now()-interval '1 second' where provider_order_no=first_attempt->>'provider_order_no';
  next_attempt:=public.renew_course_payment((order_data->>'id')::uuid,teacher,first_attempt->>'provider_order_no',
    case when method='atm' then '1A250' when method='card' then '1C250' else '1M250' end);
  if (next_attempt->>'attempt_no')::integer<>2 then raise exception 'Retry not created'; end if;
  if public.renew_course_payment((order_data->>'id')::uuid,teacher,first_attempt->>'provider_order_no','1C250')->>'changed'<>'true' then raise exception 'Concurrent stale retry not blocked'; end if;
  perform public.store_course_payment_link(next_attempt->>'provider_order_no','https://bank.example.test/renewed','new-'||method,
    case when method='atm' then '22345678901234' end);
  paid:=public.confirm_course_payment(next_attempt->>'provider_order_no',100000,'new-'||method);
  if paid->>'status'<>'paid' then raise exception 'Confirmation failed'; end if;
  perform public.confirm_course_payment(next_attempt->>'provider_order_no',100000,'new-'||method);
  if (select count(*) from public.course_registrations where order_id=(order_data->>'id')::uuid and status='active')<>1 then raise exception 'Duplicate registration'; end if;
  insert into course_resume_acceptance values(method||': deadline/live reuse/renewal/stale retry/paid callback replay OK');
 end loop;
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 free_order:=public.create_course_registration(cid,gen_random_uuid(),true,'[]',1000);
 if free_order->>'status'<>'free' then raise exception 'Free registration changed'; end if;
 insert into course_resume_acceptance values('instructor free registration OK');
 order_data:=public.create_course_registration(cid,gen_random_uuid(),false,'[{"family_name":"提醒","given_name":"參加者"}]',1000);
 notice_order:=(order_data->>'id')::uuid;
 update public.course_orders set created_at=now()-interval '25 hours' where id=notice_order;
 -- Notice claims never send anything. Ignore pre-existing TEST jobs and roll back all claims.
 for n in 1..50 loop
  notice:=public.claim_course_payment_reminder(true,'TEST-NO-SEND@example.test');
  if notice is null then exit; end if;
  if notice->'payload'->>'order_id'=notice_order::text then
   if notice->'payload'->>'kind'<>'course_payment' or (notice->'payload')?'zoom_url' then raise exception 'Reminder payload invalid'; end if;
   perform public.complete_course_notification((notice->>'id')::uuid,(notice->>'lease_token')::uuid,'accepted');
   exit;
  end if;
 end loop;
 if not exists(select 1 from public.course_notifications where order_id=notice_order and kind='payment_first' and status='sent') then raise exception '24h reminder not queued'; end if;
 insert into course_resume_acceptance values('24h reminder claim/completion/no Zoom OK (no external message sent)');
 if not (select relrowsecurity from pg_class where oid='public.course_payment_attempts'::regclass)
    or has_function_privilege('authenticated','public.renew_course_payment(uuid,uuid,text,text)','EXECUTE') then raise exception 'RLS/permissions regressed'; end if;
 insert into course_resume_acceptance values('RLS and service-only renewal permissions OK');
end; $$;
select * from course_resume_acceptance;
rollback;

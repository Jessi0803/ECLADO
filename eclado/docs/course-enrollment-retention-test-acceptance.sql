-- TEST ONLY: qqlgqasbmbicnmvnlqbr. All scenario data rolls back; no bank/provider calls.
begin;
create temp table enrollment_retention_acceptance(result text);
do $$
declare actor uuid; teacher uuid; admin_id uuid; candidate record; cid uuid:=gen_random_uuid(); cid2 uuid:=gen_random_uuid();
 o jsonb; multi jsonb; detail jsonb; roster jsonb; a jsonb; seat uuid; other_seat uuid;
begin
 select id into actor from public.profiles where role='pro' limit 1;
 select id into teacher from public.profiles where role='instructor' limit 1;
 if actor is null or teacher is null then raise exception 'TEST fixtures missing'; end if;
 for candidate in select id from public.profiles loop
  perform set_config('request.jwt.claim.sub',candidate.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',candidate.id,'role','authenticated')::text,true);
  if public.has_backoffice_permission('courses.manage') then admin_id:=candidate.id; exit; end if;
 end loop;
 if admin_id is null then raise exception 'TEST course administrator missing'; end if;
 insert into public.courses(id,name,description,image_path,starts_at,ends_at,price_twd,published)
 values(cid,'TEST｜報名保留驗收（回滾）','僅供測試',cid::text||'.webp',now()+interval '2 days',now()+interval '2 days 2 hours',1000,true),
 (cid2,'TEST｜部分取消驗收（回滾）','僅供測試',cid2::text||'.webp',now()+interval '3 days',now()+interval '3 days 2 hours',1000,true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 o:=public.create_course_registration(cid,gen_random_uuid(),true,'[]',1000);
 seat:=(o->'registrations'->0->>'id')::uuid;
 update public.courses set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id=cid;
 perform public.expire_course_registrations();
 detail:=public.get_my_course_orders(cid);
 if detail->'orders'->0->>'status'<>'expired' or detail->'orders'->0->'registrations'->0->>'status'<>'pending' then raise exception 'Enrollment not retained'; end if;
 if (select cancelled_at from public.course_registrations where id=seat) is not null then raise exception 'Unexpected auto cancellation'; end if;
 if detail->>'zoom_url' is not null then raise exception 'Unpaid Zoom access'; end if;
 insert into enrollment_retention_acceptance values('After class: enrollment retained, payment overdue, no auto-cancel, no unpaid Zoom access');
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 roster:=public.get_admin_course_roster(cid);
 if roster->'registrations'->0->>'status'<>'pending' or roster->'registrations'->0->>'payment_status'<>'expired' then raise exception 'Admin status conflated'; end if;
 perform public.cancel_course_registration(seat,'TEST 客人主動要求取消');
 perform public.cancel_course_registration(seat,'TEST 客人主動要求取消');
 if not exists(select 1 from public.course_registrations where id=seat and status='cancelled' and cancelled_by=admin_id) then raise exception 'Admin cancellation failed'; end if;
 insert into enrollment_retention_acceptance values('Staff cancellation after class accepted on request, actor/reason retained, replay idempotent');
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 multi:=public.create_course_registration(cid2,gen_random_uuid(),true,'[{"family_name":"甲","given_name":"驗收"},{"family_name":"乙","given_name":"驗收"}]',1000);
 select id into seat from public.course_registrations where order_id=(multi->>'id')::uuid and participant_name='甲驗收';
 select id into other_seat from public.course_registrations where order_id=(multi->>'id')::uuid and participant_name='乙驗收';
 a:=public.claim_course_payment((multi->>'id')::uuid,teacher,true,'atm');
 perform public.store_course_payment_link(a->>'provider_order_no','https://bank.example.test/test-only','retention-test','12345678901234');
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 perform public.cancel_course_registration(seat,'TEST 客人主動要求取消其中一位');
 if (select status from public.course_orders where id=(multi->>'id')::uuid)<>'hold'
   or (select status from public.course_registrations where id=other_seat)<>'pending' then raise exception 'Remaining enrollment affected'; end if;
 a:=public.claim_course_payment((multi->>'id')::uuid,teacher,true,'atm');
 if a->>'eligible'<>'false' or a->>'payment_url' is not null then raise exception 'Original full-price payment still active'; end if;
 if (select count(*) from public.course_manual_cases where registration_id=seat and kind='cancelled_unpaid_registration')<>1 then raise exception 'Manual case missing'; end if;
 insert into enrollment_retention_acceptance values('Partial unpaid cancellation: other enrollment/free instructor retained, original payment paused, manual case recorded');
end; $$;
select * from enrollment_retention_acceptance;
rollback;

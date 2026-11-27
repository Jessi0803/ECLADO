-- TEST ONLY; all fixtures roll back. No bank or notifications sent.
begin;
create temp table enrollment_indicator_acceptance(result text);
do $$
declare teacher uuid; student uuid; binding uuid; stranger uuid; cid uuid:=gen_random_uuid();
 cid2 uuid:=gen_random_uuid(); cid3 uuid:=gen_random_uuid(); o jsonb; detail jsonb; own jsonb; listing jsonb; n integer;
begin
 select b.instructor_id,b.student_id,b.id into teacher,student,binding from public.instructor_student_bindings b
 join public.profiles p on p.id=b.instructor_id where b.ended_at is null and p.role='instructor' limit 1;
 select id into stranger from public.profiles where id not in(teacher,student) and role='pro' limit 1;
 if teacher is null or stranger is null then raise exception 'TEST profiles missing'; end if;
 insert into public.courses(id,name,description,image_path,starts_at,ends_at,price_twd,published)
 select id,'TEST｜代報提示驗收（回滾）','TEST',id::text||'.webp',now()+interval '2 days',now()+interval '2 days 2 hours',1000,true
 from unnest(array[cid,cid2,cid3]) id;
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 o:=public.create_course_registration(cid,gen_random_uuid(),false,jsonb_build_array(
  jsonb_build_object('binding_id',binding),jsonb_build_object('family_name','其他','given_name','參加者')),1000);
 listing:=public.get_my_course_students(cid);
 if not exists(select 1 from jsonb_array_elements(listing) s where s->>'binding_id'=binding::text and s->>'registration_status'='pending') then raise exception 'Teacher missing pending indicator'; end if;
 perform set_config('request.jwt.claim.sub',student::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',student,'role','authenticated')::text,true);
 detail:=public.get_my_course_orders(cid);
 if detail->'delegated_registration'->>'status'<>'pending' or detail->'delegated_registration'->>'payment_status'<>'pending' or jsonb_array_length(detail->'orders')<>0 then raise exception 'Student status/owned order isolation failed'; end if;
 if detail::text like '%其他參加者%' or detail::text like '%'||(o->>'id')||'%' or detail->>'zoom_url' is not null then raise exception 'Peer/order/meeting leaked'; end if;
 own:=public.get_my_course_orders(null);
 if exists(select 1 from jsonb_array_elements(own->'courses') c where c->>'id'=cid::text) then raise exception 'Delegation exposed in member history'; end if;
 begin perform public.create_course_registration(cid,gen_random_uuid(),true,'[]',1000);raise exception 'Student duplicate accepted';
 exception when unique_violation then null;end;
 update public.course_orders set payment_due_at=now()-interval '1 minute' where id=(o->>'id')::uuid;
 detail:=public.get_my_course_orders(cid);
 if detail->'delegated_registration'->>'payment_status'<>'expired' or detail->'delegated_registration'->>'status'<>'pending' then raise exception 'Overdue status missing';end if;
 update public.course_registrations set status='cancelled',cancelled_at=now(),cancel_reason='TEST 客人要求' where member_id=student and course_id=cid;
 if public.get_my_course_orders(cid)->'delegated_registration'<>'null'::jsonb then raise exception 'Cancelled delegation blocks retry';end if;
 insert into enrollment_indicator_acceptance values('Student sees only own pending/overdue status, no payer order/peers/Zoom/history; duplicate rejected; cancellation removes block');
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 if exists(select 1 from jsonb_array_elements(public.get_my_course_students(cid)) s where s->>'registration_status' is not null) then raise exception 'Cancelled student still disabled';end if;
 perform public.create_course_registration(cid2,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);
 if not exists(select 1 from jsonb_array_elements(public.get_my_course_students(cid2)) s where s->>'registration_status'='active') then raise exception 'Active student not disabled';end if;
 perform set_config('request.jwt.claim.sub',student::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',student,'role','authenticated')::text,true);
 detail:=public.get_my_course_orders(cid2);
 if detail->'delegated_registration'->>'payment_status'<>'free' or detail->'delegated_registration'->>'status'<>'active' then raise exception 'Free indicator incorrect';end if;
 perform public.create_course_registration(cid3,gen_random_uuid(),true,'[]',1000);
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 if not exists(select 1 from jsonb_array_elements(public.get_my_course_students(cid3)) s where s->>'registration_status'='pending') then raise exception 'Self enrollment not marked to teacher';end if;
 begin perform public.create_course_registration(cid3,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);raise exception 'Teacher duplicate accepted';
 exception when unique_violation then null;end;
 insert into enrollment_indicator_acceptance values('Own student paid/free/self-enrollment all marked; cancelled student selectable; both duplicate directions rejected');
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',stranger,'role','authenticated')::text,true);
 if public.get_my_course_orders(cid2)->'delegated_registration'<>'null'::jsonb then raise exception 'Stranger status leak';end if;
 begin perform public.get_my_course_students(cid2);raise exception 'Non-instructor roster access accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin perform public.get_my_course_students(cid2);raise exception 'Anonymous roster accepted';exception when insufficient_privilege then null;end;
 begin perform public.get_my_course_orders(cid2);raise exception 'Anonymous status accepted';exception when insufficient_privilege then null;end;
 insert into enrollment_indicator_acceptance values('Unrelated member, non-instructor and anonymous access blocked; limited status payload exposes no peer/order credentials');
end;$$;
select * from enrollment_indicator_acceptance;
rollback;

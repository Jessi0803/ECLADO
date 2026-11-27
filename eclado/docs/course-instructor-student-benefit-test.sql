-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Transaction rolls back all fixtures and credits.
begin;
create temp table benefit_acceptance(result text);
do $$
declare teacher uuid; student uuid; binding uuid; other_teacher uuid; foreign_binding uuid:=gen_random_uuid();
 admin_id uuid; candidate record; cid uuid:=gen_random_uuid(); free_cid uuid:=gen_random_uuid();
 cancel_cid uuid:=gen_random_uuid(); late_cid uuid:=gen_random_uuid(); mixed jsonb; free_order jsonb; cancel_order jsonb;
 request_id uuid:=gen_random_uuid(); payload jsonb; attempt jsonb; free_seat uuid; paid_seat uuid; n integer; earliest timestamptz;
begin
 select b.instructor_id,b.student_id,b.id into teacher,student,binding
 from public.instructor_student_bindings b join public.profiles p on p.id=b.instructor_id
 where b.ended_at is null and p.role='instructor' limit 1;
 if teacher is null then raise exception 'TEST instructor binding fixture missing'; end if;
 for candidate in select id from public.profiles loop
  perform set_config('request.jwt.claim.sub',candidate.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',candidate.id,'role','authenticated')::text,true);
  if public.has_backoffice_permission('courses.manage') then admin_id:=candidate.id; exit; end if;
 end loop;
 if admin_id is null then raise exception 'TEST admin missing'; end if;
 select id into other_teacher from public.profiles where role='pro' and id not in(student,admin_id) limit 1;
 -- Temporary foreign instructor/binding: never persisted.
 update public.profiles set role='instructor' where id=other_teacher;
 insert into public.instructor_student_bindings(id,student_id,instructor_id,created_by)
 values(foreign_binding,admin_id,other_teacher,admin_id);
 insert into public.courses(id,name,description,image_path,starts_at,ends_at,price_twd,published)
 select id,'TEST｜師資權益驗收（回滾）','TEST',id::text||'.webp',now()+interval '2 days',now()+interval '2 days 2 hours',1000,true
 from unnest(array[cid,free_cid,cancel_cid]) id;
 insert into public.courses(id,name,description,image_path,starts_at,ends_at,price_twd,published)
 values(late_cid,'TEST｜免費名額付款截止後驗收','TEST',late_cid::text||'.webp',now()+interval '15 minutes',now()+interval '2 hours',1000,true);
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 begin
  perform public.create_course_registration(cid,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',foreign_binding,'benefit_free',true)),1000);
  raise exception 'Foreign student free enrollment accepted';
 exception when sqlstate '22023' or sqlstate '42501' then null; end;
 begin
  perform public.create_course_registration(cid,gen_random_uuid(),false,'[{"family_name":"王","given_name":"客人","benefit_free":true}]',1000);
  raise exception 'Manual free enrollment accepted';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.create_course_registration(cid,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free','true')),1000);
  raise exception 'Nonboolean flag accepted';
 exception when sqlstate '22023' then null; end;
 update public.instructor_student_bindings set ended_at=now(),ended_by=admin_id,end_reason='unbound' where id=binding;
 begin
  perform public.create_course_registration(cid,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);
  raise exception 'Ended binding accepted';
 exception when sqlstate '22023' then null; end;
 update public.instructor_student_bindings set ended_at=null,ended_by=null,end_reason=null where id=binding;
 insert into benefit_acceptance values('Ownership enforced: foreign binding, manual name, malformed flag and ended binding rejected');
 payload:=jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true),jsonb_build_object('family_name','付費','given_name','學生'));
 mixed:=public.create_course_registration(cid,request_id,false,payload,1000);
 if mixed->>'total_twd'<>'1000' or mixed->>'status'<>'pending' then raise exception 'Mixed amount/status incorrect'; end if;
 if (select paid_seats from public.course_orders where id=(mixed->>'id')::uuid)<>1 then raise exception 'Free seat counted as paid'; end if;
 select id into free_seat from public.course_registrations where order_id=(mixed->>'id')::uuid and benefit_free and status='active' and confirmed_at is not null;
 select id into paid_seat from public.course_registrations where order_id=(mixed->>'id')::uuid and not benefit_free and status='pending';
 if free_seat is null or paid_seat is null then raise exception 'Per-seat status incorrect'; end if;
 if public.create_course_registration(cid,request_id,false,payload,1000)->>'id'<>mixed->>'id' then raise exception 'Replay created another order'; end if;
 begin
  perform public.create_course_registration(cid,request_id,false,'[]',1000);raise exception 'Changed replay accepted';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.create_course_registration(cid,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);
  raise exception 'Duplicate student accepted';
 exception when sqlstate '23505' then null; end;
 if (select count(*) from public.course_notice_recipients where course_id=cid)<>1 then raise exception 'Free seat notification missing/unpaid seat included'; end if;
 insert into benefit_acceptance values('Mixed enrollment: one free active seat, one paid pending seat, NT$1000 total; replay and duplicate prevention pass');
 free_order:=public.create_course_registration(free_cid,gen_random_uuid(),true,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);
 if free_order->>'status'<>'free' or free_order->>'total_twd'<>'0' or (select count(*) from public.course_registrations where order_id=(free_order->>'id')::uuid and status='active')<>2 then raise exception 'All-free/student+self failed'; end if;
 attempt:=public.claim_course_payment((free_order->>'id')::uuid,teacher,true,'card');
 if attempt->>'eligible'='true' or exists(select 1 from public.course_payment_attempts where order_id=(free_order->>'id')::uuid) then raise exception 'Free order created payment'; end if;
 perform public.create_course_registration(late_cid,gen_random_uuid(),false,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);
 insert into benefit_acceptance values('All-free/self+student confirmed with no bank attempt; free enrollment still works before class after paid cutoff');
 attempt:=public.claim_course_payment((mixed->>'id')::uuid,teacher,true,'card');
 perform public.store_course_payment_link(attempt->>'provider_order_no','https://bank.example.test/benefit','benefit-transaction',null);
 perform public.confirm_course_payment(attempt->>'provider_order_no',100000,'benefit-transaction');
 perform public.confirm_course_payment(attempt->>'provider_order_no',100000,'benefit-transaction');
 if (select count(*) from public.pending_course_shopping_credit where order_id=(mixed->>'id')::uuid)<>1
  or exists(select 1 from public.pending_course_shopping_credit where registration_id=free_seat) then raise exception 'Free shopping credit eligibility'; end if;
 if (select count(*) from public.course_notice_recipients where course_id=cid)<>2 then raise exception 'Paid/free notice eligibility'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 if not exists(select 1 from jsonb_array_elements(public.get_admin_course_roster(cid)->'registrations') r
  where r->>'id'=free_seat::text and r->>'payment_status'='free' and r->>'benefit_free'='true') then raise exception 'Admin free status incorrect'; end if;
 insert into benefit_acceptance values('Mixed payment capture/replay: only paid seat eligible for credit; admin free flag and notice eligibility correct');
 -- Force this fixture first in the existing grant batch; both executions and all ledger writes roll back.
 select least(min(ends_at),now())-interval '1 day' into earliest from public.courses;
 update public.courses set starts_at=earliest-interval '2 hours',ends_at=earliest where id=cid;
 perform public.grant_finished_course_shopping_credit();perform public.grant_finished_course_shopping_credit();
 if (select count(*) from public.shopping_credit_ledger where metadata->>'course_order_id'=mixed->>'id' and event_type='grant')<>1
  or (select sum(amount) from public.shopping_credit_ledger where metadata->>'course_order_id'=mixed->>'id' and event_type='grant')<>1000 then raise exception 'Credit amount/idempotency failed'; end if;
 perform public.record_course_after_class_case(free_seat,'TEST 免費名額');
 begin
  perform public.resolve_course_case_and_record_refund((select id from public.course_manual_cases where registration_id=free_seat),'TEST 不應退款',100);
  raise exception 'Free seat refunded';
 exception when sqlstate '22023' then null; end;
 insert into benefit_acceptance values('Grant run twice: exactly one NT$1000 credit, no free-seat credit; free-seat refund rejected');
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
 cancel_order:=public.create_course_registration(cancel_cid,gen_random_uuid(),false,payload,1000);
 select id into free_seat from public.course_registrations where order_id=(cancel_order->>'id')::uuid and benefit_free;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 perform public.cancel_course_registration(free_seat,'TEST 客人要求取消免費名額');
 if (select status from public.course_orders where id=(cancel_order->>'id')::uuid)<>'pending' or exists(select 1 from public.course_manual_cases where registration_id=free_seat) then raise exception 'Free cancellation affected paid amount'; end if;
 perform set_config('request.jwt.claim.sub',student::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',student,'role','authenticated')::text,true);
 begin
  perform public.create_course_registration(cancel_cid,gen_random_uuid(),true,jsonb_build_array(jsonb_build_object('binding_id',binding,'benefit_free',true)),1000);
  raise exception 'Non-instructor free delegation accepted';
 exception when sqlstate '22023' or sqlstate '42501' then null; end;
 insert into benefit_acceptance values('Free cancellation leaves other paid enrollment unchanged; non-instructor delegation rejected');
end; $$;
select * from benefit_acceptance;
rollback;

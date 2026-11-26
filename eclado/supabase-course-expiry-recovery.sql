-- Apply after course-enrollment-retention. No historical order is restored automatically.
begin;
alter table public.course_payment_attempts add column retired_at timestamptz,
 add column retirement_bank_status text;
alter table public.course_payment_attempts add constraint course_attempt_retirement_evidence check(
 (retired_at is null and retirement_bank_status is null) or
 (retired_at is not null and retirement_bank_status is not null and retirement_bank_status in ('1C250','1M250')));
create table public.course_expiry_recoveries (
 order_id uuid primary key references public.course_orders(id),
 previous_provider_order_no text not null,
 bank_status text not null check(bank_status in('1C250','1M250')),
 bank_checked_at timestamptz not null,
 restored_at timestamptz not null default clock_timestamp(),
 old_payment_due_at timestamptz not null,
 new_payment_due_at timestamptz not null,
 previous_cancellations jsonb not null,
 reason text not null check(length(btrim(reason)) between 1 and 500)
);
alter table public.course_expiry_recoveries enable row level security;
revoke all on public.course_expiry_recoveries from public,anon,authenticated;
grant select on public.course_expiry_recoveries to service_role;
create or replace function public.course_order_summary(p_order public.course_orders)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_order.id,'course_id',p_order.course_id,'course_name',p_order.course_name,
  'total_twd',p_order.total_twd,'status',case when p_order.status='pending' and least(p_order.payment_due_at,c.starts_at)<=now() then 'expired' else p_order.status end,
  'payment_due_at',least(p_order.payment_due_at,c.starts_at),'paid_at',p_order.paid_at,
  'payment_method',a.payment_method,'payment_link_expires_at',a.link_expires_at,
  'payment_attempt_state',a.state,
  'atm_account',case when a.payment_method='atm' and a.state='pending' and p_order.status='pending'
    and c.published and least(a.link_expires_at,p_order.payment_due_at,c.starts_at)>now() then a.atm_account end,
  'atm_due_at',case when a.payment_method='atm' then a.link_expires_at end,
  'registrations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.participant_name,'kind',r.kind,
     'status',r.status)
     order by r.created_at,r.id) from public.course_registrations r where r.order_id=p_order.id),'[]'::jsonb))
 from public.courses c left join lateral (select * from public.course_payment_attempts a
   where a.order_id=p_order.id and a.retired_at is null order by attempt_no desc limit 1) a on true where c.id=p_order.course_id;
$$;

create or replace function public.claim_course_payment(p_order_id uuid,p_payer_id uuid,p_create boolean,p_method text default 'card')
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype;
 attempt public.course_payment_attempts%rowtype; minutes integer; deadline timestamptz; created boolean:=false; eligible boolean; next_no integer;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
   where o.id=p_order_id and o.payer_id=p_payer_id for update of c;
 select * into target from public.course_orders where id=p_order_id and payer_id=p_payer_id for update;
 if not found then return null; end if;
 select * into attempt from public.course_payment_attempts where order_id=target.id and retired_at is null order by attempt_no desc limit 1;
 eligible:=target.status='pending' and course.published and (course.publish_at is null or course.publish_at<=clock_timestamp())
   and least(course.starts_at,target.payment_due_at)>clock_timestamp()
   and exists(select 1 from public.profiles where id=p_payer_id and role=target.payer_role)
   and exists(select 1 from public.course_registrations where order_id=target.id and status='pending');
 if p_create and attempt.order_id is null and (p_method is null or p_method not in('atm','card','apple','google')
     or (p_method='atm' and target.total_twd>30000)) then return jsonb_build_object('method_unavailable',true); end if;
 minutes:=least(10,floor(extract(epoch from (least(course.starts_at,target.payment_due_at)-clock_timestamp()))/60)::integer);
 deadline:=date_trunc('minute',least(course.starts_at,target.payment_due_at,clock_timestamp()+interval '29 days'));
 if p_create and eligible and minutes>=1 and attempt.order_id is null then
   select coalesce(max(attempt_no),0)+1 into next_no from public.course_payment_attempts where order_id=target.id;
   insert into public.course_payment_attempts(order_id,attempt_no,provider_order_no,state,link_expires_at,payment_method)
   values(target.id,next_no,'CRS'||replace(case when next_no=1 then target.id::text else gen_random_uuid()::text end,'-',''),'creating',
     case when p_method='atm' then deadline else clock_timestamp()+make_interval(mins=>minutes) end,p_method) returning * into attempt;
   created:=true;
 end if;
 return jsonb_build_object('summary',public.course_order_summary(target),'provider_order_no',attempt.provider_order_no,
   'attempt_no',attempt.attempt_no,'attempt_state',attempt.state,'eligible',eligible,'create_attempt',created,
   'minutes',minutes,'payment_method',attempt.payment_method,'link_expires_at',attempt.link_expires_at,
   'payment_url',case when p_create and eligible and attempt.state='pending'
     and least(attempt.link_expires_at,course.starts_at,target.payment_due_at)>clock_timestamp() then attempt.payment_url end);
end; $$;

create or replace function public.confirm_course_payment(p_provider_order_no text,p_amount_cents integer,p_transaction_no text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype; attempt public.course_payment_attempts%rowtype; received_at timestamptz;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
   join public.course_payment_attempts a on a.order_id=o.id where a.provider_order_no=p_provider_order_no for update of c;
 select o.* into target from public.course_orders o join public.course_payment_attempts a on a.order_id=o.id
   where a.provider_order_no=p_provider_order_no for update of o;
 select * into attempt from public.course_payment_attempts where provider_order_no=p_provider_order_no for update;
 if not found or p_amount_cents is distinct from target.total_twd*100 or coalesce(length(p_transaction_no),0) not between 1 and 80
  or (attempt.provider_transaction_no is not null and attempt.provider_transaction_no<>p_transaction_no) then
   raise exception 'Course payment evidence mismatch' using errcode='22023'; end if;
 if attempt.state in('paid','review') then return public.course_order_summary(target); end if;
 received_at:=clock_timestamp();
 if target.status in('paid','review') then
   update public.course_payment_attempts set state='review',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   insert into public.course_manual_cases(order_id,kind,reason)
    values(target.id,'payment_exception','另一筆付款嘗試亦確認收款，請人工核對重複收款；不重複成立報名或發放購物金')
    on conflict(order_id) where kind='payment_exception' do nothing;
   return public.course_order_summary(target);
 end if;
 if attempt.retired_at is not null or target.status<>'pending' or received_at>=least(target.payment_due_at,course.starts_at)
   or not course.published or (course.publish_at is not null and course.publish_at>received_at)
   or not exists(select 1 from public.course_registrations where order_id=target.id and status='pending') then
   update public.course_orders set status='review',paid_at=received_at where id=target.id returning * into target;
   update public.course_payment_attempts set state='review',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   -- Late/held payment goes to review; enrollment is never automatically cancelled.
   insert into public.course_manual_cases(order_id,kind,reason)
     values(target.id,'payment_exception','已確認銀行收款，但課程或原訂單已不接受付款，請人工處理')
     on conflict(order_id) where kind='payment_exception' do nothing;
 else
   update public.course_orders set status='paid',paid_at=received_at where id=target.id returning * into target;
   update public.course_payment_attempts set state='paid',provider_transaction_no=p_transaction_no where provider_order_no=p_provider_order_no;
   update public.course_registrations set status='active',confirmed_at=received_at where order_id=target.id and status='pending';
 end if;
 return public.course_order_summary(target);
end; $$;

-- Only the trusted operator can recover these historical self-paid enrollments,
-- after a fresh, signed bank query. This is not a customer payment-method switch.
create function public.recover_expired_course_enrollment(
 p_order_id uuid,p_previous_provider text,p_bank_status text,p_bank_checked_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; target public.course_orders%rowtype;
 attempt public.course_payment_attempts%rowtype; seat public.course_registrations%rowtype;
 prior public.course_expiry_recoveries%rowtype;
begin
 select c.* into course from public.courses c join public.course_orders o on o.course_id=c.id
  where o.id=p_order_id for update of c;
 select * into target from public.course_orders where id=p_order_id for update;
 if not found then raise exception '找不到原課程訂單' using errcode='22023'; end if;
 select * into prior from public.course_expiry_recoveries where order_id=target.id;
 if found then
  if prior.previous_provider_order_no is distinct from p_previous_provider then
   raise exception '原付款紀錄不符' using errcode='22023'; end if;
  return public.course_order_summary(target);
 end if;
 if p_bank_status is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
  or p_bank_checked_at is null or p_bank_checked_at>clock_timestamp()+interval '10 seconds'
  or p_bank_checked_at<clock_timestamp()-interval '5 minutes' then
  raise exception '需要最新的銀行未付款查證與恢復原因' using errcode='22023'; end if;
 select * into attempt from public.course_payment_attempts where order_id=target.id order by attempt_no desc limit 1 for update;
 if not found or attempt.provider_order_no is distinct from p_previous_provider or attempt.retired_at is not null
  or attempt.state not in('pending','failed') or attempt.link_expires_at>clock_timestamp()
  or not ((attempt.payment_method='card' and p_bank_status='1C250')
    or (attempt.payment_method in('apple','google') and p_bank_status='1M250')) then
  raise exception '原銀行交易尚未確認逾期未付款' using errcode='22023'; end if;
 if target.status<>'pending' or target.paid_at is not null or target.payer_role<>'pro'
  or target.paid_seats<>1 or target.total_twd<>target.unit_price_twd or target.payment_due_at>clock_timestamp()
  or not course.published or (course.publish_at is not null and course.publish_at>clock_timestamp())
  or course.starts_at<clock_timestamp()+interval '1 minute'
  or not exists(select 1 from public.profiles where id=target.payer_id and role='pro')
  or exists(select 1 from public.course_manual_cases where order_id=target.id)
  or exists(select 1 from public.course_payment_attempts where order_id=target.id and state in('paid','review','creating'))
  or (select count(*) from public.course_registrations where order_id=target.id)<>1 then
  raise exception '此原訂單不符合逾期恢復條件' using errcode='22023'; end if;
 select * into seat from public.course_registrations where order_id=target.id for update;
 if seat.kind<>'pro_self' or seat.status<>'cancelled' or seat.cancel_reason is distinct from '付款期限已過'
  or seat.cancelled_by is not null or seat.confirmed_at is not null then
  raise exception '只可恢復付款逾期自動取消的美容師本人報名' using errcode='22023'; end if;
 if exists(select 1 from public.course_registrations r join public.course_orders o on o.id=r.order_id
  where r.course_id=course.id and r.id<>seat.id and r.status in('pending','active')
  and ((seat.member_id is not null and r.member_id=seat.member_id)
   or (r.kind='pro_self' and o.payer_id=target.payer_id))) then
  raise exception '會員已有同堂課的有效報名，不可重複恢復' using errcode='23505'; end if;
 insert into public.course_expiry_recoveries(order_id,previous_provider_order_no,bank_status,bank_checked_at,
  old_payment_due_at,new_payment_due_at,previous_cancellations,reason)
 values(target.id,attempt.provider_order_no,p_bank_status,p_bank_checked_at,target.payment_due_at,course.starts_at,
  jsonb_build_object('registration_id',seat.id,'status',seat.status,'cancelled_at',seat.cancelled_at,
   'cancelled_by',seat.cancelled_by,'cancel_reason',seat.cancel_reason),btrim(p_reason));
 update public.course_payment_attempts set retired_at=clock_timestamp(),retirement_bank_status=p_bank_status
  where provider_order_no=attempt.provider_order_no;
 update public.course_registrations set status='pending',cancelled_at=null,cancelled_by=null,cancel_reason=null
  where id=seat.id;
 update public.course_orders set payment_due_at=course.starts_at where id=target.id returning * into target;
 return public.course_order_summary(target);
end; $$;
revoke all on function public.recover_expired_course_enrollment(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.recover_expired_course_enrollment(uuid,text,text,timestamptz,text) to service_role;
notify pgrst,'reload schema';
commit;

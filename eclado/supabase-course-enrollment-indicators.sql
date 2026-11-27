-- Apply after supabase-course-instructor-student-benefit.sql. TEST first.
-- Delegated records remain absent from the student's member-center course history.
begin;
create or replace function public.get_my_course_orders(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  if p_course_id is null then
    return jsonb_build_object('courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
        'orders', bookings.orders,
        'zoom_url', case when bookings.has_active and c.ends_at > now() then m.zoom_url end
      ) order by (c.ends_at <= now()),
        case when c.ends_at > now() then c.starts_at end,
        case when c.ends_at <= now() then c.starts_at end desc, c.id)
      from public.courses c
      left join public.course_meeting_details m on m.course_id = c.id
      cross join lateral (
        select jsonb_agg(public.course_order_summary(o) - 'atm_account' order by o.created_at desc, o.id) as orders,
          bool_or(exists (select 1 from public.course_registrations r where r.order_id = o.id and r.status = 'active')) as has_active
        from public.course_orders o where o.payer_id = auth.uid() and o.course_id = c.id
      ) bookings
      where bookings.orders is not null
    ), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    -- Only the attendee's own status. No payer/order/peer/payment credentials.
    'delegated_registration', (select jsonb_build_object('status',r.status,'benefit_free',r.benefit_free,
      'payment_status',case when r.benefit_free then 'free'
        when o.status='pending' and least(o.payment_due_at,public.course_payment_deadline(c.starts_at))<=now() then 'expired'
        else o.status end,'payment_due_at',least(o.payment_due_at,public.course_payment_deadline(c.starts_at)))
      from public.course_registrations r join public.course_orders o on o.id=r.order_id
      join public.courses c on c.id=r.course_id
      where r.course_id=p_course_id and r.member_id=auth.uid() and r.kind='delegated'
        and r.status in('active','pending') and o.payer_id<>auth.uid() limit 1),
    'orders', coalesce((select jsonb_agg(public.course_order_summary(o) order by o.created_at desc)
      from public.course_orders o where o.payer_id = auth.uid() and o.course_id = p_course_id), '[]'::jsonb),
    'ends_at', (select c.ends_at from public.courses c where c.id = p_course_id and exists (
      select 1 from public.course_orders o where o.course_id = c.id and o.payer_id = auth.uid()
    )),
    'zoom_url', (select m.zoom_url from public.course_meeting_details m
      join public.courses c on c.id = m.course_id
      where m.course_id = p_course_id and c.ends_at > now() and exists (
      select 1 from public.course_orders o join public.course_registrations r on r.order_id = o.id
      where o.course_id = p_course_id and o.payer_id = auth.uid() and r.status = 'active'
    ))
  );
end;
$$;

create function public.get_my_course_students(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then
  raise exception '師資資格不足' using errcode='42501'; end if;
 if not exists(select 1 from public.courses where id=p_course_id and published
  and (publish_at is null or publish_at<=now())) then
  raise exception '找不到此課程，或課程已下架' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('binding_id',b.id,'student_name',s.name,
  'registration_status',r.status) order by b.created_at,b.id)
  from public.instructor_student_bindings b join public.profiles s on s.id=b.student_id
  left join public.course_registrations r on r.member_id=b.student_id and r.course_id=p_course_id
    and r.status in('active','pending')
  where b.instructor_id=auth.uid() and b.ended_at is null),'[]'::jsonb);
end; $$;
revoke all on function public.get_my_course_students(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_course_students(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

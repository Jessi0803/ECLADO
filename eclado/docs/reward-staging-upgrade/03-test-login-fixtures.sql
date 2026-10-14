-- Test-only login fixtures for qqlgqasbmbicnmvnlqbr.
-- Requires the three Auth users to be created and confirmed in the dashboard.
-- This script must never be run against the production project.

begin;

do $$
declare
  test_admin_id uuid;
  test_instructor_id uuid;
  test_student_id uuid;
  new_binding_id uuid;
begin
  select id into strict test_admin_id
  from auth.users where lower(email) = 'admin.stage@eclado.test';
  select id into strict test_instructor_id
  from auth.users where lower(email) = 'instructor.stage@eclado.test';
  select id into strict test_student_id
  from auth.users where lower(email) = 'student.stage@eclado.test';

  if exists (
    select 1 from public.instructor_student_bindings binding
    where binding.ended_at is null and binding.student_id = test_student_id
  ) or exists (
    select 1 from public.instructor_student_settings setting
    where setting.instructor_id = test_instructor_id
  ) then
    raise exception 'Test instructor/student fixtures already exist';
  end if;

  update public.profiles
  set name = 'TEST 管理員', role = 'staff', updated_at = now()
  where id = test_admin_id;
  update public.profiles
  set name = 'TEST 師資', role = 'instructor', updated_at = now()
  where id = test_instructor_id;
  update public.profiles
  set name = 'TEST 學生', role = 'pro', updated_at = now()
  where id = test_student_id;

  if (select count(*) from public.profiles where id in (test_admin_id, test_instructor_id, test_student_id)) <> 3 then
    raise exception 'Expected profiles were not created by the Auth trigger';
  end if;

  insert into public.admin_users(user_id, role, active, created_by)
  values(test_admin_id, 'super_admin', true, test_admin_id)
  on conflict (user_id) do update
  set role = excluded.role, active = true;

  insert into public.professional_memberships(
    user_id, role, started_on, created_by, change_reason
  )
  select test_instructor_id, 'instructor', current_date, test_admin_id,
    'Test fixture for reward-system acceptance'
  where not exists (
    select 1 from public.professional_memberships
    where user_id = test_instructor_id and ended_on is null
  );

  insert into public.instructor_student_settings(
    instructor_id, student_price_type, version, updated_by, updated_at
  ) values(test_instructor_id, 'student_1', 1, test_admin_id, now());

  insert into public.instructor_student_audit_logs(
    event_type, instructor_id, actor_user_id, actor_kind,
    before_data, after_data
  ) values(
    'instructor_type', test_instructor_id, test_admin_id, 'admin',
    jsonb_build_object('student_price_type', null, 'version', 0),
    jsonb_build_object('student_price_type', 'student_1', 'version', 1)
  );

  insert into public.instructor_student_bindings(
    student_id, instructor_id, created_by
  ) values(test_student_id, test_instructor_id, test_admin_id)
  returning id into new_binding_id;

  insert into public.instructor_student_audit_logs(
    event_type, student_id, instructor_id, actor_user_id, actor_kind,
    before_data, after_data
  ) values(
    'bind', test_student_id, test_instructor_id, test_admin_id, 'admin',
    jsonb_build_object('binding_id', null, 'instructor_id', null),
    jsonb_build_object('binding_id', new_binding_id, 'instructor_id', test_instructor_id)
  );
end;
$$;

commit;

select jsonb_build_object(
  'profiles', (
    select jsonb_agg(jsonb_build_object('email', email, 'name', name, 'role', role) order by email)
    from public.profiles
    where lower(email) in (
      'admin.stage@eclado.test',
      'instructor.stage@eclado.test',
      'student.stage@eclado.test'
    )
  ),
  'admin_role', (
    select role from public.admin_users
    where user_id = (select id from auth.users where lower(email) = 'admin.stage@eclado.test')
  ),
  'student_context', public.instructor_student_context(
    (select id from auth.users where lower(email) = 'student.stage@eclado.test')
  ),
  'student_pricing_enabled', (
    select enabled from public.student_pricing_feature_settings where singleton
  )
) as verification;

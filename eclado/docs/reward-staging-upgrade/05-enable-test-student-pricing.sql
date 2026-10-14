-- Test-only feature switch for qqlgqasbmbicnmvnlqbr.
-- Never run against production. Revert by setting enabled=false and incrementing version.

begin;

do $$
begin
  if (select count(*) from auth.users where lower(email) in (
    'admin.stage@eclado.test',
    'instructor.stage@eclado.test',
    'student.stage@eclado.test'
  )) <> 3 or not exists (
    select 1 from public.products
    where lower(slug) = 'reward-system-test-product'
  ) then
    raise exception 'Test login and catalog fixtures are required';
  end if;
end;
$$;

update public.student_pricing_feature_settings
set enabled = true,
    version = version + case when enabled then 0 else 1 end,
    updated_at = now()
where singleton;

commit;

select jsonb_build_object(
  'enabled', feature.enabled,
  'version', feature.version,
  'student_multiplier', public.student_pricing_multiplier(student.id),
  'student_1', settings.student_1,
  'student_2', settings.student_2,
  'expected_100ml', public.apply_student_price(1000, public.student_pricing_multiplier(student.id)),
  'expected_200ml', public.apply_student_price(1600, public.student_pricing_multiplier(student.id))
) as verification
from public.student_pricing_feature_settings feature
cross join public.student_pricing_settings settings
cross join lateral (
  select id from auth.users where lower(email) = 'student.stage@eclado.test'
) student
where feature.singleton and settings.singleton;

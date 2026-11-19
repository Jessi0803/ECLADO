-- Apply after the course foundation and description-image migrations, before
-- releasing the frontend JPEG fallback. Safe to reapply; retains scheduled
-- publication checks in the installed image-visibility function.
begin;

alter table public.courses drop constraint if exists courses_image_path_check;
alter table public.courses add constraint courses_image_path_check
  check (image_path ~ '^[0-9a-f-]{36}\.(webp|jpg)$');

update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg']::text[]
where id = 'course-images';

drop policy if exists course_images_upload_admin on storage.objects;
create policy course_images_upload_admin on storage.objects for insert to authenticated
with check (
  bucket_id = 'course-images' and name ~ '^[0-9a-f-]{36}\.(webp|jpg)$'
  and public.has_backoffice_permission('courses.manage')
);

do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.is_published_course_image(text)'::regprocedure);
  if strpos(definition, '\.(webp|jpg)$') = 0 then
    if strpos(definition, '\.webp$') = 0 then
      raise exception 'Expected course description image validation; apply supabase-course-description-images.sql first';
    end if;
    execute replace(definition, '\.webp$', '\.(webp|jpg)$');
  end if;
end;
$migration$;

commit;

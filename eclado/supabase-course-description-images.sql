-- Inline images use the same private bucket as course covers.
-- Only covers and images referenced by a published course are available to visitors.
create or replace function public.is_published_course_image(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.published and (
      c.image_path = p_path
      or (
        p_path ~ '^[0-9a-f-]{36}\.webp$'
        and left(c.description, 14) = E'ECLADO-RICH/1\n'
        and strpos(c.description, '<img data-course-image="' || p_path || '"') > 0
      )
    )
  );
$$;

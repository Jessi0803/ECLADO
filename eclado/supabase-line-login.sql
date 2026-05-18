-- ECLADO LINE Login migration
-- Run this once in Supabase SQL Editor before enabling LINE Login in production.

alter table public.profiles
  add column if not exists line_user_id text;

create unique index if not exists profiles_line_user_id_key
  on public.profiles (line_user_id)
  where line_user_id is not null;

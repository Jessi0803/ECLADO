-- Optional product subtitle shown below the product title.

alter table public.products
  add column if not exists subtitle text;

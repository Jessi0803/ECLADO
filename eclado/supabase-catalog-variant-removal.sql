-- Apply after the catalog save RPC is installed.
begin;

alter table public.product_variants
  add column if not exists removed_at timestamptz;

-- Keep the installed stock, pricing and permission logic.
do $migration$
declare
  definition text := pg_get_functiondef('public.save_product_with_variants(jsonb,jsonb)'::regprocedure);
  ownership text := E'where id = variant_id\n          and product_id = target_product_id';
  omitted text := E'set active = false, is_default = false,\n      gift_enabled = false, gift_stock = 0, gift_min_stock = 0,\n      updated_at = now()\n  where product_id = target_product_id\n    and not (id = any(saved_variant_ids));';
begin
  if strpos(definition, 'removed_at = now()') > 0 then return; end if;
  if strpos(definition, ownership) = 0 or strpos(definition, omitted) = 0 then
    raise exception 'Catalog save definition differs from the expected version';
  end if;
  definition := replace(definition, ownership, ownership || E'\n          and removed_at is null');
  definition := replace(definition, omitted, $removed$
set active = false, is_default = false,
      gift_enabled = false, gift_stock = 0, gift_min_stock = 0,
      removed_at = now(), updated_at = now()
  where product_id = target_product_id
    and removed_at is null
    and not (id = any(saved_variant_ids));$removed$);
  execute definition;
end;
$migration$;

commit;

-- Incremental patch for installations that already ran assisted-order benefits.
-- Only future quote/order item images change; existing orders remain immutable.
begin;
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure);
  if position('image_storage_path' in definition) = 0 then
    if position($marker$'sku',variant.sku,'name',product.name_zh,'nameZh',product.name_zh,'size',variant.size,'qty',quantity,$marker$ in definition) = 0 then
      raise exception 'Assisted quote source differs; no changes applied';
    end if;
    definition := replace(definition,
      $marker$'sku',variant.sku,'name',product.name_zh,'nameZh',product.name_zh,'size',variant.size,'qty',quantity,$marker$,
      $replacement$'sku',variant.sku,'name',product.name_zh,'nameZh',product.name_zh,'size',variant.size,'qty',quantity,
      'image_storage_path',(select image.storage_path from public.product_images image where image.product_id=product.id and image.active is true order by image.is_primary desc,image.sort_order,image.id limit 1),$replacement$);
    execute definition;
  end if;
end;
$migration$;
commit;

select position('image_storage_path' in pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure)) > 0 as assisted_order_images_ready;

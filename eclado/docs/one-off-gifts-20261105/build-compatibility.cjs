// Build local review artifacts only. No network, no database URL, no production execution.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, '.playwright/private-backups/one-off-gifts-20261105/catalog.json')));
const target = 'ECL-20261103-155424-8308FA6E';
const operation = 'one_off_1111_phase2_20261105_8308FA6E';
function replaceOnce(s, from, to) {
  if (s.split(from).length !== 2) throw new Error('Captured definition does not match exactly one expected patch location');
  return s.replace(from, to);
}
const originals = Object.fromEntries(['release_inventory_for_order','allocate_inventory_for_paid_order'].map(name => {
  const f = catalog.functions.find(f => f.name === name); return [name, f];
}));
let release = originals.release_inventory_for_order.definition;
release = replaceOnce(release, '  allocation record;','  allocation record;\n  one_off_gift boolean;\n  supplement_item jsonb;\n  expected_variant bigint;\n  expected_promotion uuid;');
release = replaceOnce(release, `  loop\n    if allocation.stock_deducted_qty > 0 then`, `  loop
    one_off_gift := false;
    -- Exact order, exact appended positions. Original rows 0..6 retain legacy behavior.
    if target_order_id = '${target}' and allocation.item_index >= 7 then
      expected_variant := case allocation.item_index when 7 then 38 when 8 then 87 when 9 then 104 when 10 then 105 end;
      expected_promotion := case when allocation.item_index in (7,8)
        then '6a03c582-3102-4b0a-a063-229ea1e28b21'::uuid
        when allocation.item_index in (9,10) then '44478b76-3cee-4157-918f-ecb4fc15f275'::uuid end;
      select items -> (allocation.item_index::integer) into supplement_item from public.orders where id = target_order_id;
      if expected_variant is null or coalesce(allocation.product_variant_id = expected_variant
          and allocation.promotion_id = expected_promotion and allocation.line_type = 'gift'
          and allocation.source = 'promotion_gift' and allocation.requested_qty = 1
          and allocation.allocated_qty = 1 and allocation.stock_deducted_qty = 1
          and allocation.backorder_qty = 0 and allocation.released_qty = 0 and allocation.state = 'allocated'
          and supplement_item ->> 'supplement_operation_key' = '${operation}'
          and supplement_item ->> 'variant_id' = expected_variant::text
          and supplement_item ->> 'promotion_id' = expected_promotion::text
          and supplement_item ->> 'line_type' = 'gift' and supplement_item ->> 'is_gift' = 'true'
          and supplement_item ->> 'qty' = '1', false) is not true then
        raise exception 'One-off gift allocation mismatch; manual review required for order % item %', target_order_id, allocation.item_index using errcode = '55000';
      end if;
      -- Do not assume a stock deduction without its matching consumed reservation.
      perform 1 from public.promotion_gift_reservations where order_id = target_order_id
        and promotion_id = expected_promotion and product_variant_id = expected_variant
        and quantity = 1 and status = 'consumed' for update;
      if not found then raise exception 'One-off gift consumed reservation missing' using errcode = '55000'; end if;
      one_off_gift := true;
    end if;
    if allocation.stock_deducted_qty > 0 then`);
release = replaceOnce(release, `      update public.product_variants
      set stock = stock + allocation.stock_deducted_qty
      where id = allocation.product_variant_id;`, `      if one_off_gift then
        update public.product_variants set gift_stock = gift_stock + allocation.stock_deducted_qty
          where id = allocation.product_variant_id;
        if not found then raise exception 'One-off gift variant missing' using errcode = '55000'; end if;
        update public.promotion_gift_reservations set status = 'released', released_at = now(),
          release_reason = 'one_off_supplement_inventory_release'
          where order_id = target_order_id and promotion_id = expected_promotion
          and product_variant_id = expected_variant and status = 'consumed';
      else
        update public.product_variants
        set stock = stock + allocation.stock_deducted_qty
        where id = allocation.product_variant_id;
      end if;`);
release = replaceOnce(release, '    perform public.sync_product_stock_mirror(allocation.product_id);', `    if not one_off_gift then
      perform public.sync_product_stock_mirror(allocation.product_id);
    end if;`);
let allocate = originals.allocate_inventory_for_paid_order.definition;
allocate = replaceOnce(allocate, `begin\n  if order_items is null`, `begin
  -- This order's added gifts have already been allocated by the one-off transaction.
  -- Refuse any later full-order allocation, including cancelled/returned -> paid.
  if target_order_id = '${target}' then
    if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(order_items) = 'array' then order_items else '[]'::jsonb end) i
        where i ->> 'supplement_operation_key' = '${operation}')
      or exists (select 1 from public.orders o where o.id = target_order_id and
        exists (select 1 from jsonb_array_elements(coalesce(o.pricing_snapshot -> 'one_time_supplements','[]'::jsonb)) s
          where s ->> 'operation_key' = '${operation}'))
      or exists (select 1 from public.order_adjustments a where a.order_id = target_order_id
        and a.metadata ->> 'operation_key' = '${operation}')
      or exists (select 1 from public.audit_logs a where a.entity_id = target_order_id
        and a.metadata ->> 'operation_key' = '${operation}') then
      raise exception 'One-off supplemented order cannot be reallocated or reopened; manual review required' using errcode = '55000';
    end if;
  end if;
  if order_items is null`);
(async () => {
  const db = new PGlite(); await db.waitReady;
  // Compile function bodies and obtain canonical fingerprints in local PostgreSQL.
  const definitions = { release_inventory_for_order:release, allocate_inventory_for_paid_order:allocate };
  let hashes = {};
  for (const [name, def] of Object.entries(definitions)) {
    await db.exec(def);
    hashes[name] = (await db.query('select md5(pg_get_functiondef(oid)) h from pg_proc where proname=$1',[name])).rows[0].h;
  }
  const install = `-- REVIEW ONLY: exact-order compatibility; default ROLLBACK, never executed on production.
-- Install and supplement together using review-bundle.sql after separate execution authorization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.orders in access exclusive mode;
do $install$
declare
  release_def text := $release_source$${release}$release_source$;
  allocate_def text := $allocate_source$${allocate}$allocate_source$;
  before_security jsonb;
  after_security jsonb;
begin
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure)) <> '${originals.release_inventory_for_order.md5}'
    or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure)) <> '${originals.allocate_inventory_for_paid_order.md5}' then
    raise exception 'Compatibility install requires the captured legacy definitions; do not overwrite drift or rerun';
  end if;
  if not exists(select 1 from public.orders where id='${target}' and status='paid' and order_source='online'
    and total=24860 and jsonb_array_length(items)=7) then
    raise exception 'Compatibility install requires the original target order before supplementation';
  end if;
  select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security_definer',prosecdef,'config',proconfig) order by oid)
    into before_security from pg_proc where oid in ('public.release_inventory_for_order(text)'::regprocedure,'public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure);
  execute release_def;
  execute allocate_def;
  select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security_definer',prosecdef,'config',proconfig) order by oid)
    into after_security from pg_proc where oid in ('public.release_inventory_for_order(text)'::regprocedure,'public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure);
  if before_security is distinct from after_security then raise exception 'Compatibility must preserve function identity, owner, ACL and security configuration'; end if;
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure)) <> '${hashes.release_inventory_for_order}'
    or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure)) <> '${hashes.allocate_inventory_for_paid_order}' then
    raise exception 'Installed definition hash mismatch';
  end if;
end;
$install$;
rollback;
`;
  const undo = `-- REVIEW ONLY: restore captured functions ONLY before the supplement is granted.
-- After supplementation, keep compatibility for future cancellation/return; rollback is refused.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.orders in access exclusive mode;
do $undo$
begin
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure)) <> '${hashes.release_inventory_for_order}'
    or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure)) <> '${hashes.allocate_inventory_for_paid_order}' then
    raise exception 'Rollback requires exact compatible definitions; never overwrite later changes';
  end if;
  if not exists(select 1 from public.orders where id='${target}' and jsonb_array_length(items)=7)
    or exists(select 1 from public.order_adjustments where order_id='${target}' and metadata->>'operation_key'='${operation}')
    or exists(select 1 from public.audit_logs where entity_id='${target}' and metadata->>'operation_key'='${operation}')
    or exists(select 1 from public.order_inventory_allocations where order_id='${target}' and item_index>=7)
    or exists(select 1 from public.promotion_gift_reservations where order_id='${target}'
      and promotion_id in('6a03c582-3102-4b0a-a063-229ea1e28b21','44478b76-3cee-4157-918f-ecb4fc15f275')) then
    raise exception 'Rollback refused after supplement; preserve compatible release and reopen guard';
  end if;
  execute $original_release$${originals.release_inventory_for_order.definition}$original_release$;
  execute $original_allocate$${originals.allocate_inventory_for_paid_order.definition}$original_allocate$;
end;
$undo$;
rollback;
`;
  fs.writeFileSync(path.join(__dirname,'rollback-compatibility.sql'),undo);
  fs.writeFileSync(path.join(__dirname,'compatibility-order.sql'), install);
  let supplement = fs.readFileSync(path.join(__dirname,'supplement-order.sql'),'utf8');
  supplement = supplement.replace(/-- Allow only the exact gift-aware definitions from the existing gift migration\./,
    '-- Allow only the exact order-specific compatibility definitions from compatibility-order.sql.');
  supplement = supplement.replace(/(release_inventory_for_order\(text\)'::regprocedure\)\)\s*<> ')[a-f0-9]{32}/, '$1'+hashes.release_inventory_for_order)
    .replace(/(allocate_inventory_for_paid_order\(text,jsonb\)'::regprocedure\)\)\s*<> ')[a-f0-9]{32}/, '$1'+hashes.allocate_inventory_for_paid_order)
    .replace('production inventory lifecycle is not the reviewed gift-aware version','production inventory lifecycle is not the reviewed exact-order compatible version');
  fs.writeFileSync(path.join(__dirname,'supplement-order.sql'),supplement);
  fs.writeFileSync(path.join(__dirname,'review-bundle.sql'),
    '-- GENERATED REVIEW BUNDLE. Only run in isolated DB for now. Entire file defaults to ROLLBACK.\n'+
    install.replace(/rollback;\s*$/i,'')+'\n'+supplement.replace(/^begin;\s*$/m,''));
  fs.writeFileSync(path.join(__dirname,'compatibility-manifest.json'), JSON.stringify({target_order:target,operation_key:operation,production_modified:false,baseline:Object.fromEntries(Object.entries(originals).map(([k,v])=>[k,v.md5])),compatible:hashes,scope:'Only appended positions 7..10 of the exact order; original allocations and all other orders retain captured legacy logic',reopen_policy:'Refuse full-order allocation after supplement; manual review required after cancellation/return'},null,2)+'\n');
  await db.close();
})().catch(e=>{console.error(e);process.exit(1)});

// Isolated PostgreSQL tests; only local fixtures, no production/network access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {setup, exec, get, x, c, sql, compatibility, giftMigration} = require('./validate.cjs');
const bundle = fs.readFileSync(path.join(__dirname,'review-bundle.sql'),'utf8');
const undo = fs.readFileSync(path.join(__dirname,'rollback-compatibility.sql'),'utf8');
const commit = s => s.replace(/rollback;\s*$/i,'commit;');
const target = x.order.id;
const ids = '38,87,104,105';
const results = [];
const funcs = `select proname,md5(pg_get_functiondef(oid)) hash,proowner,proacl,prosecdef,proconfig
 from pg_proc where oid in ('release_inventory_for_order(text)'::regprocedure,'allocate_inventory_for_paid_order(text,jsonb)'::regprocedure) order by proname`;
async function test(name, body) { await body(); results.push(name); console.log('PASS '+name); }
async function withDB(legacy, body) { const d=await setup(legacy); try { await body(d); } finally { await d.close(); } }
async function seedOriginalVariants(d) {
  // Synthetic stock fixtures: only supplemental stock was actually read from production.
  const example=(await get(d,'select to_jsonb(v) v from product_variants v where id=38'))[0].v;
  for(const a of x.allocations) {
    if((await d.query('select 1 from product_variants where id=$1',[a.product_variant_id])).rows.length)continue;
    const item=x.order.items[a.item_index];
    const v={...example,id:a.product_variant_id,product_id:a.product_id,sku:a.sku,size:a.variant_name,
      stock:Math.max(0,item.stock_at_order-a.stock_deducted_qty),gift_stock:20,is_default:true};
    const keys=Object.keys(v);
    await d.query('insert into product_variants('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>v[k]));
  }
  // Exercise reservation lifecycle on real status changes using repository SQL.
  const start=giftMigration.indexOf('create or replace function public.sync_gift_reservation_from_order_status()');
  await d.exec(giftMigration.slice(start,giftMigration.indexOf('$$;',start)+3));
}
async function state(d) {
  return {
    orders:await get(d,'select to_jsonb(o) j from orders o order by id'),
    variants:await get(d,'select id,stock,gift_stock from product_variants order by id'),
    allocations:await get(d,'select to_jsonb(a) j from order_inventory_allocations a order by id'),
    reservations:await get(d,'select to_jsonb(a) j from promotion_gift_reservations a order by id'),
    adjustments:await get(d,'select to_jsonb(a) j from order_adjustments a order by id'),
    events:await get(d,'select to_jsonb(a) j from inventory_allocation_events a order by id'),
    audit:await get(d,'select to_jsonb(a) j from audit_logs a order by id'),
    functions:await get(d,funcs),
    triggers:await get(d,"select tgname,tgenabled,pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal order by tgname")
  };
}
async function cancellationState(d) {
  return {
    stock:await get(d,'select id,stock,gift_stock from product_variants order by id'),
    originalAllocations:await get(d,`select item_index,product_variant_id,allocated_qty,backorder_qty,stock_deducted_qty,released_qty,state,line_type,source from order_inventory_allocations where order_id='${target}' and item_index<7 order by item_index`),
    originalReservation:await get(d,'select id,status,quantity,release_reason from promotion_gift_reservations where id=5'),
    originalEvents:await get(d,'select product_variant_id,event_type,quantity from inventory_allocation_events where allocation_id between 418 and 424 order by allocation_id,event_type')
  };
}
(async()=>{
  await test('Compatibility alone defaults to ROLLBACK; functions and all row data unchanged',()=>withDB(true,async d=>{
    const before=await state(d);await exec(d,compatibility);assert.deepEqual(await state(d),before);
  }));
  await test('Combined review bundle defaults to ROLLBACK; both functions, triggers and data restored',()=>withDB(true,async d=>{
    const before=await state(d);await exec(d,bundle);assert.deepEqual(await state(d),before);
  }));
  await test('Install preserves existing function OID, owner, custom ACL and security configuration',()=>withDB(true,async d=>{
    await d.exec('create role fixture_reader; revoke all on function release_inventory_for_order(text),allocate_inventory_for_paid_order(text,jsonb) from public; grant execute on function release_inventory_for_order(text),allocate_inventory_for_paid_order(text,jsonb) to fixture_reader;');
    const before=(await get(d,funcs)).map(({hash,...rest})=>rest);
    await exec(d,commit(compatibility));
    assert.deepEqual((await get(d,funcs)).map(({hash,...rest})=>rest),before);
    await assert.rejects(exec(d,commit(compatibility)),/captured legacy definitions/);
  }));
  await test('Unknown baseline definition is rejected; other function remains unchanged',()=>withDB(true,async d=>{
    const f=c.functions.find(f=>f.name==='release_inventory_for_order').definition;
    await d.exec(f.replace('  allocation record;','  allocation record; -- unknown drift'));
    const before=await state(d);await assert.rejects(exec(d,bundle),/captured legacy definitions/);assert.deepEqual(await state(d),before);
  }));
  for(const status of ['cancelled','returned']) {
    await test(`Status -> ${status} restores exactly four gift units; second release is a no-op`,()=>withDB(true,async d=>{
      await seedOriginalVariants(d);await exec(d,commit(bundle));
      const originalStocks=await get(d,`select id,stock from product_variants where id in (${ids}) order by id`);
      await d.query('update orders set status=$1 where id=$2',[status,target]);
      assert.deepEqual(await get(d,`select id,stock from product_variants where id in (${ids}) order by id`),originalStocks);
      assert.deepEqual((await get(d,`select gift_stock from product_variants where id in (${ids}) order by id`)).map(r=>r.gift_stock),[20,20,20,20]);
      assert.equal((await get(d,"select count(*) n from order_inventory_allocations where item_index>=7 and state='released' and stock_deducted_qty=0 and released_qty=1"))[0].n,4);
      assert.equal((await get(d,"select count(*) n from promotion_gift_reservations where product_variant_id in (38,87,104,105) and status='released'"))[0].n,4);
      assert.equal((await get(d,"select count(*) n from inventory_allocation_events where event_type='release' and product_variant_id in (38,87,104,105)"))[0].n,4);
      const before=await state(d);await d.query('select release_inventory_for_order($1)',[target]);assert.deepEqual(await state(d),before);
      for(const next of ['paid','preparing','shipped','delivered']) {
        await assert.rejects(exec(d,`begin;update orders set status='${next}' where id='${target}';commit;`),/cannot be reallocated or reopened/);
        assert.deepEqual(await state(d),before);
      }
    }));
  }
  await test('Direct full-order allocation with stripped input cannot bypass persisted supplement marker',()=>withDB(true,async d=>{
    await exec(d,commit(bundle));const before=await state(d);
    await assert.rejects(exec(d,`begin;select allocate_inventory_for_paid_order('${target}','[]');commit;`),/cannot be reallocated or reopened/);
    assert.deepEqual(await state(d),before);
  }));
  await test('Paid -> preparing does not release or double-deduct supplemental gift inventory',()=>withDB(true,async d=>{
    await exec(d,commit(bundle));const before=await get(d,'select id,stock,gift_stock from product_variants order by id');
    await d.query("update orders set status='preparing' where id=$1",[target]);
    assert.deepEqual(await get(d,'select id,stock,gift_stock from product_variants order by id'),before);
  }));
  await test('Original seven allocations including legacy silicone brush follow the original cancellation path',async()=>{
    let legacy;
    await withDB(true,async d=>{await seedOriginalVariants(d);await d.query("update orders set status='cancelled' where id=$1",[target]);legacy=await cancellationState(d);});
    await withDB(true,async d=>{
      await seedOriginalVariants(d);await exec(d,commit(bundle));await d.query("update orders set status='cancelled' where id=$1",[target]);
      assert.deepEqual(await cancellationState(d),legacy);
    });
  });
  await test('Other order allocation/release outcomes are identical to captured legacy behavior',async()=>{
    async function run(patched){let answer;await withDB(!patched,async d=>{
      await seedOriginalVariants(d);
      const other='ISOLATED-OTHER-ORDER';
      await d.exec(`insert into orders select (jsonb_populate_record(null::orders,to_jsonb(o)||jsonb_build_object('id','${other}','status','pending'))).* from orders o where id='${target}'`);
      // Include a gift-looking line on another order to prove this is not a global gift fix.
      const items=[x.order.items[4],{...x.order.items[6],qty:1,supplement_operation_key:'one_off_1111_phase2_20261105_8308FA6E'}];
      await d.query('select allocate_inventory_for_paid_order($1,$2::jsonb)',[other,JSON.stringify(items)]);
      const allocated=await get(d,`select item_index,product_variant_id,allocated_qty,backorder_qty,line_type,source from order_inventory_allocations where order_id='${other}' order by item_index`);
      await d.query('select release_inventory_for_order($1)',[other]);
      answer={allocated,stock:await get(d,'select id,stock,gift_stock from product_variants order by id'),released:await get(d,`select item_index,allocated_qty,stock_deducted_qty,released_qty,state from order_inventory_allocations where order_id='${other}' order by item_index`)};
    });return answer;}
    assert.deepEqual(await run(true),await run(false));
  });
  for(const mutation of [
    "update order_inventory_allocations set product_variant_id=38 where item_index=10",
    "update promotion_gift_reservations set status='released',released_at=now() where product_variant_id=105",
    "alter table orders disable trigger trg_protect_order_pricing_snapshot; alter table orders disable trigger trg_orders_inventory_allocation_sync; update orders set items=jsonb_set(items,'{10,supplement_operation_key}','\"wrong\"'); alter table orders enable trigger trg_orders_inventory_allocation_sync; alter table orders enable trigger trg_protect_order_pricing_snapshot"
  ]) await test('Invalid supplemental allocation/reservation/marker aborts complete cancellation: '+mutation.slice(0,60),()=>withDB(true,async d=>{
    await seedOriginalVariants(d);await exec(d,commit(bundle));await d.exec(mutation);
    const before=await state(d);
    await assert.rejects(exec(d,`begin;update orders set status='cancelled' where id='${target}';commit;`),/One-off gift allocation mismatch|consumed reservation missing/);
    assert.deepEqual(await state(d),before);
  }));
  await test('Late supplement audit failure rolls back compatibility functions and entire supplement together',()=>withDB(true,async d=>{
    await d.exec("alter table audit_logs add check(action <> 'order.one_time_gift_supplement')");const before=await state(d);
    await assert.rejects(exec(d,commit(bundle)),/check constraint/);assert.deepEqual(await state(d),before);
  }));
  await test('Compatibility can be restored before grant; rollback is refused after grant or even after cancellation',()=>withDB(true,async d=>{
    const original=await get(d,funcs);await exec(d,commit(compatibility));await exec(d,commit(undo));assert.deepEqual(await get(d,funcs),original);
    await seedOriginalVariants(d);await exec(d,commit(bundle));const before=await state(d);
    await assert.rejects(exec(d,commit(undo)),/Rollback refused after supplement/);assert.deepEqual(await state(d),before);
    await d.query("update orders set status='cancelled' where id=$1",[target]);await assert.rejects(exec(d,commit(undo)),/Rollback refused after supplement/);
  }));
  await test('Changed original order causes complete review bundle to restore both legacy functions',()=>withDB(true,async d=>{
    await d.exec('alter table orders disable trigger trg_protect_order_pricing_snapshot; update orders set total=total+1; alter table orders enable trigger trg_protect_order_pricing_snapshot');const before=await state(d);
    await assert.rejects(exec(d,commit(bundle)),/requires the original target order/);assert.deepEqual(await state(d),before);
  }));
  await test('Compatibility preserves cancellation and reopening behavior before this order receives the supplement',async()=>{
    async function run(patched){let answer;await withDB(!patched,async d=>{
      await seedOriginalVariants(d);await d.query("update orders set status='cancelled' where id=$1",[target]);
      await d.query("update orders set status='paid' where id=$1",[target]);
      answer={stock:await get(d,'select id,stock,gift_stock from product_variants order by id'),allocations:await get(d,'select item_index,allocated_qty,backorder_qty,stock_deducted_qty,state,line_type,source from order_inventory_allocations order by item_index')};
    });return answer;}
    assert.deepEqual(await run(true),await run(false));
  });
  const result={tested_at:new Date().toISOString(),production_modified:false,engine:'Isolated PGlite PostgreSQL; captured legacy source patched only for the exact order',test_count:results.length,results,
    limitations:['Not a multi-connection lock/deadlock stress test.','Payment, wallet, audit and shipping peripheral trigger bodies are neutral fixtures. Reservation status sync uses repository implementation; its production body was not captured.','Original merchandise stock fixture is synthetic; only four supplemental gift stocks were read from production. Differential tests compare original behavior rather than claim current original stock amounts.','No production function installation, production write, or gateway refund was executed.','Automatic inventory release does not execute a financial refund or confirm physical gift return.']};
  fs.writeFileSync(path.join(__dirname,'compatibility-validation.json'),JSON.stringify(result,null,2)+'\n');
})().catch(e=>{console.error(e);process.exit(1)});

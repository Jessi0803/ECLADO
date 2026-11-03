import { test, expect, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';
import { runRewardCheckoutDatabaseScenario } from './integration/instructor-reward-checkout-db.test.cjs';

// Browser checkout -> actual repository SQL in an isolated PGlite database.
// Only auth/catalog and bank responses are simulated. No production connections.
test.skip(!process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, 'Requires an isolated PostgreSQL runtime');
let context: any, fixture: Promise<void>, closeFixture: () => void;
const source = {id:1, slug:'perfect-cleansing-smoothie-balm', name:'Perfect Cleansing Smoothie Balm', name_zh:'完美潔面卸妝膏', price:10000, pro_price:10000, stock:10000, active:true, size:'200ml', features:[]};
const cleanser = {id:2, slug:'enhancer-mild-cleanser', name:'Enhancer Mild Cleanser', name_zh:'溫和增效潔面乳', price:5000, pro_price:5000, stock:10000, active:true, size:'500ml', features:[]};
const variants = [
  {id:1,product_id:1,size:'200ml',price:10000,pro_price:10000,stock:10000,is_default:true,active:true},
  {id:3,product_id:2,size:'500ml',price:5000,pro_price:5000,stock:10000,is_default:true,active:true},
];
let bogoId = '30000000-0000-4000-8000-000000000001';
let fixedId = '30000000-0000-4000-8000-000000000002';
let couponPromoId = '30000000-0000-4000-8000-000000000003';
const campaignId = '30000000-0000-4000-8000-000000000004';

test.beforeAll(async () => {
  test.setTimeout(180000);
  const closed = new Promise<void>(resolve => { closeFixture = resolve; });
  await new Promise<void>((resolve, reject) => {
    fixture = runRewardCheckoutDatabaseScenario(async (ctx: any) => {
      try {
        const {db,read,fn,one,actor,admin,student,ordinaryQuote,ordinaryCreate} = ctx;
        await actor(admin);
        await db.exec("alter table public.promotions add column description text,add column updated_at timestamptz default now(); update public.promotions set active=false; update public.product_variants set stock=10000");
        // Replenish through a real student purchase and reward ledger, never edit balances.
        await db.exec('update public.student_pricing_feature_settings set enabled=true');
        await actor(student);
        const incomeItems=[{product_id:1,variant_id:1,qty:99}];
        const income=await ordinaryCreate(incomeItems,await ordinaryQuote(incomeItems));
        await actor(admin);
        await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[income.order_id]);
        await db.query("update public.orders set status='delivered' where id=$1",[income.order_id]);
        await db.exec('update public.student_pricing_feature_settings set enabled=false');
        await db.exec(fn('supabase-shopping-credit-foundation.sql','get_my_shopping_credit'));
        await db.exec(fn('supabase-promotion-gifts-engine.sql','save_discount_promotion'));
        for (const file of ['supabase-automatic-promotion-audience.sql','supabase-buy-x-get-y.sql','supabase-automatic-price-allocation.sql']) await db.exec(read(file));
        await db.exec(`update public.automatic_price_allocation_settings set enabled=true;
          update public.product_variants set pro_price=10000,price=10000 where id=1;
          insert into public.products(id,name_zh,stock) values(2,'溫和增效潔面乳',10000);
          insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price) values(3,2,'RECOMMEND-TEST','500ml',10000,true,5000,5000);`);
        const save = async (config: any) => one('select public.save_discount_promotion($1::jsonb) id',[JSON.stringify(config)]);
        bogoId=(await save({name:'最後加購買三送一',benefit_type:'buy_x_get_y',activation_type:'automatic',buy_quantity:3,gift_quantity:1,repeat_mode:'repeat',scope_type:'products',product_ids:[2],audience_roles:['instructor'],allow_guest:false})).id;
        fixedId=(await save({name:'主商品折500',benefit_type:'fixed_discount',activation_type:'automatic',discount_amount:500,scope_type:'products',product_ids:[1],audience_roles:['instructor'],allow_guest:false})).id;
        couponPromoId=(await save({name:'加碼折200',benefit_type:'fixed_discount',activation_type:'coupon_only',discount_amount:200,scope_type:'all_regular',audience_roles:['instructor'],allow_guest:false})).id;
        await db.query(`insert into public.coupon_campaigns(id,name,code,code_normalized,stacking_policy,audience_mode,audience_roles,allow_guest,per_member_limit)
          values($1,'最後加購疊加券','LATE','LATE','allow_all','roles',array['instructor'],false,100)`,[campaignId]);
        await db.query('insert into public.coupon_promotions(coupon_campaign_id,promotion_id,sort_order) values($1,$2,0)',[campaignId,couponPromoId]);
        context=ctx;
        resolve();
        await closed;
      } catch (error) { reject(error); throw error; }
    }).catch(reject);
  });
});
test.afterAll(async () => { closeFixture?.(); await fixture; });

async function enterFinalStep(page: Page) {
  await page.goto('/checkout');
  const inputs=page.locator('form input');
  await inputs.nth(0).fill('隔離測試'); await inputs.nth(1).fill('0900000000'); await inputs.nth(2).fill('late-sql@example.test');
  await page.getByPlaceholder('縣市').fill('台北市'); await page.getByPlaceholder('區域').fill('中正區'); await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路1號');
  await page.getByRole('button',{name:'繼續確認付款'}).click();
}

const cases = [
  {name:'買贈門檻',stack:false,sc:0,rc:0,discount:3500,payment:17500},
  {name:'買贈＋自動折扣＋優惠券',stack:true,sc:0,rc:0,discount:4200,payment:16800},
  {name:'疊加優惠＋購物金',stack:true,sc:300,rc:0,discount:4200,payment:16500},
  {name:'疊加優惠＋返饋金',stack:true,sc:0,rc:500,discount:4200,payment:16300},
  {name:'疊加優惠＋雙錢包',stack:true,sc:300,rc:500,discount:4200,payment:16000},
];
for (const scenario of cases) for (const slowPreview of [false,true]) {
  test(`最後一步加購 SQL：${scenario.name}／${slowPreview?'預覽延遲':'預覽完成'}`, async ({page}) => {
    const {db,one,actor,teacher}=context;
    await db.exec('begin');
    let releasePreview=()=>{};
    const previewGate=new Promise<void>(resolve=>{releasePreview=resolve;});
    const tasks: Promise<void>[]=[];
    try {
      await db.query('update public.promotions set active=$2 where id=$1',[fixedId,scenario.stack]);
      await actor(teacher);
      expect(Number((await one('select public.get_my_reward_credit() q')).q.available_balance)).toBeGreaterThan(500);
      const user={id:teacher,email:'late-sql@example.test',user_metadata:{name:'隔離測試'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
      const bankRequests: any[]=[],creates: any[]=[],quoteRequests: any[]=[];
      let created: any,previewWaiting=false;
      await page.context().route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort('blockedbyclient'));
      await mockEcladoApis(page,{authUser:user,profiles:[{id:teacher,email:user.email,name:'隔離測試',role:'instructor'}],products:[source,cleanser],productVariants:variants,promotions:[],onPaymentRequest:body=>bankRequests.push(body)});
      const rpc = (name: string, execute: (args:any)=>Promise<any>) => page.route(`**/rest/v1/rpc/${name}`,route=>{
        const task=(async()=>{
          try { await route.fulfill({json:await execute(route.request().postDataJSON()||{})}); }
          catch(error:any) { console.error('Isolated SQL RPC', name, error.code, error.message); await route.fulfill({status:400,json:{code:error.code||'TEST_SQL',message:error.message,details:error.detail||null}}); }
        })(); tasks.push(task); return task;
      });
      await rpc('get_my_reward_credit',()=>one('select public.get_my_reward_credit() q').then((r:any)=>r.q));
      await rpc('get_my_shopping_credit',()=>one('select public.get_my_shopping_credit() q').then((r:any)=>r.q));
      const executeQuote=async(args:any,wallet:boolean)=>{
        quoteRequests.push(args);
        const count=args.p_items.find((item:any)=>item.product_id===2)?.qty||0;
        // Compute before delaying: this is an actual stale background response.
        const quote=(await one(wallet
          ? 'select public.quote_order_with_wallets($1::jsonb,$2,$3,$4,$5::bigint,$6::bigint) q'
          : 'select public.quote_order_pricing($1::jsonb,$2,$3,$4) q',
          [JSON.stringify(args.p_items),args.p_fulfillment_method,args.p_coupon_code||'',args.p_guest_email||'',...(wallet?[args.p_shopping_credit_amount||0,args.p_reward_credit_amount||0]:[])])).q;
        if(slowPreview&&!wallet&&count===4&&!args.p_guest_email){previewWaiting=true;await previewGate;}
        return quote;
      };
      await rpc('quote_order_pricing',args=>executeQuote(args,false));
      await rpc('quote_order_with_wallets',args=>executeQuote(args,true));
      await rpc('create_order_with_wallets',async args=>{
        creates.push(args);
        created=(await one(`select public.create_order_with_wallets($1::jsonb,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::bigint,$14::bigint,$15::jsonb) q`,[
          JSON.stringify(args.p_items),args.p_member,args.p_address,args.p_phone,args.p_email,args.p_note,args.p_payment_method,args.p_fulfillment_method,args.p_coupon_code||'',args.p_invoice_type,args.p_invoice_company_name,args.p_invoice_tax_id,args.p_shopping_credit_amount,args.p_reward_credit_amount,JSON.stringify(args.p_expected_quote),
        ])).q; return created;
      });
      await page.addInitScript(()=>localStorage.setItem('eclado_cart_v1',JSON.stringify([{id:1,variantId:'1',qty:1},{id:2,variantId:'3',qty:3,recommendationOnly:true}])));
      page.on('dialog',dialog=>dialog.accept());
      await enterFinalStep(page);
      await expect(page.getByRole('switch',{name:'使用返饋金',exact:true})).toBeEnabled();
      const applyCoupon=async()=>{
        await page.getByPlaceholder('輸入優惠碼').fill('LATE');
        await page.getByRole('button',{name:'套用',exact:true}).click();
        await expect(page.getByText('已套用「最後加購疊加券」',{exact:false})).toBeVisible();
      };
      if(scenario.stack)await applyCoupon();
      if(scenario.sc){await page.getByRole('switch',{name:'使用購物金',exact:true}).click();await page.getByLabel('購物金使用金額').fill(String(scenario.sc));}
      if(scenario.rc){await page.getByRole('switch',{name:'使用返饋金',exact:true}).click();await page.getByLabel('返饋金使用金額').fill(String(scenario.rc));}
      await page.getByRole('region',{name:'搭配選購'}).getByRole('button',{name:'加購溫和增效潔面乳'}).click();
      if(scenario.stack){
        await expect(page.getByText('購物內容或收件資料已變更，請重新套用優惠碼。')).toBeVisible();
        await applyCoupon();
      }
      if(slowPreview)await expect.poll(()=>previewWaiting).toBe(true);
      else await expect(page.getByTestId('checkout-order-summary').getByText('最後加購買三送一',{exact:true})).toBeVisible();
      if(scenario.sc)await expect(page.getByLabel('購物金使用金額')).toHaveValue(String(scenario.sc));
      if(scenario.rc)await expect(page.getByLabel('返饋金使用金額')).toHaveValue(String(scenario.rc));
      await page.getByRole('button',{name:'確認訂單',exact:true}).click();
      await expect(page.getByRole('heading',{name:'請完成付款'})).toBeVisible();
      releasePreview(); await Promise.all(tasks);
      expect(creates).toHaveLength(1);expect(bankRequests).toHaveLength(1);
      expect(creates[0].p_items.map(({product_id,variant_id,qty}:any)=>({product_id,variant_id,qty}))).toEqual([{product_id:1,variant_id:'1',qty:1},{product_id:2,variant_id:'3',qty:4}]);
      expect(creates[0].p_expected_quote).toMatchObject({subtotal:21000,discount:scenario.discount,total:21000-scenario.discount,payment_amount:scenario.payment,shopping_credit_amount:scenario.sc,reward_credit_amount:scenario.rc});
      expect(created).toMatchObject({subtotal:21000,discount:scenario.discount,shipping:0,total:21000-scenario.discount,payment_amount:scenario.payment,shopping_credit_amount:scenario.sc,reward_credit_amount:scenario.rc});
      expect(bankRequests[0].amount).toBe(scenario.payment);
      const stored=await one('select subtotal,discount,total,payment_amount,shopping_credit_amount,reward_credit_amount from public.orders where id=$1',[created.order_id]);
      expect(Object.fromEntries(Object.entries(stored).map(([key,value])=>[key,Number(value)]))).toMatchObject({subtotal:21000,discount:scenario.discount,total:21000-scenario.discount,payment_amount:scenario.payment,shopping_credit_amount:scenario.sc,reward_credit_amount:scenario.rc});
      const adjustments=(await db.query('select adjustment_type,amount from public.order_adjustments where order_id=$1',[created.order_id])).rows;
      expect(adjustments.find((row:any)=>row.adjustment_type==='buy_x_get_y')).toMatchObject({amount:'3500'});
      expect(adjustments.reduce((sum:number,row:any)=>sum+Number(row.amount),0)).toBe(scenario.discount);
      await expect(page.getByTestId('checkout-order-summary').getByText(`NT$ ${scenario.payment.toLocaleString()}`,{exact:true})).toBeVisible();
      await expect(page.getByRole('region',{name:'搭配選購'})).toHaveCount(0);
      expect(quoteRequests.at(-1).p_items.find((item:any)=>item.product_id===2).qty).toBe(4);
    } finally {
      releasePreview(); await Promise.allSettled(tasks); await db.exec('rollback');
    }
  });
}

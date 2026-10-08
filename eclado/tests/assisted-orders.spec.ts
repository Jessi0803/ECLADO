import {expect,test,type Page} from '@playwright/test';
import {mockEcladoApis,adminProductRows,adminProfileRows,adminOrderRows} from './support/eclado-mocks';
const user={id:'admin-assisted',email:'admin@example.test',user_metadata:{name:'管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
const created={order_id:'ECL-ASSISTED-001',link_token:'a'.repeat(64)};
async function setup(page:Page,allowed=true){
  const products=adminProductRows.map(product=>({...product,publication_status:'active',instructor_price_multiplier:0.88,distributor_price_multiplier:null,staff_price_multiplier:null,pricing_defaults:{instructor:0.7,distributor:0.65,staff:0.5}}));
  await mockEcladoApis(page,{authUser:user,profiles:adminProfileRows.map(profile=>({...profile,role:profile.role==='pro'?'instructor':profile.role})),products,
    productVariants:[{id:101,product_id:1,sku:'A',size:'200ml',price:1280,pro_price:960,stock:48,is_default:true,sort_order:0,active:true}],
    backofficeAccess:{role:allowed?'admin':'catalog_editor',permissions:allowed?['orders.read','orders.write','members.read','catalog.read']:['orders.read','members.read','catalog.read']}});
  await page.route('**/rest/v1/rpc/get_admin_assisted_request',route=>route.fulfill({json:null}));
}
async function open(page:Page){await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'訂單管理'}).first().click();await page.getByRole('button',{name:'新增代客訂單'}).click();}
test('assisted order detail link action uses existing outlined button and field styles',async({page})=>{
  await setup(page);
  await page.route('**/rest/v1/orders*',route=>route.fulfill({json:[{...adminOrderRows[0],id:created.order_id,order_source:'admin_assisted'}]}));
  await page.route('**/rest/v1/rpc/get_admin_assisted_link',route=>route.fulfill({json:{...created,created_at:'2026-10-09T00:00:00Z',actor_user_id:user.id,pricing_context:[]}}));
  await open(page);await page.getByRole('button',{name:'關閉代客開單',exact:true}).click();
  await page.getByText(created.order_id,{exact:true}).first().click();
  const panel=page.getByRole('dialog',{name:'訂單詳情',exact:true});
  const button=panel.getByRole('button',{name:'取得客戶付款連結／開單紀錄'});
  await expect(button).toHaveCSS('font-size','12px');await expect(button).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(button).toHaveCSS('border-top-width','1px');await expect(button).toHaveCSS('padding-top','9px');
  await button.click();await expect(panel.getByLabel('客戶付款連結')).toHaveValue(/order-payment#order=/);
  await expect(panel.getByLabel('客戶付款連結')).toHaveCSS('font-size','12px');
  await panel.getByText('內部開單紀錄（不提供客戶）').click();await expect(panel.getByText(`建立者：${user.id}`)).toBeVisible();
  expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
test('order create button stays at header right with status filters below',async({page})=>{
  await setup(page);await open(page);await page.getByRole('button',{name:'關閉代客開單',exact:true}).click();
  const title=await page.getByRole('heading',{name:'訂單管理',exact:true}).boundingBox();
  const create=page.getByRole('button',{name:'+ 新增代客訂單',exact:true});
  await expect(create).toHaveCSS('font-size','12px');await expect(create).toHaveCSS('letter-spacing','1.2px');
  const button=await create.boundingBox();
  const filters=await page.locator('[aria-label="訂單狀態篩選"]').boundingBox();
  expect(title&&button&&Math.abs((title.y+title.height/2)-(button.y+button.height/2))<4).toBeTruthy();
  expect(title&&button&&button.x>title.x+title.width).toBeTruthy();
  expect(button&&filters&&filters.y>=button.y+button.height).toBeTruthy();
});
test('member shortcut is the third inline action and preselects member contact and applicable pricing',async({page})=>{
  await setup(page);await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'會員管理'}).first().click();
  await page.getByRole('button',{name:'查看LINE 會員詳情'}).click();
  const details=page.getByRole('dialog',{name:'會員詳情'});
  const names=['匯入訪客訂單','補登歷史訂單','代客開單'];
  await details.getByRole('button',{name:names[2],exact:true}).scrollIntoViewIfNeeded();
  const boxes=await Promise.all(names.map(name=>details.getByRole('button',{name,exact:true}).boundingBox()));
  expect(boxes.every(box=>box&&Math.abs(box.y-boxes[0]!.y)<3)).toBeTruthy();
  expect(boxes[1]!.x>boxes[0]!.x&&boxes[2]!.x>boxes[1]!.x).toBeTruthy();
  await details.getByRole('button',{name:'代客開單',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
  await expect(dialog.getByLabel('客戶類型')).toHaveValue('member');await expect(dialog.getByLabel('選擇會員')).toHaveValue('user-line-1');
  await expect(dialog.getByLabel('收件姓名')).toHaveValue('LINE 會員');await expect(dialog.getByLabel('收件手機')).toHaveValue('0922222222');
  await expect(dialog.getByLabel('收件 Email')).toHaveValue('line-member@example.com');
  await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');await expect(dialog.getByLabel('成交單價 1')).toHaveValue('845');
  await dialog.getByRole('button',{name:'關閉代客開單',exact:true}).click();await expect(details).toBeVisible();
});
test('member shortcut is hidden without order write permission',async({page})=>{
  await setup(page,false);await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'會員管理'}).first().click();
  await page.getByRole('button',{name:'查看LINE 會員詳情'}).click();
  await expect(page.getByRole('dialog',{name:'會員詳情'}).getByRole('button',{name:'代客開單',exact:true})).toHaveCount(0);
});
test('assisted dialog reuses historical modal styles and scrolls without clipping actions',async({page},testInfo)=>{
  await setup(page);await open(page);const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
  const card=dialog.locator('.assignment-modal-card.historical-order-modal-card');
  await expect(card).toBeVisible();await expect(dialog.getByRole('heading',{name:'新增代客訂單'})).toHaveCSS('font-size','17px');
  await expect(dialog.getByLabel('商品 1',{exact:true})).toHaveCSS('font-size','12px');
  await expect(dialog.locator('.historical-order-product-grid')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('assisted-style.png')});
  await dialog.getByRole('button',{name:'＋新增商品'}).click();
  await expect(dialog.locator('.historical-order-product-grid')).toHaveCount(2);
  const submit=dialog.getByRole('button',{name:'建立付款單',exact:true});await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();await expect(submit).toHaveClass('primary');
  expect(await card.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('guest suggested retail price, manual price, snapshot and generated private customer link',async({page})=>{
  await setup(page);let payload:any;
  await page.route('**/rest/v1/rpc/create_assisted_order',route=>{payload=route.request().postDataJSON();return route.fulfill({json:created});});
  await page.route('**/api/orders/assisted-payment',route=>route.fulfill({json:{ok:true,instruction:{atm_account:'123456'}}}));
  await open(page);const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
  await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');await expect(dialog.getByLabel('成交單價 1')).toHaveValue('1280');
  await dialog.getByLabel('成交單價 1').fill('1000');await dialog.getByLabel('收件姓名').fill('訪客');await dialog.getByLabel('收件手機').fill('0911111111');await dialog.getByLabel('收件 Email').fill('guest@example.test');await dialog.getByLabel('收件地址').fill('台北市測試路');
  page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'建立付款單',exact:true}).click();
  await expect(dialog.getByLabel('客戶付款連結')).toHaveValue(/order-payment#order=ECL-ASSISTED-001&token=/);
  expect(payload.p_payload.items).toEqual([{product_id:1,variant_id:101,qty:1,unit_price:1000}]);
  expect(payload.p_payload.customer_type).toBe('guest');expect(payload.p_payload.member_id).toBeNull();expect(payload.p_payload).not.toHaveProperty('shopping_credit_amount');expect(payload.p_request_key).toMatch(/^[0-9a-f-]{36}$/);
});
test('member product override suggested price; role and minimum exception are visible',async({page})=>{
  await setup(page);await open(page);const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
  await dialog.getByLabel('客戶類型').selectOption('member');await dialog.getByLabel('選擇會員').selectOption('user-line-1');
  await expect(dialog.getByLabel('收件姓名')).toHaveValue('LINE 會員');await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');
  await expect(dialog.getByLabel('成交單價 1')).toHaveValue('845');await expect(dialog.getByLabel('低於最低訂購額原因（僅後台）')).toBeVisible();
  await dialog.getByLabel('運費設定').selectOption('free');await expect(dialog.getByLabel('運費調整原因（僅後台）')).toBeVisible();
  await expect(dialog.getByLabel('商品 1',{exact:true})).toContainText('NK細胞活化安瓶');
});
test('failure after order creation stays locked and retries payment without another order RPC',async({page})=>{
  await setup(page);let orders=0;await page.route('**/rest/v1/rpc/create_assisted_order',route=>{orders++;return route.fulfill({json:created});});
  await page.route('**/api/orders/assisted-payment',route=>route.fulfill({status:409,json:{ok:false,error:'原訂單保留，銀行結果待確認'}}));
  await open(page);const dialog=page.getByRole('dialog',{name:'新增代客訂單'});await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');
  for(const [label,value] of [['收件姓名','訪客'],['收件手機','0911111111'],['收件 Email','guest@example.test'],['收件地址','台北市']])await dialog.getByLabel(label).fill(value);
  page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'建立付款單',exact:true}).click();await expect(dialog.getByLabel('客戶付款連結')).toBeVisible();
  await dialog.getByRole('button',{name:'重新取得付款資訊'}).click();await expect(dialog.getByRole('alert')).toContainText('原訂單保留');expect(orders).toBe(1);
});
test('read-only staff cannot see assisted create entry',async({page})=>{
  await setup(page,false);await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'訂單管理'}).first().click();await expect(page.getByRole('button',{name:'新增代客訂單'})).toHaveCount(0);
});
for(const [method,label] of [['apple','Apple Pay'],['google','Google Pay']]){
  test(`${label} can be selected by admin and the customer uses the saved wallet payment link`,async({page})=>{
    await setup(page);let payload:any;
    await page.route('**/rest/v1/rpc/create_assisted_order',route=>{payload=route.request().postDataJSON();return route.fulfill({json:created});});
    await page.route('**/api/orders/assisted-payment',route=>route.fulfill({json:{ok:true,instruction:{payment_url:'https://bank.example.test/pay'}}}));
    await page.route('https://bank.example.test/pay',route=>route.fulfill({contentType:'text/html',body:'<h1>Mock wallet gateway</h1>'}));
    await open(page);const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
    await dialog.getByLabel('付款方式').selectOption(method);await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');
    for(const [name,value] of [['收件姓名','訪客'],['收件手機','0911111111'],['收件 Email','guest@example.test'],['收件地址','台北市']])await dialog.getByLabel(name).fill(value);
    page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'建立付款單',exact:true}).click();
    await expect(dialog.getByLabel('客戶付款連結')).toBeVisible();expect(payload.p_payload.payment_method).toBe(method);
    await page.route('**/api/orders/assisted-details',route=>route.fulfill({json:{ok:true,paymentMethod:method,resultAccessToken:'SHORT',order:{id:created.order_id,member:'訪客',phone:'0911111111',email:'guest@example.test',address:'台北市',invoice_type:'personal',status:'unpaid',subtotal:1280,shipping:120,total:1400,payment_due_at:'2099-01-01',items:[{name:'商品',size:'200ml',qty:1,unit_price:1280,line_total:1280}]},instruction:{payment_state:'pending',payment_url:'https://bank.example.test/pay'}}}));
    await page.goto(`/order-payment#order=${created.order_id}&token=${created.link_token}`);
    await expect(page.getByText(`付款方式：${label}`,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:`確認明細，前往${label}付款`}).click();
    await expect(page).toHaveURL('https://bank.example.test/pay');
  });
}
test('private customer page shows saved prices/invoice/ATM, no internal stock or admin UI',async({page})=>{
  await mockEcladoApis(page);await page.route('**/api/orders/assisted-details',route=>route.fulfill({json:{ok:true,paymentMethod:'atm',order:{id:created.order_id,member:'顧客',phone:'0911111111',email:'guest@example.test',address:'台北市',invoice_type:'company',invoice_company_name:'測試公司',invoice_tax_id:'62076004',status:'awaiting_confirm',subtotal:1000,shipping:120,total:1120,payment_due_at:'2099-01-01',public_lookup_code:'ABCDE-12345',is_member:false,items:[{name:'歷史成交商品',size:'200ml',qty:1,unit_price:1000,line_total:1000}]},instruction:{atm_bank_code:'807',atm_account:'85417480000013'}}}));
  await page.goto(`/order-payment#order=${created.order_id}&token=${created.link_token}`);await expect(page.getByText('公司抬頭：測試公司')).toBeVisible();await expect(page.getByText('統一編號：62076004')).toBeVisible();await expect(page.getByText('虛擬帳號：85417480000013')).toBeVisible();await expect(page.getByText('訪客查詢碼：ABCDE-12345',{exact:false})).toBeVisible();await expect(page.locator('.app-sidebar')).toHaveCount(0);await expect(page.getByText('庫存資料載入中')).toHaveCount(0);await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
  await expect(page.getByRole('button',{name:'重新讀取付款狀態'})).toHaveCSS('font-size','12px');
  await expect(page.getByRole('link',{name:'會員中心',exact:true})).toHaveCSS('text-decoration-line','none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('customer payment error and loading states use storefront cards and styled query actions',async({page},testInfo)=>{
  await mockEcladoApis(page);
  let fail=true;
  let finishLoading:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{finishLoading=resolve;});
  await page.route('**/api/orders/assisted-details',async route=>{
    await pending;
    return fail?route.fulfill({status:403,json:{ok:false,error:'連結無效或已到期，請使用會員中心／訪客訂單查詢。'}}):route.fulfill({json:{ok:true,paymentMethod:'card',order:{id:created.order_id,member:'顧客',phone:'0911111111',email:'guest@example.test',address:'台北市',invoice_type:'personal',status:'unpaid',subtotal:1000,shipping:120,total:1120,payment_due_at:'2099-01-01',is_member:true,items:[{name:'商品',size:'200ml',qty:1,unit_price:1000,line_total:1000}]}}});
  });
  await page.goto(`/order-payment#order=${created.order_id}&token=${created.link_token}`);
  await expect(page.locator('.assisted-payment-page').getByRole('status')).toContainText('正在讀取訂單');
  await expect(page.locator('.assisted-payment-header')).toHaveCSS('border-top-width','1px');
  finishLoading();await expect(page.getByRole('alert')).toContainText('連結無效');
  await expect(page.getByRole('link',{name:'會員中心',exact:true})).toHaveCSS('color','rgb(20, 20, 18)');
  await expect(page.getByRole('link',{name:'會員中心',exact:true})).toHaveCSS('text-decoration-line','none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('assisted-customer-error.png'),fullPage:true});
  fail=false;await page.getByRole('button',{name:'重新讀取訂單'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'商品與金額'})).toBeVisible();
  await expect(page.getByRole('button',{name:'確認明細，前往信用卡付款'})).toHaveCSS('background-color','rgb(20, 20, 18)');
  await page.screenshot({path:testInfo.outputPath('assisted-customer-details.png'),fullPage:true});
});

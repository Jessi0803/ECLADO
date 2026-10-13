// Run only against a freshly started disposable acceptance server on 5181.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
page.on('dialog',async d=>{const m=d.message();await d.accept(d.type()==='prompt'?(m.includes('日期')?'2026-10-13':m.includes('序號')?'LOCAL-NO-BANK-001':'985'):undefined);});
const root='http://127.0.0.1:5181';
const action=(action,args={})=>page.evaluate(async a=>{const r=await fetch('/__acceptance/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;},{action,...args});
const getState=()=>page.evaluate(async()=>await(await fetch('/__acceptance/state')).json());
try{
await page.goto('http://127.0.0.1:5181/__preview/switch?role=teacher');
await page.getByRole('tab',{name:'師資返饋金',exact:true}).click();
await page.getByLabel('銀行代碼',{exact:true}).fill('807');await page.getByLabel('銀行名稱',{exact:true}).fill('驗收銀行');await page.getByLabel('分行名稱',{exact:true}).fill('測試分行');await page.getByLabel('收款戶名',{exact:true}).fill('驗收老師');await page.getByLabel('收款帳號',{exact:true}).fill('12345678901234');
await page.getByRole('button',{name:'儲存收款銀行',exact:true}).click();
await page.getByRole('button',{name:'申請全額提領',exact:true}).click();
await page.getByText('待匯款',{exact:true}).waitFor();
let state=await (await page.request.get('http://127.0.0.1:5181/__acceptance/state')).json();assert.equal(state.account.balance,0);assert.equal(state.account.withdrawal_reserved_balance,1000);console.log('PASS actual UI bank save, withdrawal hold1000');
await page.goto('http://127.0.0.1:5181/__preview/switch?role=admin');await page.getByRole('button',{name:'師資提領管理',exact:true}).click();await page.getByRole('button',{name:'領取處理',exact:true}).click();await page.getByRole('button',{name:'記錄已匯款',exact:true}).click();await page.getByText('已匯款',{exact:true}).waitFor();
state=await (await page.request.get('http://127.0.0.1:5181/__acceptance/state')).json();assert.equal(state.withdrawals[0].net_amount,985);assert.equal(state.account.withdrawal_reserved_balance,0);console.log('PASS actual UI manual transfer proof, paid985 hold0');
await page.getByRole('button',{name:'返饋金通知紀錄',exact:true}).click();
await page.getByRole('button',{name:'返饋金財務對帳',exact:true}).click();await page.getByRole('button',{name:'執行財務對帳',exact:true}).click();
await page.screenshot({path:'/private/tmp/eclado-acceptance-reconciliation.png',fullPage:true});
console.log((await page.locator('body').innerText()).slice(-1600));
await page.goto(root+'/__acceptance');await action('dispatch');await action('dispatch');let s=await getState();assert.equal(s.inbox.length,3);const count=s.inbox.length;await action('dispatch');assert.equal((await getState()).inbox.length,count);console.log('PASS requested teacher/admin and paid teacher notifications, no resend');
await action('income',{qty:200});await action('mode',{value:'5xx'});
await page.goto(root+'/__preview/switch?role=teacher');await page.getByRole('tab',{name:'師資返饋金',exact:true}).click();await page.getByRole('button',{name:'申請全額提領',exact:true}).click();await page.getByText('待匯款',{exact:true}).waitFor();
await action('dispatch');await action('dispatch');await action('dispatch');s=await getState();assert.equal(s.account.balance,0);assert.equal(s.account.withdrawal_reserved_balance,200);assert.ok(s.inbox.slice(count).some(x=>x.channel==='LINE'&&x.mode==='5xx'));assert.ok(s.inbox.slice(count).some(x=>x.channel==='Email'));console.log('PASS LINE5xx fallback Email, financial hold unchanged');
await page.goto(root+'/__preview/switch?role=admin');await page.getByRole('button',{name:'師資提領管理',exact:true}).click();await page.getByRole('button',{name:'領取處理',exact:true}).click();await page.getByRole('button',{name:'確認未付款並退回',exact:true}).click();await page.getByText('明確失敗',{exact:true}).waitFor();s=await getState();assert.equal(s.account.balance,200);assert.equal(s.account.withdrawal_reserved_balance,0);console.log('PASS actual UI failed withdrawal full release200');
await action('dispatch');await action('dispatch');await action('dispatch');
await page.goto(root+'/__preview/switch?role=teacher');await page.getByRole('tab',{name:'師資返饋金',exact:true}).click();await page.getByRole('button',{name:'申請全額提領',exact:true}).click();await page.getByText('待匯款',{exact:true}).waitFor();
await page.goto(root+'/__preview/switch?role=admin');await page.getByRole('button',{name:'師資提領管理',exact:true}).click();await page.getByRole('button',{name:'領取處理',exact:true}).click();await page.getByRole('button',{name:'標記待查帳',exact:true}).click();await page.getByText('待查帳',{exact:true}).waitFor();s=await getState();assert.equal(s.account.balance,0);assert.equal(s.account.withdrawal_reserved_balance,200);console.log('PASS actual UI unknown keeps reserved200');
await page.getByRole('button',{name:'返饋金財務對帳',exact:true}).click();await page.getByRole('button',{name:'執行財務對帳',exact:true}).click();await page.getByText('withdrawal_unknown',{exact:true}).waitFor();assert.equal(await page.getByText('account_ledger',{exact:true}).count(),0);console.log('PASS actual reconciliation unknown finding, no ledger mismatch');
await page.goto(root+'/__preview/switch?role=readonly');await page.getByRole('button',{name:'師資提領管理',exact:true}).click();await page.getByText('待查帳',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'查看匯款銀行快照',exact:true}).count(),0);console.log('PASS read-only masked view without bank access controls');

}catch(e){console.log((await page.locator('body').innerText()).slice(-2200));throw e;}finally{await browser.close();}

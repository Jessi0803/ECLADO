import {test, expect} from '@playwright/test';

test('local binding preview: real bind/rebind/unbind, seven recipients and Email fallback',async({page})=>{
 test.skip(!process.env.BINDING_NOTICE_PREVIEW,'Requires disposable SQL preview, never run against an ordinary website');
 const external:string[]=[];
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5196')&&!r.url().startsWith('data:'))external.push(r.url());});
 page.on('dialog',d=>d.accept());
 await page.goto('/__binding-notices');
 const section=page.getByRole('region',{name:'師生綁定設定'});
 await expect(section.getByText('目前老師：未綁定')).toBeVisible();
 const before=await page.getByRole('article').count();expect(before).toBeGreaterThanOrEqual(7);
 await section.getByLabel('選擇綁定老師').selectOption({label:'王老師'});
 await section.getByRole('button',{name:'建立師生綁定',exact:true}).click();
 await expect(section.getByText('目前老師：王老師')).toBeVisible();
 await expect(page.getByRole('article')).toHaveCount(before+2);
 await section.getByLabel('選擇綁定老師').selectOption({label:'李老師'});
 await section.getByRole('button',{name:'更換老師',exact:true}).click();
 await expect(section.getByText('目前老師：李老師')).toBeVisible();
 await expect(page.getByRole('article')).toHaveCount(before+5);
 await section.getByRole('button',{name:'解除師生綁定',exact:true}).click();
 await expect(section.getByText('目前老師：未綁定')).toBeVisible();
 await expect(page.getByRole('article')).toHaveCount(before+7);
 await page.getByLabel('模擬 LINE 結果').selectOption('line_rejected');
 await page.getByRole('button',{name:'模擬發送一批',exact:true}).click();
 await expect(page.getByText('等待重試／備援',{exact:false}).first()).toBeVisible();
 for(let i=0;i<6;i++){await page.getByRole('button',{name:'模擬發送一批',exact:true}).click();await expect(page.getByRole('button',{name:'模擬發送一批',exact:true})).toBeEnabled();}
 await expect(page.getByRole('article').filter({hasText:'已模擬送出'})).toHaveCount(before+7);
 await expect(page.getByRole('article').filter({hasText:'已模擬送出 · Email'})).toHaveCount(before+7);
 await section.getByText('師生綁定通知紀錄',{exact:true}).click();
 await expect(section.getByText('已送出 · Email',{exact:false}).first()).toBeVisible();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
 expect(external).toEqual([]);
});

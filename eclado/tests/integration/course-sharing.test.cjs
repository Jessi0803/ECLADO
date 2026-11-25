const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { readFileSync } = require('node:fs');
const page = require('../../api/course-page.js');
const image = require('../../api/course-share-image.js');
const id = '006110e8-f670-43fb-9886-b5b1410c00f4';
const course = { id, name: '金緞護理 <課程>', overview: '膚況評估 & 護理規劃',
  image_path: `${id}.webp`, description: '詳細介紹不應取代概述', zoom_url: 'PRIVATE_ZOOM' };
const template = '<html><head><title>首頁</title><!--seo-head-start--><meta property="og:title" content="首頁"><meta property="og:image" content="old.jpg"><!--seo-head-end--></head><body><div id="root"></div><script src="/assets/main.js"></script></body></html>';
function response() {
  return { headers: {}, code: 200, body: '', setHeader(k,v) {this.headers[k]=v;},
    status(code) {this.code=code;return this;}, send(body='') {this.body=body;return this;},
    end(body='') {this.body=body;return this;} };
}
async function mocked(run, rows = [course], broken = false) {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({url:String(url),options});
    if (broken) throw Error('offline');
    if (String(url).includes('/rpc/resolve_course_slug')) {
      return new Response(JSON.stringify(rows.find(c=>c.slug===JSON.parse(options.body).p_slug)?.id || null));
    }
    if (String(url).includes('/rpc/get_published_courses')) {
      assert.deepEqual(JSON.parse(options.body), {p_id:id});
      return new Response(JSON.stringify(rows), {headers:{'Content-Type':'application/json'}});
    }
    if (String(url).includes('/storage/v1/object/course-images/')) {
      return new Response(await sharp({create:{width:1080,height:1080,channels:3,background:'#e0bc72'}}).webp().toBuffer());
    }
    assert.match(String(url), /^https:\/\/[a-z.-]+\/$/);
    assert.equal(options.redirect, 'error');
    return new Response(template);
  };
  try { await run(calls); } finally { global.fetch = previous; }
}

test('課程初始 HTML 提供單一課名、概述、公開封面與原網址，保留前台程式', async () => {
  await mocked(async () => {
    const res=response(); await page({method:'GET',query:{id},headers:{host:'attacker.test'}},res);
    assert.equal(res.code,200);
    assert.match(res.body, /og:title" content="金緞護理 &lt;課程&gt; \| ECLADO/);
    assert.match(res.body, /og:description" content="膚況評估 &amp; 護理規劃/);
    assert.match(res.body, new RegExp(`og:image" content="https://ecladotaiwan.com/api/course-share-image\\?id=${id}`));
    assert.match(res.body, new RegExp(`canonical" href="https://ecladotaiwan.com/courses/${id}`));
    assert.equal((res.body.match(/property="og:title"/g)||[]).length,1);
    assert.equal((res.body.match(/property="og:image"/g)||[]).length,1);
    assert.match(res.body, /src="\/assets\/main.js"/);
    assert.doesNotMatch(res.body, /PRIVATE_ZOOM|詳細介紹不應取代概述|attacker.test/);
  });
});
test('未上架、未到上架時間及不存在的課程不回傳分享內容或封面', async () => {
  await mocked(async calls => {
    for (const handler of [page,image]) {
      const res=response(); await handler({method:'GET',query:{id}},res);
      assert.equal(res.code,404); assert.doesNotMatch(String(res.body),/金緞護理|PRIVATE_ZOOM/);
      assert.equal(res.headers['Cache-Control'],'no-store');
    }
    assert.equal(calls.length,2);
  },[]);
});
test('分享封面不需登入即可讀取，WebP 轉成完整正方形 JPEG', async () => {
  await mocked(async () => {
    const res=response(); await image({method:'GET',query:{id}},res);
    assert.equal(res.code,200); assert.equal(res.headers['Content-Type'],'image/jpeg');
    const meta=await sharp(res.body).metadata();
    assert.deepEqual([meta.width,meta.height,meta.format],[1080,1080,'jpeg']);
  });
});
test('不接受任意檔案路徑與無效課程識別碼', async () => {
  await mocked(async calls => {
    for (const handler of [page,image]) {
      const res=response(); await handler({method:'GET',query:{id:'../../secret'}},res);
      assert.equal(res.code,404);
    }
    assert.equal(calls.length,0);
  });
  await mocked(async calls => {
    const res=response(); await image({method:'GET',query:{id}},res);
    assert.equal(res.code,404); assert.equal(calls.length,1);
  },[{...course,image_path:'../../private.webp'}]);
});
test('HEAD 與 GET 的狀態相同、無回應內文，POST 不允許', async () => {
  await mocked(async () => {
    for (const handler of [page,image]) {
      const res=response(); await handler({method:'HEAD',query:{id}},res);
      assert.equal(res.code,200); assert.equal(res.body,'');
      const post=response(); await handler({method:'POST',query:{id}},post);
      assert.equal(post.code,405);
    }
  });
});
test('暫時讀取失敗回傳可重試的 503，避免快取錯誤分享', async () => {
  await mocked(async () => {
    for (const handler of [page,image]) {
      const res=response(); await handler({method:'GET',query:{id}},res);
      assert.equal(res.code,503); assert.equal(res.headers['Retry-After'],'60');
    }
  },[],true);
});
test('Preview 未設定隔離測試庫時不得連線正式資料庫', async () => {
  const previous=process.env.VERCEL_ENV; process.env.VERCEL_ENV='preview';
  try {
    await mocked(async calls => {
      const res=response(); await page({method:'GET',query:{id}},res);
      assert.equal(res.code,503); assert.equal(calls.length,0);
    });
  } finally { if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous; }
});
test('課程詳情路由支援分享 HTML，報名頁仍走原本的前台', () => {
  const config=JSON.parse(readFileSync('vercel.json','utf8'));
  assert.equal(config.rewrites.find(r=>r.source==='/courses/:id').destination,'/api/course-page?id=:id');
  assert.equal(config.rewrites.find(r=>r.source==='/courses/:id/register').destination,'/');
});

test('代稱選填：有代稱時識別碼回傳暫時轉向，新網址具正確分享資訊', async () => {
  const slug='2026-12-16-gold-care';
  await mocked(async () => {
    const original=response(); await page({method:'GET',query:{id}},original);
    assert.equal(original.code,302); assert.equal(original.headers.Location,'/courses/'+slug);
    assert.equal(original.headers['Cache-Control'],'no-store');
    const canonical=response(); await page({method:'GET',query:{id:slug}},canonical);
    assert.equal(canonical.code,200);
    assert.match(canonical.body,new RegExp('og:url" content="https://ecladotaiwan.com/courses/'+slug));
    assert.match(canonical.body,new RegExp('course-share-image\\?id='+id));
    const cover=response(); await image({method:'GET',query:{id}},cover);
    assert.equal(cover.code,200);
  },[{...course,slug}]);
});

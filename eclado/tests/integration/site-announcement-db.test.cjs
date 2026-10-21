const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

// Run against an explicitly supplied isolated PGlite installation, never a remote DB.
test('announcement migration: permissions, validation, persistence and reapply', {skip:!process.env.PGLITE_MODULE}, async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.has_backoffice_permission(text) returns boolean language sql as $$
        select coalesce(current_setting('test.promotions_manage',true),'false')='true'; $$;`);
    const sql=fs.readFileSync(path.join(__dirname,'../../supabase-site-announcement.sql'),'utf8');
    await db.exec(sql);
    assert.deepEqual((await db.query('select content,enabled from public.site_announcement')).rows,[{content:'',enabled:false}]);
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int n from public.site_announcement')).rows[0].n,1);
    await assert.rejects(db.query("select public.save_site_announcement('blocked',true)"),e=>e.code==='42501');
    await assert.rejects(db.query("update public.site_announcement set enabled=true,content='blocked'"),e=>e.code==='42501');
    await db.exec('reset role;set role authenticated');
    await assert.rejects(db.query("select public.save_site_announcement('blocked',true)"),e=>e.code==='42501');
    await db.exec("set test.promotions_manage='true'");
    const result=(await db.query("select public.save_site_announcement('  任選2件即免運  ',true) value")).rows[0].value;
    assert.deepEqual(result,{content:'任選2件即免運',enabled:true});
    await assert.rejects(db.query("update public.site_announcement set content='direct write'"),e=>e.code==='42501');
    for(const [content,enabled] of [[' ',true],['\n\t ',true],['x'.repeat(201),true],[null,false],['test',null]]) {
      await assert.rejects(db.query('select public.save_site_announcement($1,$2)',[content,enabled]),e=>e.code==='22023');
    }
    assert.equal((await db.query('select content from public.site_announcement')).rows[0].content,'任選2件即免運');
    await db.query("select public.save_site_announcement('保留草稿',false)");
    await db.exec('reset role');
    await db.exec(sql);
    assert.deepEqual((await db.query('select content,enabled from public.site_announcement')).rows,[{content:'保留草稿',enabled:false}]);
    await assert.rejects(db.query('insert into public.site_announcement(id) values(false)'),e=>e.code==='23514');
  } finally {await db.close();}
});

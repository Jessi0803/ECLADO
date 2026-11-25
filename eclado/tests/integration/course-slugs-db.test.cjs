const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const {pathToFileURL} = require('node:url');

test('選填課程代稱：保留舊資料、重複防護、交易回滾、權限與公開時間', {skip:!process.env.PGLITE_MODULE}, async () => {
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db=new PGlite();
  const query=async(sql,args)=>(await db.query(sql,args)).rows;
  const save=async(id,version,name,slug,published=true,publishAt=null)=>(await query(
    'select public.save_course_with_slug($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as course',
    [id,version,name,'介紹',null,'2035-12-16T12:00:00Z','2035-12-16T14:00:00Z',1000,published,'https://zoom.us/private','April','課程概述',publishAt,null,slug],
  ))[0].course;
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select '10000000-0000-4000-8000-000000000001'::uuid$$;
      create function public.has_backoffice_permission(text) returns boolean language sql stable as $$select current_setting('test.allowed',true)='yes'$$;
      create table public.courses (
        id uuid primary key default gen_random_uuid(), version integer not null default 1,
        name text, description text, image_path text, starts_at timestamptz, ends_at timestamptz,
        price_twd integer, published boolean, instructor_name text, overview text,
        publish_at timestamptz, registration_opens_at timestamptz
      );
      create function public.get_published_courses(p_id uuid default null) returns setof public.courses language sql as $$select * from public.courses where published$$;
      create function public.save_scheduled_course(
        p_id uuid,p_version integer,p_name text,p_description text,p_image_path text,
        p_starts_at timestamptz,p_ends_at timestamptz,p_price_twd integer,p_published boolean,p_zoom_url text,
        p_instructor_name text,p_overview text,p_publish_at timestamptz,p_registration_opens_at timestamptz
      ) returns jsonb language plpgsql as $$
      declare c public.courses%rowtype;
      begin
        if p_id is null then
          insert into public.courses(name,description,image_path,starts_at,ends_at,price_twd,published,instructor_name,overview,publish_at,registration_opens_at)
          values(p_name,p_description,p_image_path,p_starts_at,p_ends_at,p_price_twd,p_published,p_instructor_name,p_overview,p_publish_at,p_registration_opens_at) returning * into c;
        else
          update public.courses set name=p_name,published=p_published,publish_at=p_publish_at,version=version+1
          where id=p_id and version=p_version returning * into c;
          if not found then raise exception 'version conflict' using errcode='40001'; end if;
        end if;
        return to_jsonb(c)||jsonb_build_object('zoom_url',p_zoom_url);
      end; $$;
      insert into public.courses(name,published) values('既有課程',false);
      set test.allowed='yes';
    `);
    const sql=readFileSync('supabase-course-slugs.sql','utf8');
    await db.exec(sql); await db.exec(sql);
    assert.equal((await query("select slug from public.courses where name='既有課程'"))[0].slug,null);
    const a=await save(null,null,'課程甲',null);
    assert.equal(a.slug,null);
    const updated=await save(a.id,a.version,'課程甲',' 2035-GOLD-CARE ');
    assert.equal(updated.slug,'2035-gold-care');
    await assert.rejects(save(null,null,'重複課程','2035-gold-care'),/已被使用/);
    assert.equal((await query("select count(*)::int as n from public.courses where name='重複課程'"))[0].n,0);
    const b=await save(null,null,'課程乙','other-course');
    await assert.rejects(save(b.id,b.version,'不應保存的新名稱',updated.slug),/已被使用/);
    assert.equal((await query('select name,version from public.courses where id=$1',[b.id]))[0].name,'課程乙');
    for(const bad of ['ab','register',a.id,'bad/slug','中文字','a'.repeat(101)])await assert.rejects(save(null,null,'格式錯誤',bad),/格式不正確/);
    await assert.rejects(save(a.id,a.version,'舊版本','unused-course'),/version conflict/);
    await db.exec("set test.allowed='no'");
    await assert.rejects(save(null,null,'禁止寫入','denied-course'),/權限不足/);
    await db.exec("set test.allowed='yes'");
    const hidden=await save(null,null,'尚未上架','hidden-course',false);
    await save(null,null,'排程課程','future-course',true,'2035-12-01T00:00:00Z');
    await db.exec('set role anon');
    assert.equal((await query("select public.resolve_course_slug('hidden-course') as id"))[0].id,null);
    assert.equal((await query("select public.resolve_course_slug('future-course') as id"))[0].id,null);
    assert.equal((await query("select public.resolve_course_slug('2035-gold-care') as id"))[0].id,a.id);
    assert.equal((await query('select * from public.get_published_courses($1)',[hidden.id])).length,0);
    const visible=await query('select * from public.get_published_courses($1)',[a.id]);
    assert.equal(visible[0].slug,'2035-gold-care'); assert.equal('zoom_url' in visible[0],false);
    await assert.rejects(save(null,null,'未授權','not-allowed'),/permission denied/);
    await db.exec('reset role');
    const cleared=await save(a.id,updated.version,'課程甲','  ');
    assert.equal(cleared.slug,null);
    assert.equal((await query("select public.resolve_course_slug('2035-gold-care') as id"))[0].id,null);
  } finally {await db.close();}
});

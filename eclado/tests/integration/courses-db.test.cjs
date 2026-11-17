const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('course permissions, publication, image visibility and version conflicts', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const migration = readFileSync(resolve(__dirname, '../../supabase-courses-foundation.sql'), 'utf8');
  const image = '10000000-0000-4000-8000-000000000001.webp';
  const zoom = 'https://eclado.zoom.us/j/123456789?pwd=private';
  const args = [null, null, '測試課程', '完整課程介紹', image,
    '2030-11-11T10:00:00+08:00', '2030-11-11T12:00:00+08:00', 1200, false, zoom];
  const query = async (sql, values) => (await db.query(sql, values)).rows;
  const save = async values => (await query('select public.save_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as course', values))[0].course;

  const saveListing = async values => (await query('select public.save_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as course', values))[0].course;

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema storage;
      create table public.backoffice_role_permissions (
        role text, permission text check (permission in ('catalog.write')), primary key (role, permission)
      );
      insert into public.backoffice_role_permissions values ('catalog_editor', 'catalog.write');
      create function auth.uid() returns uuid language sql stable as
        $$ select '10000000-0000-4000-8000-000000000002'::uuid $$;
      create function public.has_backoffice_permission(text) returns boolean language sql stable as
        $$ select exists (select 1 from public.backoffice_role_permissions
             where role = current_setting('test.member_role', true) and permission = $1) $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
      create table storage.objects (bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant select on storage.objects to anon, authenticated;
      grant insert on storage.objects to authenticated;
      grant select on public.backoffice_role_permissions to authenticated;
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("set role authenticated; set test.member_role = 'catalog_editor'");
    await assert.rejects(save(args), { code: '42501' });
    await assert.rejects(query('select public.get_admin_courses()'), { code: '42501' });
    await assert.rejects(query('insert into storage.objects values ($1,$2)', ['course-images', image]), { code: '42501' });

    await db.exec("set test.member_role = 'admin'");
    await assert.rejects(save(args), { code: '22023' });
    await query('insert into storage.objects values ($1,$2)', ['course-images', image]);
    const draft = await save(args);
    assert.equal(draft.zoom_url, zoom);
    assert.equal((await query('select public.get_admin_courses() as courses'))[0].courses[0].id, draft.id);

    await db.exec('set role anon');
    assert.deepEqual(await query('select * from public.get_published_courses()'), []);
    assert.deepEqual(await query('select * from storage.objects'), []);
    await assert.rejects(query('select public.get_admin_courses()'), { code: '42501' });
    await assert.rejects(query('select * from public.course_meeting_details'), { code: '42501' });

    await db.exec('reset role');
    const listingMigration = readFileSync(resolve(__dirname, '../../supabase-course-listing-details.sql'), 'utf8');
    await db.exec(listingMigration);
    await db.exec(listingMigration);
    await db.exec("set role authenticated; set test.member_role = 'catalog_editor'");
    await assert.rejects(saveListing([...args, 'April', '課程概述']), { code: '42501' });
    await db.exec("set test.member_role = 'admin'");
    assert.equal((await query('select public.get_admin_courses() as courses'))[0].courses[0].overview, null);
    const edit = [draft.id, draft.version, ...args.slice(2)];
    const invalid = [...edit];
    invalid[6] = invalid[5];
    await assert.rejects(save(invalid), { code: '23514' });
    edit[8] = true;
    await assert.rejects(save([...edit.slice(0, 9), 'https://zoom.us.example.test/j/123']), { code: '23514' });
    await assert.rejects(saveListing([...edit, 'April', '長'.repeat(301)]), { code: '23514' });
    const published = await saveListing([...edit, '  客座講師  ', '  練習護膚手技  ']);
    assert.equal(published.instructor_name, '客座講師');
    assert.equal(published.overview, '練習護膚手技');
    assert.equal(published.version, 2);
    await assert.rejects(save(edit), { code: '40001' });

    await db.exec('set role anon');
    const [visible] = await query('select * from public.get_published_courses($1)', [draft.id]);
    assert.equal(visible.name, draft.name);
    assert.equal(visible.description, '完整課程介紹');
    const [card] = await query('select * from public.get_published_courses()');
    assert.equal(card.instructor_name, '客座講師');
    assert.equal(card.overview, '練習護膚手技');
    assert.equal(card.description, null);
    assert.equal(visible.price_twd, 1200);
    assert.equal(visible.starts_at.toISOString(), '2030-11-11T02:00:00.000Z');
    assert.equal(Object.hasOwn(visible, 'zoom_url'), false);
    assert.deepEqual(await query('select name from storage.objects'), [{ name: image }]);

    await db.exec('set role authenticated');
    edit[1] = published.version;
    edit[8] = false;
    await save(edit);
    await db.exec('set role anon');
    assert.deepEqual(await query('select * from public.get_published_courses($1)', [draft.id]), []);
    assert.deepEqual(await query('select * from storage.objects'), []);
  } finally {
    await db.close();
  }
});

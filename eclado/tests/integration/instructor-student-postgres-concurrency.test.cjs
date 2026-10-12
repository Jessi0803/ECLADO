// Real PostgreSQL: owns a new loopback cluster, never accepts a database URL.
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), net=require('node:net');
const { pathToFileURL }=require('node:url');
const root=path.resolve(__dirname,'../..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admins=[id(1),id(2)], teachers=[id(10),id(11),id(12)];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function existingFunction(name) {
  const s=read('supabase-backoffice-permissions.sql'),start=s.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0);return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start))+3);
}
async function freePort() {
  const s=net.createServer();await new Promise((r,j)=>s.once('error',j).listen(0,'127.0.0.1',r));
  const p=s.address().port;await new Promise(r=>s.close(r));return p;
}
test('1B real PostgreSQL: separate sessions, bind/rebind/unbind/Auth-delete races and ACL',{
  skip:!process.env.EMBEDDED_POSTGRES_MODULE,timeout:120000,
},async t=>{
  const {default:EmbeddedPostgres}=await import(pathToFileURL(process.env.EMBEDDED_POSTGRES_MODULE));
  const logs=[],clients=[];
  const cluster=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'eclado-1b-pg-')),
    port:await freePort(),user:'postgres',password:'isolated-test-only',persistent:false,createPostgresUser:false,
    postgresFlags:['-h','127.0.0.1','-c','deadlock_timeout=100ms','-c','log_lock_waits=on'],
    onLog:m=>logs.push(String(m)),onError:m=>logs.push(String(m))});
  let started=false;
  const connect=async(uid=null)=>{
    const c=cluster.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);
    await c.query("set statement_timeout='8s';set lock_timeout='6s'");
    await c.query("select set_config('test.uid',$1,false)",[uid||'']);
    if(uid)await c.query('set role authenticated');return c;
  };
  const bind=(c,s,i,expected=null,action='bind')=>c.query(
    'select public.save_instructor_student_binding($1::uuid,$2::uuid,$3::uuid,$4::text) as result',[s,i,expected,action]);
  const caught=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error}));
  try {
    await cluster.initialise();await cluster.start();started=true;
    const m=await connect();const version=(await m.query('select version() as version')).rows[0].version;
    assert.match(version,/PostgreSQL 17\.6/);t.diagnostic(version);
    await m.query(`create role anon;create role authenticated;create role service_role;create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,role text,name text);
      create table public.admin_users(user_id uuid,role text,active boolean);
      create table public.backoffice_roles(role text primary key,active boolean);
      create table public.backoffice_role_permissions(role text,permission text,primary key(role,permission),
        constraint backoffice_role_permissions_permission_check check(permission in ('members.read','members.write')));
      insert into public.backoffice_roles values('admin',true),('super_admin',true);
      insert into public.backoffice_role_permissions values('admin','members.read'),('admin','members.write');
      alter table public.profiles enable row level security;grant select on public.profiles to authenticated;
      create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());`);
    await m.query(existingFunction('has_backoffice_permission'));await m.query(existingFunction('is_eclado_admin'));
    await m.query(read('supabase-instructor-student-foundation.sql'));
    const verify=await m.query(read('supabase-instructor-student-foundation-verify.sql'));
    for(const [k,v]of Object.entries(verify[1].rows[0]))assert.equal(v,true,k);
    for(const r of verify[2].rows){assert.equal(r.anon_denied,true,r.signature);assert.equal(r.client_acl_correct,true,r.signature);}
    const seed=async(uid,role)=>{
      await m.query('insert into auth.users values($1)',[uid]);
      await m.query('insert into public.profiles values($1,$2,$3)',[uid,role,`fixture-${uid}`]);
    };
    for(const uid of admins){await seed(uid,'consumer');await m.query("insert into public.admin_users values($1,'admin',true)",[uid]);}
    const a=await connect(admins[0]),b=await connect(admins[1]),d=await connect();
    for(const uid of teachers){await seed(uid,'instructor');await a.query("select public.set_instructor_student_price_type($1,'student_1',0)",[uid]);}
    const pids=await Promise.all([a,b,d].map(c=>c.query('select pg_backend_pid() as pid')));
    assert.equal(new Set(pids.map(r=>r.rows[0].pid)).size,3);
    const pid=new Map([[a,pids[0].rows[0].pid],[b,pids[1].rows[0].pid],[d,pids[2].rows[0].pid]]);
    let waits=0,races=0;
    // Hold the first transaction; prove pg_blocking_pids links the second
    // backend to it before releasing. Both winner orders are tested explicitly.
    const race=async(first,second,op1,op2)=>{
      await first.query('begin');
      try {
        await op1();const pending=caught(op2());let blocked=false;
        for(let n=0;n<150;n++){
          const r=await m.query('select $1::int=any(pg_blocking_pids($2::int)) as blocked',[pid.get(first),pid.get(second)]);
          if(r.rows[0].blocked){blocked=true;break;}await pause(10);
        }
        await first.query(blocked?'commit':'rollback');const r=await pending;
        assert.equal(blocked,true,'second backend must demonstrably wait for first');waits++;races++;
        if(!r.ok)assert.ok(!['40P01','55P03','57014'].includes(r.error.code),r.error.message);
        return r;
      }catch(e){await first.query('rollback');throw e;}
    };
    const invariant=async()=>{
      assert.equal((await m.query(`select count(*)::int as n from(select student_id from public.instructor_student_bindings
        where ended_at is null group by student_id having count(*)>1) duplicate`)).rows[0].n,0);
      assert.equal((await m.query(`select count(*)::int as n from public.instructor_student_bindings b
        left join public.profiles s on s.id=b.student_id left join public.profiles i on i.id=b.instructor_id
        where b.ended_at is null and(s.id is null or i.id is null)`)).rows[0].n,0);
      assert.equal((await m.query(`select count(*)::int as n from public.instructor_student_bindings b
        where not exists(select 1 from public.instructor_student_audit_logs h
          where h.after_data->>'binding_id'=b.id::text and h.event_type in('bind','rebind'))
        or(b.ended_at is not null and not exists(select 1 from public.instructor_student_audit_logs h
          where(h.before_data->>'binding_id'=b.id::text or h.after_data->>'binding_id'=b.id::text)
          and h.event_type in('rebind','unbind','member_deleted')))`)).rows[0].n,0);
    };
    let seq=100;const student=async()=>{const uid=id(seq++);await seed(uid,'pro');return uid;};
    const current=async uid=>(await m.query('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[uid])).rows[0]?.id;
    for(let round=0;round<5;round++){
      await t.test(`round ${round+1}: competing initial bind`,async()=>{
        const s=await student(),r=await race(a,b,()=>bind(a,s,teachers[0]),()=>bind(b,s,teachers[1]));
        assert.equal(r.ok,false);assert.equal(r.error.code,'40001');await invariant();
      });
      await t.test(`round ${round+1}: two administrators rebind`,async()=>{
        const s=await student();await bind(a,s,teachers[0]);const old=await current(s);
        const r=await race(a,b,()=>bind(a,s,teachers[1],old,'rebind'),()=>bind(b,s,teachers[2],old,'rebind'));
        assert.equal(r.ok,false);assert.equal(r.error.code,'40001');await invariant();
      });
      for(const first of ['rebind','unbind'])await t.test(`round ${round+1}: ${first} wins rebind/unbind`,async()=>{
        const s=await student();await bind(a,s,teachers[0]);const old=await current(s),next=first==='rebind'?'unbind':'rebind';
        const r=await race(a,b,()=>bind(a,s,first==='unbind'?null:teachers[1],old,first),
          ()=>bind(b,s,next==='unbind'?null:teachers[2],old,next));
        assert.equal(r.ok,false);assert.equal(r.error.code,'40001');await invariant();
      });
      for(const target of ['student','old_teacher','new_teacher'])for(const deleteFirst of [true,false]){
        await t.test(`round ${round+1}: delete ${target}, deleteFirst=${deleteFirst}`,async()=>{
          const s=await student(),oldTeacher=id(seq++),newTeacher=id(seq++);
          for(const uid of [oldTeacher,newTeacher]){await seed(uid,'instructor');await a.query("select public.set_instructor_student_price_type($1,'student_1',0)",[uid]);}
          await bind(a,s,oldTeacher);const old=await current(s),victim=target==='student'?s:target==='old_teacher'?oldTeacher:newTeacher;
          const remove=()=>d.query('delete from auth.users where id=$1',[victim]),change=()=>bind(a,s,newTeacher,old,'rebind');
          const r=deleteFirst?await race(d,a,remove,change):await race(a,d,change,remove);
          if(deleteFirst){assert.equal(r.ok,false);assert.ok(['40001','22023'].includes(r.error.code));}else assert.equal(r.ok,true);
          await invariant();
        });
      }
      for(const deleteFirst of [true,false])await t.test(`round ${round+1}: initial bind/teacher delete, deleteFirst=${deleteFirst}`,async()=>{
        const s=await student(),teacher=id(seq++);await seed(teacher,'instructor');
        await a.query("select public.set_instructor_student_price_type($1,'student_1',0)",[teacher]);
        const remove=()=>d.query('delete from auth.users where id=$1',[teacher]),change=()=>bind(a,s,teacher);
        const r=deleteFirst?await race(d,a,remove,change):await race(a,d,change,remove);
        if(deleteFirst){assert.equal(r.ok,false);assert.equal(r.error.code,'22023');}else assert.equal(r.ok,true);await invariant();
      });
    }
    await t.test('simultaneous start stress: 40 initial binds/rebinds',async()=>{
      for(let n=0;n<40;n++){
        const s=await student();let old=null,action='bind';
        if(n%2){await bind(a,s,teachers[0]);old=await current(s);action='rebind';}
        const results=await Promise.all([caught(bind(a,s,teachers[1],old,action)),caught(bind(b,s,teachers[2],old,action))]);
        assert.equal(results.filter(r=>r.ok).length,1);
        const loser=results.find(r=>!r.ok);assert.equal(loser.error.code,'40001');
        await invariant();
      }
    });
    await t.test('actual caller ACL/RLS and immutable audit',async()=>{
      const member=await connect(teachers[0]);
      await assert.rejects(bind(member,id(100),teachers[1]),e=>e.code==='42501');
      await assert.rejects(member.query('select * from public.instructor_student_bindings'),e=>e.code==='42501');
      await assert.rejects(member.query('select public.instructor_student_context($1)',[id(100)]),e=>e.code==='42501');
      assert.equal((await member.query('select count(*)::int as n from public.profiles')).rows[0].n,1);
      const anon=await connect();await anon.query('set role anon');
      await assert.rejects(anon.query('select public.get_my_student_pricing_context()'),e=>e.code==='42501');
      await assert.rejects(m.query('update public.instructor_student_audit_logs set event_type=event_type'),e=>e.code==='42501');
    });
    const deadlocks=(await m.query('select deadlocks::int from pg_stat_database where datname=current_database()')).rows[0].deadlocks;
    assert.equal(deadlocks,0);assert.doesNotMatch(logs.join('\n'),/deadlock detected/i);
    t.diagnostic(`backend PIDs=${pids.map(r=>r.rows[0].pid).join(',')}; races=${races}; proven lock waits=${waits}; deadlocks=${deadlocks}`);
  }finally{await Promise.allSettled(clients.map(c=>c.end()));if(started)await cluster.stop();}
});

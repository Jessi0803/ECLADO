-- Authorized schema-only export for test project; no customer rows or production writes.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH relations AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relkind
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v')
), functions AS (
 SELECT p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl,p.proowner
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f'
)
SELECT section,payload FROM (
 SELECT 'extensions'::text section, coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) ORDER BY e.extname),'[]') payload FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 UNION ALL
 SELECT 'sequences',coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(s.seqtypid,null),'start',s.seqstart,'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle,'owner_table',d.refobjid::regclass::text,'owner_column',a.attname,'dependency',d.deptype) ORDER BY c.relname),'[]') FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_depend d ON d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i') LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE n.nspname='public'
 UNION ALL
 SELECT 'auth_triggers',coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='auth' AND pn.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'database'::text section,jsonb_build_object('version',version(),'read_only',current_setting('transaction_read_only'),'captured_at',now(),'migration_history_exists',to_regclass('supabase_migrations.schema_migrations') IS NOT NULL) payload
 UNION ALL
 SELECT 'tables',coalesce(jsonb_agg(jsonb_build_object('name',r.relname,'kind',r.relkind,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'acl',(SELECT jsonb_object_agg(role,jsonb_build_object('select',has_table_privilege(role,r.oid,'SELECT'),'insert',has_table_privilege(role,r.oid,'INSERT'),'update',has_table_privilege(role,r.oid,'UPDATE'),'delete',has_table_privilege(role,r.oid,'DELETE'),'truncate',has_table_privilege(role,r.oid,'TRUNCATE'))) FROM unnest(ARRAY['anon','authenticated','service_role']) role)) ORDER BY r.relname),'[]') FROM relations r
 UNION ALL
 SELECT 'constraints',coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true)) ORDER BY r.relname,c.conname),'[]') FROM pg_constraint c JOIN relations r ON r.oid=c.conrelid
 UNION ALL
 SELECT 'indexes',coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',ic.relname,'unique',i.indisunique,'valid',i.indisvalid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY r.relname,ic.relname),'[]') FROM pg_index i JOIN relations r ON r.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid
 UNION ALL
 SELECT 'policies',coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'qual',qual,'with_check',with_check) ORDER BY tablename,policyname),'[]') FROM pg_policies WHERE schemaname='public'
 UNION ALL
 SELECT 'functions',coalesce(jsonb_agg(jsonb_build_object('signature',f.oid::regprocedure::text,'name',f.proname,'security_definer',f.prosecdef,
 'search_path',(SELECT v FROM unnest(f.proconfig) v WHERE v LIKE 'search_path=%' LIMIT 1),'owner',pg_get_userbyid(f.proowner),'acl',f.proacl,
 'md5',md5(pg_get_functiondef(f.oid)),'normalized_md5',md5(regexp_replace(pg_get_functiondef(f.oid),'[[:space:]]','','g')),
 'execute',(SELECT jsonb_object_agg(role,has_function_privilege(role,f.oid,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role),
 'definition',pg_get_functiondef(f.oid)) ORDER BY f.proname,f.oid::regprocedure::text),'[]') FROM functions f
 UNION ALL
 SELECT 'triggers',coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY r.relname,t.tgname),'[]') FROM pg_trigger t JOIN relations r ON r.oid=t.tgrelid WHERE NOT t.tgisinternal
) result ORDER BY section;
ROLLBACK;

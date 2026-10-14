"""Build a reviewed test-only schema upgrade from read-only catalog exports.
Never connects to any database. Preserve existing product and Auth/Storage.
"""
import json, hashlib, re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
evidence=root/'docs/evidence/reward-staging-upgrade'
out=root/'docs/reward-staging-upgrade'
out.mkdir(exist_ok=True)
p=json.loads((evidence/'production-schema-source.json').read_text())
b=json.loads((evidence/'before-metadata.json').read_text())
seq=json.loads((evidence/'production-sequences.json').read_text())
config=json.loads((evidence/'necessary-settings.json').read_text())
q=lambda s:'"'+s.replace('"','""')+'"'
lit=lambda x: 'NULL' if x is None else ('true' if x is True else 'false' if x is False else str(x) if isinstance(x,(int,float)) else "'"+str(x).replace("'","''")+"'")
old={t['name']:t for t in b['tables']}
sql=['-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Never run against production.', 'BEGIN;', "SET LOCAL statement_timeout='120s';", "SET LOCAL lock_timeout='10s';", 'SET LOCAL check_function_bodies=false;', 'SET LOCAL search_path=public,extensions,auth;', '''DO $guard$ BEGIN
 IF to_regclass('public.student_pricing_feature_settings') IS NOT NULL
 OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v'))<>5
 OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.orders)
 OR EXISTS(SELECT 1 FROM public.profiles) THEN
 RAISE EXCEPTION 'Refusing: target is not the reviewed empty legacy test baseline';
 END IF;
 END $guard$;''']
for t in b['triggers']:sql.append(f'DROP TRIGGER {q(t["name"])} ON public.{q(t["table"])};')
for pol in b['policies']:sql.append(f'DROP POLICY {q(pol["name"])} ON public.{q(pol["table"])};')
# Supabase owns its platform extensions. Check required extensions; do not clone vault contents.
sql.append("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN RAISE EXCEPTION 'pgcrypto required'; END IF; END $$;")
for s in seq:
 if s['dependency']!='i':
  sql.append(f'CREATE SEQUENCE public.{q(s["name"])} AS {s["type"]} INCREMENT {s["increment"]} MINVALUE {s["min"]} MAXVALUE {s["max"]} START {s["start"]} CACHE {s["cache"]} '+('CYCLE;' if s['cycle'] else 'NO CYCLE;'))
# Default expression function must exist before purchase_orders.
for f in p['functions']:
 if f['signature']=='next_purchase_order_number()':sql.append(f['definition'].rstrip()+';')
def col(c):
 x=q(c['name'])+' '+c['type']
 if c['identity']: x+=' GENERATED '+('ALWAYS' if c['identity']=='a' else 'BY DEFAULT')+' AS IDENTITY'
 elif c['default'] is not None:x+=' DEFAULT '+c['default']
 if c['not_null']:x+=' NOT NULL'
 return x
for t in p['tables']:
 assert t['kind']=='r', 'Unexpected relation kind needs review'
 name='public.'+q(t['name'])
 if t['name'] not in old:sql.append('CREATE TABLE '+name+' (\n'+',\n'.join(col(c) for c in t['columns'])+'\n);')
 else:
  oc={c['name']:c for c in old[t['name']]['columns']}
  for c in t['columns']:
   if c['name'] not in oc:
    if t['name']=='products' and c['name']=='slug':
     sql.append('ALTER TABLE '+name+' ADD COLUMN "slug" text;')
    else:sql.append('ALTER TABLE '+name+' ADD COLUMN '+col(c)+';')
   else:
    assert oc[c['name']]['type']==c['type'], 'Unexpected type conversion'
    if c['default']!=oc[c['name']]['default']:
     sql.append(f'ALTER TABLE {name} ALTER COLUMN {q(c["name"])} '+('SET DEFAULT '+c['default'] if c['default'] is not None else 'DROP DEFAULT')+';')
    if c['not_null']!=oc[c['name']]['not_null']:sql.append(f'ALTER TABLE {name} ALTER COLUMN {q(c["name"])} '+('SET' if c['not_null'] else 'DROP')+' NOT NULL;')
# Load non-personal settings before audit/status triggers.
for table,value in config.items():
 rows=value if isinstance(value,list) else [value]
 for row in rows:
  if table=='student_pricing_feature_settings':row=dict(row,enabled=False)
  sql.append(f'INSERT INTO public.{q(table)} ({",".join(map(q,row))}) VALUES ({",".join(lit(v) for v in row.values())});')
for f in p['functions']:
 assert hashlib.md5(f['definition'].encode()).hexdigest()==f['md5'], 'Source hash mismatch'
 sql.append(f['definition'].rstrip()+';')
# Preserve the legacy product; use the existing production slug normalizer.
sql.extend(['UPDATE public.products SET slug=public.make_product_slug(name) WHERE slug IS NULL;', 'ALTER TABLE public.products ALTER COLUMN slug SET NOT NULL;', "UPDATE public.products SET publication_status=CASE WHEN active THEN 'active' ELSE 'archived' END;"])
# Keys before foreign keys; preserve identical legacy constraints.
oldcons={(c['table'],c['name']):c for c in b['constraints']}
newcons={(c['table'],c['name']) for c in p['constraints']}
for key,c in oldcons.items():
 if key not in newcons:sql.append(f'ALTER TABLE public.{q(c["table"])} DROP CONSTRAINT {q(c["name"])};')
for c in sorted(p['constraints'],key=lambda x:x['type']=='f'):
 if c['type']=='t':continue # recreated by CREATE CONSTRAINT TRIGGER
 key=(c['table'],c['name']);oldc=oldcons.get(key)
 if oldc and oldc['definition']==c['definition']:continue
 name='public.'+q(c['table'])
 if oldc:sql.append(f'ALTER TABLE {name} DROP CONSTRAINT {q(c["name"])};')
 sql.append(f'ALTER TABLE {name} ADD CONSTRAINT {q(c["name"])} {c["definition"]}'+(' NOT VALID' if not c['validated'] and c['type'] in ('c','f') else '')+';')
constraintnames={c['name'] for c in p['constraints'] if c['type'] in ('p','u','x')}
for ix in p['indexes']:
 assert ix['valid'], 'Invalid source index needs review'
 if ix['name'] not in constraintnames:
  sql.append(re.sub(r'^(CREATE (?:UNIQUE )?INDEX) ',r'\1 IF NOT EXISTS ',ix['definition'])+';')
for t in p['tables']:
 name='public.'+q(t['name'])
 sql.extend([f'ALTER TABLE {name} '+('ENABLE' if t['rls'] else 'DISABLE')+' ROW LEVEL SECURITY;',f'ALTER TABLE {name} '+('FORCE' if t['force_rls'] else 'NO FORCE')+' ROW LEVEL SECURITY;',f'REVOKE ALL ON {name} FROM PUBLIC,anon,authenticated,service_role;'])
 for role,priv in t['acl'].items():
  rights=[k.upper() for k,v in priv.items() if v]
  if rights:sql.append(f'GRANT {",".join(rights)} ON {name} TO {q(role)};')
for pol in p['policies']:
 roles=','.join('PUBLIC' if r=='public' else q(r) for r in pol['roles'])
 stmt=f'CREATE POLICY {q(pol["name"])} ON public.{q(pol["table"])} AS {pol["permissive"]} FOR {pol["command"]} TO {roles}'
 if pol['qual'] is not None:stmt+=' USING ('+pol['qual']+')'
 if pol['with_check'] is not None:stmt+=' WITH CHECK ('+pol['with_check']+')'
 sql.append(stmt+';')
def grants(kind,target,acl,allowed):
 sql.append(f'REVOKE ALL ON {kind} {target} FROM PUBLIC,anon,authenticated,service_role;')
 for entry in acl or ['=X/postgres']:
  role,rights=entry.split('=',1);rights=rights.split('/')[0]
  if role=='postgres':continue
  assert role in ('','anon','authenticated','service_role'), 'Unexpected ACL role needs review'
  for code,right in allowed.items():
   if code in rights:sql.append(f'GRANT {right} ON {kind} {target} TO '+(q(role) if role else 'PUBLIC')+(' WITH GRANT OPTION' if code+'*' in rights else '')+';')
for f in p['functions']:grants('FUNCTION','public.'+f['signature'],f['acl'],{'X':'EXECUTE'})
for s in seq:
 if s['dependency']=='a':sql.append(f'ALTER SEQUENCE public.{q(s["name"])} OWNED BY public.{q(s["owner_table"].removeprefix("public."))}.{q(s["owner_column"])};')
 grants('SEQUENCE','public.'+q(s['name']),s['acl'],{'r':'SELECT','w':'UPDATE','U':'USAGE'})
# Retained obsolete functions are not reachable from customer roles.
prodnames={f['signature'] for f in p['functions']}
for f in b['functions']:
 if f['signature'] not in prodnames:sql.append('REVOKE ALL ON FUNCTION public.'+f['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
for tr in p['triggers']+p['auth_triggers']:
 name=('auth.' if tr in p['auth_triggers'] else 'public.')+q(tr['table'])
 if tr in p['auth_triggers']:sql.append(f'DROP TRIGGER IF EXISTS {q(tr["name"])} ON {name};')
 sql.append(tr['definition']+';')
 if tr.get('enabled','O')!='O':sql.append(f'ALTER TABLE {name} '+{'D':'DISABLE','A':'ENABLE ALWAYS','R':'ENABLE REPLICA'}[tr['enabled']]+' TRIGGER '+q(tr['name'])+';')
# Sequence starts reflect test records, never production counters or data.
sql.append("SELECT setval('public.products_id_seq',GREATEST(coalesce((SELECT max(id) FROM public.products),0)+1,1),false);")
sql.append("DO $$ BEGIN IF (SELECT enabled FROM public.student_pricing_feature_settings WHERE singleton) THEN RAISE EXCEPTION 'Test student pricing must initially remain OFF'; END IF; END $$;")
sql.append('COMMIT;')
(out/'01-production-schema-baseline.sql').write_text('\n\n'.join(sql)+'\n')
files=['supabase-student-reward-snapshots.sql','supabase-instructor-reward-ledger.sql','supabase-instructor-reward-queries.sql','supabase-instructor-reward-checkout.sql','supabase-instructor-reward-withdrawals.sql','supabase-instructor-reward-notifications.sql','supabase-instructor-reward-reconciliation.sql']
manifest={'target':'qqlgqasbmbicnmvnlqbr','production_read_only':'ilvdvlkdpntwmaijncaz','data_copy':'settings only; no customers/orders/financial accounts','preserve_legacy_product':True,'schema_installed':False,'migrations':[{'file':str((out/'01-production-schema-baseline.sql').relative_to(root)),'sha256':hashlib.sha256((out/'01-production-schema-baseline.sql').read_bytes()).hexdigest()}]+[{'file':n,'sha256':hashlib.sha256((root/n).read_bytes()).hexdigest()} for n in files]}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'tables':len(p['tables']),'functions':len(p['functions']),'baseline_bytes':(out/'01-production-schema-baseline.sql').stat().st_size,'stage_files':len(files)}))

from pathlib import Path
import json,re
base=Path('tmp/mongo-reliability'); package=json.loads(Path('package.json').read_text()); catalog=[]
for name,command in package['scripts'].items():
 if not name.startswith('test:'):continue
 files=re.findall(r'scripts/[A-Za-z0-9_-]+\.(?:mjs|js|py)',command)
 catalog.append({'name':name,'command':command,'files':files,'missing':[f for f in files if not Path(f).is_file()]})
Path('docs/reliability/test-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
evidence={}
for folder in ['unit-gates','extended-gates']:
 for row in json.loads((base/folder/'results.json').read_text()):
  evidence['scripts/'+row['name']+'.mjs']={'status':'PASS' if row['passed'] else 'FAIL','layer':'isolated in-memory or controlled-client unit fixture','evidence':[str(base/folder/(row['name']+'.log'))]}
for row in json.loads((base/'mongo-integrity-results.json').read_text()):
 evidence['scripts/'+row['name']+'.mjs']={'status':'PASS' if row['code']==0 else 'FAIL','layer':'disposable real MongoDB fixture','evidence':[str(base/(row['name']+'.log'))]}
named={
 'verify-isolated-browser-workflow.mjs':'browser-full.log',
 'run-isolated-migrations.mjs':'migrations-lts.log',
 'run-isolated-central-inventory.mjs':'central-inventory-lts.log',
 'verify-central-inventory.mjs':'central-inventory-lts.log',
 'run-isolated-unified-orders.mjs':'unified-orders-public-tenant-current.log',
 'verify-unified-orders.mjs':'unified-orders-public-tenant-current.log',
 'verify-central-inventory-files.mjs':'inventory-files-current.log',
 'verify-central-inventory-api.mjs':'central-inventory-api-current.log',
 'verify-po-otb-integrity.mjs':'po-otb-integrity-current.log',
 'verify-order-enquiry-integrity.mjs':'order-enquiry-integrity-current.log',
 'verify-reliability-http.mjs':'http-schema-ready.log',
 'verify-postgres-failure-injection.mjs':'postgres-failure-injection-current.log',
 'verify-mongo-timeout-fixture.mjs':'mongo-timeout-fixture.log',
 'verify-mongo-startup-recovery.mjs':'mongo-startup-recovery.log',
 'verify-purchase-order-reliability.mjs':'purchase-order-reliability.log',
 'verify-inventory-publish-order.mjs':'inventory-publish-order-latest.log',
 'verify-seller-connections.mjs':'seller-connections-public-tenant-current.log',
 'verify-sales-programs.mjs':'sales-programs-current.log',
 'verify-mongo-reliability-api.mjs':'mongo-api-current.log',
 'run-isolated-mongo-reliability.mjs':'mongo-api-current.log',
 'run-reliability-extended-gates.mjs':'extended-gates.log',
}
for script,log in named.items():
 text=(base/log).read_text(errors='replace')
 evidence['scripts/'+script]={'status':'PASS' if 'PASS' in text else 'NOT VERIFIED','layer':'controlled local fixture; never live-provider or deployed evidence','evidence':[str(base/log)]}
for row in catalog:
 command=row['command'];files=row['files']
 # A focused branch is not proved by a different branch of the same script.
 focus=re.search(r'ISOLATED_BROWSER_FOCUS=([\w-]+)',command)
 if focus:
  row['execution']='NOT INDEPENDENTLY VERIFIED'
  row['reason']='Focused browser branch requires its own result; broad workflow suite coverage does not automatically verify this command.'
  if focus.group(1)=='sku-group':row.update(execution='PASS',layer='isolated real databases and signed-in browser',evidence=[str(base/'sku-group-browser.log')])
 elif files and all(f in evidence and evidence[f]['status']=='PASS' for f in files):
  row.update(execution='PASS',layer='controlled local evidence',evidence=sorted({x for f in files for x in evidence[f]['evidence']}))
 else:
  row['execution']='NOT INDEPENDENTLY VERIFIED'
  row['reason']='No exact command result is recorded. Check its fixture, reference-session, authentication and provider prerequisites before execution; overlapping acceptance evidence is not a blanket pass.'
counts={status:sum(r['execution']==status for r in catalog) for status in sorted({r['execution'] for r in catalog})}
Path('docs/reliability/test-execution-status.json').write_text(json.dumps({'date':'2026-10-04','rule':'Only identified exact script runs and their covered wrappers are marked PASS; focused branches need independent evidence. No live provider proof.','counts':counts,'commands':catalog},indent=2)+'\n')
print('Catalog:',len(catalog),'commands;',counts)

from pathlib import Path
import re,json
roots=['api','inventory','src','scripts','reliability']
files={str(p):p.read_text(errors='replace') for root in roots for p in Path(root).rglob('*') if p.suffix in ['.js','.mjs','.ts','.tsx']}
files['server.js']=Path('server.js').read_text()
edges={}
for name,text in files.items():
 refs=[]
 for ref in re.findall(r"(?:from\s*|import\s*\(?\s*)['\"]([^'\"]+)",text):
  if ref.startswith('.'):
   target=Path(name).parent/ref
   import os
   target=os.path.normpath(target)
   choices=[target]+[target+ext for ext in ['.js','.mjs','.ts','.tsx']]
   refs.extend(c for c in choices if c in files)
 edges[name]=sorted(set(refs))
def closure(name,seen=None):
 seen=set() if seen is None else seen
 if name in seen:return seen
 seen.add(name)
 for child in edges.get(name,[]):closure(child,seen)
 return seen
records=[]
for name,text in files.items():
 graph=closure(name)
 mongo='api/mongo.js' in graph and any(re.search(r'\b(find|findOne|insert|update|remove|ensureIndex|saveTaxGroup)\(',files[x]) for x in graph if x!='api/mongo.js')
 pg='inventory/db.js' in graph and any(re.search(r'\b(inventoryPool|transaction)\(',files[x]) for x in graph if x!='inventory/db.js')
 tables=sorted(set(re.findall(r'\bci_[a-z_]+\b', '\n'.join(files[x] for x in graph))))
 collections=sorted(set(re.findall(r"\b(?:find|findOne|insert|update|remove|ensureIndex)\(['\"]([^'\"]+)", '\n'.join(files[x] for x in graph))))
 reads=sorted(set(re.findall(r'\b(find|findOne|readTaxGroupSnapshot|inventoryPool)\s*\(',text)))
 writes=sorted(set(re.findall(r'\b(insert|update|updateIfRevision|remove|removeIfPresent|saveTaxGroup|replaceGenericSnapshot|setCustomerGroupIfCurrent)\s*\(',text)))
 sql_operations=sorted(set(re.findall(r'\b(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b',text)))
 transactions=sorted(set(re.findall(r'\b(transaction|withTransaction|saveTaxGroup|readTaxGroupSnapshot|replaceGenericSnapshot)\s*\(',text)))
 records.append({'source':name,'imports':edges[name],'postgresql':pg,'mongodb':mongo,'tables':tables,'collections':collections,
 'read_operations_visible_in_source':reads,'write_operations_visible_in_source':writes,'sql_operations_visible_in_source':sql_operations,
 'transaction_boundaries_visible_in_source':transactions,'transaction_requirement':'Review the called business boundary; absence of a local transaction call is not proof of atomicity',
 'tenant_boundary':'tenant_id in inventory operations; PostgreSQL auth also protects globally scoped Mongo masters' if pg and mongo else 'tenant_id and authenticated configured tenant' if pg else 'global administrator master scope; client is a record/filter, not an authentication tenant',
 'failure_behavior':'Shared database managers classify transport failure as 503 and query deadlines as 504; route-specific error handling requires runtime verification',
 'evidence':'static transitive source trace and direct source operation footprint; not runtime acceptance'})
result={'scope':'All source modules, handlers, workers and frontend imports; runtime actions still require tests','files':records}
Path('docs/reliability/dependency-map.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'Mapped {len(records)} source files and {sum(len(v) for v in edges.values())} import edges')

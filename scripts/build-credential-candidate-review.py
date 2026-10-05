"""Resolve sanitized scan candidates without emitting credential values or snippets."""
from pathlib import Path
import subprocess, json, re, datetime, hashlib
base=Path('docs/reliability')
scan=json.loads((base/'credential-pattern-evidence.json').read_text())
prior=json.loads((base/'credential-pattern-review.json').read_text())
reviewed=prior.get('reviewed',[])
known={(r['path'],r['line']):r['conclusion'] for r in reviewed}
rules={
 'credential_assignment':re.compile(r'''(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|webhook[_-]?secret|password|access[_-]?token)\s*[=:]\s*["']([^"'\n]{8,})["']''',re.I),
 'authenticated_database_uri':re.compile(r'(?:mongodb(?:\+srv)?|postgres(?:ql)?)://[^\s/]+:[^\s/@]+@',re.I),
 'private_key_marker':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'provider_token_pattern':re.compile(r'\b(?:shpat_|shpca_|ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}'),
}
entries=subprocess.check_output(['git','rev-list','--objects','--all'],text=True).splitlines()
objects={e.split(' ',1)[0]:e.split(' ',1)[1] for e in entries if ' ' in e}
fsck=subprocess.run(['git','fsck','--no-reflogs','--unreachable','--no-progress'],capture_output=True,text=True)
if fsck.returncode: raise RuntimeError('Local object enumeration failed; review not overwritten')
unreachable=re.findall(r'(?:unreachable|dangling) blob ([a-f0-9]{40,64})',fsck.stdout)
cache={};budget=0

def matches(data,f):
 if b'\0' in data: return False
 lines=data.decode('utf8',errors='replace').splitlines()
 return f['line']<=len(lines) and bool(rules[f['pattern']].search(lines[f['line']-1]))

def blob(oid):
 global budget
 if oid not in cache:
  size=int(subprocess.check_output(['git','cat-file','-s',oid],text=True))
  if size>8_000_000 or budget+size>100_000_000: return None
  budget+=size; cache[oid]=subprocess.check_output(['git','cat-file','blob',oid])
 return cache[oid]

rows=[]
for index,f in enumerate(scan['findings'],1):
 refs=[];resolved=False;conclusion=None
 if f['layer']=='worktree':
  path=Path(f['path'])
  if path.is_file() and path.stat().st_size<=8_000_000:
   data=path.read_bytes();resolved=matches(data,f)
   if resolved: refs=[{'kind':'worktree','path':f['path'],'contentSha256':hashlib.sha256(data).hexdigest()}]
  if resolved: conclusion=known.get((f['path'],f['line']))
 else:
  ids=[oid for oid,path in objects.items() if path==f['path']] if f['layer']=='reachable_history' else unreachable
  for oid in ids:
   data=blob(oid)
   if data is not None and matches(data,f): refs.append({'kind':'git_blob','objectId':oid})
  resolved=len(refs)==1
 rows.append({
  'candidateId':f'C{index:03d}', 'file':f['path'],'line':f['line'],
  'credentialClass':f['pattern'],'sourceLayer':f['layer'],
  'currentOrHistorical':'current' if f['layer']=='worktree' else 'historical',
  'reachability':'worktree' if f['layer']=='worktree' else ('reachable' if f['layer']=='reachable_history' else 'unreachable'),
  'sourceReferences':refs,'sourceIdentityResolved':resolved,
  'classification':'NON_SECRET_CONFIGURATION' if conclusion else 'UNKNOWN_REQUIRES_REVIEW',
  'sensitiveValuePresent':'no credential literal in previously reviewed source structure' if conclusion else 'UNKNOWN',
  'consumer':conclusion or 'UNVERIFIED; trace exact source consumer before classification',
  'environment':'UNVERIFIED','providerAssociation':'UNVERIFIED',
  'operationalImportance':'UNVERIFIED','rotationRelevance':'not required for this reviewed label/field-map match' if conclusion else 'UNVERIFIED; no rotation authorized',
  'securityImpact':'label/configuration field-name match only' if conclusion else 'UNKNOWN',
  'contextHint':f['classification'],
 })
# Preserve explicit consumer reviews only while the exact source identity is unchanged.
previous={r['candidateId']:r for r in prior.get('candidates',[]) if r.get('reviewEvidence')}
for row in rows:
 old=previous.get(row['candidateId'])
 if old and row['sourceIdentityResolved'] and old['sourceReferences']==row['sourceReferences'] and old['file']==row['file'] and old['line']==row['line'] and old['credentialClass']==row['credentialClass']:
  for field in ['classification','sensitiveValuePresent','consumer','environment','providerAssociation','operationalImportance','rotationRelevance','securityImpact','reviewEvidence']:
   row[field]=old[field]
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceScanAt':scan['at'],
 'method':'Bounded source identity resolution; no values or source snippets emitted. Context hints never establish authenticity.',
 'reviewed':reviewed,'candidates':rows,
 'summary':{'total':len(rows),'sourceIdentityResolved':sum(r['sourceIdentityResolved'] for r in rows),'classifiedNonSecret':sum(r['classification']=='NON_SECRET_CONFIGURATION' for r in rows),'classifiedTestOnly':sum(r['classification']=='TEST_ONLY' for r in rows),'classifiedExample':sum(r['classification']=='EXAMPLE' for r in rows),'requiresReview':sum(r['classification']=='UNKNOWN_REQUIRES_REVIEW' for r in rows)},
 'limits':'Full consumer, environment, provider, operational and rotation review remains incomplete. Multiple matching blobs are ambiguous. This does not classify fixtures by filename or clear historical counterparts. No history or credentials changed.'}
(base/'credential-pattern-review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result['summary']))

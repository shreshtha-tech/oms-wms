from pathlib import Path
import subprocess,json,re,datetime

# Never emit source snippets or matched credential values. Classification is
# evidence for review, not proof that a literal is genuine or harmless.
rules={
 'credential_assignment':re.compile(r'''(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|webhook[_-]?secret|password|access[_-]?token)\s*[=:]\s*["']([^"'\n]{8,})["']''',re.I),
 'authenticated_database_uri':re.compile(r'(?:mongodb(?:\+srv)?|postgres(?:ql)?)://[^\s/]+:[^\s/@]+@',re.I),
 'private_key_marker':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'provider_token_pattern':re.compile(r'\b(?:shpat_|shpca_|ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}'),
}
findings=[];skips=[];counts={'worktree':0,'reachable_history':0,'unreachable_history':0}
def inspect(data,path,layer):
 if b'\0' in data:skips.append({'path':path,'layer':layer,'reason':'binary format requires content-aware review'});return
 text=data.decode('utf8',errors='replace');counts[layer]+=1
 for number,line in enumerate(text.splitlines(),1):
  for name,pattern in rules.items():
   if pattern.search(line):
    fixture=bool(re.search(r'fixture|example|placeholder|generated|test[_-]|codexqa',line,re.I))
    findings.append({'path':path,'layer':layer,'line':number,'pattern':name,'classification':'FIXTURE_OR_EXAMPLE_CONTEXT_REQUIRES_PROVENANCE' if fixture else 'LITERAL_OR_PATTERN_REQUIRES_REVIEW'})
paths=subprocess.check_output(['rg','--files','--hidden','--no-ignore','-g','!.git/**','-g','!node_modules/**','-g','!**/node_modules/**'],text=True).splitlines()
for name in paths:
 p=Path(name)
 try:
  if p.stat().st_size>8000000:skips.append({'path':name,'layer':'worktree','reason':'bounded per-file byte limit'});continue
  if name=='.env':
   skips.append({'path':name,'layer':'worktree','reason':'expected private configuration; permission metadata only','permissions':oct(p.stat().st_mode & 0o777)});continue
  inspect(p.read_bytes(),name,'worktree')
 except OSError:skips.append({'path':name,'layer':'worktree','reason':'unreadable file'})
entries=subprocess.check_output(['git','rev-list','--objects','--all'],text=True).splitlines()
objects={entry.split(' ',1)[0]:entry.split(' ',1)[1] for entry in entries if ' ' in entry}
fsck=subprocess.run(['git','fsck','--no-reflogs','--unreachable','--no-progress'],capture_output=True,text=True)
unreachable=re.findall(r'(?:unreachable|dangling) blob ([a-f0-9]{40,64})',fsck.stdout)
all_ids=list(objects)+[oid for oid in unreachable if oid not in objects]
metadata=subprocess.run(['git','cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],input='\n'.join(all_ids)+'\n',capture_output=True,text=True,check=True).stdout.splitlines()
budget=0
for row in metadata:
 pieces=row.split()
 if len(pieces)!=3 or pieces[1]!='blob':continue
 oid,_,size=pieces;size=int(size);layer='reachable_history' if oid in objects else 'unreachable_history';path=objects.get(oid,'unreachable blob; pathname unavailable')
 if size>8000000 or budget+size>100000000:skips.append({'path':path,'layer':layer,'reason':'bounded history byte limit'});continue
 budget+=size;inspect(subprocess.check_output(['git','cat-file','blob',oid]),path,layer)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'counts':counts,'findings':findings,'skips':skips,'reachableCommitCount':int(subprocess.check_output(['git','rev-list','--all','--count'],text=True)),'unreachableBlobCandidates':len(unreachable),'fsckCompleted':fsck.returncode==0,'limitations':['Candidate patterns do not establish secret authenticity; fixture/example markers do not prove safety','Binary formats, browser/database storage, remote history not present locally and overwritten/unreachable objects outside this scan remain separate gates','No secret values, source snippets, remote URLs, credential rotation or history mutation']}
Path('docs/reliability/credential-pattern-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'counts':counts,'candidateFindings':len(findings),'unreachableBlobCandidates':len(unreachable),'skipped':len(skips)}))

import os,json,re,zipfile,subprocess,datetime,xml.etree.ElementTree as ET
from pathlib import Path
secrets=[]
for name,value in os.environ.items():
 if re.search(r'PASSWORD|SECRET|TOKEN|PRIVATE_KEY|CREDENTIAL_KEY|API_KEY|ACCESS_KEY|MONGODB_URI|DATABASE_URL',name) and len(value)>=8:secrets.append((name,value))
rules={'credential_query_parameter':re.compile(r'(?:[?&]|&amp;)(?:access_token|client_secret|refresh_token|api_key|password|token)=[^&\s"<>]+',re.I),'authenticated_database_uri':re.compile(r'(?:mongodb(?:\+srv)?|postgres(?:ql)?)://[^\s/<>]+:[^\s/@<>]+@',re.I),'private_key_marker':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),'provider_token_pattern':re.compile(r'\b(?:shpat_|shpca_|ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}')}
paths=subprocess.check_output(['rg','--files','--hidden','--no-ignore','-g','!.git/**','-g','!node_modules/**','-g','!**/node_modules/**'],text=True).splitlines()
reports=[]
for name in paths:
 if Path(name).suffix.lower() not in ['.docx','.xlsx','.zip']:continue
 report={'path':name,'hiddenSheets':0,'formulaCells':0,'externalRelationships':0,'authorMetadataPresent':False,'customXmlParts':0,'embeddedAttachments':0,'findings':[],'textEntriesInspected':0,'skippedEntries':0,'scope':'Bounded archive XML/text only; no extraction to disk, no values emitted'}
 try:
  if Path(name).stat().st_size>32000000:report['status']='SKIPPED_ARCHIVE_SIZE';reports.append(report);continue
  with zipfile.ZipFile(name) as archive:
   entries=archive.infolist()
   if len(entries)>10000 or sum(entry.file_size for entry in entries)>64000000:report['status']='SKIPPED_EXPANSION_BOUND';reports.append(report);continue
   report['customXmlParts']=sum(entry.filename.startswith('customXml/') and not entry.is_dir() for entry in entries)
   report['embeddedAttachments']=sum('/embeddings/' in entry.filename and not entry.is_dir() for entry in entries)
   report['unsafePathEntries']=sum('..' in Path(entry.filename).parts or entry.filename.startswith(('/','\\')) for entry in entries)
   for entry in entries:
    if entry.is_dir():continue
    if entry.file_size>8000000 or entry.flag_bits&1:report['skippedEntries']+=1;continue
    data=archive.read(entry)
    if b'\0' in data:report['skippedEntries']+=1;continue
    text=data.decode('utf8',errors='replace');report['textEntriesInspected']+=1
    texts=[text]
    if entry.filename.endswith('.xml'):
     try:
      root=ET.fromstring(text);texts.append(''.join(root.itertext()))
      for element in root.iter():
       tag=element.tag.split('}')[-1]
       if tag=='sheet' and element.attrib.get('state') in ['hidden','veryHidden']:report['hiddenSheets']+=1
       if tag=='f':report['formulaCells']+=1
       if tag=='Relationship' and element.attrib.get('TargetMode')=='External':report['externalRelationships']+=1
       if entry.filename=='docProps/core.xml' and tag in ['creator','lastModifiedBy'] and (element.text or '').strip():report['authorMetadataPresent']=True
     except ET.ParseError:report['skippedEntries']+=1
    for source,value in secrets:
     if any(value in candidate for candidate in texts):report['findings'].append({'entry':entry.filename,'kind':'CONFIGURED_VALUE_MATCH','source':source})
    for kind,pattern in rules.items():
     if any(pattern.search(candidate) for candidate in texts):report['findings'].append({'entry':entry.filename,'kind':kind,'classification':'PROVENANCE_REVIEW_REQUIRED'})
   report['status']='BOUNDED_TEXT_SCAN_COMPLETE'
 except (OSError,zipfile.BadZipFile,RuntimeError):report['status']='UNREADABLE_OR_INVALID_ARCHIVE'
 reports.append(report)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'productionReady':False,'archives':reports,'limitations':['No general PII/user metadata clearance; author/comment/hidden-sheet classification remains incomplete','PDF/image/crash formats and binary/encrypted embedded attachments require separate inspection','Patterns and exact values do not establish authenticity or secret absence beyond inspected text']}
Path('docs/reliability/archive-credential-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'archives':len(reports),'textEntriesInspected':sum(r['textEntriesInspected'] for r in reports),'findings':sum(len(r['findings']) for r in reports),'incompleteArchives':sum(r['status']!='BOUNDED_TEXT_SCAN_COMPLETE' or r['skippedEntries']>0 for r in reports)}))

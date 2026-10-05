# Phase A evidence and review gate

Date: 2026-10-05. Phase A only: design, no product code changes. The attachment `pasted-text-1.txt` defines phases A–J and explicitly requires a review stop before the next phase. This report ends at that stop.

## Evidence scope and result

Static audit: 250 source files; 747 literal Mongo call sites; 473 SQL reference occurrences; 66 Mongo names (including registry-only names), 45 PG tables with migration definitions, 75 literal module/entity partitions, 42 primary domain groups, 58 proposed events, 36 payload schemas and 16 SLO rows. Call-site and schema coverage is not executed business-workflow coverage. Dynamic modules/SQL/custom helper writes are explicitly flagged D12 instead of silently inferred. No database was contacted and no provider request was sent.

| Item | Reproducible command or measurement | Result | Status |
| --- | --- | --- | --- |
| Objective read | `cat /Users/shreshthagupta/.codex/attachments/f482df9e-3341-4621-b8b3-2e8727250621/pasted-text-1.txt` | Phase A-only authorization and phase gates read before work. | PASS |
| Source extraction | `python3 /tmp/phase-a-source-audit.py` (read-only source extraction algorithm below) | 250 sources, 66 Mongo names, 45 PG tables, 747 literal Mongo calls, 473 SQL references. Writes documentation evidence only; no app imports. | PASS static |
| Real transport inventory | `rg -n 'ci_outbox|ci_sync_cursor|recordIncomingOrder|recordReturn|applyInventoryEvent|withTransaction|startSession|watch\(' api inventory scripts/inventory-*.mjs scripts/flipkart-probe-orders.mjs -g '*.js' -g '*.mjs'` plus scoped source reads recorded in ADR-002 | Identified direct ingress/ledger transactions, sequential receipt bridge, polls, publish/notification queues, held exports, absent generic Mongo outbox. | PASS static identification; runtime NOT RUN |
| Change-stream/resume implementation lookup | `rg -n 'watch\(|resumeToken|resumeAfter|startAfter' api inventory scripts/inventory-*.mjs` | No matches (exit 1) in these application/worker sources. This does not establish Atlas-tier support. | PASS static absence in stated scope |
| Event schema meta-validation | Offline `Draft202012Validator.check_schema` using installed Python `jsonschema=4.23.0`; full reproducible check below | Schema valid; one discriminated branch for each of 58 unique versioned events. | PASS design schema |
| Event examples and rejection checks | `python3 /tmp/phase-a-verify.py` (full equivalent below) | 58 synthetic positive examples; at least 290 negatives reject unknown event/version/properties and missing required fields; extra reservation-action and missing-revision/stock-eligibility cases reject. | PASS offline design examples |
| Artifact coverage and source integrity | Same verifier | 42 entities, 66 collections, 45 table definitions, valid source paths/line ranges, 250 hashes unchanged; all matrix decisions point to ADR-001; 16 SLO rows. | PASS static |
| Native test-stack executable presence | `command -v mongod`, `command -v postgres`, `command -v initdb`, `command -v docker` | First three resolve under `/opt/homebrew/bin`; Docker not found (exit 1). Stack construction/election/isolation still unverified. | PASS native binary presence; Docker NOT FOUND |
| Product source preservation | Hash comparison against `/tmp/phase-a-source-baseline.json` for 250 audited files | No audited product/worker/migration/UI/Blueprint file changed by this phase. | PASS static; not a whole-worktree clean claim |
| Documentation whitespace/patch review | `git diff --no-index --check /dev/null <each docs/architecture artifact except PHASE_A.diff>`; complete additions diff generated from empty files | No trailing-whitespace/error findings; additions only. | PASS |
| Owner approval of D01–D12 / SLOs | Owner review of ADRs and matrix | Pending explicit decisions; proposed target ownership is not accepted authority. | NOT RUN / pending owner |
| Mongo/PG runtime contracts, latency and concurrency | No command run in Phase A | Design-only phase; stack not created/started. Existing wrapper uses a non-`_test` name and inherits environment, so it is not permitted unchanged. | NOT RUN |
| Typecheck/build/unit/integration/browser/provider/chaos/load/restore | No command run in this phase | No product code changed; phase A is design only. Earlier-turn passes are not counted as Phase A propagation proof. Later phases require the new compliant disposable stack and scope-specific tests. | NOT RUN |
| Atlas tier capability / actual configured data / Render | No Atlas/configured DB connection, dashboard operation, deployment or live probe | Explicit prohibition; owner describes free shared tier/backups off, but actual configuration was not independently verified. | NOT RUN |

Early schema checks found a draft discriminator mistakenly adding a platform property to a stock-observation payload. The design was corrected and the full 58-event validation rerun successfully. Those intermediate failing authoring checks are not runtime findings and are not counted as passing evidence. An optional lookup for `db/schema.js` found no such file; the current migration sources are the actual `db/migrations/*.sql`. No historical schema path is used as evidence.

## Exit criteria

| Phase A requirement | Artifact / evidence | Exit result |
| --- | --- | --- |
| Every requested entity has ownership, writers, readers/cache and dual-writer/no-owner flag | `ownership-matrix.csv`; per-store/per-module inventory; verified source paths | MET as a source-based design inventory; unresolved choices attached to D01–D12 |
| Cross-boundary event contract covers Mongo→PG, ledger publishing, provider/report intake→Unified Orders→reservations→team alerts | ADR-002 + 58-event JSON/Markdown catalog + payload schemas | MET as proposed versioned design; implemented guarantees explicitly separate |
| Measurable p50/p95/p99 flow SLO, maximum stock-publish lag, alert timing, RPO/RTO | ADR-003 + 16 rows and reliability budgets | MET as proposals with clocks/workload/measurement method; values NOT MEASURED and owner confirmation pending |
| Written ADRs under docs/architecture, ownership matrix and event catalog | Artifact file/coverage checks | MET |
| No ambiguity silently resolved | D01–D12 each have named sources, recommended choice, consequence while pending | MET for explicit decision recording; owner approval gate NOT MET |
| Artifacts, reproducible evidence, diff, files-touched list, risk/decision report and stop | This report + README + PHASE_A.diff | MET; Phase B has NOT begun |

Design deliverables are ready for review. Approval is pending, so this is not a claim that the entire A–J programme or operational Phase A decisions are complete.

## Residual risks ranked

| Severity | Finding / exact boundary | Proposed action / decision |
| --- | --- | --- |
| CRITICAL | Mongo GRN staging → PG receipt → Mongo finalize is sequential (`api/inbound-create-edit.js:234-262`, `api/inbound-realtime.js:219-248`, `inventory/wms-operations.js:172`); no durable Mongo origin outbox/consumer receipt. A process failure can leave projection/physical fact split. | D08 atomic local outboxes + consumer receipts + immutable receipt authorization, exact replay/reconciliation; Phase B fault tests. |
| HIGH | Independent SKU/channel/location identities across `skus/channels/sku_channel_links/generic_records[location]` and `ci_master_sku/ci_channel_account/ci_channel_mapping/ci_location`; writer routes do not share a projection contract. | D01–D04 explicit mapped ownership; block unmapped operational effects. |
| HIGH | Incomplete WMS ownership: legacy fulfilment/picklist/shipment mutations return 501, STO in-transit not connected, PG has no bin/lot/serial stock placement; metadata kitting completion remains possible (`api/kitting-orders.js:13`). | D06 define PG lifecycle and projection policy; metadata is not physical evidence. |
| HIGH | Current team and legacy alert paths have different dedupe; `inventory/order-alert-routing.js:41` can queue two purposes; initial `packing_ready` can precede stock reservation. | D07 one initial alert per order/recipient; reserve before packing authorization. |
| HIGH | Remote send and DB acknowledgement are not atomic. `inventory/whatsapp.js:157` classifies dispatched-but-unknown as uncertain; manual requeue can duplicate (`inventory/alert-admin.js:108`). | Preserve uncertainty review; no automatic resend/exactly-once claim; owner policy D07. |
| HIGH | `inventory/connections.js:216` partner report overwrites observation using receipt `now()`, unlike `inventory/partner-file.js` fail-closed source-order gate and `inventory/stock-observations.js` monotonic guard. | D10 require approved provider ordering and quarantine equal-time conflicts; do not use uploaded stale data as latest truth. |
| HIGH | Shopify recovery poll updates Unified Orders but no stock task (`inventory/shopify-orders.js:25`); missing webhook can leave reservation state unrepaired. Flipkart/offline complete intake is absent; Amazon partial quantity semantics are review-required. | D09 provider/recovery semantics; no invented adapter; prove replay of missed create/cancel under B. |
| HIGH | Outbox task IDs/claim order are not per-aggregate sequence; generic consumer dedupe/versioned schemas absent. Stock-task backoff is deterministic (`inventory/workers.js:270`). SQS failure aborts batch (`inventory/sqs-worker.js:8-11`). | D10 ordered domain envelope, consumer receipt, jitter, poison isolation and recovery tests. |
| HIGH | Existing local Mongo wrapper uses `codexqa_reliability` and inherits `process.env` (`scripts/run-isolated-mongo-reliability.mjs`), violating the new `_test`/configured-store isolation contract. | Replace/audit harness before any Phase B execution; no configured/Atlas fallback. |
| HIGH | Backup/host-loss RPO/RTO and production durability are not established. Owner-supplied Atlas tier/backups statement is unverified. | D11 approve requirements; Phase I documentation and local restore drill; never contact Atlas under this instruction. |
| MODERATE | PG NOTIFY/SSE is lossy and coalesced; UI can use 60-second fallback (`src/hooks/useInventoryLiveUpdates.tsx`, `inventory/unified-orders.js:137`). No measured event-to-DOM revision tracking exists. | D10/D11 instrument authoritative revision visibility; separate healthy vs degraded SLOs. |
| MODERATE | Dynamic generic modules/unowned registry collections (`api/generic.js`, `api/mongo-collections.js`) can be mistaken for an implemented business owner. | D12 dedicated-domain allowlist and explicit owner assignment; storage appendix lists all names/partitions. |

## Every repository file touched

All are newly added documentation/design artifacts; no existing source file was edited in Phase A.

| File under docs/architecture/ | Why |
| --- | --- |
| `README.md` | Phase A index, assumptions, review gate and artifact links. |
| `ADR-001-systems-of-record.md` | Ownership decisions, permitted write boundaries and safe later stack prerequisite. |
| `ownership-matrix.csv` | Machine-readable ownership/writer/reader/permission/ambiguity matrix. |
| `storage-inventory.md` | Complete named-store and generic-module appendix with real call sites. |
| `ADR-002-event-contracts.md` | Current vs proposed transactional/ordering/retry/replay contracts. |
| `event-catalog.json` | Machine-readable 58-event contracts, producer/consumer/schema/idempotency policies. |
| `event-catalog.md` | Human-readable event catalog. |
| `event-schemas.json` | Proposed envelope/payload schemas; no runtime code wiring. |
| `ADR-003-SLOs-and-recovery.md` | Measurable SLO/RPO/RTO/retention proposals with reasoning. |
| `source-evidence.json` | Reproducible source-call evidence and 250 source hashes. |
| `PHASE_A_EVIDENCE.md` | This evidence, exit, risk, decisions, files and reproduction report. |
| `PHASE_A.diff` | Complete additions diff for the other 11 files, avoiding self-recursion. |

Temporary work files only: `/tmp/phase-a-source-audit.py`, `/tmp/phase-a-docs.py`, `/tmp/phase-a-events.py`, `/tmp/phase-a-verify.py`, `/tmp/phase-a-source-baseline.json`. They generate/inspect documents without database access; they are not product code or committed artifacts. No real `.env`, Render dashboard, DB, commit, push or deploy was touched.

## Decisions needed and phase stop

Review the specific D01–D12 table in ADR-001 (recommended ownership, identity, missing WMS, alert purpose/dedupe, atomic receipt bridge, provider permissions/revisions, event policy, SLOs and unowned modules). SLO approval includes the 60s confirmed publish limit, notification traffic envelope, 60s acceptance/120s delivery targets and loss/RPO/RTO/retention figures. They are proposals, not approved budgets or provider guarantees.

STOP for Phase A review as requested. Do not implement/start Phase B until the owner says `next`; unresolved dependent decisions remain gating even then. Do not claim system readiness, data restoration, end-to-end synchronization or production real-time behavior from this documentation pass.

## Reproduce the offline artifact check

The following check reads only repo source/design files, uses synthetic schema instances, and never imports application code or loads environment configuration. Requires Python with the locally used `jsonschema` package (4.23.0). If unavailable, record schema validation NOT RUN rather than installing or connecting anywhere implicitly. Run from the repo root:

```sh
python3 - <<'PY'
from pathlib import Path
import json,csv,re,hashlib,copy
from jsonschema import Draft202012Validator, FormatChecker
out=Path('docs/architecture'); schema=json.loads((out/'event-schemas.json').read_text()); catalog=json.loads((out/'event-catalog.json').read_text()); evidence=json.loads((out/'source-evidence.json').read_text())
Draft202012Validator.check_schema(schema);validator=Draft202012Validator(schema,format_checker=FormatChecker())
UUID='00000000-0000-4000-8000-000000000001';DATE='2026-10-05T00:00:00Z'
def sample(node):
 if '$ref' in node:return sample(schema['$defs'][node['$ref'].split('/')[-1]])
 if 'const' in node:return node['const']
 if 'enum' in node:return node['enum'][0]
 if 'anyOf' in node:return sample(node['anyOf'][0])
 if 'allOf' in node and 'type' not in node:
  result=sample(node['allOf'][0])
  for rule in node['allOf'][1:]:
   for key,v in rule.get('properties',{}).items():result[key]=sample(v)
  return result
 t=node.get('type')
 if t=='object':return {k:sample(v) for k,v in node.get('properties',{}).items() if k in node.get('required',[])}
 if t=='array':return [sample(node['items']) for _ in range(node.get('minItems',0))]
 if t=='boolean':return False
 if t=='integer':return max(1,node.get('minimum',0))
 if node.get('format')=='uuid':return UUID
 if node.get('format')=='date-time':return DATE
 if node.get('pattern')=='^[a-f0-9]{64}$':return '0'*64
 return 'fixture'
assert len(catalog['events'])==len(schema['oneOf'])==58
assert len({e['name'] for e in catalog['events']})==58
for e,branch in zip(catalog['events'],schema['oneOf']):
 assert e['name'].endswith('.v1') and e['schema_version']==1
 assert branch['properties']['event_type']['const']==e['name']
 assert e['payload_schema'].split('/')[-1] in schema['$defs']
 event=sample(schema['allOf'][0]);event['event_type']=e['name'];event['aggregate']['type']=e['aggregate'];event['payload']=sample(branch['properties']['payload']);assert validator.is_valid(event),e['name']
 for altered in [dict(event,unexpected='rejected'),dict(event,schema_version=2),dict(event,event_type='unknown.v1')]:assert not validator.is_valid(altered)
 bad=copy.deepcopy(event);bad['payload']['unexpected']='rejected';assert not validator.is_valid(bad)
 if event['payload']:
  bad=copy.deepcopy(event);bad['payload'].pop(next(iter(event['payload'])));assert not validator.is_valid(bad)
 if e['name']=='order.reservation.created.v1':
  bad=copy.deepcopy(event);bad['payload']['action']='consume';assert not validator.is_valid(bad)
 if e['payload_schema'].endswith('/order'):
  bad=copy.deepcopy(event);bad['payload']['provider_revision']=None;bad['payload']['stock_eligible']=True;assert not validator.is_valid(bad)
# Verify named storage/primary domain coverage without importing the application.
rows=list(csv.DictReader((out/'ownership-matrix.csv').open()));assert len(rows)==42
required=['SKU','Vendor','Customer','Transporter','Channel','Location','Bin','Price','Tax','Purchase order','ASN','GRN','Sale order','Fulfilment','Picklist','Shipment','return','Stock transfer','On-hand','Reservation','alert']
for word in required:assert any(word.lower() in r['entity'].lower() for r in rows),word
for r in rows:
 assert all(r.values())
 assert re.fullmatch(r'D\d\d(?:,D\d\d)*',r['decision'])
 for d in r['decision'].split(','):assert d in (out/'ADR-001-systems-of-record.md').read_text()
storage=(out/'storage-inventory.md').read_text()
for name in [*evidence['mongo'],*evidence['postgres']]:assert f'| {name} |' in storage
assert all(v['definitions'] for v in evidence['postgres'].values())
assert len(evidence['generic_module_partitions'])==75
for module in evidence['generic_module_partitions']:assert f'| {module} |' in storage
for source in evidence['sources']:
 p=Path(source['file']);assert p.exists();assert hashlib.sha256(p.read_bytes()).hexdigest()==source['sha256'],source['file']
for store in ['mongo','postgres']:
 for _,entry in evidence[store].items():
  for field in ['literal_calls','references','definitions']:
   for r in entry.get(field,[]):assert 1<=r['line']<=len(Path(r['file']).read_text().splitlines()),r
for doc in out.glob('*.md'):
 s=doc.read_text()
 for p in re.findall(r'\b(?:api|inventory|reliability|src|scripts|db)/[A-Za-z0-9_/-]+\.(?:mjs|tsx|js|ts|sql)\b',s):assert (not Path(p).exists()) if p=='db/schema.js' else Path(p).exists(),(str(doc),p)
for e in catalog['events']:
 for field in ['producers','consumers']:
  for label in e[field]:
   for p in re.findall(r'\b(?:api|inventory|src|scripts)/[A-Za-z0-9_/-]+\.(?:mjs|tsx|js|ts)\b',label):assert Path(p).exists(),p
 for r in e['routes']:
  # Exact route strings may be split between mount and sub-router.
  pieces=r.split('/');assert r.startswith('/api/') and all(pieces[1:])
assert len(re.findall(r'^\| S\d\d ',(out/'ADR-003-SLOs-and-recovery.md').read_text(),re.M))==16
print(json.dumps({'result':'PASS','source_hashes_checked':len(evidence['sources']),'entity_groups':len(rows),'mongo_names':len(evidence['mongo']),'postgres_tables':len(evidence['postgres']),'generic_module_partitions':len(evidence['generic_module_partitions']),'events':len(catalog['events']),'payload_schemas':len(schema['$defs']),'positive_event_examples':58,'negative_examples_minimum':58*5,'SLO_rows':16,'database_connections':0}))
PY
```

Source extraction method (reproducible, not a live DB inventory): the 250 source paths are explicitly enumerated in `source-evidence.json.sources`. Recompute SHA-256/line counts from those paths. Parse the JSON literal `mongoModules` object in `api/mongo-collections.js` without importing it, retain registry-only names, then extract literal calls using `\b(find|findOne|insert|update|updateWhere|remove|removeIfPresent|ensureIndex)\s*\(\s*[quote]([a-z_][a-z0-9_]*)[quote]` and `.collection([quote]name[quote]).operation` (normalize products to skus). Extract migration definitions with `CREATE TABLE IF NOT EXISTS (ci_\w+)` and SQL references with `\b(INSERT INTO|UPDATE|DELETE FROM|FROM|JOIN)\s+(ci_\w+)`. Record matching file/line/operation; never copy source statements or runtime payloads. Generic partitions derive from literal `module: [quote]value[quote]` or MODULE/M constants used in module properties. Counts are lexical occurrences, not active permission/branch coverage. The offline verifier above checks all recorded paths/hashes/line ranges and the document coverage.

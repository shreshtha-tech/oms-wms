# Procurement replication evidence

## 1. Modules replicated

| Module | Route | Evidence-backed coverage |
|---|---|---|
| Category Buyers | `/app/procurement/category-buyers` | enquiry grid/filtering, advanced filters, add/edit modal, generated buyer code, active state, category multi-select, UDF 1-5 |
| PO Enquiry | `/app/procurement/po-enquiry` | generated-admin isolated browser/API check for persisted Confirm → Release → ReOpen, exact status search, reset/page sizes, anonymous read/write rejection, and unchanged Central Inventory events; LIVE parity remains unverified |
| PO Revision | `/app/purchase-orders` | generated-admin isolated browser/API check for revision persistence/readback, paged search response, advanced filters, vendor picker, reset, and handled API error state; LIVE parity remains unverified |
| Single Location PO | `/app/procurement/po/single` | PO header, vendor picker, SKU picker, UDF, terms, comments, save and confirm |
| Multiple Location PO | `/app/procurement/po/multiple` | Cross dock/Drop Ship method, two-step Manage Allocation, even/custom allocation, SKU selection, totals, save and confirm |
| PO from Back Orders | `/app/procurement/po/back-orders` | eligible confirmed/ready-to-ship order source list, selection gate, Create PO navigation |
| ASN | `/app/grn` | enquiry filters, statuses, add ASN, PO linkage, received-quantity persistence |
| Vendor Invoice | `/app/procurement/vendor-invoices` | enquiry and filters, new editor, required invoice fields, save/confirm persistence, GRN grid surface |
| OTB | `/app/procurement/otb` | enquiry, export, create editor, merchandising hierarchy picker, totals, save/confirm persistence |
| ARS | `/app/procurement/ars/sku-location`, `/rules`, `/logs`, `/settings` | Dedicated SKU-location, rule, execution, PO-generation and B2B/ROS-settings workflows; see `ARS_REPLICATION_EVIDENCE.md` |

The existing Master SKU implementation and its data relationships were not removed or rewritten. PO SKU selection reads the shared `/api/skus` dataset, including `master_sku_code` on each SKU.

## 2. Recorded workflows traced

| Recording | Observed sequence | Implemented result |
|---|---|---|
| `video1.webm` | Category Buyers enquiry → Add New → Create/Edit fields → User Defined Fields → Save/Close | dedicated Category Buyers screen and modal flow |
| `video2.webm` | Procurement menu → Multiple Location → vendor picker → required receiving validation → Manage Allocation → choose locations → Next | exact dedicated route, picker, required code, two-stage allocation modal |
| `video3.webm` | allocation method/ratio → Save → Add SKU → choose SKU → Add SKU → line populated | allocation persistence, SKU picker, shared SKU data, calculated row and total |
| `video4.webm` | alternate vendor/allocation pass → SKU list search/selection | reusable vendor/location/SKU selection paths |
| `video5.webm` | populated PO → Save/Confirm → status and PO details update | persisted Pending Confirmation record followed by guarded Confirmed transition |
| `video6.webm` | Procurement menu → Vendor Invoice Enquiry → Search/Reset/Export → Add New → blank Manage Vendor Invoice → return | enquiry actions and editor navigation/persistence |
| `video7.webm` | Procurement menu → OTB Enquiry → status dropdown/search/reset/download/detail export | OTB enquiry, filters/status rendering and export |
| `video8.webm` | OTB Add New → dates/description/location/vendor → Operand Type Category → hierarchy picker | OTB editor and hierarchy modal |
| `video9.webm` | pick `media` → enter 10000 → Add → Save → Confirm → totals/status update | budget row calculation and Pending → Confirmed persistence |

## 3. Documentation-to-video discrepancy matrix

| Area | Guide | Recording | Resolution |
|---|---|---|---|
| Recording count | request text repeatedly says three | nine files were supplied | all nine recordings treated as authoritative |
| Multi-location terminology | “Cross Dock/Dropship” and “Multi-Location” | page pill says “Multiple Location”; PO Method values show “Cross dock” and “Drop Ship” | recorded labels used in UI; guide semantics retained |
| Category Buyer tabs | guide describes Create/Edit and UDF | video explicitly demonstrates both tabs | video layout/order used |
| PO allocation | guide describes even distribution/custom ratio | video shows two-stage `Manage Allocation` modal before Add SKU | recorded modal order is enforced |
| Vendor Invoice completion | guide documents full create/confirm workflow | recording only opens a blank editor and returns | guide-backed save/confirm is implemented; not labeled as video-observed persistence |
| PO import format | guide text says XLSX in one place and downloadable CSV template in another | recordings do not show import | CSV-compatible documented interpretation retained as an unverified UI gap |
| ASN/ARS | guide documents them | none of the nine recordings demonstrates these flows | guide-backed dedicated ARS screens implemented; no claim of recording-level visual match |
| Historical dates/data | guide/videos use 2018-2019 examples | current replica runtime is 2026 | historical examples seed enquiry grids; new records use current system date |

## 4. APIs, database, and data mappings

| Endpoint | Collection/source | Relationship |
|---|---|---|
| `GET/POST/PUT /api/procurement?entity=buyers` | `procurement_buyers` | active buyer/category mapping feeds PO buyer authorization vocabulary |
| `GET/POST/PUT /api/procurement?entity=invoices` | `vendor_invoices` | vendor code/name plus GRN-code array |
| `GET/POST/PUT /api/procurement?entity=otb` | `otb_budgets` | operand hierarchy, budget, consumed, calculated open-to-buy |
| `GET/POST/PUT /api/purchase-orders` | `purchase_orders` | vendor, buyer, delivery locations, allocation, SKU lines, UDF, terms/comments/tags and lifecycle |
| `GET /api/vendors` | `vendors` | vendor picker and active/confirmed sourcing |
| `GET /api/skus` | `skus` | PO lines share SKU and Master SKU data rather than duplicating product records |
| existing `/api/grn` | `grn` and `purchase_orders` | ASN receipt updates inbound data and linked PO state |

MongoDB is used when configured. The repository's existing in-memory fallback uses the same collection contract and seeded evidence rows.

## 5. Validations and business rules

- Buyer Name is mandatory and unique case-insensitively; Email format is checked; buyer codes are generated.
- Multi-location Add SKU is disabled until at least one allocation location is chosen.
- PO requires vendor, buyer, receiving validation, expected date, positive quantity and non-negative amount.
- PO reference number rejects unsupported special characters.
- PO lifecycle guards: Pending Confirmation → Confirmed → Released; Released → ReOpen → ReConfirmed; only Released can Cancel; only released/received states can Close.
- Vendor Invoice requires vendor, vendor invoice number, invoice/posting dates, and a non-negative amount.
- OTB requires description, location, both dates, operand type/value and positive budget; End Date cannot precede Start Date.
- OTB Open To Buy is persisted as Total Budget minus Consumed.

## 6. Permissions and roles

All procurement routes use the existing authenticated `ProtectedRoute`. The supplied evidence shows one store-admin-style user and states that OTB/category operations are right-based, but it does not expose a role/permission matrix. No unsupported role names or permission grants were invented. Fine-grained per-action authorization remains an evidence gap.

## 7. Tests executed

- `npm run typecheck`: pass.
- `npm run build`: pass; Vite reports the existing Node 20.14 versus recommended 20.19+ warning and bundle-size warning.
- Targeted ESLint on `ProcurementWorkflows.tsx`: pass.
- Repository-wide `npm run lint`: fails on 274 pre-existing errors and four warnings across legacy files; this is tracked separately from the clean targeted procurement lint.
- API GET checks: buyers, invoices, OTB and purchase orders returned 200 with seeded rows.
- Negative API checks: blank buyer returned 400; reversed OTB dates returned 400; release-before-confirm returned 409.
- Positive API lifecycle: multi-location PO with SKU and two allocations returned 201, then Confirm returned 200 and preserved line/allocation data.
- `npm run test:po-enquiry`: passed with a generated administrator and disposable MongoDB/PostgreSQL databases. The server-owned PO status began at Pending Confirmation, then Confirm/Release/ReOpen persisted; exact `ReOpen` enquiry returned the row and Confirmed did not. Anonymous read/create returned 401 without insertion. Central Inventory events were unchanged.
- `npm run test:po-revision`: passed with a generated administrator and disposable MongoDB/PostgreSQL databases. Revision number/reason persisted in MongoDB; API paging and response shape, UI search/filters, vendor picker, reset and handled API error state passed.
- The former `scripts/verify-procurement-browser.py` route/modal smoke test has been retired. It set a legacy `localStorage.vin_user` value that AuthContext does not accept and checked only visible text. It did not establish signed-in access, handler behavior, or persistence for Category Buyers, PO Enquiry, Multiple Location, Vendor Invoice, OTB, Back Orders, or ASN. Those old claims are not authentication or workflow evidence; use each module's independent checks and reference material only for the behavior they actually cover.

## 8. Remaining mismatches and uncertainties

- The generated PO checks are local tests, not authenticated LIVE comparisons. Configured-tenant MongoDB reachability and role parity are still unverified.
- No supplied recording demonstrates ASN, PO import, Vendor Invoice persistence/import, ARS execution, audit history, print layouts, or permission-denied states; these cannot be claimed as recording-verified.
- The guide mentions PO Tags and bulk imports up to 2,000 rows. The stored PO model supports tags and import-shaped line data, but the dedicated recorded editor does not yet expose a complete upload/error-log UI.
- Vendor Invoice shows Add/Remove GRN controls and the grid surface; interactive GRN selection is not complete.
- OTB Release/Cancel/Expired behaviors are represented in status vocabulary and API transition support is partial; only the recorded Pending → Confirmed workflow was browser-verified.
- Responsive behavior was inspected at 2560×1440 and a sub-1000px collapse was added, but an exhaustive device matrix was not available in the evidence.
- Pixel-level typography can vary because the original application's exact font files and icon assets were not supplied.

## 9. Files changed

- `src/eretail/procurement/ProcurementWorkflows.tsx`: dedicated procurement workflows.
- `src/App.tsx`: dedicated protected routes.
- `src/eretail/menuData.ts`: procurement navigation wiring and Vendor Invoice/OTB entries.
- `api/procurement.js`: buyers, invoice and OTB persistence/validation.
- `api/purchase-orders.js`: PO lines, allocations, metadata and guarded lifecycle transitions.
- `api/seed.js`: evidence-aligned procurement seed records.
- `server.js`: procurement API registration.
- `src/index.css`: responsive procurement grid behavior.
- `scripts/verify-po-enquiry.mjs` and `scripts/verify-po-revision.mjs`: generated-admin isolated workflow checks.
- `scripts/verify-procurement-browser.py`: retired fail-closed shim documenting why the former localStorage-based smoke test was invalid.
- `docs/PROCUREMENT_REPLICATION_EVIDENCE.md`: this traceability and completion record.

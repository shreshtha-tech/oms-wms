# Vin eRetail Master Data replica evidence

## Sources reviewed

- `VENDOR MASTER _ Vinculum Knowledge Central.pdf`: supplied Vendor Master guide.
- `Screen Recording 2026-08-14 at 11.35.10 AM.mov` (196.953 s, 2560 × 1664): Vendor Enquiry, Create/Edit and the seven recorded tabs.
- `pdf2.pdf`: all 43 pages, titled **Vin eRetail : Master Data Setup**.
- `k1.webm` (18.765 s, 216 frames): Vendor Enquiry search and results.
- `k2.webm` (21.452 s, 244 frames): Vendor Add New and all observed tabs.
- `k3.webm` (22.285 s, 282 frames): Transporter Enquiry and Add New.
- `k4.webm` (20.390 s, 236 frames): Customer Enquiry search and results.
- `k5.webm` (26.823 s, 343 frames): Customer Add New, parent picker and all tabs.

The request says “three videos”, but five videos were supplied. All five were treated as authoritative.

## Inventory and workflow trace

| Module | Enquiry evidence | Create/Edit evidence | Persistence and dependencies |
|---|---|---|---|
| Vendor | Manual Search, Reset, Download and Add New; Vendor Code, Vendor Name, Vendor Type, Credit Days, Country, State, City and Status; 20-row result contract; Confirmed, Pending Confirmation and Deactivated | Full-page second open screen; Vendor Master, Address, User Defined Fields, Attached Document, Terms and Conditions, Seller Details and Other Details; Save, Confirm, Deactivate and Audit | `/api/vendors`; unique and immutable code; new records start Pending Confirmation; rename cascades to POs and GRNs; delete is blocked |
| Transporter | Manual Search, Reset, Download and Add New; eight recorded filters/columns | Full-page second open screen; Detail Transporter and User Defined Field; Save, Reset and Audit | `/api/transporters`; unique code/name; rename cascades to fulfillment orders and shipments; delete is blocked |
| Customer | Manual Search, Reset, Download and Add New; eight recorded columns; page 1 of 10 and 181-result contract | Full-page second open screen; Customer Details, Addresses, Other Shipping Addresses and User Defined Fields; Parent Customer picker with 50-row page size | `/api/customers`; generated immutable code; duplicate email/phone/GST checks; rename cascades to sales orders and returns; delete is blocked |

Authentication, session protection, Store Admin role display, global navigation, open-screen strip, location selector, download queue, refresh, notifications and authorization gates remain provided by the existing application shell and protected routes.

## Documentation-only module inventory

These pages are described by the guide but are not exercised by `k1`–`k5`. They were inventoried and mapped to the existing application; they are not counted as video-verified workflows.

| Guide area | Documented pages and behavior | Existing route/data surface | Verification classification |
|---|---|---|---|
| SKU Management | SKU Create/Edit tabs: SKU Details, User Defined Field, Other Detail, Case Pack and ARS Detail; SKU Enquiry; SKU Import (maximum 500); SKU Classification; SKU Barcode; Manage Attribute | `/app/skus`, `/app/sku-barcode`, generic classification/attribute routes; `/api/skus`, `/api/skubarcode`, `/api/generic` | Present, documentation-only; not frame-verified by supplied videos |
| Promotion Management | Promotion enquiry/create, qualifying and benefit conditions, date/status handling | Generic promotion schema through `/api/generic` | Present, documentation-only; generic behavior is not claimed as exact |
| Vendor Promotion | Vendor-linked promotion setup and status management | `vendor-promotions` schema through `/api/generic` | Present, documentation-only; generic behavior is not claimed as exact |
| Other Masters | Currency master and other shared lookup masters | Generic master schemas through `/api/generic` | Present, documentation-only; exact option lists/messages not demonstrated |
| Pricing Events | Event enquiry and price-event setup used by SKU/channel pricing | `pricing-event` schema through `/api/generic` | Present, documentation-only; exact workflow not demonstrated |
| Tally configuration | Accounting integration configuration | Dedicated `/app/tally-configuration` and `/api/tally-config` | Sales, purchase and alias configuration are now recording-verified; external Tally exchange is not demonstrated by the sources |

The guide does not expose request/response payloads, database keys, complete role matrices, responsive breakpoints, or negative-response text for these document-only pages. Those details cannot be called source-exact without additional recordings or live read-only inspection.

## Documentation-to-video discrepancy matrix

| Area | Documentation | Recorded behavior | Applied rule |
|---|---|---|---|
| Number of supplied workflows | Request refers to three videos | Five files (`k1`–`k5`) are present | Reviewed and implemented all five |
| Vendor tabs | Includes Seller Details and Other Details | Current recording exposes all seven tabs | The seven-tab layout is retained, including the recorded return, email and receipt-validation controls |
| Vendor UDFs | General guide does not establish the visible count | Recording exposes UDF1–UDF6 | Six fields |
| Vendor address requirements | Guide and screen stars differ for Address2/City | Recording marks shipping Address2 and billing City as required | Recorded stars and validation win |
| Transporter API tab | Guide describes Configure API Detail | Recording exposes only Detail Transporter and User Defined Field | Recorded two-tab layout wins; no unsupported API fields invented |
| Transporter enquiry results | Guide documents Search | Recording does not execute Search | Search is functional through the API but no fabricated result set is claimed |
| Customer field vocabulary | Guide contains broader customer settings | Recording shows the compact Customer Details set | Recorded labels/order win |
| CRUD completion | Guide describes create/edit capabilities | Add New recordings do not enter data or click Save | Persistence and evidence-backed validation are implemented, but no claim is made that an unrecorded server message is visually exact |

## Validation and state rules

- Initial enquiry grids stay empty until Search is pressed; loading state is shown during the API request.
- Reset clears filters and restores the initial empty state.
- Recorded filtering is case-insensitive and applies across visible columns.
- Vendor requires code, name, tax zone, currency, type and the recorded starred address fields. Email syntax is validated.
- Vendor code is locked by the API after first save. A new Vendor is Pending Confirmation; Confirm and Deactivate persist status changes.
- Copy To Billing copies every recorded shipping-address value to the billing fields.
- Transporter requires type, code, name, Address1 and Address2. Its API enforces unique code and name.
- Customer requires name, type and recorded starred address fields. The API generates the code and enforces duplicate email, phone and GST safeguards.
- Parent selection, UDF values, document metadata, terms and other shipping-address rows are retained in form state and submitted with the master record.
- Delete operations remain unavailable and are rejected server-side to preserve dependent transaction history.

## Verification checklist

- [x] Supplied Vendor Master guide and the 196.953-second recording reviewed through key frames.
- [x] Five videos inspected through contact sheets and full-resolution key frames.
- [x] Each recorded click sequence traced.
- [x] Documentation/video conflicts recorded above.
- [x] TypeScript typecheck.
- [x] Targeted lint for all four changed React files.
- [x] Production bundle build (with environment version/chunk-size warnings).
- [x] Live local API: Vendor create defaults to Pending Confirmation.
- [x] Live local API: Vendor confirmation persists; code remains immutable.
- [x] Live local API: duplicate Vendor code returns HTTP 409.
- [ ] Browser pixel comparison at the original 2560x1440 capture size.
- [ ] Live external Vin eRetail API/network payload comparison (not present in supplied evidence).
- [ ] Role matrix beyond the authenticated Store Admin presentation (not demonstrated).

## Added recordings k6-k14

Nine additional 2560×1440 recordings were reviewed frame-by-frame and by full-resolution workflow key frames.

| Recording | Observed workflow | Implemented behavior |
|---|---|---|
| k6 | SKU Enquiry → Add New → Normal classification → SKU Create/Edit; SKU Details, UDF, Other Details, Case Packs and ARS Details | Dedicated manual-search enquiry, classification gate, five-tab editor, API persistence and ARS/case-pack state |
| k7 | SKU Import Import/Download tabs; CreateUpdate, Attribute Set, template, maximum 500 rows and upload-history grid | Separate `/app/sku-import`; CSV template, validated Create/Update processing, 500-row limit, success/failure counts and persistent history |
| k8 | SKU Create/Edit classification changed to Bundled | Classification choices preserve Normal/Bundled/Style/Variant/Prepack; selected classification controls the created SKU |
| k9 | SKU Barcode enquiry, import tab and Add New modal | Recorded grid/modal/import structure, 1,000-row rule, row-level preview/errors, duplicate protection and Master SKU-backed selection |
| k10 | Promotion Enquiry and Sales Promotion Create/Edit tabs | Manual enquiry plus Buy/Get, Tiers, Exclusion, Day & Time and Location tabs. The former local Save/Confirm action wrote generic metadata without POS rule execution; current creation and confirmation are blocked, and historical metadata is read-only. |
| k11 | Pricing Event Enquiry, Search/Reset/exports/Add New, recorded statuses | Dedicated enquiry with recorded fields, filters, result contract and Confirmed/Pending Confirmation/Canceled ribbons |
| k12 | Pricing Event Add New: base dates/type, B2B customer picker and location | Mandatory base validation, customer picker sourced from Customer Master, location selection and Next transition |
| k13 | Pricing Event SKU Details: SKU picker, fixed value rule, Add and Save success | SKU picker sourced from Master SKU, fixed/percentage rules, rule grid and persisted Saved Successfully state |
| k14 | Percentage/Mark Down/MRP/Round Up rule, Add, Save and reset | Percentage rule lifecycle, calculated-rule metadata persistence and saved row display |

### Master SKU preservation and synchronization

- The user-supplied Master SKU implementation at `src/pages/Skus.tsx` was not edited. Its SHA-256 at verification was `c3a292821b4a7412950c90d76783df10db1b519d15160e15231efa029136e6e9`.
- SKU Create/Edit and SKU Import use `/api/skus`, so records immediately appear in Master SKU.
- SKU Barcode and Pricing Event SKU pickers read `/api/skus`; missing SKU codes are rejected server-side for barcodes.
- Master SKU remains visible as an additional menu feature alongside the evidence-matched SKU Enquiry and SKU Import pages.

### Added discrepancy matrix

| Area | Guide/recording | Existing custom feature | Resolution |
|---|---|---|---|
| Catalog navigation | Recordings show SKU Enquiry and SKU Import | User added Master SKU | Kept Master SKU and added both recorded routes; no replacement or rewrite |
| Import file type | UI chooser does not reveal parser format | Local runtime has no spreadsheet parser dependency | CSV is processed and verified; XLSX is selectable but returns an explicit unsupported-validation message rather than silently succeeding |
| k8 completion | Shows Bundled selected but does not show the post-OK editor | k6 shows the complete Normal editor | Same classification gate is used; Bundled is persisted, while shared fields follow k6/documentation |
| Promotion line selection | k10 exposes a condition picker but does not open it | Master SKU is authoritative catalog | The old generic line persistence is disabled until eligibility and POS execution are verified; no unobserved picker columns were invented |
| Pricing calculation | Recordings store rule metadata but do not show a downstream order calculation | Existing checkout has sales-order pricing | Rules persist without claiming an unobserved retroactive order recalculation |

### Added verification

- [x] TypeScript typecheck after all new workflows.
- [x] Targeted ESLint for the new workflow components and modified SKU Barcode screen.
- [x] Production Vite build.
- [x] Existing Master SKU component hash/timestamp checked and file left unchanged.
- [x] Barcode created from a valid Master SKU.
- [x] Missing Master SKU rejected with HTTP 400.
- [x] Duplicate barcode rejected with HTTP 409.
- [x] Pricing Event with SKU rule persisted and transitioned to Confirmed.
- [x] Historical check: a Sales Promotion SKU-linked line persisted with a `Confirmed` status in generic metadata. This did not prove POS discount execution or eligibility checks. The current guard test verifies such generic writes are rejected and legacy metadata remains readable.
- [ ] Browser pixel-diff automation at 2560×1440 remains unavailable in this workspace.

## Tally Configuration: pdf3 and l1-l3

### Sources and complete inventory

- `pdf3.pdf`: all 11 pages reviewed. It documents Master → Miscellaneous → Tally Configuration, the Sales/Sales Return and Purchase/Purchase Return sections, ledger rules, tax ledgers, party aliases and the Manage Api dependency.
- `l1.webm`: all 314 decoded frames traced. It shows Sales configuration, the Marketplace Alias modal, pagination, Close, Party Name switched to Transporter and the Transporter Alias modal.
- `l2.webm`: all 123 decoded frames traced. It shows the Purchase tab, Item wise expense-ledger input, switching to Local/Interstate, dynamic local/interstate inputs and With Tax Percent selection.
- `l3.webm`: all 96 decoded frames traced. It shows the Vendor party tooltip, Vendor Alias modal, its editable mapping columns, pagination and Close.
- Authentication/session protection, the Store Admin identity, Master navigation, open-screen links, Manage Api linkage, location selector, refresh, global search and shared loading/error presentation remain supplied by `Shell`, `ProtectedRoute` and `AuthContext`.

### Workflow and data mapping

| Workflow | Implemented behavior | Persistence/dependency |
|---|---|---|
| Sales and Sales Return | Recorded voucher/reference/date defaults and options; editable voucher type; Local/Interstate or Item wise ledger modes; With Tax Percent flags; output SGST/UTGST, CGST and IGST ledger fields | One `tally-config` GLOBAL record in `generic_records` through `/api/tally-config` |
| Purchase and Purchase Return | Recorded inbound/PO/return mappings; Item wise ↔ Local/Interstate dynamic fields; expense and input tax ledger configuration | Same atomic GLOBAL configuration record |
| Marketplace Alias | Editable Tally name, sales/return voucher types and local/interstate ledgers; 10-row pagination; Save and Close | Source rows resolve live from `channels`; mappings persist as `tally-alias` records |
| Transporter Alias | Recorded transporter grid and editable accounting mappings | Source rows resolve live from Transporter Master (`partners`) |
| B2B Customer Alias | Documentation-prescribed customer mapping using the same Sales alias contract | Source rows resolve live from Customer Master (`partners`) |
| Vendor Alias | Recorded Vendor modal, purchase/P_Returns voucher mappings, ledger mappings and pagination | Sources resolve from dedicated Vendor Master plus compatible vendor partners, deduplicated by code |
| Save / Reset / Audit | Mandatory-field validation with highlighted controls; reset to observed defaults; successful saves create auditable entries | `tally-config`, `tally-alias` and `tally-audit` records; API returns fresh synchronized state after every save |

### Tally discrepancy matrix

| Area | Documentation | Video observation | Resolution |
|---|---|---|---|
| Purchase ledger section title | Narrative calls it Purchase Ledger Name in places | UI title is `Expense Ledger Name`; field is `Purchase Ledger Type` | Video-visible section and field labels are preserved exactly |
| Sales reference default | Guide describes External Order Number | UI displays `Extern orderno` | Recorded vocabulary is the default; documented External Order Number remains a selectable option |
| Purchase party aliases | Guide describes Vendor Name and Alias Name | Modal first column is labelled `Customer Code` while rows are vendors | The recorded modal label is preserved; its source and business relationship remain Vendor Master |
| Party types | Guide includes Marketplace, Transporter and B2B Customer | l1 demonstrates Marketplace and Transporter only | Both recorded types plus documented non-conflicting B2B Customer are available |
| Default voucher type | Guide says Sales/Credit Notes/Purchase/Purchase Return defaults | Captured inputs are empty and display example placeholders | Recorded empty inputs/placeholders take precedence; all remain editable |
| Tally transfer | Guide says configured sales/purchase data can be pushed to Tally | No video performs a push or exposes an outbound payload/response | Configuration and API-key dependency are implemented; no unobserved external Tally connector is claimed |

### Tally verification evidence

- [x] `npm run typecheck` passes.
- [x] `npm run build` passes; the existing Node 20.14 versus Vite 20.19 recommendation and bundle-size warning remain non-blocking warnings.
- [x] Targeted ESLint for `TallyConfiguration.tsx` passes.
- [x] GET returns observed defaults plus live Marketplace, Transporter, B2B Customer and Vendor sources.
- [x] Empty save returns HTTP 400 and the exact missing-field list.
- [x] Valid Sales/Purchase configuration persists and reloads.
- [x] Alias values persist and reload; configuration and alias saves create separate audit entries.
- [x] Headless Chrome verifies Sales screen, Marketplace Alias, Purchase Item wise default, Local/Interstate transition, Vendor Alias and Transporter Alias.
- [x] Browser screenshots were captured and visually inspected at the recordings' 2560×1440 resolution after correcting a detected action-button styling collision.
- [ ] External Tally push and response handling cannot be executed because the supplied sources contain no Tally endpoint, credentials, payload contract or demonstrated push action.

# 003 Transporter Master — source contract and selected memory proof

Storage: legacy partners filtered type Transporter; no tenant predicate or handler-specific role checks observed. Configured-admin server session is the shared boundary. Business owner unspecified. Create requires carrier/type, numeric code and name, with read-before-write code/name uniqueness checks. Update preserves code/creation metadata, rewrites merged pre-read fields, sets active/status and modification actor/date. Delete returns 409. Enquiry POST filters/paginates; full correctness not runtime verified. No direct Central Inventory/provider call. Issued fulfillment/shipment name preservation remains a downstream readback requirement.

Fresh scripts/verify-transporter-boundaries.mjs reproduced caller-selected duplicate numeric identity, then passed after handler strips id/_id on create and _id on update. Distinct numeric identity, original record preservation and delete guard verified in memory only. No configured Mongo/browser/LIVE claim.

Remaining: create code/name races, update duplicate-name validation, snapshot conflict loss, boolean active coercion, role/tenant ownership, status rules, shipment historical references, shared partners bypasses, configured persistence and all browser/reference actions. Module remains UNVERIFIED; G0/G5/G6/G7 open.

Update-name follow-up: memory regression reproduced rename to another transporter's name accepted. PUT now applies the existing create-time exact-name uniqueness precheck, excluding the current id. Regression rejects 409 and preserves the record. This is sequential validation only; concurrent uniqueness remains open.

Shared-writer follow-up: /api/partners now fails closed for this dedicated master on create/edit/delete and conversion, based on requested and stored type/partner_type. Memory regression covers guard preservation and array-id rejection. Mongo/browser/configured proof remains open.

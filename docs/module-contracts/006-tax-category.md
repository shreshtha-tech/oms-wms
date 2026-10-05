# 006 Tax Category (HSN/SAC) — current source contract

Dedicated api/tax-categories.js stores generic_records module tax-category. Create requires code/description and prechecks case-insensitive code/name duplicates; type defaults HSN (Goods). Update validates Active/Inactive, checks duplicates, and rejects a code change if any SKU hsn or Tax Application tax_category references the current code. Delete always rejects 409. GET/enquiry filtering/pagination exist but full behavior is unverified. No tenant predicate or specific role/audit actor is established. No legal tax-rate/compliance correctness inferred.

Fresh memory scripts/verify-tax-category-bypass.mjs reproduced generic API changing a SKU-referenced HSN after dedicated API rejected it. Generic tax-category mutations now return 501; test preserves category code and blocks generic deletion. Expanded protected generic suite covers direct creation, disguised edit/delete and nested module conversion for this module.

Remaining: referenced Tax Application proof, concurrency between reference creation and rename, uniqueness races, type constraints, status effects, configured persistence, role/tenant/audit requirements, downstream financial use and authenticated browser/LIVE comparison. Business owner unspecified. Module UNVERIFIED, gates open.

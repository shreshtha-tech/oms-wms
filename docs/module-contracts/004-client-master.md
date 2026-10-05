# 004 Client Master — current source contract and memory checks

api/clients.js mounts at /api/clients and /api/jsonClientMasterEnquirySearch behind the common configured-admin session boundary. Legacy partners rows qualify as Client through type or partner_type. All partners are read then filtered; no tenant predicate or role-specific enforcement is observed. This client master is not demonstrated to be an authoritative tenancy registry. Business owner unspecified.

Create validates numeric client_id, required identity/address/currency fields, status, email and shelf-life format. Duplicate client id and case-insensitive client name are prechecked. Update permits client_id edits subject to duplicate checks, merges the pre-read row, validates and writes status/modified actor. GET/enquiry list/filter/page; DELETE 409 advises inactivation. No direct ledger/provider call observed. Relationships to warehouse/client-owned documents require independent tracing.

Fresh memory scripts/verify-client-boundaries.mjs reproduced caller-selected numeric id and forged creation actor/date on update. Create now strips id/_id; update strips _id and preserves stored creation metadata. Regression passes distinct identities, preserved creation actor/date, server modification actor and blocked deletion. No configured Mongo/browser/LIVE proof.

Open: client_id rename referential safety; duplicate races; snapshot overwrites; ownership/permissions; active-client effects; index/history reconciliation; complete enquiry/paging/import/export/browser/LIVE behavior. Source contract and narrow checks do not justify full readiness. Module UNVERIFIED; G0/G5/G6/G7 open.

Shared-writer follow-up: /api/partners now fails closed for this dedicated master on create/edit/delete and conversion, based on requested and stored type/partner_type. Memory regression covers guard preservation and array-id rejection. Mongo/browser/configured proof remains open.

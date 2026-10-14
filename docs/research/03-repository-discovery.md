# Repository discovery and triage

Status: IN PROGRESS. This applies objective relevance/access/compatibility criteria to all 24 successful metadata candidates. Recent pushed_at is metadata, not a maintenance-quality or security verdict. 48 attempted candidates are retained in [longlist](03-repository-longlist.md).

| Repository | Disposition | Reason / source quality / compatibility |
|---|---|---|
| [frappe/erpnext](https://github.com/frappe/erpnext) | shortlist | reservation/ledger/batch source and tests available; GPL pattern study |
| [odoo/odoo](https://github.com/odoo/odoo) | shortlist | physical quant dimensions and moves available; ORM transaction trace still incomplete |
| [apache/ofbiz-framework](https://github.com/apache/ofbiz-framework) | follow-up | ERP entity/service source needed for competing WMS flows; not yet read |
| [openboxes/openboxes](https://github.com/openboxes/openboxes) | shortlist | WMS lot/expiry source available; actual balance writer/tests need tracing |
| [tryton/tryton](https://github.com/tryton/tryton) | follow-up | official module source location/license needs resolution |
| [metasfresh/metasfresh](https://github.com/metasfresh/metasfresh) | follow-up | ERP allocation/warehouse evidence needed; metadata alone insufficient |
| [medusajs/medusa](https://github.com/medusajs/medusa) | shortlist | TypeScript workflow/inventory source and tests; explicit Enterprise exclusions |
| [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure) | shortlist | TypeScript ordered locks and explicit concurrency tests; GPL/VCL and test configuration limits |
| [saleor/saleor](https://github.com/saleor/saleor) | shortlist | PostgreSQL ordered allocation locks and matching tests; BSD root |
| [spree/spree](https://github.com/spree/spree) | access follow-up | metadata available; old core paths returned 404; no source recommendation |
| [BroadleafCommerce/BroadleafCommerce](https://github.com/BroadleafCommerce/BroadleafCommerce) | defer | metadata only; Java adoption not justified; license not resolved |
| [temporalio/temporal](https://github.com/temporalio/temporal) | defer | metadata only; no measured need for new broker/orchestrator/telemetry runtime; source, tests and operating cost not yet assessed |
| [debezium/debezium](https://github.com/debezium/debezium) | focused | CDC outbox source/tests; operation contract differs from mutable local tasks |
| [apache/camel](https://github.com/apache/camel) | focused | pluggable idempotent repository semantics; adding JVM runtime not justified |
| [apache/kafka](https://github.com/apache/kafka) | defer | metadata only; no measured need for new broker/orchestrator/telemetry runtime; source, tests and operating cost not yet assessed |
| [rabbitmq/rabbitmq-server](https://github.com/rabbitmq/rabbitmq-server) | defer | metadata only; no measured need for new broker/orchestrator/telemetry runtime; source, tests and operating cost not yet assessed |
| [nats-io/nats-server](https://github.com/nats-io/nats-server) | defer | metadata only; no measured need for new broker/orchestrator/telemetry runtime; source, tests and operating cost not yet assessed |
| [open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js) | defer | metadata only; no measured need for new broker/orchestrator/telemetry runtime; source, tests and operating cost not yet assessed |
| [timgit/pg-boss](https://github.com/timgit/pg-boss) | shortlist | PostgreSQL job SQL and retry tests; compare patterns before replacing queue |
| [taskforcesh/bullmq](https://github.com/taskforcesh/bullmq) | defer | metadata only; no measured need for new broker/orchestrator/telemetry runtime; source, tests and operating cost not yet assessed |
| [graphile/worker](https://github.com/graphile/worker) | focused | Node/PostgreSQL worker failure isolation; matching SQL/tests not yet read |
| [Shopify/shopify-app-js](https://github.com/Shopify/shopify-app-js) | focused | official provider validator and tests; not a warehouse authority |
| [woocommerce/woocommerce](https://github.com/woocommerce/woocommerce) | focused | official sender HMAC and stock hooks; datastore/test/license trace pending |
| [woocommerce/woocommerce-rest-api](https://github.com/woocommerce/woocommerce-rest-api) | exclude adoption | archived 2021 metadata; use current official Woo implementation |

Strongest 7 comparative candidates: Saleor, ERPNext, Odoo, Medusa, Vendure, OpenBoxes and pg-boss. Focused infrastructure/connector readings add alternative mechanisms, not automatic adoption. No star count influenced triage.

Additional independently discovered leads: [Zehelein/pg-transactional-outbox](https://github.com/Zehelein/pg-transactional-outbox), [SoloCron/no-oversell](https://github.com/SoloCron/no-oversell), [CS-Nithin/multi-vendor-inventory-booking-system](https://github.com/CS-Nithin/multi-vendor-inventory-booking-system), [Dekshith14/allo](https://github.com/Dekshith14/allo). All remain DOCUMENTED ONLY until actual source/test/license review.

# PR 1 local baseline vs after

All commands ran with disposable local PostgreSQL 18.3 and MongoDB 8.0.8. Hosted PostgreSQL 16 / MongoDB 7 / Node 24: NOT RUN at this point.

- Baseline: 211 tests, 68 PASS, 143 FAIL.
- After: 214 tests, 109 PASS, 105 FAIL.
- Required: 109 PASS, 0 FAIL. Quarantined: 0 PASS, 105 FAIL; all were executed and retained in JSON logs.
- Prior FAIL to PASS: 38. Prior PASS to FAIL: 0. New tests: 3.

## Prior FAIL to PASS

- `test:ajio-integrity`
- `test:amazon-mfn-integrity`
- `test:ars-integrity`
- `test:back-order-integrity`
- `test:bulk-order-update`
- `test:category-buyers`
- `test:central-inventory`
- `test:central-inventory-api`
- `test:central-inventory-files`
- `test:central-inventory-ui`
- `test:central-inventory-ui-isolated`
- `test:common-import`
- `test:delivery-shipping`
- `test:download-pdf`
- `test:download-workbook`
- `test:inbound-realtime-integrity`
- `test:inventory-move`
- `test:legacy-fulfillment-write-blocks`
- `test:legacy-stock-write-blocks`
- `test:manage-manifests`
- `test:manage-picking`
- `test:manage-picklists`
- `test:mp-inventory-log`
- `test:order-maintenance`
- `test:order-refund`
- `test:reliability-extended`
- `test:reliability-mongo-startup`
- `test:returns-integrity`
- `test:sales-programs`
- `test:seller-connections-ui`
- `test:shipment-handover`
- `test:sku-import`
- `test:sort-to-box`
- `test:transhipment-integrity`
- `test:transhipment-old-integrity`
- `test:unified-orders`
- `test:unified-orders-isolated`
- `test:vendor-master`

## Prior PASS to FAIL

None.

## New tests

- `test:ci-env`
- `test:ci-runner`
- `test:provider-dispatch-authority`

Exact commands, outputs, status, and duration are in `baseline.json`, `after-final.json`, and `diff.json`. Quarantine reasons and owners are in `ci-test-manifest.json`.

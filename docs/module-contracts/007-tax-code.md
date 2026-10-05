# 007 Tax Code — source contract and numeric input proof

api/taxcodes.js stores tax_codes. Validation requires alphanumeric code <=50, one of GST/CESS/VAT/OTHERS, Central/State Cess nature, strict valid start-date and finite percentage in [0,100]; Active/Inactive status and description length constrained. Create uses a case-insensitive read-before-write duplicate check. Update rejects system VINCCNA/VINSCNA, checks duplicate code and persists supplied fields. Delete rejects 409. No tenant predicate, role-specific permission or server audit event observed. Tax Group mappings resolve these records by numeric id.

Fresh memory scripts/verify-tax-code-values.mjs reproduced boolean false accepted as percentage zero. Validator now requires number/string and nonblank input before Number conversion. Regressions reject boolean/array/object/blank and accept explicit zero/decimal/100. Same validator is used for create/update; tests here exercise create. No legal tax-rate correctness, effective-date posting logic or rounding proof.

Open: Mongo/configured verification, duplicate races, update payload ownership/id normalization, rate-change effect on issued documents, group-level compounding versus displayed summed rate, authorization/audit, full browser/LIVE parity. Module UNVERIFIED; gates open.

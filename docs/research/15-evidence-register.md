# Evidence register

Status: IN PROGRESS. [evidence.json](evidence.json) is the machine-readable register; [source-code investigation](04-source-code-investigation.md) presents each upstream record. UP-001 through UP-012 are bounded source analyses. See the retrieval manifests for unsuccessful paths as well as successful content hashes.

Reading tests is VERIFIED IN TESTS only for the assertions inspected. It is not a PASS execution result. Source mechanisms are VERIFIED IN CODE, with confidence scoped to the named mechanism. Earlier VERIFIED IN SOURCE terminology maps to VERIFIED IN CODE. Documented provider/release claims remain DOCUMENTED ONLY. Runtime validation performed during the separately authorized fixes is in confirmed-defect-validation.json and must not be attributed to upstream projects.

Exact upstream source and license revisions are preserved. Current local files are dirty relative to HEAD; baseline-snapshot.json describes the original baseline and confirmed-defect-validation.json describes the authorized fixes. A fresh local research snapshot is needed before final sign-off.

Current expansion: 49 unique records, including versioned STD-001/002 and UP-018/019/020 plus local chain LOC-019. Current manifest count is 218 unique successfully retrieved files; many downloaded files have not yet been read. Use progress.json and evidence.json rather than initial counts above.

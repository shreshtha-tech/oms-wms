"""Record source literals and exact legacy handler mounts; no workflow claims.

This deliberately does not infer endpoints hidden behind imports, computed URLs,
generic components, or nested Express routers. Those remain inspection gaps.
"""
import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent.parent
matrix = root / "docs/production_module_matrix.csv"
with matrix.open(newline="") as stream:
    reader = csv.DictReader(stream)
    fields = reader.fieldnames
    rows = list(reader)
assert len(rows) == 170 and [r["module_id"] for r in rows] == [f"{i:03}" for i in range(1, 171)]
protected = [(r["current_status"], r["historical_status"], r["historical_evidence"]) for r in rows]
server = (root / "server.js").read_text()
imports = dict(re.findall(r"^import\s+(\w+)\s+from\s+['\"]\./([^'\"]+)['\"]", server, re.M))
mounts = {}
for endpoint, symbol in re.findall(r"['\"](/api/[^'\"]+)['\"]\s*:\s*(\w+)", server):
    if symbol in imports and (root / imports[symbol]).is_file():
        mounts[endpoint] = imports[symbol]
records = []
bound = 0
for row in rows:
    record = {"module_id": row["module_id"], "module_name": row["module_name"], "route": row["route"],
              "frontend_source": row["frontend_component"], "api_literals": [], "gaps": []}
    path = root / row["frontend_component"]
    if not path.is_file():
        record["gaps"].append("Frontend source is unresolved; no API dependencies inferred.")
        records.append(record)
        continue
    source = path.read_text()
    record["source_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    for match in re.finditer(r"(['\"`])(/api/[^'\"`\s]*)\1", source):
        literal = match.group(2)
        endpoint = literal.split("?", 1)[0]
        dynamic = "${" in literal
        handler = mounts.get(endpoint) if not dynamic else None
        record["api_literals"].append({"literal": literal, "line": source[:match.start()].count("\n") + 1,
                                       "dynamic": dynamic, "exact_legacy_handler": handler})
    handlers = sorted({r["exact_legacy_handler"] for r in record["api_literals"] if r["exact_legacy_handler"]})
    if handlers:
        binding = "STATIC DEPENDENCIES ONLY: " + " | ".join(handlers)
        if row["backend_handler"] == "UNKNOWN" or row["backend_handler"].startswith("STATIC DEPENDENCIES ONLY: "):
            row["backend_handler"] = binding
            bound += 1
    record["gaps"].append("Literals are references, not proof of executed requests, action support, authorization, database ownership or business effects.")
    record["gaps"].append("Shared/imported components, computed URLs and nested-router actions need independent tracing.")
    records.append(record)
assert protected == [(r["current_status"], r["historical_status"], r["historical_evidence"]) for r in rows]
output = root / "docs/module_source_dependencies_2026-10-02.json"
output.write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(),
                             "scope": "Current-source references only; no workflow status promotion",
                             "server_sha256": hashlib.sha256(server.encode()).hexdigest(),
                             "modules": records}, indent=2) + "\n")
with matrix.open("w", newline="") as stream:
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(f"Recorded {len(records)} modules; bound exact legacy handler references for {bound}. Statuses and historical evidence preserved.")

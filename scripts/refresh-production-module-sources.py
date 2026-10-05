"""Add exact current route/component evidence without promoting workflow status.

Run node scripts/audit-navigation-static.mjs first. Dynamic routes, backend
contracts and actions require separate inspection and are not inferred here.
"""
import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
matrix = root / "docs/production_module_matrix.csv"
audit = json.loads((root / "artifacts/navigation-audit/static-inventory.json").read_text())
with matrix.open(newline="") as source:
    reader = csv.DictReader(source)
    fields = reader.fieldnames
    rows = list(reader)
assert len(rows) == 170
assert [row["module_id"] for row in rows] == [f"{i:03}" for i in range(1, 171)]
assert all(None not in row and all(value is not None for value in row.values()) for row in rows)
before = [(row["historical_status"], row["historical_evidence"], row["current_status"]) for row in rows]
matches = {}
for item in audit["items"]:
    if item.get("route") and item.get("componentFile"):
        matches.setdefault(item["route"], set()).add(item["componentFile"])
for route in audit["routes"]:
    path = route.get("componentFile")
    if not path:
        continue
    candidates = [path] + [path + ext for ext in (".tsx", ".ts", ".jsx", ".js")]
    existing = [candidate for candidate in candidates if (root / candidate).is_file()]
    if len(existing) == 1:
        matches.setdefault(route["route"], set()).add(existing[0])
resolved = 0
for row in rows:
    paths = matches.get(row["route"], set())
    if len(paths) != 1:
        continue
    path = next(iter(paths))
    assert (root / path).is_file(), path
    current = row["frontend_component"]
    if current not in ("UNKNOWN", path):
        raise ValueError(f"Review conflicting source for module {row['module_id']}: {current} vs {path}")
    row["frontend_component"] = path
    marker = f"STATIC SOURCE ONLY ({audit['generatedAt']}): exact route {row['route']} resolves to {path}; workflow, authorization, persistence and reference parity are not proved."
    evidence = row["current_evidence"]
    # Replace this script's own timestamped observation, preserve other evidence.
    parts = [part for part in evidence.split(" | ") if not part.startswith("STATIC SOURCE ONLY (")]
    row["current_evidence"] = " | ".join(parts + [marker])
    resolved += 1
assert before == [(row["historical_status"], row["historical_evidence"], row["current_status"]) for row in rows]
with matrix.open("w", newline="") as destination:
    writer = csv.DictWriter(destination, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(f"Resolved {resolved}/170 exact frontend sources; historical evidence and all statuses preserved.")

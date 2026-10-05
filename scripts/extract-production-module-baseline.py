"""Extract the historical 170-module register from the forensic dossier.

This is a transcription tool, not a verifier. Current fields remain UNVERIFIED.
"""

import csv
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/PRODUCTION_READINESS_FORENSIC_DOSSIER_2026-09-30.docx"
OUTPUT = ROOT / "docs/production_module_matrix.csv"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
FIELDS = [
    "module_id", "module_name", "route", "frontend_component", "backend_handler",
    "database", "tables", "business_owner", "actor_roles", "tenant_scope",
    "state_machine", "supported_actions", "unsupported_actions",
    "central_inventory_dependency", "external_provider_dependency",
    "idempotency_requirement", "concurrency_requirement", "audit_requirement",
    "current_status", "historical_status", "historical_evidence", "current_evidence",
    "remaining_gap", "risk", "test_command", "production_evidence_required",
    "release_gate",
]


def main():
    existing_rows = {}
    if OUTPUT.exists():
        with OUTPUT.open(newline="", encoding="utf-8") as file:
            existing_rows = {row["module_id"]: row for row in csv.DictReader(file)}
    with zipfile.ZipFile(SOURCE) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    lines = ["".join(node.text or "" for node in p.findall(".//w:t", NS)).strip()
             for p in document.findall(".//w:p", NS)]
    start = next(i for i, line in enumerate(lines) if line.startswith("10. Detailed module register"))
    end = next(i for i, line in enumerate(lines) if line.startswith("11. Source register"))
    rows = []
    for i in range(start, end):
        match = re.fullmatch(r"(\d{3})  (.+)", lines[i])
        if not match:
            continue
        block = lines[i + 1:i + 5]
        if len(block) != 4 or not block[0].startswith("Route / status  "):
            raise ValueError(f"Unexpected module format at {match.group(1)}: {block!r}")
        route_status = block[0].removeprefix("Route / status  ")
        if " · " not in route_status:
            raise ValueError(f"Missing route/status separator at {match.group(1)}")
        route, status = route_status.split(" · ", 1)
        row = dict.fromkeys(FIELDS, "UNKNOWN")
        row.update(
            module_id=match.group(1), module_name=match.group(2), route=route,
            current_status="UNVERIFIED", historical_status=status,
            historical_evidence=block[2].removeprefix("Observed  "),
            remaining_gap=block[3].removeprefix("Failure, limitation or next proof  "),
            production_evidence_required=block[3].removeprefix("Failure, limitation or next proof  "),
        )
        action = block[1].removeprefix("Action / evidence scope  ")
        row["supported_actions"] = action
        commands = re.findall(r"(?:npm run [\w:-]+|scripts/[\w./-]+)", " ".join(block))
        row["test_command"] = "; ".join(dict.fromkeys(commands)) or "UNKNOWN"
        row["current_evidence"] = "NOT REVERIFIED AGAINST CURRENT CHECKOUT"
        previous = existing_rows.get(row["module_id"])
        if previous:
            if previous["module_name"] != row["module_name"] or previous["route"] != row["route"]:
                raise ValueError(f"Module identity changed at {row['module_id']}; review before merging")
            for field in FIELDS:
                if field not in {"module_id", "module_name", "route", "historical_status", "historical_evidence", "remaining_gap", "production_evidence_required", "supported_actions", "test_command"}:
                    row[field] = previous[field]
            if previous["current_status"] != "UNVERIFIED":
                for field in ("remaining_gap", "production_evidence_required", "test_command"):
                    row[field] = previous[field]
        rows.append(row)
    if len(rows) != 170 or [r["module_id"] for r in rows] != [f"{n:03}" for n in range(1, 171)]:
        raise ValueError("Expected exactly 170 consecutively numbered modules")
    with OUTPUT.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} historical module rows to {OUTPUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise

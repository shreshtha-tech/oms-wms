"""Verify source fidelity only; never infer engineering completion."""
import hashlib
import json
from pathlib import Path

register = json.loads(Path('docs/goal_requirement_register_2026-10-02.json').read_text())
source = Path(register['source_path']).read_bytes()
assert hashlib.sha256(source).hexdigest() == register['source_sha256']
assert hashlib.sha256(Path(register['baseline_dossier']).read_bytes()).hexdigest() == register['baseline_dossier_sha256']
lines = source.decode().splitlines()
requirements = register['requirements']
assert [row['requirement_id'] for row in requirements] == [f'R{i:02}' for i in range(1, 48)]
for index, row in enumerate(requirements):
    start, end = row['source_start_line'], row['source_end_line']
    assert row['source_text'] == '\n'.join(lines[start - 1:end])
    if index:
        assert requirements[index - 1]['source_end_line'] == start - 1
assert requirements[-1]['source_end_line'] == len(lines)
print('PASS: 47 contiguous source sections and baseline hashes verified; engineering completion remains unproven.')

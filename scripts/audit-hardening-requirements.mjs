import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Pass the original hardening specification file.');
const source = await readFile(sourcePath, 'utf8');
const lines = source.split(/\r?\n/);
const headers = lines.flatMap((line, index) => {
  const match = line.match(/^PART (\d+) — (.+)$/);
  return match ? [{ number: Number(match[1]), title: match[2], index }] : [];
});
if (headers.length !== 50 || headers.some((header, index) => header.number !== index + 1)) throw new Error('Expected all 50 original numbered parts in sequence.');
const parts = headers.map((header, index) => {
  const end = headers[index + 1]?.index ?? lines.length;
  return { number: header.number, title: header.title, sourceStartLine: header.index + 1, sourceEndLine: end,
    completion: 'NOT_PROVEN', originalText: lines.slice(header.index, end).join('\n'),
    evidenceAssessment: 'Pending requirement-by-requirement assessment; focused passing tests cannot establish this whole part.' };
});
const registry = { sourceSha256: createHash('sha256').update(source).digest('hex'),
  scope: 'Original 50-part production hardening specification; no requirements removed or narrowed.',
  overallCompletion: 'NOT_PROVEN',
  preamble: lines.slice(0, headers[0].index).join('\n'), parts };
await writeFile(new URL('../docs/hardening/goal-requirements.json', import.meta.url), JSON.stringify(registry, null, 2) + '\n');
console.log('PASS scope extraction: all 50 original parts and preamble preserved; completion remains NOT_PROVEN');

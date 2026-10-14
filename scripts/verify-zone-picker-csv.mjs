import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/zonePickerCsv.ts', import.meta.url))], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { readZonePickerCsv } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const file = text => ({ size: new TextEncoder().encode(text).byteLength, text: async () => text });
assert.deepEqual(await readZonePickerCsv(file('\uFEFFZone,Picker\n"Z,1","P""2"\n')), [{ zone: 'Z,1', picker: 'P"2' }]);
for (const csv of [
  'Wrong,Picker\nZ,P\n',
  'Zone,Picker\n',
  'Zone,Picker\nZ,\n',
  'Zone,Picker\nZ,P,Extra\n',
  'Zone,Picker\nZ,P\nZ,P\n',
  `Zone,Picker\n${Array.from({ length: 201 }, (_, i) => `Z${i},P`).join('\n')}\n`,
]) await assert.rejects(() => readZonePickerCsv(file(csv)));
await assert.rejects(() => readZonePickerCsv({ size: 1024 * 1024 + 1, text: async () => { throw new Error('read must not occur'); } }), /1 MiB/);
const ui = await readFile(new URL('../src/eretail/wms/WmsZone.tsx', import.meta.url), 'utf8');
assert.match(ui, /await readZonePickerCsv\(file\)/);
assert.match(ui, /action: 'link-pickers-bulk', links: validated/);
assert.match(ui, /The batch outcome may be unknown\. Refresh authoritative zone links before retrying/);
console.log('PASS zone-picker CSV parser: quoted fields, malformed/duplicate/oversized files and one-request batch outcome messaging');

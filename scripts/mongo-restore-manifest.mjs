export async function readRestoreManifest(stream) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 4 * 1024 * 1024) throw new Error('Backup manifest exceeds the 4 MiB parsing limit.');
    parts.push(buffer);
  }
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, bytes)));
  if (!manifest || manifest.format !== 'dmills-canonical-ejson-v1' || manifest.complete !== true || !Array.isArray(manifest.collections) || manifest.collections.length > 10000) throw new Error('Complete compatible bounded backup manifest required.');
  const names = new Set(), files = new Set();
  let total = 0;
  for (const row of manifest.collections) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.name !== 'string' || !row.name || row.name.includes('\0') || row.name.startsWith('system.') || names.has(row.name)
      || typeof row.file !== 'string' || !/^\d+\.ndjson$/.test(row.file) || files.has(row.file)
      || !Number.isSafeInteger(row.count) || row.count < 0 || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid collection manifest.');
    total += row.count;
    if (!Number.isSafeInteger(total)) throw new Error('Backup total document count exceeds the supported range.');
    names.add(row.name); files.add(row.file);
  }
  return manifest;
}

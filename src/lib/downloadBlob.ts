export function downloadBlob(record: { content?: string; mime?: string; content_encoding?: string; filename?: string }) {
  if (typeof record.content !== 'string' || !record.content) {
    throw new Error('Stored file content is unavailable. Generate the export again.');
  }
  const binary = record.content_encoding === 'base64' ? atob(record.content) : record.content;
  if ((/\.pdf$/i.test(record.filename || '') && !binary.startsWith('%PDF-'))
    || (/\.xlsx$/i.test(record.filename || '') && !binary.startsWith('PK'))) {
    throw new Error('This historical export does not contain a valid file of the named format. Generate the export again.');
  }
  if (record.content_encoding === 'base64') {
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new Blob([bytes], { type: record.mime || 'application/octet-stream' });
  }
  return new Blob([record.content], { type: record.mime || 'text/plain' });
}

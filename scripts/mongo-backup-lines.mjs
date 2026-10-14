// Bound bytes before constructing or parsing an entire EJSON line.
export async function* boundedBackupLines(stream, maxBytes = 64 * 1024 * 1024) {
  let parts = [], bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const append = part => {
    bytes += part.length;
    if (bytes > maxBytes) throw new Error('Backup EJSON line exceeds the 64 MiB parsing limit.');
    if (part.length) parts.push(part);
  };
  const consume = () => {
    const line = decoder.decode(Buffer.concat(parts, bytes));
    parts = []; bytes = 0;
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  };
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (;;) {
      const newline = buffer.indexOf(10, start);
      if (newline < 0) { append(buffer.subarray(start)); break; }
      append(buffer.subarray(start, newline));
      yield consume();
      start = newline + 1;
    }
  }
  if (bytes) yield consume();
}

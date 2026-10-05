const maximumBytes = 10_000_000;
export function decodeStockSnapshotUpload({ fileName, base64 } = {}) {
  if (typeof fileName !== 'string' || !fileName || fileName.length > 255 || /[\x00-\x1f/\\]/.test(fileName) || !/\.(csv|json)$/i.test(fileName)) {
    throw new TypeError('A CSV or JSON filename is required');
  }
  if (typeof base64 !== 'string' || !base64 || base64.length > 4 * Math.ceil(maximumBytes / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new TypeError('A bounded base64 snapshot is required');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > maximumBytes || bytes.toString('base64') !== base64) throw new TypeError('Invalid snapshot encoding');
  return { fileName, bytes };
}

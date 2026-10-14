// Keep SQL detail private while exposing the operator action that can repair
// a publication-only read failure. This does not change publication state.
export function publicationStatusError(error) {
  const code = String(error?.code || '');
  if (code === '42P01' || code === '42703') {
    return { status: 503, body: { error: 'Publication status schema unavailable. Apply and verify the pending inventory migrations.', code: 'PUBLICATION_SCHEMA_UNAVAILABLE' } };
  }
  if (code === 'DATABASE_TIMEOUT' || code === '57014') {
    return { status: 504, body: { error: 'Publication status query timed out.', code: 'PUBLICATION_QUERY_TIMEOUT' } };
  }
  if (code === 'DATABASE_UNAVAILABLE' || code.startsWith('08') || ['57P01','57P02','57P03','53300','53400'].includes(code)) {
    return { status: 503, body: { error: 'Publication status database unavailable.', code: 'PUBLICATION_DATABASE_UNAVAILABLE' } };
  }
  return { status: 500, body: { error: 'Publication status query failed.', code: 'PUBLICATION_QUERY_FAILED' } };
}

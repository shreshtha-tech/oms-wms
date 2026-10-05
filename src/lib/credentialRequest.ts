// Submitted credentials are intentionally excluded from ordinary draft retry
// preservation. Clear form secrets after success, rejection or transport loss.
export async function credentialRequest<T>(request: () => Promise<T>, clearSecrets: () => void): Promise<T> {
  try { return await request(); }
  finally { clearSecrets(); }
}

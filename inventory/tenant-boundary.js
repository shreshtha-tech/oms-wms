// Current inventory deployment serves one explicitly configured tenant.
// Authentication remains the parent server mount's responsibility.
export function inventoryTenantBoundary(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  const allowed = process.env.INVENTORY_ALLOWED_TENANT_ID;
  if (!allowed) return res.status(503).json({ error: 'Inventory tenant is not configured' });
  const supplied = [req.body?.tenantId, req.query?.tenantId];
  if (supplied.some(value => value !== undefined && (typeof value !== 'string' || value !== allowed))) return res.status(403).json({ error: 'Inventory tenant denied' });
  req.inventoryTenantId = allowed;
  next();
}

// Public integrations authenticate with provider signatures or one-time tokens,
// but those credentials must still belong to this deployment's tenant.
export function requirePublicInventoryTenant(req, res, next) {
  const tenantId = process.env.INVENTORY_ALLOWED_TENANT_ID;
  if (!tenantId) return res.status(503).json({ error: 'Inventory tenant is not configured' });
  req.inventoryTenantId = tenantId;
  next();
}

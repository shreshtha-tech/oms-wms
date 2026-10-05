import { sendDatabaseUnavailable, find, findOne, insert, update, remove, cors } from './mongo.js';

// Master data store. Persists the base fields (code/name/description/status)
// PLUS any extra domain-specific fields sent in `extra` (stored inline), so
// each master screen (Vendor, Tax Code, Coupon, etc.) can keep its real fields.
const BASE = ['module', 'code', 'name', 'description', 'status', 'created_date'];
const isVoucherModule = (value) => String(value || '').trim().toLowerCase() === 'vouchers';
const isOtherMasterModule = (value) => String(value || '').trim().toLowerCase().startsWith('other-masters-');
const isSalesPromotionModule = (value) => String(value || '').trim().toLowerCase() === 'sales-promotion';
const isSkuGroupModule = (value) => String(value || '').trim().toLowerCase() === 'sku-group';
const isSkuCompanyLinkModule = (value) => String(value || '').trim().toLowerCase() === 'sku-company-link';
const isOrganizationModule = (value) => String(value || '').trim().toLowerCase() === 'org-hierarchy';
const isLocationModule = (value) => String(value || '').trim().toLowerCase() === 'location';
const voucherUnavailable = 'Voucher issuance is unavailable until unique codes, eligibility, redemption, audit, and permissions are verified.';
const otherMasterUnavailable = 'Other Masters changes are unavailable until each catalog\'s fields, references, validation, permissions, and consumers are verified.';
const salesPromotionUnavailable = 'Sales Promotion changes are unavailable until the POS rule, eligibility, discount, audit, and approval contracts are verified.';
const skuGroupUnavailable = 'SKU Group changes must use the dedicated SKU Group API so client, SKU, uniqueness, and audit validation is applied.';
const skuCompanyLinkUnavailable = 'SKU Company Link changes must use the dedicated API so company, location, SKU, and audit validation is applied.';
const organizationUnavailable = 'Organization Hierarchy changes must use the dedicated API so required fields, parent validation, and cycle checks are applied.';
const locationUnavailable = 'Location changes must use the dedicated API so required fields and location-code checks are applied.';
const blockedMessage = (module) => String(module || '').trim().toLowerCase() === 'tax-group' ? 'Tax Group changes must use the dedicated API so code components, validation and deletion guards are applied.' : String(module || '').trim().toLowerCase() === 'tax-category' ? 'Tax Category changes must use the dedicated API so HSN/SAC uniqueness and SKU/Tax Application reference guards are applied.' : String(module || '').trim().toLowerCase() === 'customer-group' ? 'Customer Group changes must use the dedicated API so membership, assignment and deletion guards are applied.' : isVoucherModule(module) ? voucherUnavailable : isOtherMasterModule(module) ? otherMasterUnavailable : isSalesPromotionModule(module) ? salesPromotionUnavailable : isSkuGroupModule(module) ? skuGroupUnavailable : isSkuCompanyLinkModule(module) ? skuCompanyLinkUnavailable : isOrganizationModule(module) ? organizationUnavailable : isLocationModule(module) ? locationUnavailable : '';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const id = Number(req.body?.id);
      const existing = req.method !== 'POST' && Number.isSafeInteger(id)
        ? await findOne('generic_records', { id })
        : null;
      const error = blockedMessage(req.body?.module) || blockedMessage(req.body?.extra?.module) || blockedMessage(existing?.module);
      if (error) {
        return res.status(501).json({ error });
      }
    }
    if (req.method === 'GET') {
      const { module } = req.query;
      const q = module ? { module } : {};
      return res.status(200).json(await find('generic_records', q, { sort: { id: -1 } }));
    }
    if (req.method === 'POST') {
      const { module, code, name, description, status, extra } = req.body;
      const doc = {
        ...(extra && typeof extra === 'object' ? extra : {}),
        module, code, name, description,
        status: status || extra?.status || 'Active',
        created_date: new Date().toISOString().slice(0, 10),
      };
      return res.status(201).json(await insert('generic_records', doc));
    }
    if (req.method === 'PUT') {
      const { id, extra, ...fields } = req.body;
      const payload = { ...(extra && typeof extra === 'object' ? extra : {}), ...fields };
      const rows = await update('generic_records', id, payload);
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body;
      return res.status(200).json(await remove('generic_records', id));
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('API error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}

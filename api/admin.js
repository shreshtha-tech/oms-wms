import { sendDatabaseUnavailable, cors, find, findOne, insert, updateAdminIfVersion, removeAdminIfVersion } from './mongo.js';
import { currentUser } from './auth-session.js';
import { channelRows, locations } from './catalogs.js';
import { adminApiKeyView } from './admin-api-key-view.js';

const USERS = 'user';
const ROLES = 'role';
const IMPORTS = 'import';
const PULLS = 'force-pull';
const APIS = 'api-key';
const AUDIT = 'audit';
const storedKey='[stored]';
const adminView=row=>row.type===APIS?adminApiKeyView(row):({...row,version:row.version??0});

const now = () => new Date().toISOString();
const typeRows = async (type) => find('admin_records', { type }, { sort: { id: 1 } });
const audit = async (req, event, entity, entityId, meta = {}) => insert('admin_records', {
  type: AUDIT, event, entity, entityId, meta, at: now(), actor: currentUser(req)?.username || 'unknown',
});
const bad = (res, message) => res.status(422).json({ error: message });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const action = req.query.action || req.body?.action;
    if (req.method === 'GET') {
      if (action === 'force-pull-catalog') {
        const [configuredChannels, configuredLocations] = await Promise.all([channelRows(), locations()]);
        return res.json({
          channels: configuredChannels.filter(row => row.channel_code && row.channel_name).map(row => [String(row.channel_code), String(row.channel_name)]),
          warehouses: configuredLocations.filter(row => /warehouse|head office|ho|wh/i.test(row.type)).map(row => [row.code, row.name]),
        });
      }
      if (action === 'manage-api-catalog') {
        return res.json({ locations: (await locations()).map(row => row.name) });
      }
      if (action === 'dashboard') {
        const apis = await typeRows(APIS);
        const pulls = await typeRows(PULLS);
        return res.json({
          cards: { apiKeys: apis.length, activeKeys: apis.filter((r) => r.status === 'Active').length, pulls: pulls.length, failedImports: (await typeRows(IMPORTS)).filter((r) => r.status === 'Failure').length },
          hits: [],
          topApis: [],
        });
      }
      const type = String(req.query.type || '');
      if (!type) return bad(res, 'Record type is required');
      const rows = await typeRows(type);
      return res.json(rows.map(adminView));
    }
    if (req.method === 'POST') {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return bad(res, 'An Admin record object is required');
      if (action === 'force-pull') {
        const { location, orders, addWhHo } = req.body;
        if (!location) return bad(res, 'Location is Mandatory');
        const orderList = String(orders || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
        if (!orderList.length) return bad(res, 'Order Number is Mandatory');
        if (orderList.length > 20) return bad(res, 'Max 20 order numbers are allowed');
        return res.status(501).json({ error: 'Order pull requires a configured channel integration.' });
      }
      const { type, id, ...payload } = req.body;
      // Existing create forms send id: 0. Only the store allocates a real ID.
      if (id !== undefined && id !== null && id !== 0 && id !== '') return res.status(400).json({ error: 'New Admin record identity is server allocated.' });
      if (![USERS, ROLES, IMPORTS, APIS].includes(type)) return bad(res, 'Unsupported Admin record type');
      if (type === USERS) {
        if (!payload.username || !payload.firstName || !payload.lastName || !payload.title) return bad(res, 'User Name, First Name, Last Name and Title are Mandatory');
        const duplicate = (await typeRows(USERS)).find((u) => u.username?.toLowerCase() === payload.username.toLowerCase());
        if (duplicate) return res.status(409).json({ error: 'User Name already exists' });
      }
      if (type === ROLES && (!payload.roleType || !payload.description)) return bad(res, 'Role Type and Description are Mandatory');
      if (type === IMPORTS && (!payload.importType || !payload.fileName)) return bad(res, 'Import Type and Upload Template are Mandatory');
      if (type === APIS) {
        if (!payload.apiKey || !payload.owner || !payload.expiryDate) return bad(res, 'API Key, API Owner and Expiry Date are Mandatory');
        const duplicate = (await typeRows(APIS)).find((api) => api.apiKey === payload.apiKey);
        if (duplicate) return res.status(409).json({ error: 'API Key already exists' });
      }
      const record = await insert('admin_records', { type, ...payload, status: payload.status || 'Active', createdAt: now(), version: 1 });
      await audit(req, 'Created', type, record.id);
      return res.status(201).json(adminView(record));
    }
    if (req.method === 'PUT') {
      const { id, type, version, ...payload } = req.body;
      if (!Number.isSafeInteger(version) || version < 0) return bad(res, 'A valid record version is required. Refresh and try again.');
      const record = await findOne('admin_records', { id });
      if (!record || (type && record.type !== type)) return res.status(404).json({ error: 'Admin record not found' });
      if (version !== (record.version ?? 0)) return res.status(409).json({ error: 'Record was changed by another user. Refresh and try again.' });
      // The list/editor deliberately receive a masked key. Do not let that
      // display value overwrite the stored key when another API field changes.
      if (record.type === APIS && typeof payload.apiKey === 'string' && (payload.apiKey===storedKey||payload.apiKey===String(record.apiKey||'').slice(0,4)+'xxxx'+String(record.apiKey||'').slice(-4))) payload.apiKey = record.apiKey;
      const updated = await updateAdminIfVersion(id, record.version, { ...payload, updatedAt: now() });
      if (!updated) return res.status(409).json({ error: 'Record was changed by another user. Refresh and try again.' });
      await audit(req, 'Updated', record.type, id);
      return res.json(adminView(updated));
    }
    if (req.method === 'DELETE') {
      const { id, type, version } = req.body;
      if (!Number.isSafeInteger(version) || version < 0) return bad(res, 'A valid record version is required. Refresh and try again.');
      const record = await findOne('admin_records', { id });
      if (!record || (type && record.type !== type)) return res.status(404).json({ error: 'Admin record not found' });
      if (version !== (record.version ?? 0)) return res.status(409).json({ error: 'Record was changed by another user. Refresh and try again.' });
      if (!await removeAdminIfVersion(id,record.version)) return res.status(409).json({ error: 'Record was changed by another user. Refresh and try again.' });
      await audit(req, 'Deleted', record.type, id);
      return res.json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Admin API unexpected failure');
    res.status(500).json({ error: 'Unexpected Admin API error' });
  }
}

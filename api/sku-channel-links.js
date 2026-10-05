import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { currentUser } from './auth-session.js';
const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const numericFields = [
  ['back_order_qty', 'Back Order Qty'],
  ['channel_price', 'Channel Price'],
  ['maximum_sku_qty', 'Maximum SKU Qty'],
];
function normalizeNumbers(link) {
  const values = {};
  for (const [key, label] of numericFields) {
    const raw = link[key] ?? 0;
    if (raw === '') { values[key] = 0; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: `${label} must be a non-negative number.` };
    values[key] = value;
  }
  return { values };
}
async function validateLink(link, currentId = null) {
  if (!text(link.channel_code)) return { error: 'Channel is Mandatory.' };
  if (!text(link.sku_code)) return { error: 'ERetail Sku is Mandatory.' };
  if (!text(link.channel_sku_code)) return { error: 'channelSkuCode is Mandatory.' };
  if (!text(link.status)) return { error: 'Status is Mandatory.' };
  if (!['Active', 'InActive'].includes(text(link.status))) return { error: 'Status must be Active or InActive.' };
  const numbers = normalizeNumbers(link);
  if (numbers.error) return numbers;
  const channel = await findOne('channels', { channel_code: text(link.channel_code) });
  if (!channel) return { error: 'Select a configured channel.' };
  if (!await findOne('skus', { sku_code: text(link.sku_code) })) return { error: 'SKU does not exist in SKU Master.' };
  if (text(link.client_id) && !(await find('partners', { type: 'Client' })).some(row => text(row.client_id || row.code) === text(link.client_id))) return { error: 'Select a configured client.' };
  if ((await find('sku_channel_links')).some(row => row.id !== currentId && text(row.channel_code) === text(link.channel_code) && text(row.channel_sku_code) === text(link.channel_sku_code))) return { error: 'Channel SKU is already linked for this channel.', status: 409 };
  return { channel, numbers: numbers.values };
}
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await find('sku_channel_links', {}, { sort: { id: -1 } }));
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const b = req.body;
      if (!text(b.channelCode) && !text(b.skuCode) && !text(b.channelSkuCode) && !text(b.channelProductId) && !text(b.clientId) && !text(b.channelType)) return res.status(400).json({ error: 'Please select any one filter.' });
      const filtered = (await find('sku_channel_links', {}, { sort: { id: 1 } })).filter((row) => has(row.sku_code, b.skuCode) && has(row.sku_description, b.skuDescription) && has(row.channel_sku_code, b.channelSkuCode) && has(row.channel_code, b.channelCode) && has(row.channel_product_id, b.channelProductId) && has(row.channel_type, b.channelType) && (!text(b.clientId) || row.client_id === text(b.clientId)) && (!text(b.status) || row.status === b.status));
      const size = [20,50,100,200].includes(Number(b.rows)) ? Number(b.rows) : 20; const page = Math.max(1, Number(b.page) || 1); const records = filtered.length; const total = Math.ceil(records / size); const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total, sidx: text(b.sidx), sord: text(b.sord || 'asc') });
    }
    if (req.method === 'POST') {
      const b = req.body;
      const validation = await validateLink(b);
      if (validation.error) return res.status(validation.status || 400).json({ error: validation.error });
      const actor = currentUser(req)?.username || 'unknown';
      const timestamp = new Date().toISOString();
      return res.status(201).json(await insert('sku_channel_links', {
        channel_code: text(b.channel_code), channel_type: text(validation.channel.channel_type),
        sku_code: text(b.sku_code), sku_description: text(b.sku_description),
        channel_sku_code: text(b.channel_sku_code), channel_product_id: text(b.channel_product_id),
        client_id: text(b.client_id), ...validation.numbers, status: text(b.status),
        pick_instruction: text(b.pick_instruction), created_by: actor, created_date: timestamp,
        updated_by: actor, updated_date: timestamp,
      }));
    }
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      const current = await findOne('sku_channel_links', { id: Number(id) });
      if (!current) return res.status(404).json({ error: 'SKU channel link not found.' });
      const next = { ...current, ...fields };
      const validation = await validateLink(next, current.id);
      if (validation.error) return res.status(validation.status || 400).json({ error: validation.error });
      const changed = await update('sku_channel_links', current.id, {
        channel_code: text(next.channel_code), channel_type: text(validation.channel.channel_type),
        sku_code: text(next.sku_code), sku_description: text(next.sku_description),
        channel_sku_code: text(next.channel_sku_code), channel_product_id: text(next.channel_product_id),
        client_id: text(next.client_id), ...validation.numbers, status: text(next.status),
        pick_instruction: text(next.pick_instruction), updated_by: currentUser(req)?.username || 'unknown',
        updated_date: new Date().toISOString(),
      });
      return res.status(200).json(changed[0]);
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('SKU channel links error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}

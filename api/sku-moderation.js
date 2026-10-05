import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { sendDatabaseUnavailable, claimUnmappedSkuLink, cors, find, findOne, insert } from './mongo.js';
import { channelRows } from './catalogs.js';
import { currentUser } from './auth-session.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = (row) => ({
  ...row,
  image: row.image || 'images/no_image.png',
  skuName: row.sku_name || row.sku_description || row.channel_sku_name || '',
  locCode: row.channel || row.channel_name || row.channel_code || '',
  channelCode: row.channel_code || '',
  channelImage: row.channel_image || '',
  channelSkuCode: row.seller_sku || row.channel_sku_code || '',
  eRetailSku: row.eretail_sku || row.sku_code || '',
  channelProductId: row.product_id || row.channel_product_id || '',
  channelPrice: row.pricing ?? row.channel_price ?? '',
  mrp: row.mrp ?? '', size: row.size || '', color: row.color || '',
  actionCode: Number(row.action_code ?? 0),
});
const page = (rows, body) => {
  const size = [50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 50;
  const current = Math.max(1, Number(body.page) || 1), records = rows.length;
  return { gridModel: rows.slice((current - 1) * size, current * size), rows: rows.slice((current - 1) * size, current * size), page: current, records, total: Math.ceil(records / size) };
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET' && req.query?.template === '1') {
      const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('SKU Moderation Link');
      sheet.addRow(['SKU Code', 'Channel SKU Code', 'Product ID', 'Channel']);
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Sku_Mod_Link_Import.xlsx"');
      return res.status(200).send(Buffer.from(buffer));
    }
    if (req.method === 'GET' && req.query?.meta === '1') {
      const channels = (await channelRows()).filter(row => row.channel_code && row.channel_name).map(row => ({ value: String(row.channel_code), label: String(row.channel_name) }));
      return res.status(200).json({ channels, pageSizes: [50, 100, 200], maxImportRows: 5000 });
    }
    if (req.method === 'GET') {
      const query = text(req.query?.q);
      if (query.length <= 2) return res.status(200).json([]);
      const rows = (await find('skus')).filter((row) => has(row.sku_code, query) || has(row.description || row.sku_description || row.name, query)).slice(0, 50);
      return res.status(200).json(rows.map((row) => ({ id: row.id, sku_code: row.sku_code, description: row.description || row.sku_description || row.name || '', image: row.image || 'images/no_image.png' })));
    }
    if (req.method === 'POST' && req.body?.action === 'import') {
      const body = req.body, imported = Array.isArray(body.rows) ? body.rows : [];
      if (!text(body.fileName)) return res.status(400).json({ error: 'No file chosen to import.' });
      if (imported.length > 5000) return res.status(400).json({ error: 'Max 5000 lines are allowed at a time.' });
      if (!imported.length) return res.status(400).json({ error: 'Import file contains no rows.' });
      const [links, skus, configuredChannels] = await Promise.all([find('sku_channel_links'), find('skus'), channelRows()]);
      const results = [];
      for (let index = 0; index < imported.length; index++) {
        const raw = imported[index] && typeof imported[index] === 'object' && !Array.isArray(imported[index]) ? imported[index] : {};
        const skuCode = text(raw['SKU Code'] || raw.skuCode), channelSkuCode = text(raw['Channel SKU Code'] || raw.channelSkuCode), productId = text(raw['Product ID'] || raw.productId), channel = text(raw.Channel || raw.channel);
        let remarks = '';
        if (!skuCode || !skus.some((row) => text(row.sku_code) === skuCode)) remarks = 'Invalid SKU Code';
        else if (!channelSkuCode) remarks = 'Channel SKU Code is mandatory';
        const channelRecord = configuredChannels.find((row) => [text(row.channel_code), text(row.channel_name)].includes(channel));
        if (!remarks && !channelRecord) remarks = 'Invalid Channel';
        const targetChannelAliases = [text(channelRecord?.channel_code), text(channelRecord?.channel_name)].filter(Boolean);
        const matches = !remarks ? links.filter((row) => [text(row.channel_code), text(row.channel), text(row.channel_name)].some((value) => targetChannelAliases.includes(value))
          && text(row.seller_sku || row.channel_sku_code) === channelSkuCode
          && (!productId || text(row.product_id || row.channel_product_id) === productId)) : [];
        if (!remarks && matches.length > 1 && !productId) remarks = 'Product ID is required when the Seller SKU matches multiple listings.';
        const target = matches[0];
        if (!remarks && !target) remarks = 'Unmapped SKU was not found.';
        if (!remarks && text(target.eretail_sku || target.sku_code)) remarks = 'Channel SKU is already linked.';
        if (!remarks && target) {
          const saved = await claimUnmappedSkuLink(target.id, {
            sku_code: skuCode, eretail_sku: skuCode, action_code: 0,
            linked_at: new Date().toISOString(), updated_by: currentUser(req)?.username || 'unknown', updated_date: new Date().toISOString(),
          });
          if (!saved) remarks = 'Channel SKU is already linked.';
          else Object.assign(target, saved);
        }
        results.push({ sq: index + 1, skuCode, channelSkuCode, channelProductId: productId, locCode: channel, remarks, gridSts: remarks ? 1 : 0 });
      }
      const batchId = `SKUMOD${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      await insert('generic_records', { module: 'sku-moderation-import', code: batchId, name: text(body.fileName), batch_id: batchId, results, created_by: currentUser(req)?.username || 'unknown', created_date: new Date().toISOString() });
      return res.status(200).json({ batchIdImport: batchId, importDTO: { dtoList: results, totalItems: results.length, successItems: results.filter((row) => !row.remarks).length, failedItems: results.filter((row) => row.remarks).length, inProcessItems: 0 } });
    }
    if (req.method === 'POST' && Object.prototype.hasOwnProperty.call(req.body || {}, 'REQ_SEARCH_FLAG')) {
      const body = req.body, linked = String(body.linkedUnlinkedFlag) === '1';
      let rows = (await find('sku_channel_links')).map(normalize).filter((row) => linked ? !!text(row.eRetailSku) : !text(row.eRetailSku));
      rows = rows.filter((row) => has(row.locCode, body.locCode) && has(row.skuName, body.skuName) && has(row.channelSkuCode, body.channelSkuCode) && has(row.channelProductId, body.channelProductId));
      rows.sort((a, b) => text(a.skuName).localeCompare(text(b.skuName)) * (text(body.sord) === 'asc' ? 1 : -1));
      return res.status(200).json({ ...page(rows, body), linkedUnlinkedFlag: linked ? 1 : 0, doFetchCount: body.doFetchCount === true });
    }
    if (req.method === 'PUT') {
      const body = req.body || {}, linkedSkuCode = text(body.linkedSkuCode);
      if (!linkedSkuCode) return res.status(400).json({ error: 'Search SKU to link.' });
      if (!await findOne('skus', { sku_code: linkedSkuCode })) return res.status(400).json({ error: 'Selected eRetail SKU does not exist.' });
      const actionCode = body.actionCode == null ? 0 : Number(body.actionCode);
      if (!Number.isInteger(actionCode) || ![0, 1, 2, 3].includes(actionCode)) return res.status(400).json({ error: 'Action code is invalid.' });
      const links = await find('sku_channel_links');
      const channelCode = text(body.chnlCode);
      const target = body.id ? links.find((row) => row.id === Number(body.id)) : links.find((row) => text(row.seller_sku || row.channel_sku_code) === text(body.chnlSkuCode)
        && text(row.product_id || row.channel_product_id) === text(body.channelProductId)
        && (!channelCode || [text(row.channel_code), text(row.channel), text(row.channel_name)].includes(channelCode)));
      if (!target) return res.status(404).json({ error: 'Unmapped SKU was not found.' });
      if (text(target.eretail_sku || target.sku_code)) return res.status(409).json({ error: 'This channel SKU is already linked.' });
      const changed = await claimUnmappedSkuLink(target.id, {
        sku_code: linkedSkuCode, eretail_sku: linkedSkuCode, action_code: actionCode,
        linked_at: new Date().toISOString(), updated_by: currentUser(req)?.username || 'unknown', updated_date: new Date().toISOString(),
      });
      if (!changed) {
        const latest = await findOne('sku_channel_links', { id: target.id });
        return res.status(latest ? 409 : 404).json({ error: latest ? 'This channel SKU is already linked.' : 'Unmapped SKU was not found.' });
      }
      return res.status(200).json({ row: normalize(changed), jsonMessage: null, message: 'Data saved successfully.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('sku moderation error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

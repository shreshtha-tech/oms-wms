import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const parseDate = value => {
  const match = text(value).slice(0, 10).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return date.getUTCDate() === Number(day) && date.getUTCMonth() + 1 === Number(month) ? date : null;
};
const storedDate = value => {
  const displayDate = parseDate(value);
  if (displayDate) return displayDate;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const within = (value, from, to) => {
  const date = storedDate(value);
  return date && date >= from && date < new Date(to.getTime() + 86_400_000);
};
const normalize = row => ({
  ...row,
  skuIntInv: row.skuIntInv || row.sku_code || '',
  channelSku: row.channelSku || row.channel_sku || '',
  channelProductId: row.channelProductId || row.channel_product_id || '',
  channelType: row.channelType || row.channel_type || '',
  locCodeIL: row.locCodeIL || row.channel_code || '',
  brandCode: row.brandCode || row.brand || '',
  invInterface: row.invInterface ?? row.inventory ?? '',
  crtDate: row.crtDate || row.request_date || '',
  date: row.date || row.updated_date || '',
  ilstatus: row.ilstatus || row.status || '',
  errDesc: row.errDesc || row.error_description || '',
  serialKey: row.serialKey || row.code || String(row.id ?? ''),
  requestJson: row.requestJson || row.request_json || '',
  responseJson: row.responseJson || row.response_json || '',
});
const page = (rows, body) => {
  const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
  const current = Math.max(1, Number(body.page) || 1);
  const records = rows.length;
  const gridModel = rows.slice((current - 1) * size, current * size);
  return { gridModel, interfaceLogDTOs: gridModel, rows: size, page: current, records, total: Math.ceil(records / size) };
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const channels = await find('channels', {});
    const logs = (await find('generic_records', { module: 'mp-inventory-log' })).map(normalize);

    if (req.method === 'GET') {
      const channelOptions = channels.map(row => ({ value: String(row.channel_code), label: String(row.channel_name) }));
      const types = [...new Set(channels.map(row => String(row.channel_type)).filter(Boolean))].map(value => ({ value, label: value }));
      const brands = [...new Set(channels.map(row => String(row.brand)).filter(Boolean))].map(value => ({ value, label: value }));
      return res.json({
        channelTypes: types,
        channels: channelOptions,
        brands,
        manualChannelTypes: types,
        manualChannels: channelOptions,
        clients: [['-1', '--- Select ---']],
        statuses: [['', '--- Select ---'], ['0', 'In Process'], ['1', 'success'], ['9', 'Error'], ['10', 'Submitted']],
        pageSizes: [20, 50, 100, 200],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const connectorRequired = new Set(['force-push', 'retransmit', 'manual-push']);
    if (connectorRequired.has(body.action)) {
      return res.status(501).json({ error: 'Marketplace inventory push requires a configured and verified integration.' });
    }
    if (body.action === 'export') {
      return res.status(501).json({ error: 'MP Inventory Log export is unavailable until its report generation service is connected.' });
    }
    if (body.action === 'ingest') {
      return res.status(501).json({ error: 'MP Inventory Log ingestion is unavailable until a verified marketplace feed processor is connected.' });
    }
    if (!body.REQ_SEARCH_FLAG) return res.status(400).json({ error: 'REQ_SEARCH_FLAG is required' });
    const searchType = text(body.searchType || '1');
    if (searchType === '2') return res.status(501).json({ error: 'MP Inventory Log archival data is unavailable until its archive service is connected.' });
    if (searchType !== '1') return res.status(400).json({ error: 'Unsupported MP Inventory Log search type.' });
    if (!text(body.intFace) || text(body.intFace) === '-1') return res.status(400).json({ error: 'interface is mandatory.' });
    if (!text(body.channelType) && !text(body.locCode)) return res.status(400).json({ error: 'Either Channel Type or Channel Code is mandatory' });
    if (!text(body.crtDate)) return res.status(400).json({ error: 'Date is mandatory' });

    const [from, to] = text(body.crtDate).split(' - ').map(parseDate);
    if (!from || !to || to < from) return res.status(400).json({ error: 'Enter a valid Request Date range.' });
    if ((to - from) / 86_400_000 > 90) return res.status(400).json({ error: 'Entered Dispatch date is not in 3 months range' });
    if (!text(body.date)) return res.status(400).json({ error: 'Date is mandatory' });
    const [updatedFrom, updatedTo] = text(body.date).split(' - ').map(parseDate);
    if (!updatedFrom || !updatedTo || updatedTo < updatedFrom) return res.status(400).json({ error: 'Enter a valid Date range.' });
    if ((updatedTo - updatedFrom) / 86_400_000 > 90) return res.status(400).json({ error: 'Entered Date range is not in 3 months range' });

    let rows = logs.filter(row => has(row.skuIntInv, body.sku)
      && has(row.channelSku, body.channelSKU)
      && has(row.channelProductId, body.channelProductId)
      && (!text(body.channelType) || row.channelType === text(body.channelType))
      && (!text(body.locCode) || row.locCodeIL === text(body.locCode))
      && (!text(body.brandCode) || row.brandCode === text(body.brandCode))
      && (!text(body.ilstatus) || row.ilstatus === text(body.ilstatus))
      && within(row.crtDate, from, to)
      && within(row.date, updatedFrom, updatedTo));
    rows.sort((left, right) => text(right.date).localeCompare(text(left.date)));
    return res.json(page(rows, body));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('mp inventory log error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

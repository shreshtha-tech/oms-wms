import { sendDatabaseUnavailable, cors, find } from './mongo.js';
import { clientPairs, locationPairs } from './catalogs.js';
import { listCentralWmsMoveHistory } from '../inventory/wms-operations.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [moves, clients, locations, configuredReasons] = await Promise.all([
        listCentralWmsMoveHistory(), clientPairs(), locationPairs(), find('generic_records', { module: 'inventory-move-reason' }),
      ]);
      const reasons = [...new Set([...moves.map(row => text(row.reason)), ...configuredReasons.map(row => text(row.code))].filter(Boolean))].sort();
      return res.json({ locations, clients,
        reasons: [['-1', '--- Select ---'], ...reasons.map(reason => [reason, reason])],
        pageSizes: [20, 50, 100, 200], source: 'central-inventory' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const unsupported = ['SKUDesc', 'fromZone', 'toZone', 'fromBin', 'toBin', 'userId', 'clientId', 'putawayNo', 'cycleId', 'styleCode', 'usnNo']
      .find(key => text(body[key]) && !(key === 'clientId' && text(body[key]) === '0'));
    if (unsupported) return res.status(501).json({ error: `${unsupported} cannot be filtered from Central Inventory movement events because that mapping is not recorded.` });
    const all = await listCentralWmsMoveHistory(body);
    const rows = all.filter(row => has(row.skuCode, body.skuCode)
      && has(row.SKUDesc, body.SKUDesc)
      && has(row.fromZone, body.fromZone)
      && has(row.toZone, body.toZone)
      && has(row.fromBin, body.fromBin)
      && has(row.toBin, body.toBin)
      && has(row.user, body.userId)
      && has(row.putawayNo, body.putawayNo)
      && has(row.reason, body.reason)
      && has(row.cycleId, body.cycleId)
      && has(row.siteLocationCode, body.siteLocationCode)
      );
    rows.sort((a, b) => text(a.moveDate).localeCompare(text(b.moveDate)) * (body.sord === 'asc' ? 1 : -1));
    const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 20;
    const page = Math.max(1, +body.page || 1);
    const records = rows.length;
    const total = Math.ceil(records / size);
    return res.json({
      rows: rows.slice((page - 1) * size, page * size), page, total, records,
      sidx: body.sidx || 'createdDate', sord: body.sord || 'desc', REQ_SEARCH_FLAG: true,
    });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Inventory Move History error:', { name: error?.name, code: error?.code });
    return res.status(error.statusCode || error.status || (error.code || /database|connection/i.test(error.message || '') ? 503 : 500)).json({ error: error.message || 'Inventory Move History unavailable.' });
  }
}

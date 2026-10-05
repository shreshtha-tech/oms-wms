import { sendDatabaseUnavailable, findOne, update, cors } from './mongo.js';

// Purchase-order tag masters are reference choices; assigned rows remain PO data.
const tagOptions = [
  { value: '11', text: 'gty' }, { value: '12', text: 'Perishable Goods' },
  { value: '13', text: 'air' }, { value: '14', text: 'TESTING' },
  { value: '1', text: 'Fragile Items' }, { value: '2', text: 'PO Tag2' },
  { value: '3', text: 'PO Tag3' }, { value: '4', text: 'PO Tag4' },
  { value: '5', text: 'PO Tag5' }, { value: '6', text: 'po' },
  { value: '7', text: 'PO Tag6' }, { value: '8', text: 'po tag7' },
  { value: '9', text: 'hgjkhl' }, { value: '10', text: 'CCM' },
];

function displayDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(value);
  const item = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${item.day}/${item.month}/${item.year} ${item.hour}:${item.minute} ${String(item.dayPeriod || '').toUpperCase()}`;
}

const normalizeRows = (po) => (Array.isArray(po.tags) ? po.tags : []).map((tag) => {
  if (typeof tag === 'string') {
    const option = tagOptions.find((item) => item.value === tag || item.text === tag);
    return { poTag: option?.value || tag, poTagText: option?.text || tag, poTagStatusText: po.status || '', poTagStatus: '', tagDateText: '', tagDate: '', taggedByText: '', taggedBy: '', actionFlag: '', tagType: 'AT' };
  }
  return tag;
});

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const poCode = String(req.query.poCode || req.body?.poCode || '');
    const po = await findOne('purchase_orders', { po_no: poCode });
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    if (req.method === 'GET') return res.status(200).json({ options: tagOptions, poTagMaintDto: { poTagRowDTOList: normalizeRows(po) } });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const gridData = String(req.body.gridData || '');
    if (!gridData) return res.status(200).json({ options: tagOptions, poTagMaintDto: { poTagRowDTOList: normalizeRows(po) } });
    const values = gridData.split('\u0015');
    let rows = normalizeRows(po);
    for (let index = 0; index < values.length; index += 3) {
      const [poTag, actionFlag] = values.slice(index, index + 3);
      const option = tagOptions.find((item) => item.value === poTag);
      if (!option) return res.status(400).json({ error: 'Invalid PO Tag.' });
      if (actionFlag === 'D') rows = rows.filter((row) => String(row.poTag) !== poTag);
      if (actionFlag === 'A' && !rows.some((row) => String(row.poTag) === poTag)) {
        const now = new Date();
        rows.push({ poTag, poTagText: option.text, poTagStatusText: po.status || '', poTagStatus: String(req.body.statusCode || ''), tagDateText: displayDate(now), tagDate: String(now.getTime()), taggedByText: String(req.body.taggedByText || 'Current User'), taggedBy: String(req.body.taggedBy || 'current-user'), actionFlag: '', tagType: 'AT' });
      }
    }
    await update('purchase_orders', po.id, { tags: rows });
    return res.status(200).json({ jsonMessage: null, poTagMaintDto: { poTagRowDTOList: rows, poTagRowDTOListJSON: JSON.stringify(rows) } });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

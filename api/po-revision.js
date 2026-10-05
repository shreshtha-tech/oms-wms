import { sendDatabaseUnavailable, find, cors } from './mongo.js';

const textMatch = (value, query) => !query || String(value || '').toLowerCase().includes(String(query).toLowerCase());
const dateMatch = (value, query) => !query || String(value || '').slice(0, 10) === String(query).slice(0, 10);

function revisionRows(purchaseOrders) {
  return purchaseOrders.flatMap((po) => {
    const revisions = Array.isArray(po.revisions) ? po.revisions : [];
    if (!revisions.length && !po.po_revision_code) return [];
    const source = revisions.length ? revisions : [{ revision_no: po.revision_no, revision_code: po.po_revision_code, revised_at: po.revision_date }];
    return source.map((revision, index) => ({
      id: Number(po.id) * 1000 + Number(revision.revision_no || index + 1),
      poCode: po.po_no || '', poRevisionCode: revision.revision_code || po.po_revision_code || '', buyerName: po.buyer_name || '',
      poRevisionDate: String(revision.revised_at || po.revision_date || '').slice(0, 10), status: po.status || '', poDate: String(po.po_date || '').slice(0, 10),
      vendorCode: po.vendor_code || '', vendorName: po.vendor_name || po.vendor || '', poType: po.po_type || '', poMode: po.po_mode || po.poMode || '',
      poAmount: Number(revision.after?.amount ?? po.amount ?? 0), deliveryLocation: po.warehouse || po.delivery_location || '', sourceLocation: po.source_location || '',
      poReleaseDate: String(po.release_date || '').slice(0, 10), createdBy: po.created_by || po.createdBy || '', createdDate: po.created_date || po.createdDate || '',
      modifiedBy: po.updated_by || po.updatedBy || '', modifiedDate: po.updated_date || po.updatedDate || '',
    }));
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const rowsPerPage = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
    const requestedPage = Math.max(1, Number(body.page) || 1);
    const direction = String(body.sord).toLowerCase() === 'desc' ? -1 : 1;
    const poTypes = Array.isArray(body.POType) ? body.POType : body.POType ? [body.POType] : [];
    const all = revisionRows(await find('purchase_orders'));
    const filtered = all.filter((row) => textMatch(row.poCode, body['id.POCode'] ?? body.poCode)
      && textMatch(row.poRevisionCode, body['id.PORevCode'] ?? body.poRevisionCode) && dateMatch(row.poRevisionDate, body.poRevisionDate)
      && dateMatch(row.poDate, body.podate ?? body.poDate) && textMatch(row.vendorCode, body.vendorCode)
      && (!poTypes.length || poTypes.includes(row.poType)) && (!body.poMode || row.poMode === body.poMode)
      && textMatch(row.deliveryLocation, body.delLocationCode ?? body.deliveryLocation) && textMatch(row.sourceLocation, body.sourceLocation)
      && dateMatch(row.poReleaseDate, body.POReleasedate ?? body.poReleaseDate)
      && textMatch(row.createdBy, body.createdBy) && dateMatch(row.createdDate, body.createdDate)
      && textMatch(row.modifiedBy, body.updatedBy) && dateMatch(row.modifiedDate, body.updatedDate)
      && (!body.fromPORevisionCode || row.poRevisionCode >= body.fromPORevisionCode) && (!body.toPORevisionCode || row.poRevisionCode <= body.toPORevisionCode)
      && (!body.fromPOCode || row.poCode >= body.fromPOCode) && (!body.toPOCode || row.poCode <= body.toPOCode));
    filtered.sort((a, b) => String(a.poCode).localeCompare(String(b.poCode)) * direction);
    const records = filtered.length;
    const total = records ? Math.ceil(records / rowsPerPage) : 0;
    const page = total ? Math.min(requestedPage, total) : 1;
    const start = (page - 1) * rowsPerPage;
    return res.status(200).json({ rows: filtered.slice(start, start + rowsPerPage), total, page, records });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('PO Revision API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message || 'Unable to search PO revisions' });
  }
}

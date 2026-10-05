import { sendDatabaseUnavailable, cors, find, insert, update } from './mongo.js';
import { locations } from './catalogs.js';
import { currentUser } from './auth-session.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const statusCodes = { Open: '1', Confirmed: '4', 'Part Confirmed': '5', Cancelled: '7', Closed: '13' };
const typeNames = { 1: 'Cancelled Order', 2: 'Selected Inbound', 5: 'Selected Inbound RealTime', 3: 'User defined_Cancelled Order' };

function parseDate(value) {
  const input = text(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return new Date(`${input}T00:00:00.000Z`);
  const match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`) : null;
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}` : text(value);
}

function normalize(row) {
  const status = row.status || 'Open';
  const details = Array.isArray(row.details) ? row.details : [];
  return {
    ...row,
    putAwayId: row.putAwayId || row.putaway_no || row.code || '',
    status,
    hdnStatus: row.hdnStatus || statusCodes[status] || '10',
    createDate: row.createDate || row.created_date || '',
    confirmedDate: row.confirmedDate || row.confirmed_date || '',
    putAwayType: row.putAwayType || row.putaway_type || row.name || 'Selected Inbound RealTime',
    sourceQty: Number(row.sourceQty ?? details.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)),
    toQty: Number(row.toQty ?? row.putaway_qty ?? row.qty ?? 0),
    locCode: row.locCode || row.location_name || '',
    siteLocCode: row.siteLocCode || row.location_code || '',
    inboundNo: row.inboundNo || row.inbound_no || '',
    poNo: row.poNo || row.po_no || '',
    extAsn: row.extAsn || row.asn_no || '',
    remarks: row.remarks || '',
    createdBy: row.createdBy || row.created_by || '',
    modifiedBy: row.modifiedBy || row.modified_by || '',
    modifiedDate: row.modifiedDate || row.modified_date || '',
    details,
  };
}

function nextCode(rows) {
  const next = Math.max(0, ...rows.map((row) => Number(text(normalize(row).putAwayId).replace(/\D/g, '')) || 0)) + 1;
  return `PA${String(next).padStart(9, '0')}`;
}

function dateRange(value, fromValue, toValue) {
  const parts = text(value).split(' - ');
  const from = parseDate(fromValue || parts[0]);
  const to = parseDate(toValue || parts[1] || parts[0]);
  return { from, to };
}

function inDateRange(value, range) {
  const date = parseDate(value);
  return !range.from || !range.to || Boolean(date && date >= range.from && date <= range.to);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const rows = (await find('generic_records', { module: 'putaway' })).map(normalize);
      const putAwayNo = text(req.query?.putAwayNo);
      const configuredLocations = await locations();
      if (putAwayNo) {
        const row = rows.find((item) => item.putAwayId === putAwayNo);
        return row ? res.json({ row }) : res.status(404).json({ error: 'PutAway was not found.' });
      }
      return res.json({
        statuses: [['-1', '--- Select ---'], ['7', 'Cancelled'], ['13', 'Closed'], ['4', 'Confirmed'], ['1', 'Open'], ['5', 'Part Confirmed'], ['10', 'Undefined']],
        types: [['-1', '--- Select ---'], ['1', 'Cancelled Order'], ['2', 'Selected Inbound'], ['5', 'Selected Inbound RealTime'], ['3', 'User defined_Cancelled Order']],
        locations: configuredLocations.map((row) => [row.code, `${row.code}-${row.name}`]),
        pageSizes: [20, 50, 100, 200],
        maxDateRangeDays: 90,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const rows = (await find('generic_records', { module: 'putaway' })).map(normalize);

    if (body.action === 'export' || body.action === 'detail-export') {
      return res.status(501).json({ error: 'PutAway export is unavailable until a report worker can produce the requested report from verified PutAway records.' });
    }

    if (body.action === 'create') {
      const requestedType = text(body.type);
      const inboundNo = text(body.inboundNo);
      if (requestedType === '-1' || !requestedType) return res.status(400).json({ error: 'Putaway Type is mandatory' });
      if (!['2', '5'].includes(requestedType)) return res.status(501).json({ error: 'This PutAway type requires a configured source workflow.' });
      if (!inboundNo) return res.status(400).json({ error: 'Select atleast one inbound for putaway' });
      if (requestedType === '5' && !['1', '2'].includes(text(body.mode))) return res.status(400).json({ error: 'Putaway Mode is Mandatory' });
      if (requestedType === '5' && text(body.mode) === '2') return res.status(501).json({ error: 'System Suggested PutAway is unavailable until a bin allocation executor is connected.' });
      if (requestedType === '2' && (!Array.isArray(body.qcstatus) || !body.qcstatus.length)) return res.status(400).json({ error: 'QC Status is Mandatory' });

      const inbound = (await find('grn')).find((row) => [row.inbound_no, row.grn_no].includes(inboundNo));
      if (!inbound) return res.status(404).json({ error: 'Inbound record not found' });
      if (inbound.status !== 'Confirmed') return res.status(409).json({ error: 'Only a confirmed inbound can generate PutAway' });
      if (inbound.central_receipt_status !== 'committed' || !Array.isArray(inbound.central_receipt_event_ids) || inbound.central_receipt_event_ids.length === 0) {
        return res.status(409).json({ error: 'Inbound does not have a committed Central Inventory receipt.' });
      }
      if (rows.some((row) => row.inboundNo === inboundNo && row.status !== 'Cancelled')) return res.status(409).json({ error: 'PutAway already exists for this inbound' });
      const configuredLocations = await locations();
      const site = configuredLocations.find((row) => [row.code, row.name].includes(text(inbound.warehouse)));
      if (!site) return res.status(400).json({ error: 'Inbound site location is not configured' });
      const details = (inbound.lines || []).map((line, index) => ({
        skuCode: text(line.skuCode || line.sku_code), skuName: text(line.skuName || line.sku_name), inboundNo,
        lineNo: index + 1, lpn: text(line.idCode || line.lpn), lot: text(line.lottable05 || line.lot),
        fromBin: text(line.binLoc || line.bin), suggestedBin: '',
        qty: Number(line.rcvdUOMQty ?? line.rcvdQty ?? line.received_qty ?? 0), putawayQty: 0,
      })).filter((line) => line.skuCode && Number.isFinite(line.qty) && line.qty > 0);
      if (!details.length) return res.status(400).json({ error: 'Inbound has no received SKU quantity for PutAway' });

      const type = requestedType === '2' ? 'Selected Inbound' : 'Selected Inbound RealTime';
      const putAwayId = nextCode(rows);
      const timestamp = new Date().toISOString();
      const actor = currentUser(req)?.username || 'unknown';
      const quantity = details.reduce((sum, line) => sum + line.qty, 0);
      const row = await insert('generic_records', {
        module: 'putaway', code: putAwayId, putAwayId, status: 'Open', putAwayType: type, putaway_type: type,
        inboundNo, inbound_no: inboundNo, poNo: text(inbound.po_no), po_no: text(inbound.po_no),
        extAsn: text(inbound.asn_no), asn_no: text(inbound.asn_no), remarks: text(body.remarks),
        sourceQty: quantity, toQty: 0, putaway_qty: 0, locCode: site.name, siteLocCode: site.code,
        created_date: timestamp, createdBy: actor, created_by: actor, details,
      });
      return res.status(201).json({ row: normalize(row) });
    }

    if (['save', 'confirm', 'cancel'].includes(body.action)) {
      const row = rows.find((item) => item.putAwayId === text(body.putAwayId));
      if (!row) return res.status(404).json({ error: 'PutAway not found' });
      if (body.action === 'confirm') return res.status(501).json({ error: 'PutAway confirmation is unavailable until bin placement and Central Inventory movement are connected.' });
      if (row.status !== 'Open') return res.status(409).json({ error: 'Only an open PutAway draft can be changed.' });
      const actor = currentUser(req)?.username || 'unknown';
      const fields = {
        modifiedBy: actor, modified_by: actor, modifiedDate: new Date().toISOString(), modified_date: new Date().toISOString(),
      };
      if (body.action === 'cancel') fields.status = 'Cancelled';
      if (body.action === 'save') fields.remarks = text(body.remarks);
      const [changed] = await update('generic_records', row.id, fields);
      return res.json({ row: normalize(changed) });
    }

    if (!body.REQ_SEARCH_FLAG) return res.status(400).json({ error: 'REQ_SEARCH_FLAG is required' });
    const unsupportedFilters = ['orderNo', 'toBin', 'toZone', 'obCode', 'toLpn'];
    if (unsupportedFilters.some((key) => text(body[key]))) return res.status(501).json({ error: 'One or more selected PutAway filters require bin placement or order mappings that are not connected.' });
    if (!text(body.CreatedDate) && !text(body.putAwayNo)) return res.status(400).json({ error: 'common.putAwayDateValid.message04' });
    const createdRange = dateRange(body.CreatedDate, body.fromCreatedDate, body.toCreatedDate);
    if (text(body.CreatedDate) && (!createdRange.from || !createdRange.to)) return res.status(400).json({ error: 'PutAway Created Date is invalid.' });
    if (createdRange.from && createdRange.to && (createdRange.to - createdRange.from) / 86400000 > 90) return res.status(400).json({ error: 'PutAwayDate range can not be greater than 90 days' });
    const confirmedRange = text(body.confirmedDate) ? dateRange(body.confirmedDate) : null;
    if (confirmedRange && (!confirmedRange.from || !confirmedRange.to)) return res.status(400).json({ error: 'PutAway Confirmed Date is invalid.' });
    const locationsFilter = text(body.locationCode).split('|').filter(Boolean);
    let filtered = rows.filter((row) => has(row.putAwayId, body.putAwayNo)
      && has(row.inboundNo, body.inboundNo)
      && has(row.poNo, body.poNo)
      && has(row.extAsn, body.extAsn)
      && (!text(body.status) || text(body.status) === '-1' || row.hdnStatus === text(body.status))
      && (!text(body.putAwayType) || text(body.putAwayType) === '-1' || row.putAwayType === typeNames[text(body.putAwayType)])
      && (!locationsFilter.length || locationsFilter.includes(row.siteLocCode))
      && (!text(body.sku) || row.details.some((line) => has(line.skuCode, body.sku)))
      && (!text(body.fromBin) || row.details.some((line) => has(line.fromBin, body.fromBin)))
      && (!text(body.fromLpn) || row.details.some((line) => has(line.lpn, body.fromLpn)))
      && (!text(body.CreatedDate) || inDateRange(row.createDate, createdRange))
      && (!confirmedRange || inDateRange(row.confirmedDate, confirmedRange)));
    filtered.sort((a, b) => text(b.putAwayId).localeCompare(text(a.putAwayId)));
    const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
    const page = Math.max(1, Number(body.page) || 1);
    const records = filtered.length;
    const gridModel = filtered.slice((page - 1) * size, page * size).map((row) => ({
      ...row, createDate: formatDate(row.createDate), confirmedDate: formatDate(row.confirmedDate),
    }));
    return res.json({ gridModel, putAwayList: gridModel, rows: size, page, records, total: Math.ceil(records / size) });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('PutAway Enquiry error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

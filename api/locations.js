import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
const MODULE = 'location';
const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const list = async () => (await find('generic_records', { module: MODULE })).map((row) => ({ ...row, location_code: row.location_code || row.code, location_name: row.location_name || row.name, location_short_name: row.location_short_name || row.shortname || '', location_type: row.location_type || row.loc_type || '', source_warehouse: row.source_warehouse || '', hierarchy_code: row.hierarchy_code || '', hierarchy_type: row.hierarchy_type || '', location_tags: row.location_tags || [] }));
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') { const rows = await list(); const hierarchy = await find('generic_records', { module: 'org-hierarchy' }); return res.status(200).json({ rows, hierarchy, locationTypes: ['Franchise', 'Head Office', 'Store', 'WH'], hierarchyTypes: ['Company', 'Region', 'Zone', 'SubZone'], statuses: ['Active', 'Deleted', 'InActive'], locationTags: [...new Set(rows.flatMap((row) => row.location_tags))] }); }
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const b = req.body; let filtered = (await list()).filter((row) => has(row.location_code, b.locationCode) && has(row.location_name, b.locationName) && has(row.location_short_name, b.locationShortName) && has(row.location_type, b.locationType) && has(row.source_warehouse, b.sourceWarehouse) && has(row.hierarchy_code, b.hierarchyCode) && has(row.hierarchy_type, b.hierarchyType) && has(row.status, b.status) && (!text(b.locationTag) || row.location_tags.some((tag) => text(b.locationTag).split(',').includes(tag))));
      filtered.sort((a, c) => text(a.location_code).localeCompare(text(c.location_code)) * (text(b.sord) === 'asc' ? 1 : -1));
      const size = [15, 20, 25, 50, 200].includes(Number(b.rows)) ? Number(b.rows) : 20, page = Math.max(1, Number(b.page) || 1), records = filtered.length, total = Math.ceil(records / size), gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const b = req.body, code = text(b.location_code || b.code).toUpperCase(), name = text(b.location_name || b.name);
      if (!code || !name || !text(b.location_short_name) || !text(b.location_type)) return res.status(400).json({ error: 'Location Code, Location Name, Short Name and Location Type are mandatory.' });
      const rows = await list(), current = req.method === 'PUT' ? await findOne('generic_records', { id: Number(b.id) }) : null;
      if (req.method === 'PUT' && (!current || current.module !== MODULE)) return res.status(404).json({ error: 'Location not found' });
      if (rows.some((row) => row.id !== current?.id && row.location_code.toUpperCase() === code)) return res.status(409).json({ error: 'Location Code already exists.' });
      const extras = ['vendor_name','customer_name','po_code','vat_no','cst_no','tin_no','tax_zone','external_location','sku_link_location','brand','ars_enabled','e_waybill_manifest','live_date','identification_type','identification_code','invoice_report','price_zone','pan_no','license_no','back_order_enabled','sell_to_ecommerce','store_planning','order_capacity','distributor_location','apob_gstin','warehouse_process_time','address1','address2','address3','address4','latitude','longitude','phone1','phone2','email1','email2','geo_code_type','geo_code_address','contact_title','first_name','middle_name','last_name','contact_email','fax','contact_phone1','contact_phone2','designation','primary_contact','ars_fulfillment_method','ars_fulfillment_wh','wh_lead_time','max_sku_qty_status','mow_value','return_location','dto_location'];
      const doc = { module: MODULE, code, name, description: text(b.description), status: text(b.status) || 'Active', location_code: code, location_name: name, location_short_name: text(b.location_short_name), location_type: text(b.location_type), source_warehouse: text(b.source_warehouse), hierarchy_code: text(b.hierarchy_code), hierarchy_type: text(b.hierarchy_type), location_tags: Array.isArray(b.location_tags) ? b.location_tags : [], city: text(b.city), state: text(b.state), country: text(b.country), address: text(b.address), pincode: text(b.pincode), gstin: text(b.gstin), udf: Array.isArray(b.udf) ? b.udf.slice(0, 10) : [], operating_hours: Array.isArray(b.operating_hours) ? b.operating_hours : [], holidays: Array.isArray(b.holidays) ? b.holidays : [], ...Object.fromEntries(extras.map((key) => [key, b[key] ?? ''])) };
      if (req.method === 'POST') return res.status(201).json(await insert('generic_records', { ...doc, created_date: new Date().toISOString().slice(0, 10) }));
      return res.status(200).json((await update('generic_records', current.id, doc))[0]);
    }
    if (req.method === 'DELETE') return res.status(409).json({ error: 'Locations are maintained by status; deletion is not available.' });
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('locations error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}

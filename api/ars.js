import { sendDatabaseUnavailable, find, findOne, insert, update, remove, cors, actor } from './mongo.js';
import { activeLocations } from './catalogs.js';

const collections = { links: 'ars_sku_links', rules: 'ars_rules', logs: 'ars_execution_logs', settings: 'ars_settings' };
const text = (value) => String(value ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);
const ruleFrequencyLabels = { 6: 'Never', 2: 'Bimonthly', 1: 'Monthly', 4: 'Biweekly', 3: 'Weekly', 5: 'Daily' };

function validateLink(body) {
  if (!text(body.sku_code) || !text(body.location) || !text(body.ars_flag)) return 'SKU, Location and ARS Flag are required.';
  const nonNegative = (value, label) => {
    if (text(value) === '') return '';
    return Number.isFinite(Number(value)) && Number(value) >= 0 ? '' : `${label} must be a finite number zero or greater.`;
  };
  for (const [value, label] of [[body.wh_lead_time, 'WH Lead Time'], [body.stock_cover_days, 'Stock Cover Days'], [body.maximum_order_qty, 'Maximum SKU Qty']]) {
    const error = nonNegative(value, label); if (error) return error;
  }
  return '';
}

function validateRule(body) {
  const locations = Array.isArray(body.locations) ? body.locations.filter(Boolean) : (text(body.location) ? [body.location] : []);
  if (!locations.length) return 'Please Enter Location.';
  if (!text(body.ars_method)) return 'Please Enter ARS Method.';
  if (body.ars_method === 'Min-Max') {
    if (!text(body.minimum_qty) || !text(body.maximum_qty)) return 'Please Enter Min And Max values.';
    if (!Number.isFinite(Number(body.minimum_qty)) || !Number.isFinite(Number(body.maximum_qty)) || Number(body.minimum_qty) < 0 || Number(body.maximum_qty) <= Number(body.minimum_qty)) return 'Maximum Quantity must be greater than Minimum Quantity.';
  }
  if (body.ars_method === 'Sales History' && !text(body.ros_period)) return 'Please Enter ROS.';
  if (!Array.isArray(body.sku_sets) || !body.sku_sets.length) return 'Please Add atleast one SKU Set';
  if (!text(body.description)) return 'Please Enter Rule Description.';
  if (!text(body.vendor_type)) return 'Please Enter Vendor Type.';
  if (!text(body.output_type)) return 'Please Enter Output Type.';
  if (!text(body.status)) return 'Please Enter Status.';
  if (!text(body.start_date)) return 'Please Enter Start Date.';
  return '';
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const endpoint = text(req.path).split('/').pop();
    const liveLinkEndpoint = ['fetchArsAttributes', 'addAndUpdateArsAttributes', 'bulkUpdateArsAttributes', 'downloadArsAttribute'].includes(endpoint);
    const entity = text(req.query.entity || req.body?.entity || (liveLinkEndpoint ? 'links' : ''));
    const collection = collections[entity];
    if (!collection) return res.status(400).json({ error: 'Unknown ARS entity.' });
    if (req.method === 'GET') return res.status(200).json(await find(collection, {}, { sort: { id: entity === 'settings' ? 1 : -1 } }));

    if (req.method === 'POST' && endpoint === 'downloadArsAttribute') {
      return res.status(501).json({ error: 'ARS full export requires a real export processor. Use Download visible rows for the displayed search page.' });
    }

    if (req.method === 'POST' && entity === 'links' && endpoint !== 'bulkUpdateArsAttributes' && (req.body?.REQ_SEARCH_FLAG || endpoint === 'fetchArsAttributes')) {
      const body = req.body; const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
      const selectedLocations = text(body.location).split('\u0017').filter(Boolean);
      const locationMaster = await find('generic_records', { module: 'location' });
      const locationMatches = selectedLocations.flatMap((value) => {
        const match = locationMaster.find((row) => [row.id, row.code, row.location_code, row.name, row.location_name].some((candidate) => text(candidate) === text(value)));
        return match ? [value, match.code, match.location_code, match.name, match.location_name].map(text).filter(Boolean) : [value];
      });
      const filtered = (await find(collection)).filter((row) => (!locationMatches.length || locationMatches.some((value) => has(row.location, value) || has(row.location_id, value)))
        && has(row.location_type, body.locationTypeId) && has(row.sku_code, body.skuCode || body.sku)
        && has(row.sku_name, body.skuName) && has(row.category, body.category) && has(row.brand, body.brand)
        && has(row.primary_vendor, body.primaryVendor) && has(row.fulfilment_method, body.fullFillmentMethod)
        && has(row.fulfilment_wh, body.fullFillmentWH || body.fullFillmentWh) && has(row.wh_lead_time, body.whLeadTime || body.fullfillmentWhLeadTime)
        && has(row.stock_cover_days, body.stockCoverDays)
        && (!text(body.arsFlag) || text(row.ars_flag).toLowerCase() === (text(body.arsFlag) === '1' ? 'active' : text(body.arsFlag) === '0' ? 'inactive' : text(body.arsFlag).toLowerCase()))
        && has(row.sku_location_tag, body.skuLocationTag) && has(row.udf1, body.udf1) && has(row.udf2, body.udf2));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1); const records = filtered.length; const total = Math.ceil(records / size);
      const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }

    if (req.method === 'POST' && endpoint === 'addAndUpdateArsAttributes') {
      const body = req.body || {};
      if (!text(body.skuCode)) return res.status(400).json({ error: 'SkuCode is mandatory' });
      if (body.id && !text(body.transferUnitFactor)) return res.status(400).json({ error: 'Transfer Unit Factor is mandatory' });
      if (body.id && !text(body.minimumTransferQty)) return res.status(400).json({ error: 'Minimum Transfer Qty is mandatory' });
      for (const [value, label, required, minimum] of [
        [body.whLeadTime, 'WH Lead Time', false, 0], [body.stockCoverDays, 'Stock Cover Days', false, 0],
        [body.minimumTransferQty, 'Minimum Transfer Qty', Boolean(body.id), 1],
        [body.transferUnitFactor, 'Transfer Unit Factor', Boolean(body.id), 1],
        [body.maximumOrderQty, 'Maximum SKU Qty', false, 0],
      ]) {
        if (!required && text(value) === '') continue;
        if (!Number.isFinite(Number(value)) || Number(value) < minimum) {
          return res.status(400).json({ error: `${label} must be a finite number ${minimum === 0 ? 'zero or greater' : `at least ${minimum}`}.` });
        }
      }
      if (!text(body.location) || text(body.location) === '-1') return res.status(400).json({ error: 'Location is mandatory' });
      const configuredLocations = await activeLocations();
      const location = configuredLocations.find((row) => row.name === text(body.location) || row.code === text(body.location));
      if (!location) return res.status(400).json({ error: 'Select a configured active location.' });
      const fulfilmentValue = text(body.fullFillMentWH);
      const fulfilmentWarehouse = fulfilmentValue ? configuredLocations.find((row) => row.name === fulfilmentValue || row.code === fulfilmentValue) : null;
      if (fulfilmentValue && !fulfilmentWarehouse) return res.status(400).json({ error: 'Select a configured active fulfillment location.' });
      if (!['0', '1'].includes(text(body.arsFlag))) return res.status(400).json({ error: 'ArsFlag must be Active or InActive.' });
      if (text(body.isCICO) === '1' && !text(body.caseSize)) return res.status(400).json({ error: 'Case Size is Mandatory.' });
      if (text(body.caseSize) && (!Number.isInteger(Number(body.caseSize)) || Number(body.caseSize) <= 0)) return res.status(400).json({ error: 'Case Size must be positive integer.' });
      const currentActor = actor(req);
      const fields = {
        sku_code: text(body.skuCode), location: text(body.location), fulfilment_method: text(body.fullFillMentMethod),
        fulfilment_wh: text(body.fullFillMentWH), wh_lead_time: Number(body.whLeadTime || 0), primary_vendor: text(body.primaryVendor),
        stock_cover_days: Number(body.stockCoverDays || 0), minimum_transfer_qty: Number(body.minimumTransferQty || 1),
        transfer_unit_factor: Number(body.transferUnitFactor || 1), ars_flag: text(body.arsFlag) === '1' ? 'Active' : text(body.arsFlag) === '0' ? 'Inactive' : text(body.arsFlag),
        maximum_order_qty: Number(body.maximumOrderQty || 0), sku_location_tag: text(body.skuLocationTag), is_cico: text(body.isCICO) === '1',
        case_size: text(body.caseSize), updated_date: today(), updated_by: currentActor,
      };
      const sku = await findOne('skus', { sku_code: fields.sku_code });
      if (!sku) return res.status(400).json({ error: 'SKU does not exist in SKU Master.' });
      Object.assign(fields, { sku_name: sku.name, category: sku.category, brand: sku.brand,
        location_id: location.code, location: location.name,
        location_type: location.type, fulfilment_wh_id: fulfilmentWarehouse?.code || '',
        fulfilment_wh: fulfilmentWarehouse?.name || '' });
      if (body.id) {
        const duplicate = (await find(collection)).find((row) => Number(row.id) !== Number(body.id)
          && row.sku_code === fields.sku_code
          && (row.location_id === location.code || row.location === location.name || row.location === location.code));
        if (duplicate) return res.status(409).json({ error: 'This SKU and Location are already linked.' });
        const changed = await update(collection, Number(body.id), fields);
        if (!changed.length) return res.status(404).json({ error: 'ARS record not found.' });
        return res.status(200).json({ jsonMessage: null, skuLocLinkDTO: changed[0] });
      }
      const duplicate = (await find(collection)).find((row) => row.sku_code === fields.sku_code
        && (row.location_id === location.code || row.location === location.name || row.location === location.code));
      if (duplicate) return res.status(409).json({ error: 'This SKU and Location are already linked.' });
      const row = await insert(collection, { ...fields, created_date: today(), created_by: currentActor });
      return res.status(200).json({ jsonMessage: null, skuLocLinkDTO: row });
    }

    if (req.method === 'POST' && endpoint === 'bulkUpdateArsAttributes') {
      const body = req.body || {};
      if (!text(body.locationType_bulk) || text(body.locationType_bulk) === '-1') return res.status(400).json({ error: 'Location Type is mandatory' });
      const checked = [body.arsCheckBox, body.stockCoverDaysCheckBox, body.primaryVendorCheckBox, body.fullfillmentMethodCheckBox,
        body.fullfillmentWHCheckBox, body.fullfillmentWhLeadTimeCheckBox, body.minimumTransferQtyCheckBox,
        body.transferUnitFactorCheckBox, body.maximumOrderQtyCheckBox, body.skuLocationTagCheckBox, body.caseSizeCheckBox, body.isCICOCheckBox]
        .some((value) => value === true || text(value) === 'true');
      if (!checked) return res.status(400).json({ error: 'Select at least one attribute to update' });
      for (const [check, value, label, minimum] of [
        [body.stockCoverDaysCheckBox, body.stockCoverDays_bulk, 'Stock Cover Days', 0],
        [body.fullfillmentWhLeadTimeCheckBox, body.whLeadTime_bulk, 'WH Lead Time', 0],
        [body.minimumTransferQtyCheckBox, body.minimumTransferQty_bulk, 'Minimum Transfer Qty', 1],
        [body.transferUnitFactorCheckBox, body.transferUnitFactor_bulk, 'Transfer Unit Factor', 1],
        [body.maximumOrderQtyCheckBox, body.maximumOrderQty_bulk, 'Maximum SKU Qty', 0],
      ]) {
        if (!(check === true || text(check) === 'true')) continue;
        if (!Number.isFinite(Number(value)) || Number(value) < minimum) return res.status(400).json({ error: `${label} must be a finite number ${minimum === 0 ? 'zero or greater' : `at least ${minimum}`}.` });
      }
      const match = (row, key, value) => {
        if (!text(value) || text(value) === '-1') return true;
        if (key === 'location_type') {
          const types = { 2: ['wh', 'warehouse'], 3: ['store'], 6: ['franchise'] };
          return (types[text(value)] || [text(value).toLowerCase()]).includes(text(row[key]).toLowerCase());
        }
        return text(row[key]).toLowerCase().includes(text(value).toLowerCase());
      };
      const candidates = (await find(collection)).filter((row) => match(row, 'location_type', body.locationType_bulk)
        && match(row, 'location', body.location_bulk) && match(row, 'category', body.categoryCode)
        && match(row, 'sku_group', body.skuGroup_bulk) && match(row, 'primary_vendor', body.vendorCode)
        && match(row, 'brand', body.brand_bulk) && match(row, 'sku_code', body.sku_bulk));
      const fields = {};
      const use = (check, key, value) => { if (check === true || text(check) === 'true') fields[key] = value; };
      use(body.arsCheckBox, 'ars_flag', text(body.arsFlag_bulk) === '1' ? 'Active' : text(body.arsFlag_bulk) === '0' ? 'Inactive' : text(body.arsFlag_bulk));
      use(body.stockCoverDaysCheckBox, 'stock_cover_days', Number(body.stockCoverDays_bulk || 0));
      use(body.primaryVendorCheckBox, 'primary_vendor', text(body.primaryVendor_bulk));
      use(body.fullfillmentMethodCheckBox, 'fulfilment_method', text(body.fullfillmentMethod_bulk));
      use(body.fullfillmentWHCheckBox, 'fulfilment_wh', text(body.fullfillmentWH_bulk));
      use(body.fullfillmentWhLeadTimeCheckBox, 'wh_lead_time', Number(body.whLeadTime_bulk || 0));
      use(body.minimumTransferQtyCheckBox, 'minimum_transfer_qty', Number(body.minimumTransferQty_bulk || 1));
      use(body.transferUnitFactorCheckBox, 'transfer_unit_factor', Number(body.transferUnitFactor_bulk || 1));
      use(body.maximumOrderQtyCheckBox, 'maximum_order_qty', Number(body.maximumOrderQty_bulk || 0));
      use(body.skuLocationTagCheckBox, 'sku_location_tag', text(body.skuLocationTag_bulk));
      use(body.caseSizeCheckBox, 'case_size', text(body.caseSize_bulk));
      use(body.isCICOCheckBox, 'is_cico', body.isCICO_ValueCB === true || text(body.isCICO_ValueCB) === 'true');
      const changed = candidates.length ? await update(collection, candidates.map((row) => row.id), { ...fields, updated_date: today(), updated_by: actor(req) }) : [];
      return res.status(200).json({ skuLocLinkDTO: { updatedRowCount: changed.length }, jsonMessage: null });
    }

    if (req.method === 'POST' && entity === 'rules' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
      const filtered = (await find(collection)).filter((row) => {
        const locations = Array.isArray(row.locations) ? row.locations : [row.location].filter(Boolean);
        const productSets = Array.isArray(row.sku_sets) ? row.sku_sets.map((set) => set.type) : [];
        return (!text(body.location) || locations.some((value) => has(value, body.location)))
          && (!text(body.productSet) || productSets.some((value) => has(value, body.productSet)))
          && has(row.rule_id, body.arsRuleId) && has(row.description, body.desc)
          && (!text(body.status) || text(row.status).toLowerCase() === text(body.status).toLowerCase())
          && has(row.status_code, body.statusCode) && has(row.ars_method, body.arsMethod)
          && (!text(body.frequency) || has(ruleFrequencyLabels[row.frequency] || row.frequency, body.frequency))
          && has(row.last_run_date, body.lastARSRunDate) && has(row.next_run_date, body.nextARSRunDate)
          && has(row.updated_date, body.modifiedDateText);
      });
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1); const records = filtered.length; const total = Math.ceil(records / size);
      const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }

    if (req.method === 'POST' && entity === 'logs' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body; const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
      const rules = await find('ars_rules');
      const filtered = (await find(collection)).map((row) => {
        const rule = rules.find((item) => text(item.rule_id) === text(row.rule_id)) || {};
        return { ...row, arsExecId: row.execution_id, execTime: row.started_at, ruleDesc: row.description || rule.description, frequencyDesc: row.frequency_desc || rule.frequency_desc || ruleFrequencyLabels[rule.frequency] || '', vendorTypeDesc: row.vendor_type || rule.vendor_type || '', outPutTypeDesc: row.output_type || rule.output_type || '', statusDesc: row.status };
      }).filter((row) => has(row.location, body.location) && has(row.arsExecId, body.arsExecId) && has(row.execTime, body.execTime)
        && has(row.rule_id, body.ruleId) && has(row.ruleDesc, body.ruleDesc) && has(row.frequencyDesc, body.frequency)
        && has(row.vendorTypeDesc, body.vendorType) && has(row.outPutTypeDesc, body.outputType) && has(row.statusDesc, body.status));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1); const records = filtered.length; const total = Math.ceil(records / size);
      const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }

    if (req.method === 'POST' && entity === 'logs' && ['approve-all', 'process-all'].includes(req.body?.action)) {
      return res.status(501).json({ error: 'ARS execution approval and processing require a durable approval workflow and an idempotent purchase-order job.' });
    }

    if (req.method === 'POST' && entity === 'links') {
      if (req.body.action === 'import') {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length || rows.length > 2000) return res.status(400).json({ error: 'Import must contain between 1 and 2000 rows.' });
        const configuredLocations = await activeLocations();
        const results = [];
        for (const row of rows) {
          const error = validateLink(row); if (error) return res.status(400).json({ error: `${row.sku_code || 'Row'}: ${error}` });
          if (!configuredLocations.some((location) => [location.code, location.name].includes(text(row.location)))) return res.status(400).json({ error: `${row.sku_code || 'Row'}: Select a configured active location.` });
          results.push(await insert(collection, { ...row, wh_lead_time: Number(row.wh_lead_time || 0), stock_cover_days: Number(row.stock_cover_days || 0), created_by: actor(req), created_date: today(), updated_by: actor(req), updated_date: today() }));
        }
        return res.status(201).json(results);
      }
      const error = validateLink(req.body); if (error) return res.status(400).json({ error });
      if (!(await activeLocations()).some((location) => [location.code, location.name].includes(text(req.body.location)))) return res.status(400).json({ error: 'Select a configured active location.' });
      const sku = await findOne('skus', { sku_code: text(req.body.sku_code) });
      if (!sku) return res.status(400).json({ error: 'SKU does not exist in SKU Master.' });
      const duplicate = (await find(collection)).find((row) => row.sku_code === req.body.sku_code && row.location === req.body.location);
      if (duplicate) return res.status(409).json({ error: 'This SKU and Location are already linked.' });
      const { entity: _entity, action: _action, ...linkFields } = req.body;
      return res.status(201).json(await insert(collection, { ...linkFields, sku_name: sku.name, category: sku.category, brand: sku.brand, wh_lead_time: Number(req.body.wh_lead_time || 0), stock_cover_days: Number(req.body.stock_cover_days || 0), created_by: actor(req), created_date: today(), updated_by: actor(req), updated_date: today() }));
    }

    if (req.method === 'POST' && entity === 'rules') {
      const error = validateRule(req.body); if (error) return res.status(400).json({ error });
      const configuredLocations = await activeLocations();
      const requestedLocations = Array.isArray(req.body.locations) && req.body.locations.length ? req.body.locations : [req.body.location].filter(Boolean);
      if (requestedLocations.some((value) => !configuredLocations.some((location) => [location.code, location.name].includes(text(value))))) return res.status(400).json({ error: 'Select only configured active locations.' });
      const rows = await find(collection); const rule_id = String(Math.max(1000, ...rows.map((row) => Number(row.rule_id) || 0)) + 1);
      const { entity: _entity, action: _action, ...ruleFields } = req.body;
      const locations = Array.isArray(req.body.locations) && req.body.locations.length ? req.body.locations : [req.body.location].filter(Boolean);
      return res.status(201).json(await insert(collection, { ...ruleFields, locations, location: locations[0] || '', rule_id, minimum_qty: Number(req.body.minimum_qty || 0), maximum_qty: Number(req.body.maximum_qty || 0), frequency: Number(req.body.frequency), status: req.body.status || 'Pending', last_run_date: '', next_run_date: '', created_by: actor(req), updated_by: actor(req), created_date: today(), updated_date: today() }));
    }

    if (req.method === 'PUT' && entity === 'settings') {
      const enabled = Array.isArray(req.body.custom_period_enabled) ? req.body.custom_period_enabled : [false, false, false];
      const periods = Array.isArray(req.body.custom_periods) ? req.body.custom_periods : ['', '', ''];
      for (let index = 0; index < 3; index += 1) {
        if (enabled[index] && !text(periods[index])) return res.status(400).json({ error: 'Please Enter Days in Textbox to Make it Active.' });
        if (text(periods[index]) && (!/^\d+$/.test(text(periods[index])) || Number(periods[index]) < 2 || Number(periods[index]) > 365)) return res.status(400).json({ error: 'Please Enter Days between 2 and 365' });
      }
      const activeRos = [req.body.ros_lifetime, req.body.ros_12_weeks, req.body.ros_6_weeks, req.body.ros_1_month, req.body.ros_2_weeks, ...enabled].filter(Boolean).length;
      if (req.body.enable_ars && activeRos < 2) return res.status(400).json({ error: 'Minimum 2 ROS Calculation parameters should be Active' });
      const current = (await find(collection))[0];
      const payload = { ...req.body, updated_date: today(), updated_by: actor(req) }; delete payload.entity;
      const rows = current ? await update(collection, current.id, payload) : [await insert(collection, payload)];
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'PUT' && entity === 'links' && req.body.action === 'bulk-update') {
      const all = await find(collection); const f = req.body.filters || {}; const fields = req.body.fields || {};
      const ids = all.filter((row) => Object.entries(f).every(([key, value]) => !text(value) || text(row[key]) === text(value))).map((row) => row.id);
      if (!ids.length) return res.status(404).json({ error: 'No ARS SKU-Location records match the bulk-update criteria.' });
      const changed = await update(collection, ids, { ...fields, updated_date: today() });
      return res.status(200).json(changed);
    }

    if (req.method === 'PUT' && entity === 'rules' && req.body.action === 'run') {
      return res.status(501).json({ error: 'ARS run requires a durable request key, atomic purchase-order creation, authoritative sales history for Sales History rules, and Central Inventory readback.' });
    }

    if (req.method === 'PUT') {
      if (entity === 'logs') return res.status(501).json({ error: 'ARS execution logs cannot be edited without the durable approval and processing workflow.' });
      const id = Number(req.body.id); const current = await findOne(collection, { id }); if (!current) return res.status(404).json({ error: 'ARS record not found.' });
      const { entity: _entity, id: _id, action, ...fields } = req.body;
      if (entity === 'rules') {
        for (const field of ['rule_id', 'last_run_date', 'next_run_date', 'created_by', 'created_date']) delete fields[field];
      }
      if (entity === 'rules' && action === 'confirm') {
        if (current.status !== 'Pending') return res.status(409).json({ error: 'Only a Pending ARS Rule can be confirmed.' });
        const locations = Array.isArray(current.locations) && current.locations.length ? current.locations : [current.location].filter(Boolean);
        const configuredLocations = await activeLocations();
        if (locations.some((value) => !configuredLocations.some((location) => [location.code, location.name].includes(text(value))))) return res.status(400).json({ error: 'ARS Rule contains a location that is no longer active.' });
        fields.status = 'Active';
      } else if (entity === 'rules') {
        const error = validateRule({ ...current, ...fields }); if (error) return res.status(400).json({ error });
        const locations = Array.isArray(fields.locations) && fields.locations.length ? fields.locations : [fields.location || current.location].filter(Boolean);
        const configuredLocations = await activeLocations();
        if (locations.some((value) => !configuredLocations.some((location) => [location.code, location.name].includes(text(value))))) return res.status(400).json({ error: 'Select only configured active locations.' });
        if (Array.isArray(fields.locations)) fields.location = fields.locations[0] || '';
      } else if (entity === 'links') {
        const error = validateLink({ ...current, ...fields }); if (error) return res.status(400).json({ error });
        if (!(await activeLocations()).some((location) => [location.code, location.name].includes(text(fields.location || current.location)))) return res.status(400).json({ error: 'Select a configured active location.' });
      }
      fields.updated_date = today(); fields.updated_by = actor(req);
      const changed = await update(collection, id, fields); return res.status(200).json(changed[0]);
    }

    if (req.method === 'DELETE') {
      if (entity === 'logs') return res.status(501).json({ error: 'ARS execution history cannot be deleted while its source and processing workflow remain unverified.' });
      const row = await findOne(collection, { id: Number(req.body.id) }); if (!row) return res.status(404).json({ error: 'ARS record not found.' });
      if (entity === 'rules' && row.status !== 'Pending') return res.status(409).json({ error: 'Only a Pending ARS Rule can be deleted. Use Inactive or Discontinued for an audited rule.' });
      return res.status(200).json(await remove(collection, Number(req.body.id)));
    }
    res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('ARS API error:', { name: error?.name, code: error?.code });
    res.status(error.statusCode || error.status || 500).json({ error: error.message || 'ARS request failed.' });
  }
}

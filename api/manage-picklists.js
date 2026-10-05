import { sendDatabaseUnavailable, cors, find, insert } from './mongo.js';
import { channelNames, locationPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';

const text = value => String(value ?? '').trim();
const includes = (value, query) => !text(query) || text(query) === '-1'
  || text(value).toLowerCase().includes(text(query).toLowerCase());

function normalizePicklist(row) {
  return {
    ...row,
    recordTrust: 'legacy-unverified',
    clientId: row.client_id ?? '',
    pickListNo: row.picklist_no ?? '',
    stat: row.status ?? '',
    statId: row.status_code ?? '',
    picklistDateStr: row.created_date ?? '',
    user: row.generated_by ?? '',
    userCrt: row.picker ?? '',
    pickerMap: row.picker ?? '',
    pickListName: row.description ?? '',
    picklistEndDateStr: row.finished_date ?? '',
    picklistQty: row.total_qty ?? '',
    completion: row.completion ?? '',
    processQty: row.process_qty ?? '',
    ispicklistlocked: row.is_locked == null ? '' : (row.is_locked ? '1' : '0'),
    printStatus: row.print_status ?? '',
    locCode: row.location_code ?? row.warehouse ?? '',
    assignedPicklistDate: row.assigned_date ?? '',
    picklistStartTime: row.start_time ?? '',
    picklistPrintDateStr: row.print_date ?? '',
    picklistTag: row.picklist_tag ?? '',
    zonesValue: row.zones ?? '',
    sortFlag: row.sortation_required == null ? '' : (row.sortation_required ? 'Yes' : 'No'),
    waveDescr: row.wave_description ?? '',
    waveFilterNo: row.wave_filter_no ?? '',
    isB2BOrder: row.order_processing ?? '',
    assignPickers: row.picker ?? '',
    pickListStatus: row.status ?? '',
  };
}

function page(rows, body, key = 'rowDTOListFromUpdate') {
  const size = [5, 10, 20, 30, 40, 50, 100, 200, 300, 400, 500, 1000, 1500, 2000].includes(+body.rows)
    ? +body.rows : 20;
  const currentPage = Math.max(1, +body.page || 1);
  const records = rows.length;
  const items = rows.slice((currentPage - 1) * size, currentPage * size);
  return { [key]: items, gridModel: items, rows: items, page: currentPage, total: Math.ceil(records / size), records };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method === 'GET') {
      const [channels, locations, templates, waves] = await Promise.all([
        channelNames(), locationPairs(), find('generic_records', { module: 'picklist-template' }),
        find('generic_records', { module: 'picklist-wave' }),
      ]);
      return res.json({
        channels,
        pickingModes: [['1', 'Orderwise'], ['2', 'Pick+Sort'], ['3', 'Orderwise&PickSort']],
        picklistTypes: [['3', 'Count Of Order'], ['2', 'Count Of SKU'], ['4', 'Template'], ['1', 'Multi Qty'], ['0', 'Single Qty']],
        locations,
        orderStatuses: ['Allocated', 'Part Allocated'],
        orderDocumentTypes: ['SO', 'RTV', 'STO', 'KIT', 'DELIVERY RETURN'],
        orderTypes: ['Normal', 'COD', 'Prepaid', 'B2BGC-COD', 'B2CGC-COD'],
        pickers: [],
        statuses: ['Open', 'In Progress', 'Completed', 'Cancelled'],
        available: false,
        dataTrust: 'legacy-unverified',
        picklistGenerationAvailable: false,
        notice: 'Picklist enquiry is read-only. Generation, unlocking, and picker assignment require Central Inventory reservations and a supported pick workflow.',
        templates,
        waves,
      });
    }

    if (req.method !== 'POST') {
      return res.status(['PUT', 'PATCH', 'DELETE'].includes(req.method) ? 501 : 405)
        .json({ error: 'Picklist workflow writes are unavailable until reservation and picking transactions are connected.' });
    }

    if (body.action === 'search' || body.REQ_SEARCH_FLAG) {
      const rows = (await find('picklists')).map(normalizePicklist).filter(row =>
        includes(row.pickListNo, body.pickNO || body.orderNo)
        && includes(row.stat, body.stat)
        && includes(row.user, body.user)
        && includes(row.userCrt, body.userCrt)
        && includes(row.locCode, body.locCode)
        && includes(row.zonesValue, body.zonesValue)
        && includes(row.sortFlag, body.sortFlag)
        && includes(row.waveFilterNo, body.waveFilterNo)
        && includes(row.pickListName, body.pickListName)
        && includes(row.isB2BOrder, body.isB2BOrder)
        && (!text(body.frompicklistDate) || row.picklistDateStr >= body.frompicklistDate)
        && (!text(body.topicklistDate) || row.picklistDateStr <= body.topicklistDate));
      rows.sort((a, b) => text(a.picklistDateStr).localeCompare(text(b.picklistDateStr)) * (text(body.sord) === 'asc' ? 1 : -1));
      return res.json(page(rows, body));
    }

    if (body.action === 'search-orders') {
      const rows = (await find('fulfillment_orders')).filter(row =>
        ['Allocated', 'Part Allocated'].includes(row.status)
        && includes(row.order_no, body.orderNo)
        && includes(row.warehouse ?? row.location_code, body.siteLoc)
        && includes(row.status, body.orderStatus)
        && includes(row.order_type, body.orderType)
        && (!text(body.fromOrderDate) || row.order_date >= body.fromOrderDate)
        && (!text(body.toOrderDate) || row.order_date <= body.toOrderDate))
        .map(row => ({ ...row, recordTrust: 'legacy-unverified' }));
      return res.json(page(rows, body, 'orderDTOList'));
    }

    if (body.action === 'wave-search') {
      const rows = (await find('generic_records', { module: 'picklist-wave' }))
        .filter(row => includes(row.code, body.waveNumber)
          && includes(row.name, body.waveDescription)
          && includes(row.location, body.locationCode)
          && includes(row.status, body.status)
          && includes(row.wave_type, body.waveType))
        .map(row => ({ ...row, recordTrust: 'legacy-unverified' }));
      return res.json(page(rows, body, 'waveDTOList'));
    }

    if (body.action === 'template-save') {
      if (!text(body.templateName) || !text(body.location) || text(body.location) === '-1') {
        return res.status(400).json({ error: 'Template Name and Source Warehouse Location are mandatory' });
      }
      if (!(await locationPairs()).some(([code]) => code === text(body.location))) {
        return res.status(400).json({ error: 'Select a configured source warehouse location.' });
      }
      const row = await insert('generic_records', {
        module: 'picklist-template',
        code: `PT${Date.now().toString().slice(-6)}`,
        name: text(body.templateName),
        location: text(body.location),
        order_processing: body.isB2B || 'B2C',
        status: body.status || 'Active',
        grouping_sequence: body.groupingSequence || 'By Order',
        split_zone_wise: !!body.splitZoneWise,
        order_count: +body.orderCount || 0,
        sku_count: +body.skuCount || 0,
        sku_qty: +body.skuQty || 0,
        split_category: !!body.splitCategory,
        reassign_pack: !!body.reassignPack,
        assign_priority: body.assignPriority || '',
        category: body.category || '',
        created_by: currentUser(req)?.username || 'unknown',
        created_date: new Date().toISOString().slice(0, 10),
      });
      return res.status(201).json({ row, jsonMessage: 'Template saved successfully' });
    }

    if (body.action === 'generate') {
      return res.status(501).json({ error: 'Picklist generation is paused until selected orders have active Central Inventory reservations and a supported pick workflow.' });
    }
    return res.status(501).json({ error: 'This picklist action is unavailable until the reservation and picking workflow is connected.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Manage Picklist error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

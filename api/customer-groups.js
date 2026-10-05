import { sendDatabaseUnavailable,
  find,
  findOne,
  insert,
  update,
  remove,
  setCustomerGroupIfCurrent,
  cors,
} from './mongo.js';

const MODULE = 'customer-group';

function normalizeStatus(value, fallback = '') {
  const status = String(value ?? '').trim().toLowerCase();
  if (['active', '1'].includes(status)) return 'Active';
  if (['inactive', 'in-active', 'in active', '0'].includes(status)) return 'Inactive';
  return fallback;
}

function displayStatus(status) {
  return normalizeStatus(status) === 'Inactive' ? 'InActive' : 'Active';
}

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => (
    !value || String(row[key] || '').toLowerCase().includes(String(value).toLowerCase())
  ));
}

async function groups() {
  const [records, customers] = await Promise.all([
    find('generic_records', { module: MODULE }, { sort: { id: -1 } }),
    find('partners', { type: 'Customer' }),
  ]);
  return records.map((record) => ({
    ...record,
    status: displayStatus(record.status),
    no_of_customer: customers.filter((customer) => customer.customer_group_code === record.code).length,
  }));
}

function normalizeCustomerIds(value) {
  if (!Array.isArray(value)) return { error: 'Customer list must be an array.' };
  if (value.length > 1000) return { error: 'Maximum 1000 customers are allowed in a group.' };
  const ids = value.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { error: 'Customer list contains an invalid ID.' };
  return { ids: [...new Set(ids)] };
}

async function validateCustomerIds(ids, groupCode) {
  const customers = await find('partners', { type: 'Customer' });
  const byId = new Map(customers.map((customer) => [Number(customer.id), customer]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { error: 'One or more selected customers no longer exist.', status: 400 };
  const assignedElsewhere = ids.filter((id) => {
    const assignedCode = String(byId.get(id).customer_group_code || '');
    return assignedCode && assignedCode !== groupCode;
  });
  if (assignedElsewhere.length) return { error: 'A customer is already assigned to another group.', status: 409 };
  return { customers, byId };
}

async function applyMembership(groupCode, ids, customers) {
  const selected = new Set(ids);
  const newlyAssigned = [];
  try {
    // Claim additions first. The Mongo compare-and-set guards concurrent edits.
    for (const id of ids) {
      const customer = customers.find((row) => Number(row.id) === id);
      if (customer.customer_group_code === groupCode) continue;
      const claimed = await setCustomerGroupIfCurrent(id, ['', groupCode], groupCode);
      if (!claimed) {
        for (const claimedId of newlyAssigned) {
          await setCustomerGroupIfCurrent(claimedId, [groupCode], '');
        }
        return { error: 'A customer was assigned to another group while this change was being saved.', status: 409 };
      }
      newlyAssigned.push(id);
    }

    // Clear only assignments that still belong to this group. A concurrent
    // reassignment to a different group is preserved.
    for (const customer of customers) {
      if (customer.customer_group_code === groupCode && !selected.has(Number(customer.id))) {
        await setCustomerGroupIfCurrent(customer.id, [groupCode], '');
      }
    }
    return { ok: true };
  } catch (error) {
    for (const claimedId of newlyAssigned) {
      await setCustomerGroupIfCurrent(claimedId, [groupCode], '').catch(() => {});
    }
    throw error;
  }
}

async function createGroup(name, requestedIds) {
  const created = await insert('generic_records', {
    module: MODULE,
    code: '',
    name,
    status: 'Active',
    created_date: new Date().toISOString().slice(0, 10),
  });
  const code = `CG${String(created.id).padStart(4, '0')}`;
  const [saved] = await update('generic_records', created.id, { code });
  if (!saved) {
    await remove('generic_records', created.id);
    return { error: 'Customer Group could not be saved.', status: 500 };
  }

  const validation = await validateCustomerIds(requestedIds, code);
  if (validation.error) {
    await remove('generic_records', created.id);
    return validation;
  }
  let membership;
  try {
    membership = await applyMembership(code, requestedIds, validation.customers);
  } catch (error) {
    await remove('generic_records', created.id);
    throw error;
  }
  if (membership.error) {
    await remove('generic_records', created.id);
    return membership;
  }
  return { group: { ...saved, no_of_customer: requestedIds.length } };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { code, name } = req.query;
      const status = normalizeStatus(req.query.status);
      return res.status(200).json((await groups()).filter((row) => matches(row, { code, name, status: status ? displayStatus(status) : '' })));
    }

    if (req.method === 'POST' && String(req.body?.REQ_SEARCH_FLAG) === 'true') {
      const body = req.body;
      const status = normalizeStatus(body.status ?? body.statusText);
      const filtered = (await groups()).filter((row) => matches(row, {
        code: body.custGroupCode,
        name: body.custGroupName,
        status: status ? displayStatus(status) : '',
      }));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = filtered.length;
      const total = Math.ceil(records / size);
      const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({
        gridModel: gridModel.length ? gridModel : null,
        rows: gridModel.length ? gridModel : null,
        page,
        records,
        total,
        sidx: String(body.sidx || 'custGroupCode'),
        sord: String(body.sord || 'desc'),
      });
    }

    if (req.method === 'POST') {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Please Enter Customer Group Name.' });
      if (name.length > 50) return res.status(400).json({ error: 'Customer Group Name cannot exceed 50 characters.' });
      const duplicate = (await find('generic_records', { module: MODULE })).find((row) => row.name?.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) return res.status(409).json({ error: 'Customer Group Name already exists.' });
      const requested = req.body.customer_ids === undefined ? { ids: [] } : normalizeCustomerIds(req.body.customer_ids);
      if (requested.error) return res.status(400).json({ error: requested.error });
      const result = await createGroup(name, requested.ids);
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.status(201).json({ ...result.group, status: 'Active', no_of_customer: requested.ids.length });
    }

    if (req.method === 'PUT') {
      const id = Number(req.body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'A valid Customer Group ID is required.' });
      const group = await findOne('generic_records', { id });
      if (!group || group.module !== MODULE) return res.status(404).json({ error: 'Customer Group not found' });
      const nextName = String(req.body?.name ?? group.name).trim();
      if (!nextName) return res.status(400).json({ error: 'Please Enter Customer Group Name.' });
      if (nextName.length > 50) return res.status(400).json({ error: 'Customer Group Name cannot exceed 50 characters.' });
      const duplicate = (await find('generic_records', { module: MODULE })).find((row) => row.id !== group.id && row.name?.trim().toLowerCase() === nextName.toLowerCase());
      if (duplicate) return res.status(409).json({ error: 'Customer Group Name already exists.' });
      const nextStatus = req.body?.status === undefined
        ? normalizeStatus(group.status, 'Active')
        : normalizeStatus(req.body.status);
      if (!nextStatus) return res.status(400).json({ error: 'Invalid status' });

      if (Object.hasOwn(req.body || {}, 'customer_ids')) {
        const requested = normalizeCustomerIds(req.body.customer_ids);
        if (requested.error) return res.status(400).json({ error: requested.error });
        const validation = await validateCustomerIds(requested.ids, group.code);
        if (validation.error) return res.status(validation.status).json({ error: validation.error });
        if (nextStatus === 'Inactive' && requested.ids.some((customerId) => validation.byId.get(customerId).customer_group_code !== group.code)) {
          return res.status(400).json({ error: 'Inactive Customer Group cannot accept new customers.' });
        }
        const membership = await applyMembership(group.code, requested.ids, validation.customers);
        if (membership.error) return res.status(membership.status).json({ error: membership.error });
      }

      const [saved] = await update('generic_records', group.id, {
        name: nextName,
        status: nextStatus,
        updated_date: new Date().toISOString().slice(0, 10),
      });
      const response = (await groups()).find((row) => row.id === saved.id);
      return res.status(200).json(response);
    }

    if (req.method === 'DELETE') {
      const group = await findOne('generic_records', { id: Number(req.body?.id) });
      if (!group || group.module !== MODULE) return res.status(404).json({ error: 'Customer Group not found' });
      const used = (await find('partners', { type: 'Customer' })).some((customer) => customer.customer_group_code === group.code);
      return res.status(409).json({ error: used ? 'Customer Group cannot be deleted while customers are assigned. Set it InActive instead.' : 'Customer Groups are maintained by status; deletion is not available.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('customer groups error:', { name: error?.name, code: error?.code });
    return res.status(error.statusCode || 500).json({ error: error.message || 'Customer Group request failed.' });
  }
}

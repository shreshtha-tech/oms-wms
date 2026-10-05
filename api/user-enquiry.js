import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const statuses = [['-1', '--- Select ---'], ['1', 'Active'], ['0', 'InActive'], ['9', 'Locked']];
const userTypes = [['-1', '--- Select ---'], ['1001', 'Admin'], ['3', 'Distributor'], ['1', 'Normal'], ['2', 'Seller'], ['1002', 'SellerAdmin'], ['4', 'Store']];
const selectOnly = [['-1', '--- Select ---']];
const roles = async () => [...selectOnly, ...(await find('admin_records', { type: 'role' })).map(row => [String(row.roleId), String(row.description)])];
const companies = async () => [...selectOnly, ...(await find('generic_records', { module: 'company' })).map(row => [String(row.code), String(row.name)])];
const columns = [['username', 'User Name'], ['firstName', 'First Name'], ['lastName', 'Last Name'], ['status', 'Status'], ['email', 'Email'], ['userType', 'User Type']];
const text = (value) => String(value ?? '').trim();
const includes = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.json({ statuses, userTypes, roles: await roles(), companies: await companies(), locations: [...selectOnly, ...(await find('generic_records', { module: 'location' })).map(row => [String(row.code), String(row.name)])], columns, pageSizes: [20, 50, 100, 200], defaultUserType: '1', searchEndpoint: 'jsonUserSearch', importUrl: 'vendorImportDisplayBS?ExternalImportType=40', exportEndpoint: 'generateUserExportAction', editorUrl: 'loadUserDetailBS' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    if (body.action === 'export') {
      if (!Number(body.gridDataLen)) return res.status(400).json({ error: 'No data found' });
      return res.json({ endpoint: 'generateUserExportAction', reportId: `USER-${Date.now()}` });
    }
    let rows = (await find('admin_records', { type: 'user' })).map((row) => ({ ...row, userId: row.username, userCode: row.username, statusId: row.status === 'Active' ? '1' : row.status === 'Locked' ? '9' : '0', userType: row.userType || 'Normal' }));
    rows = rows.filter((row) => includes(row.username, body.userId) && includes(row.firstName, body.firstName) && includes(row.lastName, body.lastName) && includes(row.email, body.email) && (text(body.userStatus) === '-1' || !text(body.userStatus) || row.statusId === text(body.userStatus)) && (text(body.userType) === '-1' || !text(body.userType) || userTypes.find(([id]) => id === text(body.userType))?.[1] === row.userType) && (text(body.role) === '-1' || !text(body.role) || includes(JSON.stringify(row.roles), body.role)) && (text(body.company) === '-1' || !text(body.company) || includes(JSON.stringify(row.roles), body.company)) && (text(body.location) === '-1' || !text(body.location) || includes(JSON.stringify(row.roles), body.location)));
    const key = ['username', 'firstName', 'lastName', 'status', 'email', 'userType'].includes(body.sidx) ? body.sidx : 'username';
    rows.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { sensitivity: 'base' }) * (body.sord === 'desc' ? -1 : 1));
    const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
    const page = Math.max(1, Number(body.page) || 1), records = rows.length, total = Math.ceil(records / size);
    const userList = rows.slice((page - 1) * size, page * size);
    return res.json({ JSON: 'success', loadonce: false, page, records, rows: size, total, userList, gridModel: userList });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('user enquiry error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

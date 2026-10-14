import { cors } from './mongo.js';

const columns = ['Report ID','Status','Report Request Date','Report Names','Report Complete Date','Download','Error Msg'];
const unavailable = { error: 'REPORT_SERVICE_UNAVAILABLE', message: 'Pending reports are unavailable until trusted generation and report ownership are configured.' };

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === 'GET' && req.query?.action === 'meta') return res.status(200).json({ columns, available: false });
  if (req.method === 'GET') return res.status(503).json(unavailable);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.body?.action === 'seed') return res.status(403).json({ error: 'REPORT_SEED_DISABLED', message: 'Client-declared report status and content cannot create a report.' });
  if (['download', 'force'].includes(req.body?.action)) return res.status(503).json(unavailable);
  return res.status(400).json({ error: 'Unsupported Exports action' });
}

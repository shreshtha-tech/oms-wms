import { cors } from './mongo.js';

const text = (value) => String(value ?? '').trim();
const unavailable = 'SKU label generation and printing are unavailable until a label template renderer and printer/PDF output service are connected.';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  if (!['1', '2'].includes(text(body.labelId))) return res.status(400).json({ error: 'Please select a Label Type' });
  if (!text(body.data)) return res.status(400).json({ error: 'Please Enter Valid Data' });
  const lines = text(body.data).split(/\r?\n/).filter((line) => text(line));
  if (lines.length > 100) return res.status(400).json({ error: 'Max 100 lines are allowed at a time' });
  return res.status(501).json({ error: unavailable });
}

import {sendDatabaseUnavailable, cors, find } from './mongo.js';

const emptyPage = (page) => ({ otcList: [], gridModel: [], page, total: 0, records: 0, rows: 20 });

async function handlerImpl(req, res) {
  if (cors(req, res)) return;
  if (req.method === 'GET') {
    const page = Math.max(1, Number(req.query?.page) || 1);
    // RET-OTC-001 was a local example task, not a real Flipkart job.
    const tasks = (await find('generic_records', { module: 'return-otc-task' })).filter((row) => row.taskId !== 'RET-OTC-001');
    const start = (page - 1) * 20;
    return res.json({ otcList: tasks.slice(start, start + 20), gridModel: tasks.slice(start, start + 20), page, total: Math.ceil(tasks.length / 20), records: tasks.length, rows: 20 });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(503).json({ error: 'Flipkart Return OTC is unavailable until a real connector is configured.' });
}

export default async function handler(req,res) { try { return await handlerImpl(req,res); } catch(error) { if(sendDatabaseUnavailable(res,error))return; throw error; } }

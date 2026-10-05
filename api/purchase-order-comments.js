import { sendDatabaseUnavailable, findOne, update, cors } from './mongo.js';

function commentDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.day}/${value.month}/${value.year} ${value.hour}:${value.minute} ${String(value.dayPeriod || '').toUpperCase()}`;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { po_id, commentDet } = req.body;
    if (String(commentDet ?? '') === '') return res.status(400).json({ error: 'Please Enter Some Comments' });
    const po = await findOne('purchase_orders', { id: Number(po_id) });
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    const addedBy = String(req.body.commentAddedBy || 'Current User');
    const entry = {
      comment_date: commentDate(), comment_added_by: addedBy,
      comment_status: po.status || '', view_comments: String(commentDet),
    };
    const comments = [entry, ...(Array.isArray(po.comments) ? po.comments : [])];
    await update('purchase_orders', po.id, { comments });
    return res.status(200).json({
      poDTO: { commentDate: entry.comment_date, commentAddedBy: entry.comment_added_by, commentStatus: entry.comment_status, viewComments: entry.view_comments },
      commentsOrderList: comments,
    });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}

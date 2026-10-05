import { sendDatabaseUnavailable, find, cors } from './mongo.js';

const unavailable = 'Coupon changes are unavailable until issuance, eligibility, redemption, audit, and permissions are verified.';
const matchesDate = (value, from, to) => {
  if (!from && !to) return true;
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!from || date >= from) && (!to || date <= to);
};

// Manage Coupons (Master > Coupon Management > Coupon Enquiry)
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await find('coupons_master', {}, { sort: { id: -1 } }));
    }
    if (req.method === 'POST') {
      const b = req.body;
      if (String(b.REQ_SEARCH_FLAG) === 'true') {
        const has=(v,q)=>!String(q??'').trim()||String(q)==='-1'||String(v??'').toLowerCase().includes(String(q).trim().toLowerCase()),types={'1':'Line','2':'Bill'},statuses={'7':'Cancelled','4':'Confirmed','1':'Pending Confirmation'};
        const all=await find('coupons_master',{}, {sort:{id:-1}}),filtered=all.filter(r=>has(r.coupon_key,b.couponKey)&&has(r.description,b.desc)&&has(r.coupon_code,b.couponCode)&&has(r.coupon_type,types[String(b.couponType)]||'')&&has(r.status,statuses[String(b.couponStatus)]||'')&&matchesDate(r.start_date,b.fromOrderDate,b.toOrderDate)&&matchesDate(r.active_date,b.fromActiveDate,b.toActiveDate));
        const size=[20,50,100,200].includes(Number(b.rows))?Number(b.rows):20,page=Math.max(1,Number(b.page)||1),records=filtered.length,total=Math.ceil(records/size),gridModel=filtered.slice((page-1)*size,page*size);
        return res.status(200).json({gridModel:gridModel.length?gridModel:null,page,records,total});
      }
      return res.status(501).json({ error: unavailable });
    }
    if (req.method === 'PUT' || req.method === 'DELETE') return res.status(501).json({ error: unavailable });
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('coupons error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}

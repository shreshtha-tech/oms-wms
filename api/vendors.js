import { sendDatabaseUnavailable, find, findOne, insertVendor, updateVendorWithAudit, cors, actor } from './mongo.js';

// Earlier local seeds used simplified names. Present them using the observed
// Vendor Master vocabulary while retaining backward-compatible records.
const normalizeVendor = (vendor) => ({
  ...vendor,
  vendor_type: vendor.vendor_type === 'Domestic' || vendor.vendor_type === 'Import' ? 'Outright purchase' : vendor.vendor_type,
  country: vendor.country === 'India' ? 'INDIA' : vendor.country,
  status: vendor.status === 'Active' ? 'Confirmed' : vendor.status === 'Inactive' ? 'Deactivated' : vendor.status,
});

// Vendor Master (Master > Trading Partner > Vendor Enquiry)
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json((await find('vendors', {}, { sort: { id: -1 } })).map(normalizeVendor));
    }
    if (req.method === 'POST') {
      const b = req.body;
      if (b.REQ_SEARCH_FLAG) {
        const vendorType = { '4': 'B2S2', '3': 'JIT', '2': 'Marketplace', '1': 'Outright purchase' }[String(b.vendorType)] || b.vendorType;
        const paymentTerm = { '1':'30 Days','2':'45 Days','3':'60 Days','4':'90 Days','5':'Advance','6':'120 days from the date of receipt of goods','7':'7 days','8':'50 Days','9':'75 DAYS','10':'35 Days','11':'120','13':'Letter of Credit','15':'7 Days','16':'1' }[String(b.paymentTerm)] || b.paymentTerm;
        const status = { '1':'Confirmed','2':'Deactivated','0':'Pending Confirmation' }[String(b.status)] || b.status;
        const matches = (await find('vendors', {}, { sort: { id: -1 } })).map(normalizeVendor).filter((vendor) => {
          const tests = [[vendor.vendor_code,b.vendorCode],[vendor.vendor_name,b.vendorName],[vendor.vendor_type,vendorType],[vendor.vendor_short_name,b.vendorShortName],[vendor.credit_days,paymentTerm],[vendor.status,status],[vendor.country,b.country],[vendor.state,b.state],[vendor.city,b.city]];
          return tests.every(([actual, expected]) => !String(expected || '').trim() || String(actual || '').toLowerCase().includes(String(expected).trim().toLowerCase()));
        });
        return res.status(200).json(matches);
      }
      const code = String(b.vendor_code || '').trim();
      const name = String(b.vendor_name || '').trim();
      if (!code || !name) return res.status(400).json({ error: 'Vendor Code and Vendor Name are required' });
      if (await findOne('vendors', { vendor_code: code })) return res.status(409).json({ error: `Vendor Code "${code}" already exists` });
      // Identity is allocated by storage, never selected by a create request.
      const { id: ignoredId, _id: ignoredMongoId, ...createFields } = b;
      const doc = await insertVendor({
        ...createFields, vendor_code: code, vendor_name: name,
        vendor_type: b.vendor_type || 'Outright purchase', credit_days: b.credit_days ?? '',
        country: b.country || 'INDIA', state: b.state || '', city: b.city || '',
        status: b.status || 'Pending Confirmation',
        // Local audit data is server-owned so the client cannot fabricate history.
        audit: [{ at: new Date().toISOString(), action: 'Created', by: actor(req) }],
      });
      return res.status(201).json(doc);
    }
    if (req.method === 'PUT') {
      const { id, _id: ignoredMongoId, ...fields } = req.body;
      const current = await findOne('vendors', { id: Number(id) });
      if (!current) return res.status(404).json({ error: 'Vendor not found' });
      // The reference locks Vendor Code after the first save.
      const code = String(current.vendor_code).trim();
      const name = String(fields.vendor_name ?? current.vendor_name).trim();
      if (!code || !name) return res.status(400).json({ error: 'Vendor Code and Vendor Name are required' });
      const duplicate = (await find('vendors', { vendor_code: code })).find((v) => v.id !== Number(id));
      if (duplicate) return res.status(409).json({ error: `Vendor Code "${code}" already exists` });
      // POs and GRNs retain the name recorded when each document was issued.
      // Their vendor_code remains the stable link to this master record.
      const changedStatus = fields.status && fields.status !== current.status;
      const auditEntry = { at: new Date().toISOString(), action: changedStatus ? `Status changed to ${fields.status}` : 'Updated', by: actor(req) };
      const changes = { ...fields, vendor_code: code };
      // An omitted name is not a rename. Reapplying the pre-read name would
      // undo a concurrent rename while saving an unrelated field.
      if (fields.vendor_name != null) changes.vendor_name = name;
      else delete changes.vendor_name;
      const row = await updateVendorWithAudit(Number(id), changes, auditEntry);
      return res.status(200).json(row);
    }
    if (req.method === 'DELETE') {
      // A vendor may be referenced by POs/GRNs; deleting it would break history.
      return res.status(409).json({ error: 'Vendor records cannot be deleted from Vendor Master. Deactivate the vendor instead.' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    if (err.status === 409 || err.status === 503) return res.status(err.status).json({ error: err.message });
    console.error('vendors error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message });
  }
}

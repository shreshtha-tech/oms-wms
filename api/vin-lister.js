import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

const channels = ['Amazon', 'eBay', 'Lazada', 'Shopee', 'Walmart', 'Magento', 'Zalora', 'Shopify', 'Tokopedia', 'Bli Bli', 'TADA', 'JD'];
const categories = ['Fashion & Accessories', 'Health n Beauty', 'Jewellery', 'Baby Products', 'Electronics', 'Home Furnishing', 'Luggage & Travel', 'Adv & Mountaineering', 'Pet Supplies', 'Groceries, Meat & FMCG', 'Baby and Mother Care'];
const now = () => new Date().toISOString();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const action = req.query?.action || req.body?.action || 'products';
    if (req.method === 'GET') {
      if (action === 'meta') return res.status(200).json({ channels, categories });
      if (action === 'imports') return res.status(200).json(await find('vin_lister_imports', {}, { sort: { id: -1 } }));
      if (action === 'exports') return res.status(200).json(await find('vin_lister_exports', {}, { sort: { id: -1 } }));
      if (action === 'logs') return res.status(200).json(await find('vin_lister_transmit_logs', {}, { sort: { id: -1 } }));
      return res.status(200).json(await find('vin_lister_products', {}, { sort: { id: -1 } }));
    }
    if (req.method === 'POST' && action === 'product-import') {
      const rows = req.body.rows;
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Upload File must contain at least one product.' });
      const bad = rows.find((r) => !String(r.sku_code || '').trim() || !String(r.product_name || '').trim() || !categories.includes(r.category));
      if (bad) return res.status(400).json({ error: 'SKU Code, Product Name and a supported Category are required.' });
      let created = 0; let updated = 0;
      for (const row of rows) { const existing = await findOne('vin_lister_products', { sku_code: String(row.sku_code).trim() }); if (existing) { await update('vin_lister_products', existing.id, { ...existing, ...row, sku_code: String(row.sku_code).trim(), updated_at: now() }); updated++; } else { await insert('vin_lister_products', { sku_code: String(row.sku_code).trim(), product_name: row.product_name, category: row.category, images: [], marketplaces: [], prices: {}, status: 'Draft', created_at: now() }); created++; } }
      const record = await insert('vin_lister_imports', { import_type: 'Product', file_name: req.body.file_name || 'product-import', count: rows.length, created, updated, status: 'Completed', created_at: now() });
      return res.status(201).json({ record, created, updated });
    }
    if (req.method === 'POST' && action === 'image-import') {
      const { access_token, sku_codes = [] } = req.body;
      if (!String(access_token || '').trim()) return res.status(400).json({ error: 'Dropbox Access Token is required.' });
      let mapped = 0; for (const code of sku_codes) { const product = await findOne('vin_lister_products', { sku_code: code }); if (product) { await update('vin_lister_products', product.id, { images: [...(product.images || []), `${code}.jpg`], updated_at: now() }); mapped++; } }
      return res.status(201).json(await insert('vin_lister_imports', { import_type: 'Image Import', file_name: 'Dropbox repository', count: sku_codes.length, mapped, status: 'Completed', created_at: now() }));
    }
    if (req.method === 'POST' && action === 'price-import') {
      const { channel, rows } = req.body; if (!channels.includes(channel)) return res.status(400).json({ error: 'Select a supported channel.' }); if (!Array.isArray(rows) || !rows.length || rows.some((r) => !r.sku_code || Number(r.price) < 0)) return res.status(400).json({ error: 'Every Channel Price row requires SKU Code and a valid price.' });
      let updated = 0; for (const row of rows) { const product = await findOne('vin_lister_products', { sku_code: row.sku_code }); if (product) { await update('vin_lister_products', product.id, { marketplaces: [...new Set([...(product.marketplaces || []), channel])], prices: { ...(product.prices || {}), [channel]: Number(row.price) }, status: 'Ready', updated_at: now() }); updated++; } }
      return res.status(201).json(await insert('vin_lister_imports', { import_type: 'Channel Price', channel, count: rows.length, updated, status: 'Completed', created_at: now() }));
    }
    if (req.method === 'POST' && action === 'assign-marketplace') {
      const product = await findOne('vin_lister_products', { id: Number(req.body.id) }); if (!product) return res.status(404).json({ error: 'Product not found.' }); if (!channels.includes(req.body.channel)) return res.status(400).json({ error: 'Select a supported marketplace.' });
      const [saved] = await update('vin_lister_products', product.id, { marketplaces: [...new Set([...(product.marketplaces || []), req.body.channel])], updated_at: now() }); return res.status(200).json(saved);
    }
    if (req.method === 'POST' && action === 'export') {
      const { export_type, channel, category, product_ids = [] } = req.body; if (!export_type) return res.status(400).json({ error: 'Select Export Type.' }); if (channel && !channels.includes(channel)) return res.status(400).json({ error: 'Select a supported marketplace.' });
      const products = await find('vin_lister_products', {}); const output = products.filter((p) => (!channel || p.marketplaces?.includes(channel)) && (!category || p.category === category) && (!product_ids.length || product_ids.includes(p.id)));
      return res.status(201).json(await insert('vin_lister_exports', { export_type, channel: channel || 'All', category: category || 'All', count: output.length, status: 'Ready', created_at: now(), rows: output }));
    }
    if (req.method === 'POST' && action === 'sku-push') {
      const product = await findOne('vin_lister_products', { id: Number(req.body.id) }); const channel = req.body.channel; if (!product) return res.status(404).json({ error: 'SKU not found.' }); if (!product.marketplaces?.includes(channel)) return res.status(400).json({ error: 'Assign the SKU to this marketplace before processing.' });
      const log = await insert('vin_lister_transmit_logs', { sku_code: product.sku_code, product_name: product.product_name, channel, operation: 'SKU Push', status: 'Processed', processed_at: now() }); return res.status(201).json(log);
    }
    res.status(405).json({ error: 'Unsupported Vin Lister operation.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('vin-lister error:', { name: error?.name, code: error?.code }); res.status(500).json({ error: error.message }); }
}

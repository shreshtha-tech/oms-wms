import { sendDatabaseUnavailable, find, cors } from './mongo.js';

// Dynamic platform/channel list for the dashboard filter (from channels + known brands).
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const channels = await find('channels', {});
    // Map channel brands to display platforms; always include the core set.
    const brandMap = { flipkart: 'Flipkart', amazon: 'Amazon', myntra: 'Myntra', shopify: 'Shopify', nykaa: 'Nykaa', ajio: 'Ajio', meesho: 'Meesho', trendyol: 'Trendyol', custom: 'Website' };
    const set = new Set(['Amazon', 'Flipkart', 'Myntra', 'Shopify', 'Website']);
    channels.forEach((c) => { const p = brandMap[c.brand] || c.brand; if (p) set.add(p); });
    const platforms = ['All', ...[...set].filter((p) => p !== 'All').sort()];
    const locations = ['All', ...[...new Set(channels.map((c) => c.location).filter((l) => l && l !== 'View Location(s)'))]];
    return res.status(200).json({ platforms, locations });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('platforms error:', { name: err?.name, code: err?.code });
    res.status(500).json({ error: err.message });
  }
}

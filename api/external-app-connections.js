import { sendDatabaseUnavailable, cors } from './mongo.js';

const text = (value) => String(value ?? '').trim();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ jsonMessage: 'Method not allowed' });
  const body = req.body || {};
  if (text(body.extAppID) !== '43') return res.status(400).json({ jsonMessage: 'Invalid External App.' });
  const subDomain = text(body.subDomain);
  const clientID = text(body.clientID);
  const clientSecret = text(body.clientSecret);
  if (!subDomain || !clientID || !clientSecret) return res.status(200).json({ jsonMessage: 'Kindly provide Subdomain, Client_ID & Client_Secret for establishing a connection.' });
  if (!/^[a-zA-Z0-9-]+$/.test(subDomain)) return res.status(200).json({ jsonMessage: 'Invalid Subdomain.' });
  try {
    const response = await fetch(`https://${subDomain}.auth.marketingcloudapis.com/v2/token`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientID, client_secret: clientSecret }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !text(result.access_token)) return res.status(200).json({ jsonMessage: text(result.error_description || result.message) || 'Connection failed.' });
    return res.status(200).json({ jsonMessage: null, connected: true });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    return res.status(200).json({ jsonMessage: error.name === 'TimeoutError' ? 'Connection timed out.' : 'Connection failed.' });
  }
}

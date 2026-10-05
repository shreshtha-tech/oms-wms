import { find } from './mongo.js';

const value = item => String(item ?? '').trim();

export async function locations() {
  const records = await find('generic_records', { module: 'location' });
  return records.map(row => ({
    code: value(row.location_code || row.code),
    name: value(row.location_name || row.name),
    type: value(row.location_type || row.loc_type),
  })).filter(row => row.code && row.name);
}

export async function activeLocations() {
  const records = await find('generic_records', { module: 'location' });
  return records.map(row => ({
    code: value(row.location_code || row.code),
    name: value(row.location_name || row.name),
    type: value(row.location_type || row.loc_type),
    status: value(row.status),
  })).filter(row => row.code && row.name && (!row.status || row.status.toLowerCase() === 'active'));
}

export async function locationPairs() {
  return (await locations()).map(row => [row.code, row.name]);
}

export async function channelRows() {
  return find('channels');
}

export async function channelNames() {
  return [...new Set((await channelRows()).map(row => value(row.channel_name)).filter(Boolean))];
}

export async function clientPairs() {
  const records = (await find('partners')).filter(row => row.type === 'Client' || row.partner_type === 'Client');
  return records.map(row => [
    value(row.client_id || row.code || row.id),
    value(row.client_name || row.name),
  ]).filter(([id, name]) => id && name);
}

export async function transporterPairs() {
  const records = await find('partners');
  return records.filter(row => row.type === 'Transporter' || row.partner_type === 'Transporter')
    .map(row => [value(row.transporter_code || row.code || row.id), value(row.name || row.transporter_name)])
    .filter(row => row[0] && row[1]);
}

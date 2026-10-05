import { parse as parseCsv } from 'csv-parse/sync';

export async function ingestPartnerStockFile({tenantId,accountId,fileName,bytes}){
  if(typeof fileName!=='string'||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10_000_000)throw new TypeError('File must be a buffer under 10 MB');
  const ext=fileName.toLowerCase().split('.').pop();
  let records;if(ext==='csv')records=parseCsv(bytes,{columns:true,skip_empty_lines:true,trim:true,bom:true});else if(ext==='json')records=JSON.parse(bytes.toString('utf8'));else throw new TypeError('Only CSV or JSON stock snapshots are supported');
  if(!Array.isArray(records)||records.length>100000)throw new TypeError('Invalid stock snapshot');
  const identities=new Set();
  for(const row of records){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.external_sku!=='string'||typeof row.external_location_id!=='string'||!row.external_sku||!row.external_location_id||!/^\d+$/.test(String(row.available))||!Number.isSafeInteger(Number(row.available)))throw new TypeError('Expected external_sku, external_location_id, nonnegative integer available');const identity=JSON.stringify([row.external_sku,row.external_location_id]);if(identities.has(identity))throw new TypeError('Duplicate SKU/location in snapshot');identities.add(identity);}
  // No approved provider timestamp/revision contract exists for these files.
  // Receipt time cannot establish authoritative ordering; do not commit an
  // inbox receipt, observation, job, or physical-stock effect as successful.
  throw Object.assign(new Error('Partner stock snapshots require an approved provider timestamp or revision contract before observations can be imported.'), {status:501,code:'SNAPSHOT_ORDERING_CONTRACT_UNVERIFIED'});
}

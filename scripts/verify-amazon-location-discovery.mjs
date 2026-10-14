import assert from 'node:assert/strict';
import { probeConnection } from '../inventory/connection-provider.js';

async function probe(fulfillmentAvailability){
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,method:options.method});
    return url==='https://api.amazon.com/auth/o2/token'
      ? {ok:true,status:200,json:async()=>({access_token:'fixture-access',expires_in:3600})}
      : {ok:true,status:200,json:async()=>({sku:'SELLER-SKU',fulfillmentAvailability})};
  };
  const result=await probeConnection('amazon',{sellerId:'SELLER-1',marketplaceId:'MARKET-1',region:'na',clientId:'fixture-client',clientSecret:'fixture-secret',refreshToken:'fixture-refresh',testSku:'SELLER-SKU'}, {fetcher});
  assert.equal(result.raw.sku,'SELLER-SKU');
  return {result,calls};
}

const discovered=await probe([
  {fulfillmentChannelCode:'MFN-EAST',quantity:4},
  {fulfillmentChannelCode:'MFN-WEST',quantity:7},
  {fulfillmentChannelCode:'MFN-EAST',quantity:4},
  {quantity:2},
]);
assert.deepEqual(discovered.result.locations,[{id:'MFN-EAST',name:'MFN-EAST'},{id:'MFN-WEST',name:'MFN-WEST'}]);
assert.equal(discovered.calls.length,2);
assert.match(discovered.calls[1].url,/includedData=fulfillmentAvailability,summaries/);
const noChannel=await probe([{quantity:3},{fulfillmentChannelCode:'  ',quantity:1}]);
assert.deepEqual(noChannel.result.locations,[],'Do not invent a DEFAULT channel when provider returned none');
console.log('PASS Amazon MFN location discovery uses only unique fulfillment-channel codes returned for the verified seller SKU.');

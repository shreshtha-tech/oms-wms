import assert from 'node:assert/strict';
import { normalizeShopifyOrderObservation } from '../inventory/shopify-orders.js';

const order={legacyResourceId:'9007199254740993',createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T01:00:00Z',cancelledAt:null,displayFulfillmentStatus:'UNFULFILLED',lineItems:{nodes:[{id:'gid://shopify/LineItem/123',sku:'FIXTURE-SKU',quantity:2,name:'Fixture'}],pageInfo:{hasNextPage:false}}};
const normalized=normalizeShopifyOrderObservation(order);
assert.equal(normalized.id,'9007199254740993','large provider IDs must retain their string identity');
assert.equal(normalized.line_items[0].id,'123');
assert.equal(normalized.line_items[0].quantity,2);
for(const incomplete of [
  {...order,legacyResourceId:null},
  {...order,legacyResourceId:Number.MAX_SAFE_INTEGER+2},
  {...order,updatedAt:null},
  {...order,lineItems:null},
  {...order,lineItems:{nodes:order.lineItems.nodes,pageInfo:{hasNextPage:true}}},
  {...order,lineItems:{nodes:[{id:'gid://shopify/LineItem/123',sku:'',quantity:2}],pageInfo:{hasNextPage:false}}},
  {...order,lineItems:{nodes:[{id:null,sku:'FIXTURE-SKU',quantity:2}],pageInfo:{hasNextPage:false}}},
]) assert.throws(()=>normalizeShopifyOrderObservation(incomplete));
console.log('PASS Shopify observation requires stable order/revision and complete physical line snapshots before cursor progress');

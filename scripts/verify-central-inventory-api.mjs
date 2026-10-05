import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { inventoryPrivate } from '../inventory/http.js';
import { inventoryPool, migrateInventory } from '../inventory/db.js';

const tenant=`central-api-test-${randomUUID()}`;
process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
await migrateInventory();
const app=express();app.use(express.json());app.use('/api/inventory-sync',inventoryPrivate);
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/inventory-sync/central`;
async function request(path,method='GET',body){const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
try{
  let response=await request('/products','POST',{sku:'TS-LIVE-1',productName:'Live SKU'});assert.equal(response.status,201);const masterSkuId=response.data.id;
  response=await request('/locations','POST',{code:'MAIN-WH',locationType:'warehouse'});assert.equal(response.status,201);const locationId=response.data.id;
  response=await request('/adjustments','POST',{masterSkuId,locationId,mode:'set',quantity:500,reason:'Opening count',requestId:'opening-1'});assert.equal(response.status,201);assert.equal(response.data.sellable,500);
  response=await request('/adjustments','POST',{masterSkuId,locationId,mode:'set',quantity:500,reason:'Opening count',requestId:'opening-1'});assert.equal(response.status,200);assert.equal(response.data.duplicate,true);
  response=await request('/alert-rules','POST',{masterSkuIds:[masterSkuId],threshold:100,enabled:true});assert.equal(response.status,200);
  response=await request('/adjustments','POST',{masterSkuId,locationId,mode:'delta',quantity:-405,reason:'Offline sale',requestId:'sale-1'});assert.equal(response.status,201);assert.equal(response.data.sellable,95);
  response=await request('/overview');assert.equal(response.status,200);assert.equal(Number(response.data.products[0].sellable),95);assert.equal(response.data.alerts.length,1);
  response=await request('/adjustments','POST',{masterSkuId,locationId,mode:'delta',quantity:10,reason:'Receipt',requestId:'receipt-1'});assert.equal(response.status,201);assert.equal(response.data.sellable,105);
  response=await request('/overview');assert.equal(response.data.alerts.length,0);
  response=await request('/events');assert.equal(response.status,200);assert.equal(response.data.length,3);
  console.log('PASS central inventory API: SKU/location, opening count, idempotency, offline sale, threshold alert and recovery');
}finally{await new Promise(resolve=>server.close(resolve));await inventoryPool().end();}

import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { waitForDataReady, closeDataStore, find } from '../api/mongo.js';
import purchaseOrders from '../api/purchase-orders.js';
assert.equal(new URL(process.env.MONGODB_URI||'').hostname,'127.0.0.1');assert.ok(process.env.MONGO_TEST_PROCESS_PID);
const invoke=async(method,body)=>{const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){}};await purchaseOrders({method,body,query:{},headers:{}},res);return res;};
try{
 assert.equal(await waitForDataReady(),'mongo');
 const inventoryBefore=await find('inventory');
 const draft={po_no:'QA-RETRY-PO',vendor:'Controlled Vendor',warehouse:'QA-WH',po_date:'2026-10-04',expected_date:'2026-10-10',buyer_name:'QA Buyer',recv_validation_code:'Standard',qty:1,amount:5,line_items:[]};
 const responses=await Promise.all(Array.from({length:20},()=>invoke('POST',draft)));
 assert.equal(responses.filter(r=>r.code===201).length,1);assert.equal(responses.filter(r=>r.code===409).length,19);
 const stored=await find('purchase_orders',{po_no:draft.po_no});assert.equal(stored.length,1);assert.equal(stored[0].status,'Pending Confirmation');
 const changed=await invoke('PUT',{id:stored[0].id,po_no:'RENAMED-PO'});assert.equal(changed.code,409);
 assert.equal((await find('purchase_orders',{id:stored[0].id}))[0].po_no,draft.po_no);
 assert.deepEqual(await find('inventory'),inventoryBefore);
 const client=new MongoClient(process.env.MONGODB_URI);try{await client.connect();const indexes=await client.db(process.env.MONGODB_DB).collection('purchase_orders').indexes();assert.ok(indexes.some(i=>i.name==='uq_purchase_order_number'&&i.unique));}finally{await client.close();}
 console.log('PASS real Mongo purchase-order reliability: 20 concurrent duplicate creates produce one durable draft, remaining requests conflict, identity cannot change, unique index verified, no stock mutation');
}finally{await closeDataStore();}

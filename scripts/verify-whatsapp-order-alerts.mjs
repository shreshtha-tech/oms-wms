import assert from 'node:assert/strict';
import { whatsappTemplatePayload, whatsappSetup } from '../inventory/whatsapp.js';

const settings={WHATSAPP_ORDER_TEMPLATE:'dmills_new_order',WHATSAPP_PACKING_TEMPLATE:'dmills_packing_ready',WHATSAPP_TEMPLATE_LANGUAGE:'en_US'};
const row={event_type:'new_order',platform:'shopify',external_order_id:'12345',mobile_e164:'+919876543210',dispatch_by:'2026-09-29T12:00:00Z'};
const items=[{seller_sku:'TS-001',quantity:2}];
const observed=whatsappTemplatePayload(row,items,settings);
assert.equal(observed.template.name,'dmills_new_order');
assert.equal(observed.to,'919876543210');
assert.deepEqual(observed.template.components[0].parameters.map(p=>p.text),['shopify','12345','TS-001 × 2','Check stock in D-Mills']);
const packing=whatsappTemplatePayload({...row,event_type:'packing_ready'},items,settings);
assert.equal(packing.template.name,'dmills_packing_ready');
assert.notEqual(packing.template.components[0].parameters[3].text,'Check stock in D-Mills');
assert.throws(()=>whatsappTemplatePayload(row,items,{}),/template is not configured/);
const previous=process.env.INVENTORY_PUBLIC_ORIGIN;
delete process.env.INVENTORY_PUBLIC_ORIGIN;
try{assert.equal(whatsappSetup().callbackUrl,null);}finally{if(previous===undefined)delete process.env.INVENTORY_PUBLIC_ORIGIN;else process.env.INVENTORY_PUBLIC_ORIGIN=previous;}
console.log('PASS WhatsApp order templates: immediate observed order, separate packing alert, exact four variables and setup status');

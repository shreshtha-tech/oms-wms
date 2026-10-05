import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { inventoryPool } from '../inventory/db.js';
import { currentCredentials } from '../inventory/connection-setup.js';
import { providerFetch } from '../inventory/connection-security.js';

// Verified: https://seller.flipkart.com/api-docs/order-api-docs/v3/PostShipmentSearch.html
// This bounded probe reads one page only. Pagination belongs to Step 2.
const api={url:'https://api.flipkart.net/sellers/v3/shipments/filter/',type:'preDispatch',states:['APPROVED','PACKED','READY_TO_DISPATCH'],pageSize:5,lookbackDays:7,
 // UNVERIFIED: live field presence, nested buyer/address/title/currency/payment
 // fields, modified-date filtering, and cancelled-filter casing. No mappings assumed.
 unverified:['live response shape','buyer/address/title/currency/payment fields','modified-date filter','cancelled-filter casing']};

const keys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
export async function probeFlipkartOrders(account,{credentials=currentCredentials,fetcher=providerFetch,now=Date.now()}={}){
 const result={tokenHttpStatus:null,tokenCallWorked:false,shipmentsHttpStatus:null,ordersPermission:'not_checked',shipmentKeys:[],orderItemKeys:[],priceComponentKeys:[],subShipmentKeys:[]};
 try{
  const fields=await credentials(account,{forceRefresh:true,fetcher:async(url,options)=>{
   const response=await fetcher(url,options);result.tokenHttpStatus=response.status;return response;
  }});
  result.tokenCallWorked=Boolean(fields?.accessToken);
  if(!result.tokenCallWorked)return result;
  const body={filter:{type:api.type,states:api.states,orderDate:{from:new Date(now-api.lookbackDays*86400000).toISOString(),to:new Date(now).toISOString()}},pagination:{pageSize:api.pageSize}};
  const response=await fetcher(api.url,{method:'POST',headers:{Authorization:`Bearer ${fields.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  result.shipmentsHttpStatus=response.status;
  result.ordersPermission=response.status===401?'401':response.status===403?'403':response.ok?'OK':'not_confirmed';
  if(response.ok){
   const data=await response.json();const shipment=Array.isArray(data?.shipments)?data.shipments[0]:null;
   result.shipmentKeys=keys(shipment);result.orderItemKeys=keys(shipment?.orderItems?.[0]);
   result.priceComponentKeys=keys(shipment?.orderItems?.[0]?.priceComponents);result.subShipmentKeys=keys(shipment?.subShipments?.[0]);
  }
 }catch{
  // Provider bodies/errors may contain credentials or buyer data. Emit no text from them.
 }
 return result;
}

async function main(){
 dotenv.config({quiet:true});
 let db;
 try{
  const tenant=process.env.INVENTORY_ALLOWED_TENANT_ID,accountId=process.argv[2]||process.env.INVENTORY_FLIPKART_ACCOUNT_ID;
  if(!tenant)throw new Error('configuration');
  db=inventoryPool();
  const {rows}=await db.query(`SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='flipkart'${accountId?' AND id=$2':''} LIMIT 2`,accountId?[tenant,accountId]:[tenant]);
  if(rows.length!==1)throw new Error('account_selection');
  const result=await probeFlipkartOrders(rows[0]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if(!result.tokenCallWorked||result.ordersPermission!=='OK'||!result.shipmentKeys.length)process.exitCode=1;
 }catch{
  process.stdout.write(`${JSON.stringify({tokenHttpStatus:null,tokenCallWorked:false,shipmentsHttpStatus:null,ordersPermission:'not_checked',shipmentKeys:[]})}\n`);process.exitCode=1;
 }finally{if(db)await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();

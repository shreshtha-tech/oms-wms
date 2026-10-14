import '../env.js';
import { inventoryPool } from '../inventory/db.js';
import { reconcileShopifyStock, reconcileWooUncertainStock, reconcileAmazonUncertainStock } from '../inventory/workers.js';
import { inventoryDriftCount } from '../inventory/drift-count.js';
const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;if(!tenantId)throw new Error('INVENTORY_ALLOWED_TENANT_ID required');
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
while(!stopped){
  try{
    const shopify=await reconcileShopifyStock(tenantId);
    const woocommerce=await reconcileWooUncertainStock(tenantId);
    const amazon=await reconcileAmazonUncertainStock(tenantId);
    const driftCount=await inventoryDriftCount(inventoryPool(),tenantId);
    console.log(JSON.stringify({kind:'inventory_reconciliation',shopify,woocommerce,amazon,driftCount,at:new Date().toISOString()}));
  }catch(error){console.error('Inventory reconciliation failed:',error);process.exitCode=1;}
  for(let i=0;i<900&&!stopped;i++)await new Promise(r=>setTimeout(r,1000));
}
await inventoryPool().end();

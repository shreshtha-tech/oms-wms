import { inventoryPool, transaction } from './db.js';
import { openCredential } from './credentials.js';
import { ShopifyConnector } from './connectors/shopify.js';

// Read-only Shopify queries. No stock mutation or mapping activation occurs here.
export async function refreshShopifySnapshot(tenantId,accountId,{connectorFactory=options=>new ShopifyConnector(options)}={}){
  const lock=await inventoryPool().connect();
  const lockName=`shopify-snapshot:${tenantId}:${accountId}`;
  let locked=false;
  try{
    locked=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[lockName])).rows[0].locked;
    if(!locked)throw Object.assign(new Error('A Shopify stock check is already running'),{status:409});
    const account=(await lock.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND platform='shopify'",[tenantId,accountId])).rows[0];
    if(!account)throw new Error('Shopify account not found');
    const secret=openCredential(account);
    const connector=connectorFactory({shop:account.external_account_id,token:secret.accessToken,clientId:secret.clientId,clientSecret:secret.clientSecret});
    const items=[],skuCounts=new Map(),seenIds=new Set();let cursor=null;
    for(let pageNo=0;pageNo<1000;pageNo++){
      const page=await connector.inventoryPage(cursor);
      if(!page?.nodes||!page.pageInfo)throw new Error('Shopify inventory response was incomplete');
      for(const item of page.nodes){
        if(seenIds.has(item.id))throw new Error('Shopify pagination repeated an inventory item; retry the snapshot');seenIds.add(item.id);
        item.sku=String(item.sku||'').trim();if(item.sku)skuCounts.set(item.sku,(skuCounts.get(item.sku)||0)+1);
        if(!item.tracked||!item.sku)continue;
        let levels=item.inventoryLevels;
        item.levels=[...levels.nodes];
        for(let n=0;levels.pageInfo.hasNextPage;n++){
          if(n>=100)throw new Error('Location pagination exceeded safe limit');
          levels=await connector.inventoryLevelPage(item.id,levels.pageInfo.endCursor);
          if(!levels)throw new Error('Inventory item disappeared during snapshot');
          item.levels.push(...levels.nodes);
        }
        items.push(item);
      }
      if(!page.pageInfo.hasNextPage)break;
      if(pageNo===999)throw new Error('Inventory pagination exceeded safe limit');
      cursor=page.pageInfo.endCursor;
    }
    const observedAt=new Date().toISOString();let matched=0,unmatched=0,duplicate=0;
    await transaction(async db=>{
      const mappings=(await db.query('SELECT m.*,s.sku FROM ci_channel_mapping m JOIN ci_master_sku s ON s.tenant_id=m.tenant_id AND s.id=m.master_sku_id WHERE m.tenant_id=$1 AND m.account_id=$2',[tenantId,accountId])).rows;
      await db.query('DELETE FROM ci_stock_observation WHERE tenant_id=$1 AND account_id=$2',[tenantId,accountId]);
      for(const item of items)for(const level of item.levels){
        const quantity=Object.fromEntries(level.quantities.map(q=>[q.name,q.quantity]));
        if(!['available','on_hand','committed'].every(k=>Number.isSafeInteger(quantity[k])))throw new Error('Shopify returned incomplete inventory quantities');
        const mapping=mappings.find(m=>m.listing_id===item.id&&m.external_location_id===level.location.id&&m.sku===item.sku&&m.external_sku===item.sku);
        const status=skuCounts.get(item.sku)>1?'duplicate_sku':mapping?'matched':'unmapped';
        if(status==='matched')matched++;else if(status==='duplicate_sku')duplicate++;else unmatched++;
        await db.query('INSERT INTO ci_stock_observation(tenant_id,account_id,external_item_id,external_location_id,sku,quantities,match_status,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenantId,accountId,item.id,level.location.id,item.sku,quantity,status,observedAt]);
        if(status==='matched')await db.query("INSERT INTO ci_channel_stock(tenant_id,mapping_id,observed_quantity,observed_at,publish_state) VALUES($1,$2,$3,$4,'observed') ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET observed_quantity=EXCLUDED.observed_quantity,observed_at=EXCLUDED.observed_at",[tenantId,mapping.id,quantity.available,observedAt]);
      }
      await db.query("INSERT INTO ci_sync_cursor(tenant_id,account_id,stream,last_success_at,cursor_value) VALUES($1,$2,'stock_snapshot',$3,$4) ON CONFLICT(tenant_id,account_id,stream) DO UPDATE SET last_success_at=EXCLUDED.last_success_at,cursor_value=EXCLUDED.cursor_value",[tenantId,accountId,observedAt,JSON.stringify({matched,unmatched,duplicate,itemsRead:seenIds.size})]);
    });
    return {shop:account.external_account_id,observedAt,itemsRead:seenIds.size,matched,unmatched,duplicate,stockWrites:0};
  }finally{if(locked)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockName]);lock.release();}
}

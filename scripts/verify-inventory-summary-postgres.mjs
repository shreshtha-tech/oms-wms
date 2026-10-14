import assert from 'node:assert/strict';
import { readInventorySummary } from '../inventory/read-model.js';

// Called only by the owned PostgreSQL runner with its checked-out fixture client.
export async function verifyInventorySummaryPostgres(db) {
  await db.query(`CREATE TEMP TABLE ci_master_sku (tenant_id text,id integer);
    CREATE TEMP TABLE ci_location (tenant_id text,id integer,location_type text);
    CREATE TEMP TABLE ci_inventory_balance (tenant_id text,master_sku_id integer,location_id integer,on_hand bigint,reserved_order bigint,reserved_cart bigint,damaged bigint,quarantined bigint,safety_stock bigint);
    CREATE TEMP TABLE ci_stock_alert (tenant_id text,master_sku_id integer,status text);
    CREATE TEMP TABLE ci_channel_account (tenant_id text,id integer,status text);
    CREATE TEMP TABLE ci_channel_mapping (tenant_id text,account_id integer,active boolean);`);
  const totals = result => Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'generatedAt'));
  assert.deepEqual(totals(await readInventorySummary('a', db)), { catalogSkus: 0, countedSkus: 0, sellable: 0, lowStock: 0, activeAccounts: 0 });
  await db.query(`INSERT INTO ci_master_sku VALUES ('a',1),('a',2),('a',3),('b',1);
    INSERT INTO ci_location VALUES ('a',1,'warehouse'),('a',2,'store'),('a',3,'marketplace'),('b',1,'warehouse');
    INSERT INTO ci_inventory_balance VALUES
      ('a',1,1,10,2,1,2,0,0),('a',1,2,1,0,0,0,0,2),
      ('a',2,3,100,0,0,0,0,0),('b',1,1,10000,0,0,0,0,0),('a',999,1,100,0,0,0,0,0);
    INSERT INTO ci_stock_alert VALUES ('a',1,'open'),('a',1,'closed'),('a',999,'open'),('b',1,'open');
    INSERT INTO ci_channel_account VALUES ('a',1,'active'),('a',2,'active'),('a',3,'inactive'),('b',1,'active');
    INSERT INTO ci_channel_mapping VALUES ('a',1,true),('a',1,true),('a',2,false),('a',3,true),('b',1,true);`);
  assert.deepEqual(totals(await readInventorySummary('a', db)), { catalogSkus: 3, countedSkus: 1, sellable: 5, lowStock: 1, activeAccounts: 1 });
  assert.deepEqual(totals(await readInventorySummary('b', db)), { catalogSkus: 1, countedSkus: 1, sellable: 10000, lowStock: 1, activeAccounts: 1 });
  await db.query("UPDATE ci_inventory_balance SET on_hand=9007199254740992 WHERE tenant_id='b'");
  await assert.rejects(readInventorySummary('b', db), /numeric range/);
}

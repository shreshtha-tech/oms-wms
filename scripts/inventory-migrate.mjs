import '../env.js';
import { migrateInventory,inventoryPool } from '../inventory/db.js';
await migrateInventory();await inventoryPool().end();console.log('Central inventory migration applied');

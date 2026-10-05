import '../../env.js';
import { insert } from '../../api/mongo.js';

await insert('generic_records',{module:'language-property',code:'TEST_LABEL',name:'TEST_LABEL',propertyKey:'TEST_LABEL',propertyType:'0',defaultValue:'Default test label',translations:{'1':'English test label'}});
await insert('generic_records',{module:'bill-party',code:'TEST_PARTY',name:'Test Bill Party'});
await insert('admin_records',{type:'accounting-log',tab:'tallyInterfaceTable',financialClient:'TLY',billPartyCode:'TEST_PARTY',intCode:'Sales',key2:'TEST-DOC-1',modifiedDate:'24/09/2026',status:'success',errorDesc:''});
await insert('admin_records',{type:'api-request',apiName:'eretail/v1/order/create',statusCode:200,durationMs:120,at:new Date().toISOString(),server:'test-api-1'});
await import('../../server.js');

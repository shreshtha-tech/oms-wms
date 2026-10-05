import { sendDatabaseUnavailable, cors, find, findOne, insert, remove, update } from './mongo.js';

const COLLECTION='external_app_definitions';
const text=(value)=>String(value??'').trim();

export default async function handler(req,res){
  if(cors(req,res))return;
  try{
    const body=req.body||{};
    if(req.method==='GET'||body.action==='search'){
      const extAppSubId=Number(req.query?.extAppSubId||body.extAppSubId);
      const rows=(await find(COLLECTION)).filter((row)=>!extAppSubId||row.ext_app_sub_id===extAppSubId);
      return res.status(200).json({rows});
    }
    if(req.method==='POST'){
      if(body.mode==='Delete'){
        const current=await findOne(COLLECTION,{id:Number(body.lineId)});if(!current)return res.status(404).json({jsonMessage:'Definition not found'});
        await remove(COLLECTION,current.id);
        return res.status(200).json({jsonMessage:null});
      }
      if(!text(body.definitionKey)||!text(body.description)||!text(body.content)||!text(body.recipientVal)||body.recipientVal==='-1'||!text(body.buyerVal)||body.buyerVal==='-1'||!text(body.orderStatus)||body.orderStatus==='-1')return res.status(400).json({jsonMessage:'Please fill all mandatory fields'});
      const variables=Array.isArray(body.variables)?body.variables:[];
      if(!variables.length||variables.some((variable)=>!text(variable.mapping)||variable.mapping==='-1')||variables.length>4)return res.status(400).json({jsonMessage:'Please fill all mandatory fields'});
      const extAppSubId=Number(body.extAppSubId),lineId=Number(body.lineId);
      const existing=lineId?await findOne(COLLECTION,{id:lineId}):(await find(COLLECTION)).find((row)=>row.ext_app_sub_id===extAppSubId&&row.definition_key===text(body.definitionKey));
      const now=new Date().toISOString();
      const document={ext_app_id:text(body.extAppID),ext_app_type:text(body.extAppType),ext_app_sub_id:extAppSubId,definition_key:text(body.definitionKey),description:text(body.description),content:text(body.content),recipient_val:text(body.recipientVal),buyer_val:text(body.buyerVal),variables,order_status:text(body.orderStatus),is_active:String(body.isActive??'1')==='1',created_by:existing?.created_by||'super admin',created_date:existing?.created_date||now,modified_by:'super admin',modified_date:now};
      const saved=existing?(await update(COLLECTION,existing.id,document))[0]:await insert(COLLECTION,document);
      return res.status(existing?200:201).json({jsonMessage:null,row:saved});
    }
    if(req.method==='PATCH'){
      const current=await findOne(COLLECTION,{id:Number(body.lineId)});if(!current)return res.status(404).json({jsonMessage:'Definition not found'});
      const saved=(await update(COLLECTION,current.id,{is_active:String(body.isActive)==='1',modified_by:'super admin',modified_date:new Date().toISOString()}))[0];
      return res.status(200).json({jsonMessage:null,row:saved});
    }
    return res.status(405).json({jsonMessage:'Method not allowed'});
  }catch(error){
    if (sendDatabaseUnavailable(res, error)) return;console.error('external app definitions error:',{ name: error?.name, code: error?.code });return res.status(500).json({jsonMessage:error.message})}
}

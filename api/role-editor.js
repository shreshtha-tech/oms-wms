import { sendDatabaseUnavailable, cors, find, insert, update } from './mongo.js';
const types=[['-1','--- Select ---'],['S','Seller Panel'],['C','Company'],['E','Enterprise']];
const columns=[['roleId','Role Id'],['roleTypeText','Role Type'],['description','Description'],['isActiveText','Is Active']];
const processes=[
 {id:'ADM006',text:'ADM006 Interface SKU Push',children:[{id:'ADM006^F001',text:'F001 View'}]},
 {id:'ADM007',text:'ADM007 Audit Log',children:[{id:'ADM007^F001',text:'F001 View'}]},
 {id:'ADM009',text:'ADM009 SKU Create/Import',children:[{id:'ADM009^F001',text:'F001 View'}]},
 {id:'ADM010',text:'ADM010 Force Order Pull',children:[{id:'ADM010^F001',text:'F001 View'}]},
 {id:'ARS001',text:'ARS001 ARS Enquiry',children:[{id:'ARS001^F001',text:'F001 View'}]},
 {id:'ASN001',text:'ASN001 ASN Maintenance',children:[{id:'ASN001^F001',text:'F001 View'},{id:'ASN001^F002',text:'F002 Save'}]},
 {id:'MST026',text:'MST026 Vendor Enquiry',children:[{id:'MST026^F001',text:'F001 View'}]},
 {id:'MST051',text:'MST051 Vendor Promotion Create/Edit',children:[{id:'MST051^F001',text:'F001 View'},{id:'MST051^F002',text:'F002 Save/Confirm'},{id:'MST051^F003',text:'F003 Cancel'}]},
 {id:'ODR001',text:'ODR001 Order Enquiry',children:[{id:'ODR001^F001',text:'F001 View'}]},
 {id:'PO001',text:'PO001 PO Enquiry',children:[{id:'PO001^F001',text:'F001 View'}]},
 {id:'RET001',text:'RET001 Vendor Return',children:[{id:'RET001^F001',text:'F001 View'},{id:'RET001^F002',text:'F002 Save'},{id:'RET001^F003',text:'F003 Confirm'},{id:'RET001^F004',text:'F004 Cancel'},{id:'RET001^F005',text:'F005 Print'},{id:'RET001^F006',text:'F006 Allocate'},{id:'RET001^F008',text:'F008 Hold'}]},
 {id:'RPT001',text:'RPT001 Shipment Label',children:[{id:'RPT001^F001',text:'F001 View'}]},
 {id:'RPT002',text:'RPT002 Invoice',children:[{id:'RPT002^F001',text:'F001 View'}]},
 {id:'TRF001',text:'TRF001 STO Toggle Button',children:[{id:'TRF001^F012',text:'F012 STO Toggle Button View'}]},
 {id:'WMS019',text:'WMS019 Customer Return Create/Edit',children:[{id:'WMS019^F007',text:'F007 Edit transporter and Refrence no'}]}
];
const seeds=[['00000','E','ConfirmInbound************************************'],['00001','C','CRM -Admin'],['00002','E','NOT IN USE'],['00003','E','AdminControls'],['00004','C','All Company Level Rights'],['00005','E','All Enterprise Level Rights'],['00006','E','Ent Finance'],['00007','C','Cmp Finance'],['00008','E','Ent Buyer'],['00009','C','Cmp Buyer'],['00010','C','Cmp Asst Buyer'],['00011','E','Ent Asst Buyer'],['00012','C','Cmp WMS Inbound QC'],['00013','C','WMS Level 2'],['00014','C','WMS Level 3'],['00015','C','WMS Level 4'],['00016','C','WMS Level 5'],['00017','C','WMS Level 6'],['00018','C','WMS Level 7'],['00019','E','Ent WMS Admin Create']].map(([roleId,roleType,description],i)=>({id:-(i+1),roleId,roleType,roleTypeText:types.find(x=>x[0]===roleType)?.[1],description,isActive:true,isActiveText:'Yes',createdBy:'super  admin',createDate:'02/04/2012',modifiedBy:i?'super  admin':'G-himani.g',modifiedDate:i?'14/11/2011':'16/10/2024',assigned:[]}));
const flat=nodes=>nodes.flatMap(n=>[n.id,...(n.children||[]).map(c=>c.id)]);
const prune=(nodes,ids)=>nodes.map(n=>{const children=(n.children||[]).filter(c=>ids.includes(c.id));return ids.includes(n.id)||children.length?{...n,children}:null}).filter(Boolean);
export default async function handler(req,res){if(cors(req,res))return;try{
 if(req.method==='GET')return res.json({types,columns,pageSizes:[20,50,100],tabs:['Roles','Process Mapping'],processes,defaults:{roleType:'-1',description:'',isActive:true},endpoints:{search:'jsonRoleSearch',loadTree:'jsonLoadRoleTreeData',move:'jsonAddRemoveAction',save:'jsonSaveRole'}});
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});const b=req.body||{},stored=(await find('admin_records',{type:'role'})).map(r=>({...r,roleTypeText:r.roleTypeText||types.find(x=>x[0]===r.roleType)?.[1],isActiveText:r.isActive===false?'No':'Yes'}));const all=[...seeds,...stored];
 if(b.action==='search'){let rows=all.filter(r=>(b.roleType==='-1'||!b.roleType||r.roleType===b.roleType)&&(!b.description||r.description.toLowerCase().includes(String(b.description).toLowerCase()))&&(!b.roleId||r.roleId.includes(b.roleId))&&(b.isActive===undefined||r.isActive===!!b.isActive));const size=[20,50,100].includes(+b.rows)?+b.rows:20,page=Math.max(1,+b.page||1);return res.json({gridModel:rows.slice((page-1)*size,page*size),page,total:Math.ceil(rows.length/size),records:rows.length,rows:size});}
 if(b.action==='load-tree'){const role=all.find(r=>r.roleId===b.roleId),assignedIds=role?.assigned||[];return res.json({availableNodes:prune(processes,flat(processes).filter(id=>!assignedIds.includes(id))),assignedNodes:prune(processes,assignedIds)});}
 if(b.action==='move'){if(!b.changeData?.length)return res.status(400).json({error:b.changeFlag==='Remove'?'Nothing to Remove.':'Nothing to add.'});const ids=b.changeData.flatMap(id=>{const p=processes.find(x=>x.id===id);return p?[p.id,...p.children.map(c=>c.id)]:[id]});const assigned=b.changeFlag==='Add'?[...new Set([...(b.assigned||[]),...ids])]:(b.assigned||[]).filter(id=>!ids.includes(id));return res.json({assigned,availableNodes:prune(processes,flat(processes).filter(id=>!assigned.includes(id))),assignedNodes:prune(processes,assigned)});}
 if(b.action==='save'){if(!b.roleType||b.roleType==='-1')return res.status(400).json({error:'Role Type is mandatory.'});if(!b.description)return res.status(400).json({error:'Description is mandatory.'});const existing=stored.find(r=>r.roleId===b.roleId);const nextId=b.roleId||String(Math.max(10075,...all.map(r=>+r.roleId||0))+1).padStart(5,'0'),payload={type:'role',roleId:nextId,roleType:b.roleType,roleTypeText:types.find(x=>x[0]===b.roleType)?.[1],description:b.description,isActive:!!b.isActive,isActiveText:b.isActive?'Yes':'No',assigned:b.assigned||[],modifiedBy:'demo-admin',modifiedDate:new Date().toLocaleDateString('en-GB')};if(existing){const [row]=await update('admin_records',existing.id,payload);return res.json({roleDTO:row,message:'Role updated successfully'});}const row=await insert('admin_records',{...payload,createdBy:'demo-admin',createDate:new Date().toLocaleDateString('en-GB')});return res.status(201).json({roleDTO:row,message:'Role saved successfully'});}
 return res.status(400).json({error:'Unsupported Role action'});
}catch(e){
    if (sendDatabaseUnavailable(res, e)) return;console.error('role editor error:',{ name: e?.name, code: e?.code });return res.status(500).json({error:e.message})}}

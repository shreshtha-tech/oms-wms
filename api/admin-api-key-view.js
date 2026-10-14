const visibleFields=[
 'id','type','owner','expiryDate','status','createdAt','updatedAt','permissions',
 'billToParty','timezone','maskStatus','isMonitor','allowedIps','apiType',
 'apiCategory','apiName','apiUrl','accessRights','keyForVinLister',
];
const visiblePermissionFields=['id','name','apiName','apiUrl','access','locations'];
const booleanFields=new Set(['isMonitor','accessRights','keyForVinLister']);
function publicPermissions(value){
 if(!Array.isArray(value))return [];
 return value.map(permission=>{
  if(typeof permission==='string')return permission;
  if(!permission||typeof permission!=='object'||Array.isArray(permission))return null;
  const visible={};
  for(const field of visiblePermissionFields)if(Object.hasOwn(permission,field)){
   const item=permission[field];
   if(field==='locations'){if(Array.isArray(item))visible[field]=item.filter(location=>typeof location==='string');}
   else if(field==='id'){if(Number.isSafeInteger(item))visible[field]=item;}
   else if(field==='access'){if(typeof item==='boolean')visible[field]=item;}
   else if(typeof item==='string')visible[field]=item;
  }
  return visible;
 }).filter(permission=>permission!==null);
}
export function adminApiKeyView(row) {
 const view={};
 for(const field of visibleFields)if(Object.hasOwn(row,field)){
  const item=row[field];
  if(field==='permissions')view[field]=publicPermissions(item);
  else if(field==='id'){if(Number.isSafeInteger(item))view[field]=item;}
  else if(field==='maskStatus'){
   if(typeof item==='string')view[field]=item;
   else if(Array.isArray(item))view[field]=item.filter(value=>typeof value==='string');
  }else if(booleanFields.has(field)){if(typeof item==='boolean')view[field]=item;}
  else if(typeof item==='string')view[field]=item;
 }
 view.version=Number.isSafeInteger(row.version)&&row.version>=0?row.version:0;
 view.apiKey=row.apiKey?'[stored]':'';
 return view;
}

import { sendDatabaseUnavailable, cors, find, findOne, insert, update } from './mongo.js';

const titles = [['-1','--- Select ---'],['4','Dr.'],['1','Mr.'],['2','Mrs.'],['3','Ms.']];
const statuses = [['-1','--- Select ---'],['1','Active'],['0','InActive'],['9','Locked']];
const userTypes = [['-1','--- Select ---'],['1001','Admin',true],['3','Distributor'],['1','Normal'],['2','Seller',true],['1002','SellerAdmin'],['4','Store']];
const selectOnly = [['-1','--- Select ---']];
const companies = async () => [...selectOnly, ...(await find('generic_records', { module: 'company' })).map(row => [String(row.code), String(row.name)])];
const roles = async () => [...selectOnly, ...(await find('admin_records', { type: 'role' })).map(row => [String(row.roleId), String(row.description)])];
const countries = [['-1','--- Select ---'],['107','INDIA'],['108','INDONESIA'],['140','MALAYSIA'],['205','SINGAPORE'],['228','THAILAND'],['242','UNITED KINGDOM'],['243','UNITED STATES']];
const indiaStates = [['-1','--- Select ---'],['DL','Delhi'],['HR','Haryana'],['KA','Karnataka'],['MH','Maharashtra'],['UP','Uttar Pradesh']];
const statusName = id => statuses.find(x=>x[0]===String(id))?.[1] || 'Active';
const typeName = id => userTypes.find(x=>x[0]===String(id))?.[1] || 'Normal';
const mandatory = b => !b.userId || b.title==='-1' || !b.firstName || !b.lastName || b.userType==='-1' || !b.address1 || !b.country || b.country==='-1' || !b.state || b.state==='-1' || !b.city || !b.phone1 || !b.emailId1;

export default async function handler(req,res){
  if(cors(req,res))return;
  try{
    if(req.method==='GET'){
      const userId=String(req.query.userId||'');
      if(userId){const row=(await find('admin_records',{type:'user'})).find(x=>String(x.username).toLowerCase()===userId.toLowerCase());if(!row)return res.status(404).json({error:'User not found'});return res.json({row});}
      return res.json({titles,statuses,userTypes,companies:await companies(),roles:await roles(),countries,states:indiaStates,udfCount:5,roleColumns:['Company','Location','Role Desc','Role Id'],defaults:{title:'-1',status:'1',userType:'1'},endpoints:{save:'saveUserDetailBS',roles:'jsonRoleAdd',roleSearch:'jsonSearchRoles',countryState:'jsonCountryStateData',resetMfa:'resetMfa',passwordPolicy:'fetchPasswordPolicy',changePassword:'changePassword'}});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const b=req.body||{};
    if(b.action==='catalog'){return res.json(b.kind==='states'?{states:b.country==='107'?indiaStates:selectOnly}:{roles:await roles(),locations:[...selectOnly,...(await find('generic_records',{module:'location'})).map(row=>[String(row.code),String(row.name)])]});}
    if(b.action==='role-add'){if(b.company==='-1'||!b.company)return res.status(400).json({error:'Please Select Company'});if(b.company!=='**'&&b.location==='-1')return res.status(400).json({error:'Please Select Location'});if(!b.roleIds?.length||b.roleIds.includes('-1'))return res.status(400).json({error:'Please Select Role'});const company=(await companies()).find(x=>x[0]===b.company)?.[1]||b.company;const roleOptions=await roles();return res.json({roles:b.roleIds.map(id=>({company,location:b.locationName||'',role:roleOptions.find(x=>x[0]===id)?.[1]||id,roleIdGrid:id,orgId:company}))});}
    if(b.action==='reset-mfa'){if(!b.userId)return res.status(400).json({error:'User Name is mandatory'});return res.json({jsonMessage:'MFA reset successfully.'});}
    if(b.action==='password-policy')return res.json({passwordPolicyMap:{pwdLength:8,characterRegex:1,numericRegex:1,upperCaseRegex:1,specialCaseRegex:'[^a-zA-Z0-9]'}});
    if(b.action==='change-password'){if(!b.userId)return res.status(400).json({error:'User Name is mandatory'});if(!b.password)return res.status(400).json({error:'Please enter password.'});if(b.password.toLowerCase().includes(String(b.userId).toLowerCase()))return res.status(400).json({error:'Password must not contain your username.'});if(/(?:012|123|234|345|456|567|678|789)/.test(b.password))return res.status(400).json({error:'Password cannot include numeric sequences.'});if(b.password.length<8)return res.status(400).json({error:'Password must be 8 character long.'});if(!/[a-zA-Z]/.test(b.password))return res.status(400).json({error:'Password must contain alphabets.'});if(!/[0-9]/.test(b.password))return res.status(400).json({error:'Password must contain numeric digit.'});if(!/[A-Z]/.test(b.password))return res.status(400).json({error:'Password must contain uppercase letter.'});if(!/[^a-zA-Z0-9]/.test(b.password))return res.status(400).json({error:'Password must contain special character.'});const row=(await find('admin_records',{type:'user'})).find(x=>String(x.username).toLowerCase()===String(b.userId).toLowerCase());if(row)await update('admin_records',row.id,{passwordResetAt:new Date().toISOString(),forceChangePwdOnNextLogin:'Y'});return res.json({userId:b.userId,reLogin:false});}
    if(b.action!=='save')return res.status(400).json({error:'Unsupported User action'});
    if(mandatory(b))return res.status(400).json({error:'Please fill all mandatory fields'});
    if(String(b.userId).includes(' '))return res.status(400).json({error:'White Spaces are not allowed'});
    if(!/^[a-zA-Z0-9._]+$/.test(b.userId))return res.status(400).json({error:'Please enter AlphaNumerics only'});
    if(b.userType==='3'&&!b.pincode)return res.status(400).json({error:'Please Enter Shipping Pincode'});
    if(!/^[\w.-]+@([\w-]+\.)+[\w-]{2,4}$/.test(b.emailId1))return res.status(400).json({error:'Please enter valid Email Address'});
    const all=await find('admin_records',{type:'user'}),existing=all.find(x=>String(x.username).toLowerCase()===String(b.userId).toLowerCase());
    const payload={type:'user',username:b.userId,firstName:b.firstName,middleName:b.middleName||'',lastName:b.lastName,designation:b.designation||'',title:b.title,dobStr:b.dobStr||'',status:statusName(b.status),statusId:b.status,userType:typeName(b.userType),userTypeId:b.userType,purchaseOrderLimit:b.purchaseOrderLimit||'',isMFA:!!b.isMFA,address1:b.address1,address2:b.address2||'',address3:b.address3||'',country:b.country,state:b.state,city:b.city,pincode:b.pincode||'',phone1:b.phone1,phone2:b.phone2||'',email:b.emailId1,emailId1:b.emailId1,emailId2:b.emailId2||'',udf:b.udf||Array(5).fill(''),roles:b.roles||[],updatedAt:new Date().toISOString(),version:(existing?.version||0)+1};
    if(existing){const [row]=await update('admin_records',existing.id,payload);return res.json({row,message:'User updated successfully'});}const row=await insert('admin_records',{...payload,createdAt:new Date().toISOString()});return res.status(201).json({row,message:'User saved successfully'});
  }catch(error){
    if (sendDatabaseUnavailable(res, error)) return;console.error('user editor error:',{ name: error?.name, code: error?.code });return res.status(500).json({error:error.message});}
}

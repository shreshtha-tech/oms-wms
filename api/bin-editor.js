import { sendDatabaseUnavailable, cors, find, findOne, insert, remove, update } from './mongo.js';
import { clientPairs, locations } from './catalogs.js';
import { currentUser } from './auth-session.js';
const text = (value) => String(value ?? '').trim();
const required = (body) => {
  if (!text(body.binCode)) return 'Please enter bin code';
  if (!text(body.binFlag) || text(body.binFlag) === '-1') return 'Please select BIN Flag';
  if (!text(body.binType) || text(body.binType) === '-1') return 'Please select BIN Type';
  if (!text(body.zone) || text(body.zone) === '-1') return 'Please select Zone';
  if (!text(body.invBucket) || text(body.invBucket) === '-1') return 'Please select BIN Bucket';
  if (!text(body.binLocationType) || text(body.binLocationType) === '-1') return 'Please select Bin Location Type';
  if (['12','13','Drop Zone','Pack Station'].includes(text(body.binType)) && !['30','In Process'].includes(text(body.invBucket))) return 'Bin bucket should be InProcess for bin type Drop Zone/Pack Station';
  if (!body.looseId && text(body.lpnCapacity) && (!Number.isFinite(Number(body.lpnCapacity)) || Number(body.lpnCapacity) <= 0)) return 'LPN capacity Should be valid number having value greater than zero.';
  for (const [key,label] of [['cubeCapacity','Cube Capacity'],['xcord','X Coordinate'],['ycord','Y Coordinate'],['zcord','Z Coordinate'],['length','Length'],['width','Width'],['height','Height'],['weightCapacity','Weight Capacity']]) if (Number(body[key] || 0) > 9999) return `${label} cannot Exceed 9999.`;
  if (Number(body.approximateUnits || 0) > 100000) return 'Approx. No Of Units cannot Exceed 100000.';
  if (!/^\d*$/.test(text(body.thresholdQty))) return 'Threshold Qty must be an integer value';
  if (Number(body.thresholdQty || 0) > 100000) return 'Threshold Qty cannot Exceed 100000.';
  if (Number(body.thresholdQty || 0) > Number(body.approximateUnits || 0)) return 'ThresHold Qty must be less than or equal to Approx. No Of Units';
  return '';
};
const normalize = (row) => ({ ...row, locCode: row.loc_code || '', binCode: row.bin_code || row.code || '', binType: row.bin_type || '2', binFlag: row.bin_flag || '2', status: row.status !== 'Inactive', invBucket: row.inv_bucket || '-1', zone: row.zone || '-1', binLocationType: row.bin_location_type || '-1' });
export default async function handler(req,res) {
  if (cors(req,res)) return;
  try {
    if (req.method === 'GET') { const [generic, configuredLocations, clients] = await Promise.all([find('generic_records'), locations(), clientPairs()]); return res.json({ zones: generic.filter(x=>x.module==='wms-zone').map(x=>x.code), bins: generic.filter(x=>x.module==='bin-enquiry').map(normalize), locations: configuredLocations, clients }); }
    const body=req.body||{}, code=text(body.binCode).toUpperCase();
    if (req.method === 'POST' || req.method === 'PUT') {
      const error=required(body); if(error) return res.status(400).json({error});
      const configuredLocation=(await locations()).find(row=>row.code===text(body.locCode));
      if(!configuredLocation)return res.status(400).json({error:'Please select a configured site location'});
      const configuredClients=await clientPairs();
      if(!Array.isArray(body.clients ?? []) || (body.clients ?? []).some(client=>!configuredClients.some(([code])=>code===text(client))))return res.status(400).json({error:'Please select configured clients'});
      const all=await find('generic_records',{module:'bin-enquiry'}); const existing=all.find(x=>text(x.bin_code||x.code).toUpperCase()===code);
      if(req.method==='POST'&&existing) return res.status(409).json({error:'This Bin is already exist with this location.'});
      const fields={module:'bin-enquiry',code,name:`Bin ${code}`,bin_code:code,loc_code:configuredLocation.code,location:configuredLocation.name,status:body.status===false?'Inactive':'Active',bin_type:text(body.binType),bin_flag:text(body.binFlag),inv_bucket:text(body.invBucket),zone:text(body.zone),aisle:text(body.aisle),seq_no:text(body.seqNo),bin_location_type:text(body.binLocationType),allowed_uoms:body.allowedUoms||[],xcord:text(body.xcord),ycord:text(body.ycord),zcord:text(body.zcord),order_tags:body.orderTags||[],site_locations:body.siteLocations||[],commingle_item:!!body.commingleItem,commingle_lot:!!body.commingleLot,def_inb_bin:!!body.defInbBin,inbound_types:body.inboundTypes||[],clients:body.clients||[],def_ret_bin:!!body.defRetBin,def_rto_bin:!!body.defRTOBin,def_cross_dock_bin:!!body.defCrossDockBin,def_usn_bin:!!body.defUSNBin,loose_id:!!body.looseId,lpn_capacity:text(body.lpnCapacity),fnv_cross_dock:!!body.fnvCrossDock,carry_forward:!!body.carryForward,non_carry_forward:!!body.nonCarryForward,lot_attributes:body.lotAttributes||[],cube_capacity:Number(body.cubeCapacity||0),weight_capacity:Number(body.weightCapacity||0),length:Number(body.length||0),width:Number(body.width||0),height:Number(body.height||0),approximate_units:Number(body.approximateUnits||0),threshold_qty:Number(body.thresholdQty||0),udf1:text(body.udf1),udf2:text(body.udf2),udf3:text(body.udf3),udf4:text(body.udf4),udf5:text(body.udf5),modified_by:currentUser(req)?.username||'unknown',modified_date:new Date().toISOString()};
      if(req.method==='PUT'){if(!existing)return res.status(404).json({error:'Bin was not found.'});const changed=await update('generic_records',existing.id,fields);return res.json({row:normalize(changed[0]),jsonMessage:'Data saved successfully.'});}
      const row=await insert('generic_records',{...fields,created_by:currentUser(req)?.username||'unknown',created_date:new Date().toISOString()});return res.status(201).json({row:normalize(row),jsonMessage:'Data saved successfully.'});
    }
    if(req.method==='DELETE'){const current=await findOne('generic_records',{id:Number(body.id)});if(!current||current.module!=='bin-enquiry')return res.status(404).json({error:'Bin was not found.'});await remove('generic_records',current.id);return res.json({jsonMessage:'Bin deleted successfully.'});}
    return res.status(405).json({error:'Method not allowed'});
  } catch(error){
    if (sendDatabaseUnavailable(res, error)) return;console.error('Bin editor error:',{ name: error?.name, code: error?.code });return res.status(500).json({error:error.message});}
}

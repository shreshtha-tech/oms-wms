import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(){const value=process.env.INVENTORY_CREDENTIAL_KEY;if(!/^[0-9a-f]{64}$/i.test(value||''))throw new Error('INVENTORY_CREDENTIAL_KEY must be a 32-byte hex key');return Buffer.from(value,'hex');}
export function sealCredential(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv),encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return {encrypted,iv,tag:cipher.getAuthTag()};}
export function openCredential(row){
 try{
  if(!Buffer.isBuffer(row?.credential_iv)||row.credential_iv.length!==12||!Buffer.isBuffer(row?.credential_tag)||row.credential_tag.length!==16||!Buffer.isBuffer(row?.encrypted_credentials)||!row.encrypted_credentials.length)throw new Error('Invalid credential format');
  const decipher=createDecipheriv('aes-256-gcm',key(),row.credential_iv,{authTagLength:16});
  decipher.setAuthTag(row.credential_tag);
  return JSON.parse(Buffer.concat([decipher.update(row.encrypted_credentials),decipher.final()]).toString());
 }catch{
  throw Object.assign(new Error('Stored credentials could not be decrypted. Verify the private key and credential record.'),{code:'CREDENTIAL_DECRYPTION_FAILED'});
 }
}

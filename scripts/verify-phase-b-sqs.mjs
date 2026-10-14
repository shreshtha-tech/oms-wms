import assert from 'node:assert/strict';
import { pollAmazonSqs } from '../inventory/sqs-worker.js';
const deleted=[],accepted=[],errors=[];
const client={async send(command){
 if(command.constructor.name==='ReceiveMessageCommand')return {Messages:[
  {Body:'{bad',ReceiptHandle:'poison'},
  {Body:JSON.stringify({NotificationType:'ORDER_CHANGE'}),ReceiptHandle:'valid'},
  {Body:JSON.stringify({NotificationType:'ORDER_CHANGE',bad:true}),ReceiptHandle:'rejected'},
 ]};
 deleted.push(command.input.ReceiptHandle);return {};
}};
const count=await pollAmazonSqs({queueUrl:'synthetic',tenantId:'synthetic',accountId:'synthetic',client,
 accept:async({notification})=>{if(notification.bad)throw Error('synthetic rejection');accepted.push(notification.NotificationType)},
 onMessageError:code=>errors.push(code)});
assert.equal(count,3);assert.deepEqual(accepted,['ORDER_CHANGE']);assert.deepEqual(deleted,['valid']);assert.deepEqual(errors,['AMAZON_MESSAGE_UNRESOLVED','AMAZON_MESSAGE_UNRESOLVED']);
console.log('PASS: SQS poison isolation; only durably accepted synthetic message acknowledged.');

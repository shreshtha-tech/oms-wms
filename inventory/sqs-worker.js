import { SQSClient,ReceiveMessageCommand,DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { acceptAmazonNotification } from './ingress.js';

export async function pollAmazonSqs({queueUrl,tenantId,accountId,client=new SQSClient({})}){
  const response=await client.send(new ReceiveMessageCommand({QueueUrl:queueUrl,MaxNumberOfMessages:10,WaitTimeSeconds:20}));
  for(const message of response.Messages||[]){
    // Queue policy must restrict senders to the authorized Amazon notification destination.
    const envelope=JSON.parse(message.Body);const notification=typeof envelope.Message==='string'?JSON.parse(envelope.Message):envelope;
    await acceptAmazonNotification({tenantId,accountId,notification});
    await client.send(new DeleteMessageCommand({QueueUrl:queueUrl,ReceiptHandle:message.ReceiptHandle}));
  }
  return response.Messages?.length||0;
}

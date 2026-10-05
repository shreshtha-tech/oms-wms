import { providerFetch } from '../connection-security.js';
export class AmazonConnector {
  constructor({sellerId,marketplaceId,clientId,clientSecret,refreshToken,endpoint='https://sellingpartnerapi-fe.amazon.com',fetcher=providerFetch,rateControl}){
    this.sellerId=sellerId;this.marketplaceId=marketplaceId;this.clientId=clientId;this.clientSecret=clientSecret;this.refreshToken=refreshToken;this.endpoint=endpoint;this.fetcher=fetcher;this.rateControl=rateControl;this.token='';this.tokenExpires=0;this.nextPatchAt=0;this.patchTokens=10;
  }
  async accessToken(){
    if(this.token&&Date.now()<this.tokenExpires-60000)return this.token;
    const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:this.refreshToken,client_id:this.clientId,client_secret:this.clientSecret});
    const response=await this.fetcher('https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Object.assign(new Error(`Amazon LWA token request failed (${response.status})`),{providerStatus:response.status});
    const data=await response.json();if(typeof data.access_token!=='string'||!data.access_token)throw new Error('Amazon returned an invalid token response');this.token=data.access_token;this.tokenExpires=Date.now()+Number(data.expires_in)*1000;return this.token;
  }
  async request(path,{method='GET',body}={}){
    if(this.rateControl)await this.rateControl(1);
    const response=await this.fetcher(`${this.endpoint}${path}`,{method,headers:{'x-amz-access-token':await this.accessToken(),'Content-Type':'application/json','User-Agent':'CentralInventory/1.0 (Language=JavaScript)'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error(`Amazon SP-API failure (${response.status})`),{providerStatus:response.status,diagnostic:data});if(data===null||typeof data!=='object')throw new Error('Amazon returned an invalid JSON response');return data;
  }
  async patchMfnQuantity({sellerSku,quantity,productType='PRODUCT',fulfillmentChannelCode='DEFAULT'}){
    if(!Number.isSafeInteger(quantity)||quantity<0)throw new TypeError('Quantity must be a nonnegative integer');
    // Default documented usage plan: 5 requests/s, burst 10, per connector instance.
    const now=Date.now();this.patchTokens=Math.min(10,this.patchTokens+Math.max(0,now-this.nextPatchAt)/200);this.nextPatchAt=now;
    if(this.patchTokens<1){await new Promise(r=>setTimeout(r,Math.ceil((1-this.patchTokens)*200)));this.patchTokens=1;}this.patchTokens--;
    const path=`/listings/2021-08-01/items/${encodeURIComponent(this.sellerId)}/${encodeURIComponent(sellerSku)}?marketplaceIds=${encodeURIComponent(this.marketplaceId)}`;
    return this.request(path,{method:'PATCH',body:{productType,patches:[{op:'replace',path:'/attributes/fulfillment_availability',value:[{fulfillment_channel_code:fulfillmentChannelCode,quantity}]}]}});
  }
  async getFbaInventory({nextToken,granularityId=this.marketplaceId}={}){
    const query=new URLSearchParams({granularityType:'Marketplace',granularityId,marketplaceIds:this.marketplaceId,details:'true'});if(nextToken)query.set('nextToken',nextToken);
    return this.request(`/fba/inventory/v1/summaries?${query}`);
  }
}

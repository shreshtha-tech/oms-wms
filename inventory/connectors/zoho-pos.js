import { providerFetch } from '../connection-security.js';
export class ZohoPosConnector {
  constructor({region='in',organizationId,accessToken,fetcher=providerFetch}){if(!['in','com'].includes(region))throw new Error('Unsupported Zoho POS region');this.base=`https://api.zakya.${region}/inventory/v1`;this.organizationId=organizationId;this.accessToken=accessToken;this.fetcher=fetcher;this.calls=[];}
  async request(path){
    const now=Date.now();this.calls=this.calls.filter(t=>now-t<60000);if(this.calls.length>=100)await new Promise(r=>setTimeout(r,60000-(now-this.calls[0])));this.calls.push(Date.now());
    const response=await this.fetcher(`${this.base}${path}${path.includes('?')?'&':'?'}organization_id=${encodeURIComponent(this.organizationId)}`,{signal:AbortSignal.timeout(20000),headers:{Authorization:`Zoho-oauthtoken ${this.accessToken}`}});
    const data=await response.json();if(!response.ok||data.code&&data.code!==0)throw Object.assign(new Error(`Zoho POS failure (${response.status})`),{providerStatus:response.status});return data;
  }
  async listItems(page=1){return this.request(`/items?page=${page}`);}
  async getItem(id){return this.request(`/items/${encodeURIComponent(id)}`);}
  async listInvoices(page=1){return this.request(`/invoices?page=${page}`);}
  // Stock writes require a separately authorized inventory-adjustment workflow.
}

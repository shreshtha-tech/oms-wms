import { Link, useSearchParams } from 'react-router-dom';
import SaleOrders from './SaleOrders';
import OrderEnquiry from '../eretail/sales/OrderEnquiry';
import MasterOrderEnquiry from '../eretail/sales/MasterOrderEnquiry';
import GlobalOrderSearch from '../eretail/sales/GlobalOrderSearch';
import Shell from '../eretail/Shell';

export default function DemoOrderViews(){
 const [params,setParams]=useSearchParams();const view=params.get('view')||'sale';
 const tabs=[['sale','Sale Orders'],['enquiry','Order Enquiry'],['master','Master Order Enquiry'],['global','Global Order Search']];
 const content=<div className="p-4"><div className="mb-4 rounded border border-amber-300 bg-amber-50 p-4"><h1 className="text-xl font-semibold">Demo data · ERP workspace</h1><p className="text-sm">These records are seeded in the legacy ERP store. They are excluded from live seller order counts, search, and inventory synchronization.</p><Link className="text-blue-700 underline" to="/app/sale-orders">Return to live orders</Link></div><nav className="mb-4 flex flex-wrap gap-2" aria-label="Demo order views">{tabs.map(([key,label])=><button key={key} className={`rounded border px-3 py-2 ${view===key?'bg-blue-100':''}`} onClick={()=>setParams({view:key})}>{label}</button>)}</nav>{view==='enquiry'?<OrderEnquiry/>:view==='master'?<MasterOrderEnquiry/>:view==='global'?<GlobalOrderSearch/>:<SaleOrders/>}</div>;
 return view==='sale'?<Shell active="sales" breadcrumb="SALES > Demo data" openScreens={[{label:'Demo data',to:'#'}]}>{content}</Shell>:content;
}

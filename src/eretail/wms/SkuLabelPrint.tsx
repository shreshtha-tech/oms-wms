import { useState } from 'react';
import { Printer, RotateCcw } from 'lucide-react';
import Shell from '../Shell';
import { Btn, Panel } from '../parts';

export default function SkuLabelPrint() {
  const [labelId, setLabelId] = useState('1');
  const [data, setData] = useState('');
  const reset = () => setData('');

  return (
    <Shell active="wms" breadcrumb="WMS > Setup > SKU Label Print" openScreens={[{ label: 'SKU Label Print', to: '#' }]}>
      <div role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Label rendering, printer output, and PDF generation are not connected. Print and PDF stay unavailable until a real output service is configured.
      </div>
      <div className="mb-3 flex justify-end gap-2">
        <Btn variant="warn" disabled><Printer size={15} />Print</Btn>
        <Btn variant="ghost" disabled>PDF</Btn>
        <Btn variant="ghost" onClick={reset}><RotateCcw size={15} />Reset</Btn>
      </div>
      <Panel title="SKU Label Print">
        <label className="block max-w-md text-xs text-slate-600">
          Label Type
          <select aria-label="Label Type" className="inp mt-1" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
            <option value="-1">--- Select ---</option>
            <option value="1">AJIO_BUSINESS</option>
            <option value="2">LABEL</option>
          </select>
        </label>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label>
            <span className="sr-only">Label Data</span>
            <textarea aria-label="Label Data" className="inp min-h-60 font-mono" value={data} onChange={(event) => setData(event.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Failed SKU output is unavailable
            <textarea aria-label="Failed SKU" className="inp mt-1 min-h-60 font-mono" value="" disabled readOnly />
          </label>
        </div>
        <div className="mt-4 text-xs text-slate-500">
          <p>Expected input format: SKU,Qty,UomCode,SkuBarcode,Param1(optional),Param2(optional),Param3(optional),Param4(optional),Param5(optional).</p>
          <p>Maximum 100 lines per request. Input is not sent to a printer or converted into a label by this screen.</p>
        </div>
      </Panel>
    </Shell>
  );
}

import '../env.js';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,scryptSync } from 'node:crypto';
import { mkdir,readFile } from 'node:fs/promises';
import express from 'express';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { inventoryPrivate } from '../inventory/http.js';
import { inventoryPool,migrateInventory } from '../inventory/db.js';
import { currentUser,issueSession,verifyCredentials } from '../api/auth-session.js';

if(!/test|contract/.test(process.env.INVENTORY_DATABASE_URL||''))throw new Error('Use an isolated test database');
process.env.INVENTORY_ALLOWED_TENANT_ID=`ui-${randomUUID()}`;
const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
process.env.DMILLS_ADMIN_USER='inventory-ui-test';process.env.DMILLS_ADMIN_PASSWORD_HASH=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
await migrateInventory();
const app=express();app.use(express.json({limit:'10mb'}));
app.get('/api/auth/session',(req,res)=>res.json({user:currentUser(req),configured:true}));
app.post('/api/auth/login',async(req,res)=>{if(!await verifyCredentials(req.body.username,req.body.password))return res.sendStatus(401);issueSession(res,req.body.username);res.json({user:{username:req.body.username}});});
app.use('/api',(req,res,next)=>currentUser(req)?next():res.status(401).json({error:'Sign in to continue.'}));
app.use('/api/inventory-sync',inventoryPrivate);app.use(express.static('dist'));app.get(/^(?!\/api).*/,(_,res)=>res.sendFile('index.html',{root:'dist'}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('artifacts/central-inventory',{recursive:true});
try{
  assert.equal((await fetch(base+'/api/inventory-sync/central/overview')).status,401);
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByLabel('Login Id').fill('inventory-ui-test');await page.getByLabel('Password',{exact:true}).fill(password);await page.locator('button[type=submit]').click();
  await page.waitForURL('**/app/dashboard');await page.getByRole('link',{name:'Manage inventory'}).click();
  const active=()=>page.locator('[data-screen-frame][aria-hidden="false"]');
  const workspace=()=>active().locator('[data-central-inventory]');
  const go=async(name)=>{await workspace().getByRole('navigation').getByRole('button',{name,exact:true}).click();};
  await workspace().getByRole('heading',{name:'Master SKU balances'}).waitFor();
  await active().getByRole('button',{name:'Close Central Inventory',exact:true}).waitFor();
  await go('Record physical stock');await workspace().getByLabel('Location code',{exact:true}).fill('UI-WAREHOUSE');await workspace().getByRole('button',{name:'Add location',exact:true}).click();await workspace().getByText('Location created',{exact:true}).waitFor();
  // Real Shopify-derived stock is used when the read-only verifier supplied a sample.
  let sample={sku:'UI-STOCK-32B',on_hand:500,available:500};
  try{sample=JSON.parse(await readFile('artifacts/central-inventory/shopify-verified-sample.json','utf8'));}catch{}
  assert.ok(Number.isSafeInteger(sample.on_hand)&&sample.on_hand>=5);
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Physical counts');ws.addRow(['SKU','Product Name','Location','On hand']);ws.addRow([sample.sku,'Shopify quantity verification','UI-WAREHOUSE',sample.on_hand]);
  const buffer=Buffer.from(await wb.xlsx.writeBuffer());
  await go('Excel upload');await workspace().getByLabel('Excel file',{exact:true}).setInputFiles({name:'verified-stock.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});await workspace().getByLabel('Import purpose').selectOption('counts');await workspace().getByRole('button',{name:'Preview import',exact:true}).click();await workspace().getByRole('heading',{name:'Import preview'}).waitFor();assert.match(await workspace().innerText(),/1 rows · 1 new SKUs · 1 stock changes · 0 errors/);
  await workspace().getByRole('button',{name:'Commit verified counts'}).click();await workspace().getByText('Import committed; catalog and stock refreshed',{exact:true}).waitFor();
  await go('Record physical stock');await workspace().getByLabel('SKU',{exact:true}).selectOption({label:`${sample.sku} — Shopify quantity verification`});await workspace().getByLabel('Warehouse / store',{exact:true}).selectOption({label:'UI-WAREHOUSE'});await workspace().getByLabel('Operation').selectOption('delta');await workspace().getByLabel('Quantity',{exact:true}).fill('-5');await workspace().getByLabel('Low-stock threshold (optional)').fill(String(sample.on_hand-2));await workspace().getByLabel('Reason / reference').fill('Isolated sale verification');await workspace().getByRole('button',{name:'Record stock',exact:true}).click();await workspace().getByText('Stock recorded and alerts evaluated',{exact:true}).waitFor();
  await go('Low-stock alerts');await workspace().getByRole('heading',{name:'Open low-stock alerts'}).waitFor();assert.match(await workspace().innerText(),new RegExp(`${(sample.on_hand-5).toLocaleString('en-IN')} sellable`));
  await go('Stock overview');
  for(const format of ['Excel','PDF']){const event=page.waitForEvent('download');await workspace().getByRole('button',{name:`Download ${format}`,exact:true}).click();const file=await event;await file.saveAs(`artifacts/central-inventory/ui-download.${format==='Excel'?'xlsx':'pdf'}`);await workspace().getByText(`${format==='Excel'?'XLSX':'PDF'} downloaded`,{exact:true}).waitFor();}
  // Verify state survives reload and download data agrees with API/ledger.
  await page.reload({waitUntil:'domcontentloaded'});await workspace().getByRole('heading',{name:'Master SKU balances'}).waitFor();assert.ok((await workspace().innerText()).includes(sample.sku));
  for(const width of [1440,1024,768,390]){
    await page.setViewportSize({width,height:1000});
    for(const section of ['Stock overview','Record physical stock','Excel upload','Low-stock alerts','Channel connections','Ledger activity']){
      await go(section);
      const defects=await active().evaluate(root=>{
        const viewport=document.documentElement.clientWidth;
        return [...root.querySelectorAll('button,input,select,summary')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').filter(e=>{
          if(e.closest('.ci-table-scroll'))return false;
          const r=e.getBoundingClientRect();return r.width>0&&(r.left<-.5||r.right>viewport+.5);
        }).map(e=>({text:e.textContent?.slice(0,60)||e.getAttribute('aria-label'),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));
      });
      assert.deepEqual(defects,[],`${width}px ${section}: overflowing controls`);
      if(['Stock overview','Record physical stock'].includes(section))await page.screenshot({path:`artifacts/central-inventory/${width}-${section.replaceAll(' ','-')}.png`,fullPage:true});
    }
    const wms=active().getByTitle('WMS',{exact:true});await wms.click();
    const flyout=active().locator('[data-menu-flyout][data-menu-kind=wms]');await flyout.waitFor();
    const groups=await flyout.locator('[data-menu-group]').evaluateAll(nodes=>nodes.filter(n=>['Inventory','Miscellaneous'].includes(n.getAttribute('data-menu-group'))).map(n=>({name:n.getAttribute('data-menu-group'),top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight})));
    const inventory=groups.find(g=>g.name==='Inventory'),misc=groups.find(g=>g.name==='Miscellaneous');
    assert.ok(inventory&&misc&&inventory.bottom<=misc.top+1,`${width}px WMS Inventory overlaps Miscellaneous`);
    assert.ok(inventory.scrollHeight>inventory.clientHeight&&misc.scrollHeight>misc.clientHeight,`${width}px WMS groups should scroll independently`);
    await flyout.locator('[data-menu-group="Miscellaneous"]').evaluate(node=>{node.scrollTop=node.scrollHeight;});
    const last=flyout.getByTitle('QC Params Mapping',{exact:true});
    assert.ok(await last.isVisible(),`${width}px last Miscellaneous entry must remain reachable`);
    await page.screenshot({path:`artifacts/central-inventory/${width}-wms-menu.png`,fullPage:true});
    await wms.click();
    await active().getByTitle('Switch Location',{exact:true}).click();const dialog=active().getByRole('dialog',{name:'User Preferences'});await dialog.waitFor();const bounds=await dialog.locator(':scope > div').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:1000});await active().getByTitle('Dashboard',{exact:true}).click();await page.waitForURL('**/app/dashboard');await active().locator('[data-central-summary]').getByText('1',{exact:true}).first().waitFor();assert.ok((await active().locator('[data-central-summary]').innerText()).includes((sample.on_hand-5).toLocaleString('en-IN')));
  assert.deepEqual(errors,[]);console.log('PASS authenticated UI: Excel preview/commit, stock adjustment and threshold, real downloads, reload persistence, dashboard totals, 6 sections at 4 viewport sizes and preferences dialog');
}catch(error){await page.screenshot({path:"artifacts/central-inventory/ui-failure.png",fullPage:true});console.error((await page.locator('[data-screen-frame][aria-hidden="false"]').innerText()).slice(-2200));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));await inventoryPool().end();}

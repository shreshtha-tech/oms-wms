import '../env.js';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,scryptSync } from 'node:crypto';
import { mkdir,readFile } from 'node:fs/promises';
import express from 'express';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { inventoryPrivate } from '../inventory/http.js';
import { inventoryPool,migrateInventory } from '../inventory/db.js';
import { authenticateSession,currentUser,issueSession,verifyCredentials } from '../api/auth-session.js';

if(!/test|contract/.test(process.env.INVENTORY_DATABASE_URL||''))throw new Error('Use an isolated test database');
process.env.INVENTORY_ALLOWED_TENANT_ID=`ui-${randomUUID()}`;
const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
process.env.DMILLS_ADMIN_USER='inventory-ui-test';process.env.DMILLS_ADMIN_PASSWORD_HASH=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
await migrateInventory();
const app=express();app.use(express.json({limit:'10mb'}));
app.get('/api/auth/session',async(req,res)=>res.json({user:await authenticateSession(req),configured:true}));
app.post('/api/auth/login',async(req,res)=>{if(!await verifyCredentials(req.body.username,req.body.password))return res.sendStatus(401);const user=await issueSession(res,req.body.username);return res.json({user});});
app.use('/api',async(req,res,next)=>{req.user=await authenticateSession(req);return currentUser(req)?next():res.status(401).json({error:'Sign in to continue.'});});
app.use('/api/inventory-sync',inventoryPrivate);app.use(express.static('dist'));app.get(/^(?!\/api).*/,(_,res)=>res.sendFile('index.html',{root:'dist'}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
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
  await go('Channel connections');
  const configs=await (await page.request.get(base+'/api/inventory-sync/connections/catalog')).json();
  assert.equal(configs.platforms.length,20);
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});
   for(const config of configs.platforms){
    const row=workspace().locator('.seller-connections tbody tr').filter({has:page.getByText(config.name,{exact:true})});
    await row.getByRole('button',{name:/^(Connect|Set up report import|Pair local agent)$/}).click();
    const dialog=page.getByRole('dialog',{name:new RegExp(config.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});
    await dialog.waitFor();
    for(const field of config.fields)await dialog.getByLabel(field.label,{exact:true}).waitFor();
    assert.equal(await dialog.locator('form button').first().isDisabled(),true,config.key+' validates required fields');
    const overflow=await dialog.evaluate(root=>[...root.querySelectorAll('input,select,button')].filter(e=>e.getClientRects().length).some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>document.documentElement.clientWidth+1;}));
    assert.equal(overflow,false,config.key+' '+width+' controls fit');
    await dialog.getByRole('button',{name:'Close connection',exact:true}).click();
   }
  }
  const programmes=workspace().getByRole('heading',{name:'Marketplace programmes',exact:true});
  await programmes.scrollIntoViewIfNeeded();
  const myntraProgramme=workspace().locator('.ci-card tbody tr').filter({hasText:'Myntra M-Now'}).first();
  await myntraProgramme.getByRole('button',{name:'Manage Myntra M-Now',exact:true}).click();
  await workspace().getByLabel('Myntra M-Now parent platform',{exact:true}).waitFor();
  await workspace().getByRole('button',{name:'Connect Myntra PPMP',exact:true}).click();
  const myntraProgrammeDialog=page.getByRole('dialog',{name:/Set up authorized report import: Myntra PPMP/});
  await myntraProgrammeDialog.getByLabel('Seller / brand account',{exact:true}).waitFor();
  await myntraProgrammeDialog.getByLabel('Partner ticket / contract reference (optional)',{exact:true}).waitFor();
  await myntraProgrammeDialog.getByRole('button',{name:'Close connection',exact:true}).click();
  const amazonProgramme=workspace().locator('.ci-card tbody tr').filter({hasText:'Amazon Now'}).first();
  await amazonProgramme.getByRole('button',{name:'Manage Amazon Now',exact:true}).click();
  await workspace().getByRole('button',{name:'Connect Amazon MFN',exact:true}).click();
  const amazonProgrammeDialog=page.getByRole('dialog',{name:/Connect seller portal: Amazon MFN/});
  await amazonProgrammeDialog.getByLabel('Seller ID',{exact:true}).waitFor();
  await amazonProgrammeDialog.getByLabel('Marketplace ID',{exact:true}).waitFor();
  await amazonProgrammeDialog.getByRole('button',{name:'Close connection',exact:true}).click();
  for(const [nav,heading] of [['Unified orders','Unified orders'],['Returns','Returns'],['Mobile team','Mobile team'],['Connection health','Connection and alert health']]){
   await go(nav);await workspace().getByRole('heading',{name:heading,exact:true}).waitFor();
   for(const width of [1440,390]){await page.setViewportSize({width,height:900});const overflow=await workspace().evaluate(root=>[...root.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length&&!e.closest('.ci-table-scroll')).some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>document.documentElement.clientWidth+1;}));assert.equal(overflow,false,nav+' '+width+' controls fit');}
  }
  await go('Unified orders');
  const connectionStatus=workspace().getByLabel('Seller platform connections');
  const connectionSummary=await connectionStatus.locator('summary').innerText();
  assert.match(connectionSummary,/\d+ of 20 order feeds ready · \d+ not fully verified/);
  await connectionStatus.getByText('20 platforms do not currently have a verified, operational order feed').waitFor();
  const collapsed=await connectionStatus.locator('details').evaluate(element=>!element.open);
  assert.equal(collapsed,true,'platform statuses are collapsed by default');
  await connectionStatus.locator('summary').click();
  const tata=connectionStatus.locator('li').filter({hasText:'Tata CLiQ'});
  await tata.getByRole('button',{name:'Connect'}).click();
  const tataDialog=page.getByRole('dialog',{name:/Set up authorized report import: Tata CLiQ/});
  await tataDialog.waitFor();
  await tataDialog.getByLabel('Seller / brand account',{exact:true}).waitFor();
  await tataDialog.getByLabel('Partner ticket / contract reference (optional)',{exact:true}).waitFor();
  await tataDialog.getByRole('button',{name:'Close connection',exact:true}).click();
  await page.goto(`${base}/app/order-enquiry`,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Order Enquiry',exact:true}).waitFor();
  const enquiryConnections=page.getByLabel('Seller platform connections');
  await enquiryConnections.locator('summary').click();
  await enquiryConnections.locator('li').filter({hasText:'Nykaa Fashion'}).getByRole('button',{name:'Connect'}).click();
  await page.waitForURL('**/app/central-inventory?section=channels&platform=nykaa');
  const nykaaDialog=page.getByRole('dialog',{name:/Set up authorized report import: Nykaa Fashion/});
  await nykaaDialog.waitFor();
  await nykaaDialog.getByLabel('Partner ticket / contract reference (optional)',{exact:true}).waitFor();
  await nykaaDialog.getByRole('button',{name:'Close connection',exact:true}).click();
  await page.goto(`${base}/app/central-inventory?section=activity`,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Seller connection and sync attempts'}).waitFor();
  await go('Ledger activity');await workspace().getByRole('heading',{name:'Seller connection and sync attempts'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS seller connection UI: 20 platform dialogs, in-place Myntra M-Now and Amazon Now parent-account setup, unified-order status count/dropdown, Tata CLiQ setup, and cross-screen Order Enquiry → Nykaa setup navigation; validation, history and responsive layouts');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await inventoryPool().end();}

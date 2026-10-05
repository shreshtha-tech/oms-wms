import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { chromium } from 'playwright';

const inventory=JSON.parse(readFileSync('artifacts/navigation-audit/static-inventory.json','utf8'));
const port=3127,base=`http://127.0.0.1:${port}`;
const user='nav-audit-local',password=randomBytes(16).toString('hex'),salt=randomBytes(16).toString('hex');
const hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
const server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),MONGODB_URI:'',DMILLS_ADMIN_USER:user,DMILLS_ADMIN_PASSWORD_HASH:hash},stdio:['ignore','pipe','pipe']});
let serverOutput='';server.stdout.on('data',chunk=>{serverOutput+=chunk.toString().slice(0,500)});server.stderr.on('data',chunk=>{serverOutput+=chunk.toString().slice(0,500)});
let browser;
const results=[];
try{
  let ready=false;
  for(let n=0;n<80;n++){
    if(server.exitCode!==null)throw new Error(`Isolated server exited: ${serverOutput.slice(-500)}`);
    try{const response=await fetch(`${base}/api/auth/session`);if(response.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,150));
  }
  if(!ready)throw new Error(`Isolated server failed to start: ${serverOutput.slice(-500)}`);
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('textbox',{name:'Login Id'}).fill(user);
  await page.getByRole('textbox',{name:'Password'}).fill(password);
  await page.getByRole('button',{name:'Login',exact:true}).click();
  await page.waitForURL('**/app/dashboard',{timeout:10000});
  const urls=[...new Set(inventory.items.filter(x=>x.route).map(x=>x.route))];
  for(const route of urls){
    const api=[],errors=[];
    const onResponse=response=>{if(response.url().startsWith(`${base}/api/`))api.push({path:new URL(response.url()).pathname+new URL(response.url()).search,status:response.status()});};
    const onError=error=>errors.push(error.message);
    page.on('response',onResponse);page.on('pageerror',onError);
    let http=null,navigated=null,text='',alert='',pending=false;
    try{
      const response=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:20000});http=response?.status()??null;
      await page.waitForTimeout(320);
      navigated=new URL(page.url()).pathname;
      text=(await page.locator('[data-screen-frame][aria-hidden="false"]').innerText().catch(()=>page.locator('body').innerText())).slice(0,700);
      alert=(await page.locator('[role="alert"]').allInnerTexts().catch(()=>[])).join(' | ').slice(0,350);
      pending=/Checking session|Loading\.\.\.|Loading…|Request failed \(HTTP/.test(text);
    }catch(error){errors.push(error.message);}
    page.off('response',onResponse);page.off('pageerror',onError);
    results.push({route,http,navigated,text,alert,pending,api,errors});
  }
  const unlinked=[];
  for(const item of inventory.items.filter(x=>!x.route)){
    try{
      await page.goto(base+'/app/dashboard',{waitUntil:'domcontentloaded'});
      await page.getByTitle(item.rail,{exact:true}).first().hover();
      const button=page.locator('[data-menu-flyout]').getByTitle(item.label,{exact:true}).first();
      await button.click({timeout:2000});
      unlinked.push({label:item.label,rail:item.rail,after:new URL(page.url()).pathname});
    }catch(error){unlinked.push({label:item.label,rail:item.rail,error:error.message.slice(0,180)});}
  }
  mkdirSync('artifacts/navigation-audit',{recursive:true});
  writeFileSync('artifacts/navigation-audit/runtime-results.json',JSON.stringify({generatedAt:new Date().toISOString(),mode:'isolated local server, MongoDB disabled, ephemeral admin',results,unlinked},null,2));
  console.log(JSON.stringify({routes:urls.length,unlinked:unlinked.length,httpErrors:results.filter(x=>x.http!==200).length,redirects:results.filter(x=>x.navigated!==x.route).length,pageErrors:results.filter(x=>x.errors.length).length,apiErrors:results.filter(x=>x.api.some(a=>a.status>=400)).length,unlinkedNavigation:unlinked.filter(x=>x.after&&x.after!='/app/dashboard').length},null,2));
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
}

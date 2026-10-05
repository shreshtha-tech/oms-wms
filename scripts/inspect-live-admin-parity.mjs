import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/live-parity/admin';
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('selCompanyLocationBS.action'));
  if (!page) throw new Error('Authenticated LIVE shell unavailable');
  const names = ['Exports','Force Order Pull','Settings','Manage Api','API Dashboard','Language Setting','User Audit Logs','Accounting Log','Tax Integration Log','Device Tracking Log','External Apps Logs','POS Integration Log','Repush Log'];
  const links = await page.locator('a').evaluateAll((elements, names) => elements.filter(e => names.includes(e.textContent.trim())).map(e => ({text:e.textContent.trim(),href:e.getAttribute('href'),onclick:e.getAttribute('onclick')})), names);
  links.push({text:'Manage Api Add/Edit',onclick:'openScreen("Manage Api Add/Edit", "manageApiKeyEdit?seqId=","fa fa-fw fa-list-ol")'}, {text:'Register Webhook',onclick:'openScreen("Register Webhook", "manageApiWebhook","fa fa-fw fa-list-ol")'});
  await writeFile(`${output}/navigation.json`, JSON.stringify(links,null,2));
  console.log(`Found ${links.length} requested navigation entries`);
  if(process.argv[2]==='settings-diagnose') {
    const pending=[];
    const parser=await page.context().newPage();
    page.on('response',response=>{
      if(response.url().includes('displayAdminSettings'))pending.push((async()=>{const html=await response.text();const data=await parser.evaluate(html=>{
        const doc=new DOMParser().parseFromString(html,'text/html');
        const sections=[...doc.querySelectorAll('button[onclick*=showLink]')].map(e=>({title:e.textContent.trim().replace(/\s+/g,' ').slice(0,120),id:e.id,target:e.getAttribute('onclick')?.match(/'([^']+)'/)?.[1]})).map(section=>{
          const root=doc.getElementById(section.target);return {...section,controls:root?[...root.querySelectorAll('input:not([type=hidden]),select,textarea,button')].map(e=>({id:e.id,tag:e.tagName,type:e.type,title:e.getAttribute('title'),label:doc.querySelector(`label[for="${e.id}"]`)?.textContent.trim().replace(/\s+/g,' ').slice(0,120)||e.closest('.form-group')?.querySelector('label')?.textContent.trim().replace(/\s+/g,' ').slice(0,120)||e.closest('tr')?.querySelector('td,th')?.textContent.trim().replace(/\s+/g,' ').slice(0,120)||'',text:e.tagName==='BUTTON'?e.textContent.trim().slice(0,80):undefined,onclick:e.getAttribute('onclick'),options:e.tagName==='SELECT'?[...e.options].map(o=>({text:o.text,value:o.value})).slice(0,100):undefined})):[]};
        });
        return {title:doc.title,sections,headings:[...doc.querySelectorAll('h1,h2,h3,h4,h5,.nav-tabs li')].map(e=>({text:e.textContent.trim().slice(0,120),id:e.id})).filter(x=>x.text),controls:[...doc.querySelectorAll('input:not([type=hidden]),select,textarea,button')].map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,label:e.closest('label')?.textContent.trim().slice(0,100)||e.parentElement?.textContent.trim().slice(0,100)||'',options:e.tagName==='SELECT'?[...e.options].map(o=>({text:o.text,value:o.value})).slice(0,100):undefined,onclick:e.getAttribute('onclick')})),links:[...doc.querySelectorAll('a[onclick]')].map(e=>({text:e.textContent.trim().slice(0,100),onclick:e.getAttribute('onclick')}))};
      },html);await writeFile(`${output}/settings-source.json`,JSON.stringify(data,null,2));console.log(JSON.stringify({status:response.status(),length:html.length,headings:data.headings.length,controls:data.controls.length,links:data.links.length}));})());
    });
    page.on('framenavigated',f=>console.log('Navigated '+f.url().split('?')[0]));
    await page.evaluate(()=>window.openScreen('Settings','displayAdminSettings','fa fa-arrow-circle-right'));
    await page.waitForTimeout(10000);await Promise.allSettled(pending);await parser.close();
  }
  if (process.argv[2] === 'shell') console.log(JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,frames:[...document.querySelectorAll('iframe')].map(e=>({id:e.id,src:e.getAttribute('src')})),closeTab:String(window.closeTab),openScreen:String(window.openScreen)})),null,2));
  if (process.argv[2] === 'details') {
    for (const frame of page.frames().filter(f=>links.some(l=>f.url().includes('/'+l.onclick.match(/openScreen\("[^"]+",\s*"([^"]+)"/)[1])))) {
      const label=links.find(l=>frame.url().includes('/'+l.onclick.match(/openScreen\("[^"]+",\s*"([^"]+)"/)[1])).text;
      const data=await frame.evaluate(()=>({
        grids:[...document.querySelectorAll('table')].filter(e=>e.p).map(e=>({id:e.id,url:e.p.url,datatype:e.p.datatype,rowNum:e.p.rowNum,multiselect:e.p.multiselect,height:e.p.height,colModel:e.p.colModel.map(c=>({name:c.name,label:c.label,width:c.width,hidden:c.hidden,search:c.search,stype:c.stype,searchoptions:c.searchoptions,formatter:typeof c.formatter==='function'?String(c.formatter):c.formatter})),colNames:e.p.colNames})),
        events:[...document.querySelectorAll('button,input,select,a')].flatMap(e=>Object.entries(window.jQuery?._data(e,'events')||{}).map(([event,handlers])=>({id:e.id,text:e.textContent.trim().slice(0,80),event,handlers:handlers.map(h=>String(h.handler)).filter(h=>!h.includes('dispatch')&&!h.includes('triggerHandler'))}))).filter(e=>e.handlers.length),
        functions:Object.fromEntries([...new Set([...document.scripts].filter(s=>!s.src).flatMap(s=>[...s.textContent.matchAll(/function\s+(\w+)\s*\(/g)].map(m=>m[1])))].filter(n=>typeof window[n]==='function').map(n=>[n,String(window[n])])),
        dialogs:[...document.querySelectorAll('.modal')].map(e=>({id:e.id,text:e.textContent.trim().slice(0,4000)})),
      }));
      await writeFile(`${output}/${label.toLowerCase().replaceAll(' ','-')}-details.json`,JSON.stringify(data,null,2));
      console.log(`${label}: ${data.grids.length} grids, ${Object.keys(data.functions).length} inline functions`);
    }
  }
  if (process.argv[2] === 'capture') {
    for (const link of links.filter((link,index)=>links.findIndex(l=>l.text===link.text)===index).filter(link=>!process.argv[3] || process.argv[3].split(',').includes(link.text)).sort((a,b)=>Number(a.text==='Settings')-Number(b.text==='Settings'))) {
      const route = link.onclick.match(/openScreen\("[^"]+",\s*"([^"]+)"/)[1];
      const slug = (link.text + (process.argv[4] ? '-'+process.argv[4] : '')).toLowerCase().replaceAll(' ','-').replaceAll('/','-');
      await page.evaluate(({title,route})=>{
        if (window.multiScreenItems.length>=9) {
          const old=[...document.querySelectorAll('#openScreensMenu li a[id]')].find(e=>e.id!==title.replaceAll(' ',''));
          if(old) window.closeTab(old.id);
        }
        window.openScreen(title,route,'fa fa-arrow-circle-right');
      },{title:link.text,route});
      await page.waitForTimeout(1200);
      for (let attempt=0;attempt<30&&!page.frames().some(f=>f.url().includes(`/${route}`));attempt++) await page.waitForTimeout(500);
      const inspect = page.frames().find(f=>f.url().includes(`/${route}`));
      if (!inspect) throw new Error(`Live frame did not open for ${link.text}; frames: ${page.frames().map(f=>f.url().split('?')[0]).join(', ')}`);
      await inspect.locator('body').waitFor({timeout:30000});
      await page.waitForTimeout(500);
      await inspect.locator('.blockUI:visible').first().waitFor({state:'hidden',timeout:15000}).catch(()=>{});
      if(process.argv[4]) { await inspect.getByText(process.argv[4],{exact:true}).first().click(); await page.waitForTimeout(700); }
      const snapshot = frame => frame.evaluate(() => {
        const secret = e => /password|secret|token|apikey|api_key/i.test(`${e.id} ${e.name}`);
        const visible = e => !!(e.getBoundingClientRect().width && e.getBoundingClientRect().height);
        const geometry = e => {const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,color:s.color,background:s.backgroundColor};};
        return {url:location.href,title:document.title,
          text:document.body.innerText.replace(/\b[A-Za-z0-9_-]{28,}\b/g,'[REDACTED]').slice(0,30000),
          controls:[...document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a')].map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,text:e.tagName==='SELECT'?'':e.textContent.trim().slice(0,160),value:secret(e)?'[REDACTED]':e.value,checked:e.checked,disabled:e.disabled,visible:visible(e),title:e.title,placeholder:e.placeholder,onclick:e.getAttribute('onclick'),onchange:e.getAttribute('onchange'),options:e.tagName==='SELECT'?[...e.options].map(o=>({text:o.text,value:o.value})):undefined,geometry:visible(e)?geometry(e):undefined})),
          headers:[...document.querySelectorAll('th')].map(e=>({text:e.textContent.trim(),id:e.id,geometry:geometry(e)})),
          scripts:[...document.scripts].map(e=>e.src).filter(Boolean),
          grids:[...document.querySelectorAll('table')].filter(e=>e.p).map(e=>({id:e.id,url:e.p.url,columns:e.p.colModel.map(c=>({key:c.name,label:c.label,width:c.width,hidden:c.hidden,filter:c.search===false?undefined:c.stype}))})),
          functions:Object.fromEntries([...new Set([...document.scripts].filter(s=>!s.src).flatMap(s=>[...s.textContent.matchAll(/function\s+(\w+)\s*\(/g)].map(m=>m[1])))].filter(n=>typeof window[n]==='function').map(n=>[n,String(window[n])])),
          events:[document,...document.querySelectorAll('button,select')].flatMap(e=>Object.entries(window.jQuery?._data(e,'events')||{}).flatMap(([event,handlers])=>handlers.map(h=>({id:e.id,event,selector:h.selector,handler:String(h.handler)})))).filter(e=>e.handler.length>80&&!e.handler.includes('dispatch')),
          handlers:Object.fromEntries([...new Set([...document.querySelectorAll('[onclick],[onchange]')].flatMap(e=>[e.getAttribute('onclick'),e.getAttribute('onchange')]).filter(Boolean).flatMap(s=>[...s.matchAll(/\b([\w$]+)\s*\(/g)].map(m=>m[1])))].filter(n=>typeof window[n]==='function'&&!['$', 'jQuery'].includes(n)).map(n=>[n,String(window[n])])),
        };
      });
      const data = await snapshot(inspect);
      data.children = [];
      for (const child of inspect.childFrames().filter(f=>f.url().includes('eRetailWeb'))) { await child.locator('body').waitFor(); data.children.push(await snapshot(child)); }
      for (const control of [data,...data.children].flatMap(d=>d.controls)) if (/password|secret|token|apikey|api_key/i.test(`${control.id} ${control.name}`)) {
        control.value = '[REDACTED]';
        if (control.options) control.options = control.options.map(option=>({...option,value:'[REDACTED]'}));
      }
      // Do not retain production API credentials or account data in screenshots.
      if (slug !== 'manage-api') await (await inspect.frameElement()).screenshot({path:`${output}/${slug}.png`});
      if (slug === 'manage-api') data.text = data.text.split('API Key')[0] + '[API record values omitted]';
      await writeFile(`${output}/${slug}.json`,JSON.stringify(data,null,2));
      console.log(`${link.text}: ${data.controls.filter(c=>c.visible).length} visible controls; ${data.headers.length} columns`);
    }
  }
} finally { await browser.close(); }

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('selCompanyLocationBS.action'));
  if (!page) throw new Error('Authenticated eRetail shell unavailable');
  const frames = [];
  for (const frame of page.frames().filter(frame => frame.url().includes('eRetail'))) {
    frames.push(await frame.evaluate(() => ({
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      elements: [...document.querySelectorAll('header,footer,aside,nav,img,h1,h2,.sidebar-menu > li,.navbar,.content-wrapper,input:not([type=password]),select')].filter(element => element.getBoundingClientRect().width > 0).map(element => {
        const rect = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return { tag: element.tagName, id: element.id, class: element.className, text: element.textContent.trim().slice(0,180), src: element.getAttribute('src'), x:rect.x,y:rect.y,width:rect.width,height:rect.height,background:css.backgroundColor,color:css.color,font:css.font,border:css.border,html:element.tagName === 'IMG' ? element.outerHTML : undefined };
      }),
    })));
  }
  await writeFile('artifacts/live-parity/shell-observations.json', JSON.stringify(frames,null,2));
  await page.screenshot({path:'artifacts/live-parity/live-shell.png'});
  console.log(JSON.stringify(frames,null,2));
} finally { await browser.close(); }

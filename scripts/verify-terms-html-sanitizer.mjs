import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ path: 'node_modules/dompurify/dist/purify.min.js' });
  const result = await page.evaluate(async () => {
    window.executed = 0;
    const html = '<p style="color:red"><b>Safe terms</b></p><img src="invalid" onerror="window.executed++"><svg onload="window.executed++"></svg><script>window.executed++</script><a href="javascript:window.executed++">link</a>';
    const sanitized = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    document.getElementById('editor').innerHTML = sanitized;
    await new Promise(resolve => setTimeout(resolve, 100));
    return { sanitized, executed: window.executed, text: document.getElementById('editor').textContent };
  });
  assert.equal(result.executed, 0);
  assert.ok(!/onerror|onload|javascript:|<script|<svg/i.test(result.sanitized));
  assert.match(result.sanitized, /<b>Safe terms<\/b>/);
  assert.match(result.sanitized, /color:red/);
  const source = await readFile('src/eretail/procurement/ProcurementWorkflows.tsx', 'utf8');
  assert.match(source, /editor.current.innerHTML = safeHtml/);
  assert.match(source, /dangerouslySetInnerHTML=\{\{__html:safeHtml\}\}/);
  assert.match(source, /onPaste=.*DOMPurify.sanitize/);
  console.log('PASS: real browser sanitizer rejects execution payloads while preserving formatting; editor/preview/paste use sanitized HTML.');
} finally { await browser.close(); }

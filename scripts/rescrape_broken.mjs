import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dirname;
const CDP = join(DIR, 'chrome-cdp-skill', 'skills', 'chrome-cdp', 'scripts', 'cdp.mjs');
const TAB = '0FDB1521';
const OUT = join(DIR, 'workshop-html');
const base = 'https://catalog.us-east-1.prod.workshops.aws/event/dashboard/zh-CN';

const broken = [
  { slug: 'workshop', file: 'workshop' },
  { slug: 'workshop/010-introduction', file: '010-introduction' },
  { slug: 'workshop/015-getting-started', file: '015-getting-started' },
  { slug: 'workshop/015-getting-started/015-access-account', file: '015-access-account' },
  { slug: 'workshop/015-getting-started/017-prerequisites', file: '017-prerequisites' },
  { slug: 'workshop/030-understand-harness', file: '030-understand-harness' },
  { slug: 'workshop/040-create-deploy/041-connect', file: '041-connect' },
];

function cdp(cmd, arg) {
  try {
    return execSync(`node "${CDP}" ${cmd} ${TAB} ${arg ? '"' + arg + '"' : ''}`, {
      encoding: 'utf-8', timeout: 30000, cwd: DIR, maxBuffer: 10 * 1024 * 1024
    }).trim();
  } catch (e) { return e.stdout || ''; }
}

function sleep(ms) { execSync(`powershell -c "Start-Sleep -Milliseconds ${ms}"`); }

for (const page of broken) {
  console.log(`[${page.file}] navigating...`);
  cdp('eval', `window.location.href='${base}/${page.slug}'`);
  sleep(5000);

  // Get HTML via base64 to handle large content
  const b64 = cdp('eval', `btoa(unescape(encodeURIComponent((document.querySelector('article')||document.querySelector('main')).innerHTML)))`);
  if (!b64 || b64.length < 100) {
    console.log(`  STILL BROKEN - retrying with longer wait`);
    sleep(5000);
    const b64r = cdp('eval', `btoa(unescape(encodeURIComponent((document.querySelector('article')||document.querySelector('main')).innerHTML)))`);
    if (b64r && b64r.length > 100) {
      const html = Buffer.from(b64r, 'base64').toString('utf-8');
      writeFileSync(join(OUT, `${page.file}.html`), html);
      console.log(`  OK (retry): ${html.length} chars`);
    } else {
      console.log(`  FAILED`);
    }
    continue;
  }
  const html = Buffer.from(b64, 'base64').toString('utf-8');
  writeFileSync(join(OUT, `${page.file}.html`), html);

  // Alerts
  const alerts = cdp('eval', `JSON.stringify([...document.querySelectorAll('[data-analytics-alert]')].map(el=>({type:el.getAttribute('data-analytics-alert'),header:(el.querySelector('[class*=_header]')||{}).textContent||'',html:(el.querySelector('[class*=Alert-module_content]')||{}).innerHTML||''})))`);
  writeFileSync(join(OUT, `${page.file}.alerts.json`), alerts || '[]');

  console.log(`  OK: ${html.length} chars`);
}
console.log('Done!');

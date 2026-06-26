#!/usr/bin/env node
/**
 * Phase 1: Scrape all workshop pages as raw HTML locally.
 * Phase 2 (convert_html.mjs) will convert them to markdown.
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dirname;
const CDP = join(DIR, 'chrome-cdp-skill', 'skills', 'chrome-cdp', 'scripts', 'cdp.mjs');
const TAB = '939CB9E2';
const OUT = join(DIR, 'workshop-html');
mkdirSync(OUT, { recursive: true });

const pages = [
  { slug: 'workshop', file: 'workshop' },
  { slug: 'workshop/010-introduction', file: '010-introduction' },
  { slug: 'workshop/015-getting-started', file: '015-getting-started' },
  { slug: 'workshop/015-getting-started/015-access-account', file: '015-access-account' },
  { slug: 'workshop/015-getting-started/017-prerequisites', file: '017-prerequisites' },
  { slug: 'workshop/030-understand-harness', file: '030-understand-harness' },
  { slug: 'workshop/040-create-deploy', file: '040-create-deploy' },
  { slug: 'workshop/040-create-deploy/041-connect', file: '041-connect' },
  { slug: 'workshop/040-create-deploy/042-knowledge-base', file: '042-knowledge-base' },
  { slug: 'workshop/040-create-deploy/043-gateway', file: '043-gateway' },
  { slug: 'workshop/040-create-deploy/044-skills', file: '044-skills' },
  { slug: 'workshop/040-create-deploy/045-create-harness', file: '045-create-harness' },
  { slug: 'workshop/040-create-deploy/046-deploy', file: '046-deploy' },
  { slug: 'workshop/050-first-eval', file: '050-first-eval' },
  { slug: 'workshop/060-golden-set-eval', file: '060-golden-set-eval' },
  { slug: 'workshop/060-golden-set-eval/061-eval-env', file: '061-eval-env' },
  { slug: 'workshop/060-golden-set-eval/062-create-evaluators', file: '062-create-evaluators' },
  { slug: 'workshop/060-golden-set-eval/063-run-eval', file: '063-run-eval' },
  { slug: 'workshop/070-optimization', file: '070-optimization' },
  { slug: 'workshop/070-optimization/071-optimize-prompt', file: '071-optimize-prompt' },
  { slug: 'workshop/070-optimization/072-reevaluate', file: '072-reevaluate' },
  { slug: 'workshop/080-governance', file: '080-governance' },
  { slug: 'workshop/085-optional-labs', file: '085-optional-labs' },
  { slug: 'workshop/085-optional-labs/086-compare-models', file: '086-compare-models' },
  { slug: 'workshop/085-optional-labs/087-judge-stability', file: '087-judge-stability' },
  { slug: 'workshop/090-summary', file: '090-summary' },
  { slug: 'workshop/100-cleanup', file: '100-cleanup' },
];

function cdp(cmd, arg) {
  try {
    return execSync(`node "${CDP}" ${cmd} ${TAB} ${arg ? '"' + arg + '"' : ''}`, {
      encoding: 'utf-8', timeout: 30000, cwd: DIR
    }).trim();
  } catch (e) { return e.stdout || ''; }
}

function sleep(ms) { execSync(`powershell -c "Start-Sleep -Milliseconds ${ms}"`); }

const baseUrl = 'https://catalog.us-east-1.prod.workshops.aws/event/dashboard/zh-CN';

for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  console.log(`[${i + 1}/${pages.length}] ${page.file}`);

  cdp('nav', `${baseUrl}/${page.slug}`);
  sleep(1500);

  // Save article HTML
  const html = cdp('eval', `(document.querySelector('article')||document.querySelector('main')||document.body).outerHTML`);
  writeFileSync(join(OUT, `${page.file}.html`), html, 'utf-8');

  // Save alerts JSON separately (structured data with innerHTML for formatting)
  const alerts = cdp('eval', `JSON.stringify([...document.querySelectorAll('[data-analytics-alert]')].map(el=>({type:el.getAttribute('data-analytics-alert'),header:(el.querySelector('[class*=_header]')||{}).textContent||'',html:(el.querySelector('[class*=Alert-module_content]')||{}).innerHTML||''})))`);
  writeFileSync(join(OUT, `${page.file}.alerts.json`), alerts || '[]', 'utf-8');

  // Save image URLs
  const imgs = cdp('eval', `JSON.stringify([...document.querySelectorAll('article img')].map(i=>i.src).filter(s=>s&&s.startsWith('http')))`);
  writeFileSync(join(OUT, `${page.file}.images.json`), imgs || '[]', 'utf-8');

  console.log(`  saved`);
}

console.log(`\nDone! Raw HTML saved to ${OUT}`);

#!/usr/bin/env node
/**
 * Simple reliable converter: HTML -> Markdown for all workshop pages.
 * Handles alerts via separate .alerts.json files.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dirname;
const HTML_DIR = join(DIR, 'workshop-html');
const OUT = join(DIR, 'workshop-output');
const DOCS = join(DIR, 'workshop-site', 'docs');
mkdirSync(OUT, { recursive: true });

const pages = readdirSync(HTML_DIR).filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));

function convertAlert(a) {
  const adType = a.type === 'success' ? 'success' : a.type === 'warning' ? 'warning' : a.type === 'error' ? 'danger' : 'info';
  const title = a.header ? ` "${a.header.trim().replace(/"/g, "'")}"` : '';
  let body = a.html || '';
  body = body.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  body = body.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  body = body.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  body = body.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  body = body.replace(/<br\s*\/?>/gi, '\n');
  body = body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  body = body.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  body = body.replace(/<[^>]+>/g, '');
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  body = body.trim().replace(/\n/g, '\n    ');
  return `\n!!! ${adType}${title}\n    ${body}\n\n`;
}

function htmlToMd(html, alerts) {
  let md = html;

  // Remove scripts/styles
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Replace each alert div individually using indexOf loop (avoids greedy regex issues)
  let alertIdx = 0;
  while (md.includes('Alert-module_alert') && alertIdx < 50) {
    const start = md.indexOf('<div class="Alert-module_alert');
    if (start === -1) break;
    // Find the matching data-analytics-alert and count divs to find the end
    let depth = 0, i = start, found = false;
    for (; i < md.length - 6; i++) {
      if (md.substring(i, i + 4) === '<div') depth++;
      if (md.substring(i, i + 6) === '</div>') {
        depth--;
        if (depth === 0) { i += 6; found = true; break; }
      }
    }
    if (!found) break;
    const admonition = alerts[alertIdx] ? convertAlert(alerts[alertIdx]) : '';
    md = md.substring(0, start) + admonition + md.substring(i);
    alertIdx++;
  }

  // Remove anchor links wrapping headings
  md = md.replace(/<a[^>]*href="#[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  // Headers
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n\n');

  // Code blocks with language
  md = md.replace(/<pre[^>]*><code[^>]*class="language-(\w+)"[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
    code = code.replace(/^(\d+\n)+/, '').replace(/<[^>]+>/g, '');
    return '\n```' + lang + '\n' + code + '\n```\n\n';
  });
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    code = code.replace(/^(\d+\n)+/, '').replace(/<[^>]+>/g, '');
    return '\n```\n' + code + '\n```\n\n';
  });
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    code = code.replace(/^(\d+\n)+/, '').replace(/<[^>]+>/g, '');
    return '\n```\n' + code + '\n```\n\n';
  });

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  // Bold/italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, src, alt) => `\n![${alt}](/images/${decodeURIComponent(src.split('/').pop().split('?')[0])})\n`);
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, src) => `\n![](/images/${decodeURIComponent(src.split('/').pop().split('?')[0])})\n`);
  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');
  // Paragraphs/br
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');
  // Tables
  md = md.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    let t = '';
    rows.forEach((row, idx) => {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
      t += '| ' + cells.map(c => c[1].replace(/<[^>]+>/g, '').trim()).join(' | ') + ' |\n';
      if (idx === 0) t += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
    });
    return '\n' + t + '\n';
  });
  // Strip remaining HTML
  md = md.replace(/<[^>]+>/g, '');
  // Decode entities
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Cleanup
  md = md.replace(/^\s*(Previous|Next|PreviousNext)\s*$/gm, '');
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

for (const page of pages) {
  const html = readFileSync(join(HTML_DIR, `${page}.html`), 'utf-8').replace(/^\uFEFF/, '');
  const alertsFile = join(HTML_DIR, `${page}.alerts.json`);
  let alerts = [];
  try { alerts = JSON.parse(readFileSync(alertsFile, 'utf-8')); } catch(e) {}

  const md = htmlToMd(html, alerts);
  const outFile = `workshop_${page}.md`;
  writeFileSync(join(OUT, outFile), md + '\n');
  writeFileSync(join(DOCS, outFile), md + '\n');
  console.log(`${outFile} (${md.length})`);
}

// Copy workshop as index
const ws = readFileSync(join(DOCS, 'workshop_workshop.md'), 'utf-8');
writeFileSync(join(DOCS, 'index.md'), ws);

console.log(`\nDone! ${pages.length} pages converted.`);

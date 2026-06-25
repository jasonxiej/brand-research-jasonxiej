#!/usr/bin/env node
/* eslint-disable */
/**
 * One-shot migration: convert legacy <slug>-<YYYYMMDD>.html brand reports
 * to brands/<slug>-<YYYYMMDD>.json data files. Reads the __BRAND_DATA__
 * JSON block embedded in each HTML, writes it as a JSON file, updates
 * brands/index.json's reportFile / reportUrl, and (unless --keep-html is
 * passed) deletes the legacy HTML files.
 *
 * Usage:
 *   node scripts/migrate-to-json.cjs             # convert + delete .html
 *   node scripts/migrate-to-json.cjs --keep-html # convert, keep .html
 *   node scripts/migrate-to-json.cjs --dry-run   # print plan only
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DIR = ROOT;
const JSON_DIR = path.join(ROOT, 'brands');
const INDEX_FILE = path.join(JSON_DIR, 'index.json');

const FILE_RE = /^([a-z0-9-]+)-(\d{8})\.html$/i;

const dryRun = process.argv.includes('--dry-run');
const keepHtml = process.argv.includes('--keep-html');

function extractBrandData(html) {
  const m = html.match(/<script\s+id="__BRAND_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/i);
  if (!m) return null;
  const raw = m[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { return JSON.parse(raw); } catch { return null; }
}

const files = fs.readdirSync(HTML_DIR).filter((f) => FILE_RE.test(f));

console.log(`Migrating ${files.length} HTML reports to JSON...\n`);

fs.mkdirSync(JSON_DIR, { recursive: true });

let migrated = 0, skipped = 0, failed = 0;
const movedIds = [];

for (const f of files) {
  const id = f.replace(/\.html$/, '');
  const jsonPath = path.join(JSON_DIR, id + '.json');
  if (fs.existsSync(jsonPath)) {
    console.log('· skip (already has JSON):', id);
    skipped++;
    continue;
  }
  const html = fs.readFileSync(path.join(HTML_DIR, f), 'utf8');
  const data = extractBrandData(html);
  if (!data) {
    console.log('✗ no __BRAND_DATA__ in', f);
    failed++;
    continue;
  }
  // Update paths so future renders go through the JSON route
  data.id = data.id || id;
  data.reportFile = 'brands/' + id + '.json';
  data.reportUrl = '/report/' + id;
  if (!dryRun) {
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('✓ wrote brands/' + id + '.json');
  } else {
    console.log('  dry: would write brands/' + id + '.json');
  }
  movedIds.push(id);
  if (!dryRun && !keepHtml) {
    fs.unlinkSync(path.join(HTML_DIR, f));
    console.log('  deleted legacy', f);
  }
  migrated++;
}

// Update brands/index.json
if (!dryRun && fs.existsSync(INDEX_FILE)) {
  try {
    const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    let updated = 0;
    for (const b of (idx.brands || [])) {
      if (movedIds.includes(b.id)) {
        b.reportFile = 'brands/' + b.id + '.json';
        b.reportUrl = '/report/' + b.id;
        updated++;
      }
    }
    idx.updated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2) + '\n', 'utf8');
    console.log(`\n✓ brands/index.json updated (${updated} entries repointed to JSON)`);
  } catch (e) {
    console.error('✗ failed to update index.json:', e.message);
  }
}

console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`);
console.log(dryRun ? '(dry run — no files changed)' : '');

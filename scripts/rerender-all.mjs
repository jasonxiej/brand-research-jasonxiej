// scripts/rerender-all.mjs
// Rerender every brand's HTML report with the latest report-template.mjs so
// the new dual-track radar (AI + heuristic) appears in every detail page.
// Uses the existing per-brand data from brands/index.json (heuristic fields
// were backfilled by scripts/backfill-heuristic.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Use dynamic import so we can fail fast if the template has issues.
const { renderReport } = await import(path.join(ROOT, 'lib', 'report-template.mjs').replace(/\\/g, '/')
  .replace(/^([A-Za-z]:)/, 'file:///$1'));

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'brands', 'index.json'), 'utf8'));
const userBrand = 'Kiwii';

let ok = 0, fail = 0;
for (const b of idx.brands) {
  const target = path.join(ROOT, b.reportFile);
  try {
    const html = renderReport({
      name: b.name,
      url: b.url,
      data: b,
      meta: b.meta,
      createdAt: b.createdAt,
      userBrand,
    });
    fs.writeFileSync(target, html, 'utf8');
    console.log('✓ rerendered', b.reportFile);
    ok++;
  } catch (e) {
    console.error('✗', b.reportFile, '—', e.message);
    fail++;
  }
}
console.log(`\nRerendered ${ok} reports${fail ? ` (${fail} failed)` : ''}.`);
// scripts/backfill-heuristic.mjs
//
// One-shot backfill: compute the heuristic radar for every brand in
// brands/index.json and persist:
//   heuristicRadar       — { 克制: 7.5, ... } — the 0-10 final scores
//   heuristicRadarArray  — [7.5, 5.5, ...]   — array form for the radar chart
//   heuristicDetail      — full sub-indicator breakdown (for "why this score")
//
// Idempotent: re-running updates the same fields in-place.
//
// Usage:
//   node scripts/backfill-heuristic.mjs            # update brands/index.json in place
//   node scripts/backfill-heuristic.mjs --dry-run  # print changes, do not write
//
// Place at: brand-research-jasonxiej/scripts/backfill-heuristic.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeHeuristicRadar,
  computeHeuristicRadarArray,
  computeHeuristicDetail,
  diffRadar,
  RADAR_KEYS,
} from '../lib/scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'brands', 'index.json');

const dryRun = process.argv.includes('--dry-run');

function loadIndex() {
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
}
function saveIndex(idx) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2) + '\n', 'utf8');
}

const idx = loadIndex();
console.log(`\nHeuristic radar backfill — ${idx.brands.length} brands${dryRun ? ' (DRY RUN)' : ''}\n`);

let updated = 0;
for (const b of idx.brands) {
  const radar = computeHeuristicRadar(b);
  const arr = computeHeuristicRadarArray(b);
  const detail = computeHeuristicDetail(b);
  const diff = diffRadar(b.radar, radar);

  b.heuristicRadar = radar;
  b.heuristicRadarArray = arr;
  b.heuristicDetail = detail;
  b.heuristicMeta = {
    computedAt: new Date().toISOString().slice(0, 10),
    avgDelta: diff.avgDelta,
  };
  updated++;

  console.log(`${b.name.padEnd(12)}  LLM [${RADAR_KEYS.map((k) => (b.radar?.[k] ?? 5).toFixed(1)).join(' ')}]`);
  console.log(`${' '.repeat(12)}  HEU [${RADAR_KEYS.map((k) => radar[k].toFixed(1)).join(' ')}]  avg |Δ|=${diff.avgDelta}`);
}

if (!dryRun) {
  idx.updated = new Date().toISOString().slice(0, 10);
  saveIndex(idx);
  console.log(`\n✓ wrote ${updated} brands to ${path.relative(ROOT, INDEX_FILE)}`);
} else {
  console.log(`\n· dry run, no changes written`);
}
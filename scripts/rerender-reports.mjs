#!/usr/bin/env node
// scripts/rerender-reports.mjs
// 从 brands/index.json 重新生成所有品牌报告 HTML（吃最新的双语模板）。
// 跑完后会覆盖原报告文件。请确保已经先跑过 scripts/backfill-bilingual.mjs。
// 运行：`node scripts/rerender-reports.mjs`
//   ONLY=adidas-20260623  只重渲这一条
//   USER_BRAND=Kiwii       自定义「你的品牌」名（默认 Kiwii）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.resolve(ROOT, 'brands/index.json');
const OUT_DIR = ROOT; // 报告直接生成在项目根目录

const { renderReport } = await import(pathToFileURL(path.resolve(ROOT, 'lib/report-template.mjs')).href);

const only = process.env.ONLY || null;
const userBrand = process.env.USER_BRAND || 'Kiwii';

const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const brands = data.brands || [];
console.log(`📚 找到 ${brands.length} 条品牌，开始重渲报告`);

let rendered = 0;
for (const b of brands) {
  if (only && b.id !== only) continue;
  if (!b.reportFile) {
    console.warn(`  ⚠  ${b.id} 没有 reportFile 字段，跳过`);
    continue;
  }

  // 调 renderReport 吃整个 brand 对象
  const html = renderReport({
    name: b.nameEn || b.name,
    url: b.url,
    data: b,
    meta: b.meta || {},
    createdAt: b.createdAt,
    userBrand,
  });

  const outPath = path.resolve(OUT_DIR, b.reportFile);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ✓ ${b.id} → ${b.reportFile} (${(html.length / 1024).toFixed(1)} KB)`);
  rendered++;
}

console.log(`\n✅ 完成。重渲了 ${rendered} 个报告文件。`);
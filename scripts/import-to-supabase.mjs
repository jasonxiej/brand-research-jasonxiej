#!/usr/bin/env node
// scripts/import-to-supabase.mjs
// =============================================================
//   把 brands/*.json 批量导入 Supabase brand_reports 表
//
//   用法:
//     1. cp .env.example .env.local  填入 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//     2. node scripts/import-to-supabase.mjs
//
//   选项:
//     --id=<brand-id>     只导入单个（多次此选项可批量）
//     --dry-run           只打印要做什么，不写
//     --include-html      同时把 .html 文件内容写进 html 列（默认 false，只写 JSON）
//
//   设计：
//   - 每个 .json 文件代表一份品牌调研结果
//     - 包含 brandName / tagline / positioning / radar 数据等
//   - 每个 .html 文件是对应的渲染好的报告（可选）
//   - 脚本把 brandName / fileName / brand / html 写入 Supabase
// =============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BRANDS_DIR = path.join(ROOT, 'brands');

// Load .env.local first, fall back to .env
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

// ---- CLI 参数解析 ----
const args = process.argv.slice(2);
const onlyIds = new Set();
let dryRun = false;
let includeHtml = false;
for (const a of args) {
  if (a.startsWith('--id=')) onlyIds.add(a.slice('--id='.length));
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--include-html') includeHtml = true;
}

// ---- env ----
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('✗ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。');
  console.error('  请在 .env.local 填入后重试（参考 .env.example）。');
  process.exit(1);
}
if (dryRun) {
  console.log('(dry run: 不会实际写入 Supabase)\n');
}

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- 收集要导入的 JSON ----
const files = await fs.readdir(BRANDS_DIR);
const targets = files
  .filter((f) => /^([a-z0-9-]+)-(\d{8})\.json$/.test(f))
  .filter((f) => {
    const id = f.replace(/\.json$/, '');
    return onlyIds.size === 0 || onlyIds.has(id);
  });

if (targets.length === 0) {
  console.log('没有可导入的 brand JSON 文件。');
  process.exit(0);
}

console.log(`准备导入 ${targets.length} 份品牌数据到 Supabase:\n`);
for (const f of targets) console.log('  -', f);
console.log();

// ---- 逐个 upsert ----
let ok = 0, fail = 0;
const skipped = [];

for (const file of targets) {
  const id = file.replace(/\.json$/, '');
  const filePath = path.join(BRANDS_DIR, file);

  try {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

    // brand 字段：直接把 JSON 内容作为 brand metadata
    //   - 包括 id / brandName / tagline / positioning / 等等
    //   - 不包括 .html（html 列单独处理）
    const brand = { ...data };
    if (brand.html) delete brand.html;  // HTML 单独存
    brand.id = id;
    brand.reportFile = file;
    brand.reportUrl = `/api/report?id=${encodeURIComponent(id)}`;

    // html 字段：可选地从同名 .html 文件读取
    let html = '';
    if (includeHtml) {
      try {
        html = await fs.readFile(path.join(BRANDS_DIR, id + '.html'), 'utf8');
      } catch {
        skipped.push(id + ' (no .html)');
      }
    }

    if (dryRun) {
      console.log(`  would upsert: ${id}  brandName="${data.brandName || data.brand || '(unset)'}"  html=${html ? 'yes' : 'no'}`);
      continue;
    }

    const { error } = await supabase.from('brand_reports').upsert({
      id,
      file_name: file,
      brand,
      html,
      deleted_at: null,
      expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) {
      console.error(`  ✗ ${id}:`, error.message);
      fail++;
    } else {
      console.log(`  ✓ ${id}`);
      ok++;
    }
  } catch (e) {
    console.error(`  ✗ ${id}:`, e.message);
    fail++;
  }
}

console.log();
console.log(`完成：${ok} 成功 · ${fail} 失败`);
if (skipped.length) console.log('跳过：', skipped.join(', '));
process.exit(fail > 0 ? 1 : 0);
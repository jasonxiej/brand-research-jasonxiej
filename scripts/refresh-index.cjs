#!/usr/bin/env node
/* eslint-disable */
/**
 * 扫描 brand-research 目录下所有 <slug>-<YYYYMMDD>.html 形式的品牌调研页面，
 * 从 HTML 中抽取品牌名、tagline、调性关键词、色板 HEX、雷达图数据，
 * 合并后写入 brands/index.json。
 *
 * 使用：node scripts/refresh-index.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DIR = ROOT;
const INDEX_FILE = path.join(ROOT, 'brands', 'index.json');
const TRASH_FILE = path.join(ROOT, 'brands', 'trash.json');

const FILE_RE = /^([a-z0-9-]+)-(\d{8})\.html$/i;

function listHtmlFiles() {
  return fs
    .readdirSync(HTML_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ file: f, full: path.join(HTML_DIR, f) }))
    .filter(({ file }) => FILE_RE.test(file));
}

function pickBetween(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const j = text.indexOf(end, i + start.length);
  if (j < 0) return '';
  return text.slice(i + start.length, j).trim();
}

// 从 <script id="__BRAND_DATA__" type="application/json">...</script> 块读取完整数据
function extractBrandData(html) {
  const m = html.match(/<script\s+id="__BRAND_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    // 反转义 HTML entities
    const raw = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function extractBrand(html, slug) {
  const title = (pickBetween(html, '<title>', '</title>') || '').trim();
  const h1 = (pickBetween(html, '<h1>', '</h1>') || '').trim();

  // 色板：取 #RRGGBB 与 命名
  const palette = [];
  const swatchRe = /#([0-9A-Fa-f]{6})[\s\S]{0,200}?>([^<]+)</g;
  let m;
  let guard = 0;
  while ((m = swatchRe.exec(html)) && guard++ < 40) {
    const hex = '#' + m[1].toUpperCase();
    const name = (m[2] || '').trim().replace(/\s+/g, ' ');
    if (name && !palette.find((p) => p.hex === hex && p.name === name)) {
      palette.push({ hex, name });
    }
  }

  // 雷达图：从 window.__RADAR_DATA__ 提取 values: [a,b,c,d,e,f]
  // 兼容旧版 charts.js 的 value: [...] + name: '...'
  const radar = {};
  const valuesRe = /values:\s*\[([^\]]+)\]/;
  const oldValueRe = /value:\s*\[([^\]]+)\][\s\S]{0,200}?name:\s*['"]([^'"]+)['"]/;
  const valuesMatch = html.match(valuesRe);
  const oldMatch = !valuesMatch ? html.match(oldValueRe) : null;

  if (valuesMatch) {
    const vals = valuesMatch[1].split(',').map((s) => Number(s.trim()));
    const labels = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];
    if (vals.length === 6) {
      labels.forEach((l, i) => (radar[l] = vals[i]));
    }
  } else if (oldMatch) {
    const vals = oldMatch[1].split(',').map((s) => Number(s.trim()));
    const labels = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];
    if (vals.length === 6) {
      labels.forEach((l, i) => (radar[l] = vals[i]));
    }
  }

  return {
    title,
    h1: h1.replace(/<[^>]+>/g, '').trim(),
    palette,
    radar,
  };
}

function buildEntry({ file, full }) {
  const [, slug, date] = file.match(FILE_RE);
  const html = fs.readFileSync(full, 'utf8');
  const dataCompact = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

  // 优先从 __BRAND_DATA__ 块读（包含完整 8 维 + meta + url）
  const data = extractBrandData(html);
  if (data) {
    const radar = data.radar || {};
    const radarValues = radar['识别强度'] !== undefined
      ? [radar['克制'], radar['温度感'], radar['游戏化'], radar['科技感'], radar['情感连接'], radar['识别强度']]
      : null;
    return {
      id: data.id || file.replace('.html', ''),
      name: data.name || slug,
      nameZh: data.nameZh || '',
      url: data.url || '',
      tagline: data.tagline || '',
      category: data.category || '',
      country: data.country || '',
      year: data.year || null,
      reportFile: data.reportFile || file,
      reportUrl: data.reportUrl || './' + file,
      createdAt: data.createdAt || dataCompact,
      summary: data.summary || '',
      primaryColors: data.primaryColors || [],
      radar,
      radarValues,
      palette: data.palette || [],
      // 8 维额外字段
      logo: data.logo || {},
      typography: data.typography || {},
      photography: data.photography || {},
      tone: data.tone || [],
      toneSummary: data.toneSummary || '',
      positioning: data.positioning || '',
      targetUser: data.targetUser || {},
      sellingPoints: data.sellingPoints || [],
      meta: data.meta || {},
    };
  }

  // fallback：旧逻辑（正则提取 + 保留手工填写的字段）
  const ext = extractBrand(html, slug);
  const radarValues = ext.radar['识别强度'] !== undefined
    ? [ext.radar['克制'], ext.radar['温度感'], ext.radar['游戏化'], ext.radar['科技感'], ext.radar['情感连接'], ext.radar['识别强度']]
    : null;
  return {
    id: file.replace('.html', ''),
    name: slug.split('-')[0] ? slug.split('-')[0].replace(/^\w/, (c) => c.toUpperCase()) : slug,
    nameZh: ext.h1 || ext.title || slug,
    tagline: '',
    category: '',
    country: '',
    reportFile: file,
    reportUrl: './' + file,
    createdAt: dataCompact,
    summary: ext.title,
    primaryColors: ext.palette.slice(0, 4).map((p) => p.hex),
    radar: ext.radar,
    radarValues,
    palette: ext.palette,
    tone: [],
    toneSummary: '',
    positioning: '',
    targetUser: {},
    sellingPoints: [],
    logo: {},
    typography: {},
    photography: {},
    meta: {},
  };
}

function main() {
  // 0) 加载回收站 id 集合
  let trashData = null;
  if (fs.existsSync(TRASH_FILE)) {
    try {
      trashData = JSON.parse(fs.readFileSync(TRASH_FILE, 'utf8'));
    } catch {}
  }

  const files = listHtmlFiles();
  const fileIds = new Set(files.map((f) => f.file.replace(/\.html$/, '')));

  // ★ 0.5) 对账：trash 里有 id 但磁盘上仍有对应 HTML 文件 → 视为「重新生成」
  // 自动从 trash 移除，让 brand 重新进入索引
  let trashChanged = false;
  if (trashData && Array.isArray(trashData.items) && trashData.items.length) {
    const before = trashData.items.length;
    const restored = [];
    trashData.items = trashData.items.filter((it) => {
      if (fileIds.has(it.id)) {
        restored.push(it.id);
        return false;
      }
      return true;
    });
    if (restored.length) {
      trashData.updated = new Date().toISOString();
      // 单独记录恢复历史，不污染 description
      if (!Array.isArray(trashData.restorations)) trashData.restorations = [];
      trashData.restorations.push({ at: new Date().toISOString(), ids: restored });
      fs.writeFileSync(TRASH_FILE, JSON.stringify(trashData, null, 2) + '\n', 'utf8');
      trashChanged = true;
      console.log(`↻ 自动从回收站恢复 ${restored.length} 个品牌（磁盘上仍有对应 HTML）：${restored.join(', ')}`);
    }
    if (trashData.items.length !== before) trashChanged = true;
  }

  // 重新计算 trashIds（去除已自动恢复的）
  const trashIds = new Set();
  if (trashData && Array.isArray(trashData.items)) {
    for (const it of trashData.items) trashIds.add(it.id);
  }

  const brands = files.map(buildEntry).filter((b) => !trashIds.has(b.id));

  // 与已有 index.json 合并：保留手工填写的 tagline / category / country / summary
  let existing = { brands: [] };
  if (fs.existsSync(INDEX_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    } catch (e) {
      console.warn('已有 index.json 解析失败，将重新生成');
    }
  }
  const prevMap = new Map((existing.brands || []).map((b) => [b.id, b]));

  const merged = brands.map((b) => {
    const prev = prevMap.get(b.id) || {};
    // 如果 __BRAND_DATA__ 块返回了完整的 summary（来自真实 summary-block p），优先用它
    // 旧的回退值（nameZh）只在 __BRAND_DATA__ 不存在时才被合并
    const hasFullSummary = b.summary && b.summary.length > 20 && b.summary !== (b.nameZh || '');
    return {
      ...b,
      // 字段：如果 __BRAND_DATA__ 已经有值就用它，否则保留 prev 的手填值
      tagline: b.tagline || prev.tagline || '',
      category: b.category || prev.category || '',
      country: b.country || prev.country || '',
      summary: hasFullSummary ? b.summary : (prev.summary || b.summary || ''),
    };
  });

  const out = {
    version: existing.version || '1.0.0',
    updated: new Date().toISOString().slice(0, 10),
    description: existing.description || '{YOUR_BRAND} 品牌调研库索引',
    brands: merged,
  };

  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`✓ 已刷新 brands/index.json，共 ${merged.length} 个品牌${trashIds.size ? `（已跳过 ${trashIds.size} 个回收站项）` : ''}`);
  merged.forEach((b) => console.log('  - ' + b.id + ' · ' + b.nameZh));
}

main();

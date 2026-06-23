// scripts/rebuild-brand-data.cjs
// ============================================================
// 彻底重建 __BRAND_DATA__ 块 —— 不解析老的（已经坏掉），直接从渲染 HTML 抓数据
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');

const RADAR_LABELS = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];

// 手动写死 nameZh / url（更稳）
const FIXED = {
  'oura-20260622': { nameZh: 'Oura 品牌视觉研究', url: 'https://ouraring.com' },
  'hatch-20260622': { nameZh: 'Hatch 品牌视觉研究', url: 'https://www.hatch.co' },
  'linear-20260622': { nameZh: 'Linear 品牌视觉研究', url: 'https://linear.app' },
  'b-o-20260622': { nameZh: 'Bang & Olufsen 品牌视觉研究', url: 'https://www.bang-olufsen.com' },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 反向 mojibake 修复：latin1 解读 -> utf8 编码 的逆过程
function fixMojibake(s) {
  if (typeof s !== 'string' || !s) return s;
  if (!/[\u2500-\u254F\u9375\u4F7A\u589D\u745A\u55DA\u942E\u65C2\u934E\u58d0]/.test(s)) return s;
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch (e) {
    return s;
  }
}
function fixDeep(o) {
  if (typeof o === 'string') return fixMojibake(o);
  if (Array.isArray(o)) return o.map(fixDeep);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) out[k] = fixDeep(o[k]);
    return out;
  }
  return o;
}

function extractBrandMeta($, fileName) {
  const wrap = $('.brand-card .brand-name').first();
  let name = '', category = '', country = '';
  if (wrap.length) {
    const nameNode = wrap.contents().filter((_, n) => n.type === 'text').first();
    name = nameNode ? nameNode.text().trim() : wrap.clone().children().remove().end().text().trim();
    const tagText = wrap.find('.tag').first().text().trim();
    const parts = tagText.split(/\s+·\s+/);
    category = (parts[0] || '').trim();
    country = (parts[1] || '').trim();
  }
  // 没英文就从文件名补
  if (!/[A-Za-z]/.test(name) && fileName) {
    const base = fileName.replace(/-\d{8}\.html$/i, '');
    name = base.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  }
  return { name: name.replace(/\s+/g, ' ').trim(), category, country };
}

function extractTone($) {
  const tones = [];
  $('.detail-item:has(.detail-label:contains("品牌调性")) .dim-tone-key').each((_, el) => {
    tones.push($(el).text().trim());
  });
  return tones;
}

function extractPositioning($) {
  const item = $('.detail-item:has(.detail-label:contains("品牌定位"))').first();
  if (!item.length) return { tagline: '', statement: '' };
  const html = item.find('.detail-value').html() || '';
  const taglineM = html.match(/Tagline：<em>([^<]+)<\/em>/);
  const tagline = taglineM ? taglineM[1].trim() : '';
  let rest = html.replace(/Tagline：<em>[^<]+<\/em><br>/, '').replace(/<br>/g, ' ').replace(/<[^>]+>/g, ' ').trim();
  return { tagline, statement: rest };
}

function extractTargetUser($) {
  const item = $('.detail-item:has(.detail-label:contains("目标用户"))').first();
  if (!item.length) return {};
  const lines = (item.find('.detail-value').html() || '').split(/<br>/).map((s) => s.trim()).filter(Boolean);
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(key + '：'));
    return line ? line.replace(key + '：', '').trim() : '';
  };
  return { age: get('年龄'), identity: get('身份'), pain: get('痛点'), scene: get('场景') };
}

function extractSellingPoints($) {
  const item = $('.detail-item:has(.detail-label:contains("核心卖点"))').first();
  if (!item.length) return [];
  const lines = (item.find('.detail-value').html() || '').split(/<br>/).map((s) => s.trim()).filter(Boolean);
  return lines.filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim());
}

function extractRadar(html) {
  const m = html.match(/values:\s*\[([\d.,\s]+)\]/);
  if (!m) return {};
  const vals = m[1].split(',').map((v) => Number(v.trim()));
  const radar = {};
  RADAR_LABELS.forEach((label, i) => { radar[label] = vals[i] ?? 5; });
  return radar;
}

function extractPalette($) {
  const items = [];
  $('.palette .swatch').each((_, el) => {
    const bg = $(el).find('.swatch-block').attr('style') || '';
    const styleMatch = bg.match(/background\s*:\s*(#[0-9A-Fa-f]+)/);
    const hex = styleMatch ? styleMatch[1].toUpperCase() : '';
    if (!hex) return;
    const infoEl = $(el).find('.swatch-info');
    const hexSpanText = infoEl.find('span').first().text().trim();
    const fullText = infoEl.text().trim();
    const name = fullText.replace(hexSpanText, '').trim();
    items.push({ hex, name });
  });
  return items;
}

function extractSummary($) {
  const block = $('.summary-block p').first();
  return block.text().trim();
}

function extractToneSummary($) {
  const item = $('.detail-item:has(.detail-label:contains("品牌调性"))').first();
  if (!item.length) return '';
  const em = (item.find('.detail-value').html() || '').match(/<em>([^<]+)<\/em>/);
  if (em) return em[1].trim();
  return '';
}

function processFile(filePath) {
  const fileName = path.basename(filePath);
  const id = fileName.replace(/\.html$/i, '');
  const fixed = FIXED[id];
  if (!fixed) {
    console.log(`SKIP: ${fileName} 没有 FIX 映射`);
    return false;
  }
  console.log(`\n处理: ${fileName} -> nameZh="${fixed.nameZh}"`);

  // 读为 Buffer，自己处理 UTF-8
  const buf = fs.readFileSync(filePath);
  let html = buf.toString('utf8');

  // 移除 BOM
  if (html.charCodeAt(0) === 0xFEFF) html = html.slice(1);

  // 解析
  const $ = cheerio.load(html);

  // 抓数据
  const { name, category, country } = extractBrandMeta($, fileName);
  const tagline = extractPositioning($).tagline;
  const { tagline: posTagline, statement: positioning } = extractPositioning($);
  const summary = extractSummary($);
  const tone = extractTone($);
  const toneSummary = extractToneSummary($);
  const targetUser = extractTargetUser($);
  const sellingPoints = extractSellingPoints($);
  const palette = extractPalette($);
  const radar = extractRadar(html);
  const primaryColors = palette.slice(0, 4).map((p) => p.hex);

  const createdAt = (html.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || new Date().toISOString().slice(0, 10);

  const payload = {
    id,
    name,
    nameZh: fixed.nameZh,  // 用我们写死的，确保对
    url: fixed.url,
    tagline: posTagline || tagline,
    category,
    country,
    year: '',
    summary,
    primaryColors,
    palette,
    logo: {},
    typography: { note: '' },
    photography: { type: '', description: '' },
    tone,
    toneSummary,
    positioning,
    targetUser,
    sellingPoints,
    radar,
    radarValues: RADAR_LABELS.map((k) => radar[k] ?? 5),
    meta: { favicon: '', ogImage: '', heroImage: '', logoCandidates: [] },
    reportFile: fileName,
    reportUrl: './' + fileName,
    createdAt,
  };

  // 应用 mojibake 修复到除 nameZh 外的所有字段
  const fixedPayload = fixDeep(payload);
  fixedPayload.nameZh = fixed.nameZh;  // 强制覆盖

  console.log(`  data: ${palette.length} 色 / ${tone.length} 调性 / ${sellingPoints.length} 卖点`);
  console.log(`  nameZh: ${JSON.stringify(fixedPayload.nameZh)}`);

  // 构建新 block
  const newBlock = `<script id="__BRAND_DATA__" type="application/json">${esc(JSON.stringify(fixedPayload))}</script>`;

  // 替换（如果有的话）
  if (/<script id="__BRAND_DATA__" type="application\/json">[\s\S]*?<\/script>/.test(html)) {
    html = html.replace(/<script id="__BRAND_DATA__" type="application\/json">[\s\S]*?<\/script>/, newBlock);
    console.log('  ✓ 替换了已存在的 __BRAND_DATA__ 块');
  } else if (html.includes('</head>')) {
    html = html.replace('</head>', `  ${newBlock}\n  </head>`);
    console.log('  ✓ 插入了新的 __BRAND_DATA__ 块（在 </head> 前）');
  }

  // 写回（UTF-8 no BOM，LF line endings）
  html = html.replace(/\r\n/g, '\n');
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✓ DONE`);
  return true;
}

const files = ['oura-20260622.html', 'hatch-20260622.html', 'linear-20260622.html', 'b-o-20260622.html'];
let updated = 0;
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { console.log(`SKIP: ${f} 不存在`); continue; }
  if (processFile(p)) updated++;
}
console.log(`\nDONE: 更新了 ${updated} 个文件`);

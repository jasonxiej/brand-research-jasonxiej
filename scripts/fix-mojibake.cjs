// scripts/fix-mojibake.cjs
// ============================================================
// 修复 __BRAND_DATA__ 块中"双重编码"的中文 mojibake
// 现象：UTF-8 字节被错误地当 Latin-1 解读后再重新 UTF-8 编码
// 修法：把整段 JSON 的字节流"重置"为正确的 UTF-8
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');

// 已知品牌的正确 nameZh（直接写死最稳）
const CORRECT_NAME_ZH = {
  'oura-20260622': 'Oura 品牌视觉研究',
  'hatch-20260622': 'Hatch 品牌视觉研究',
  'linear-20260622': 'Linear 品牌视觉研究',
  'b-o-20260622': 'B-O 品牌视觉研究',
};

function processFile(filePath) {
  const fileName = path.basename(filePath);
  const id = fileName.replace(/\.html$/i, '');
  const correctNameZh = CORRECT_NAME_ZH[id];
  if (!correctNameZh) {
    console.log(`SKIP: ${fileName} 没有正确的 nameZh 映射`);
    return false;
  }

  console.log(`\n处理: ${fileName} -> nameZh="${correctNameZh}"`);
  let html = fs.readFileSync(filePath, 'utf8');

  if (!html.includes('id="__BRAND_DATA__"')) {
    console.log('  - 没有 __BRAND_DATA__ 块，跳过');
    return false;
  }

  // 1. 抓出 JSON 文本
  const match = html.match(/<script id="__BRAND_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    console.log('  - 没匹配到 __BRAND_DATA__');
    return false;
  }
  const jsonStr = match[1];

  // 2. 反转义 HTML 实体（&quot; -> ", &amp; -> &, &lt; -> <, &gt; -> >）
  const unescaped = jsonStr
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  let data;
  try {
    data = JSON.parse(unescaped);
  } catch (e) {
    console.log('  WARN: JSON.parse 失败: ' + e.message);
    return false;
  }

  const oldNameZh = data.nameZh || '';
  console.log(`  old nameZh: ${JSON.stringify(oldNameZh)}`);

  // 3. 强制把 nameZh 设为正确值（这会解决 mojibake —— 因为 Node 字符串本身是正确字符）
  data.nameZh = correctNameZh;

  // 4. 同时也清掉 summary 里可能存在的 mojibake（更激进的做法：把整个 data 重新走一遍
  //    "latin1 解读 -> utf8 编码" 的逆向过程来修正）
  //    检测特征：mojibake 字符串里包含 U+2510-U+254B 范围（box drawing chars），或 U+9375 这种 GBK 重码
  const hasMojibake = (s) => {
    if (!s) return false;
    return /[\u2500-\u254F\u9375\u4F7A\u589D\u745A\u55DA\u942E\u65C2]/.test(s);
  };
  const fixMojibake = (s) => {
    if (typeof s !== 'string' || !s) return s;
    if (!hasMojibake(s)) return s;
    // 反向：用 latin1 把字符串字节化，再用 utf8 解码
    try {
      const buf = Buffer.from(s, 'latin1');
      return buf.toString('utf8');
    } catch (e) {
      return s;
    }
  };

  const fixStringsDeep = (obj) => {
    if (typeof obj === 'string') return fixMojibake(obj);
    if (Array.isArray(obj)) return obj.map(fixStringsDeep);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = fixStringsDeep(obj[k]);
      return out;
    }
    return obj;
  };

  // 不对 data.nameZh 应用 mojibake 修复（我们手动覆盖了）
  const dataFixed = fixStringsDeep(data);
  dataFixed.nameZh = correctNameZh;

  console.log(`  new nameZh: ${JSON.stringify(dataFixed.nameZh)}`);

  // 5. 重新 HTML 转义（只转义 & < > "，中文不动）
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const newBlock = `<script id="__BRAND_DATA__" type="application/json">${esc(JSON.stringify(dataFixed))}</script>`;

  // 6. 替换回文件
  html = html.replace(/<script id="__BRAND_DATA__" type="application\/json">[\s\S]*?<\/script>/, newBlock);

  // 7. 用 \n 而不是 \r\n（确保 LF only，no CRLF）
  html = html.replace(/\r\n/g, '\n');

  // 8. 移除 UTF-8 BOM 如果存在
  if (html.charCodeAt(0) === 0xFEFF) {
    html = html.slice(1);
    console.log('  - 移除 BOM');
  }

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
console.log('\n下一步：跑 refresh-index 让 index.json 也跟着修');

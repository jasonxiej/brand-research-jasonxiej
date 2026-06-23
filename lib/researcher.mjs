// lib/researcher.mjs
// ============================================================
// 品牌调研核心逻辑：抓官网 → 提取基本信息 → 调 LLM 做 8 维分析
// 复用 .trae/skills/brand-research/SKILL.md 中定义的 8 维度框架
// ============================================================

import { load as cheerioLoad } from 'cheerio';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- OpenAI 兼容客户端 ----------
function makeClient(config = {}) {
  const apiKey = config.apiKey || process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = config.baseUrl || process.env.MINIMAX_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  if (!apiKey) {
    throw new Error('未配置 AI 模型 API Key。请在设置里填写 API Key，或在 .env 中配置 API Key。');
  }
  return new OpenAI({ apiKey, baseURL });
}

// ---------- 工具：把传入的 brand 解析成 { name, url, slug } ----------
export function parseInput(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('请输入品牌名或官网 URL');

  // 看起来是 URL
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    return {
      name: guessNameFromUrl(u),
      url: s,
      slug: slugify(u.hostname.replace(/^www\./, '')),
    };
  }

  // 是品牌名 → 我们用 https://<slug>.com 作为试探 URL（不一定能访问，但先放着）
  const slug = slugify(s);
  return {
    name: s,
    url: null, // 后面 LLM 阶段会让我们去搜
    slug,
  };
}

function guessNameFromUrl(u) {
  const host = u.hostname.replace(/^www\./, '').split('.')[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[\/\?#].*$/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'brand';
}

// ---------- 抓取官网 HTML ----------
async function fetchSite(url, onLog) {
  if (!url) return null;
  onLog?.({ level: 'info', msg: `→ 抓取官网: ${url}` });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BrandResearchHub/1.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
      redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    onLog?.({ level: 'success', msg: `✓ 官网 HTML 已抓取 (${(html.length / 1024).toFixed(1)} KB)` });
    return html;
  } catch (e) {
    onLog?.({ level: 'warn', msg: `⚠ 官网抓取失败: ${e.message}。将继续用品牌名做语义分析。` });
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---------- cheerio 提取基本信息 ----------
function extractBasics(html, onLog) {
  if (!html) return { text: '', meta: {} };
  const $ = cheerioLoad(html);

  const meta = {
    title: $('title').first().text().trim().slice(0, 200),
    description: $('meta[name="description"]').attr('content')?.trim().slice(0, 300) || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    ogSiteName: $('meta[property="og:site_name"]').attr('content') || '',
    favicon: $('link[rel*="icon"]').first().attr('href') || '',
    h1: $('h1').first().text().trim().slice(0, 200),
  };

  // 找 logo img
  const logoCandidates = [];
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') || '').toLowerCase();
    const src = $(el).attr('src') || '';
    if (/logo|brand/i.test(alt) || /logo|brand/i.test(src)) {
      logoCandidates.push({ src, alt });
    }
  });
  meta.logoCandidates = logoCandidates.slice(0, 3);

  // 提取页面纯文本（用于 LLM）
  $('script, style, noscript, svg, iframe').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);

  onLog?.({ level: 'info', msg: `→ 提取 meta: title="${meta.title.slice(0, 40)}…"` });
  return { text, meta };
}

// ---------- 调 LLM：8 维分析 + 雷达图打分 ----------

// 把 LLM 返回的原文清洗成可解析的 JSON 字符串：
//   1. 剥掉 <think>...</think> 块（包括多段、非贪婪）
//   2. 剥 markdown 围栏 ```json ... ```
//   3. trim
function cleanLLMOutput(raw) {
  let s = String(raw || '');
  // 1) 剥 thinking 块（多次出现也安全）
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 2) 剥 markdown 围栏
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return s;
}

// 用平衡括号找到第一个完整 JSON 对象并解析
function extractFirstJSON(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}

// 智能修复 JSON：状态机正确跟踪字符串边界，把"字符串内"的未转义 " 当成内容而非结束
// 判定逻辑：看到 " 时，跳过后面空白，若下一个非空白字符是 `,` `}` `]` `:` 之一才算字符串结束，
// 否则视为内容里的非法引号，自动加 \ 转义
function repairJson(s) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { out += ch; escape = false; continue; }
    if (ch === '\\' && inString) { out += ch; escape = true; continue; }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }
      // 在字符串内：看后面是否紧跟 JSON 结构符号
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      const next = s[j] || '';
      if (next === ',' || next === '}' || next === ']' || next === ':') {
        // 真正的字符串结束
        inString = false;
        out += ch;
        continue;
      }
      // 字符串内的引号：转义
      out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

// ---------- 编码安全网：清理 LLM 返回里可能出现的 mojibake / 控制字符 ----------
// 现象：偶尔 LLM 返回的字符串里会带 box-drawing 字符 (U+2500-254F)、
//       GBK 重码字符 (U+9375 鍝 / U+4F7A 佺 / U+589D 墝 ...)、或 ESC (U+001B)
//       这种被双重编码或带控制字符的"假中文"。
// 修法：
//   1. 移除 ASCII 控制字符 (U+0000-001F, U+007F) 除了 \n \r \t
//   2. 如果检测到 mojibake 标记字符（box-drawing / GBK 重码），尝试 latin1→utf8 还原
//   3. 把还原失败的（仍是 box-drawing）整段标 [unreadable] 替换
const MOJIBAKE_MARKER = /[\u2500-\u254F\u9375\u4F7A\u589D\u745A\u55DA\u942E\u65C2\u934E\u58D0\u5466\u7E0F]/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeString(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s.replace(CONTROL_CHARS, '');
  if (MOJIBAKE_MARKER.test(out)) {
    // 尝试用 latin1 解读字节流再回 utf8（经典 mojibake 逆向）
    try {
      const buf = Buffer.from(out, 'latin1');
      const recovered = buf.toString('utf8');
      // 只在"还原后看起来更像中文"时采用：检测中文字符占比提升
      const beforeZh = (out.match(/[\u4E00-\u9FFF]/g) || []).length;
      const afterZh = (recovered.match(/[\u4E00-\u9FFF]/g) || []).length;
      if (afterZh > beforeZh) {
        out = recovered.replace(CONTROL_CHARS, '');
      }
    } catch { /* keep original */ }
  }
  // 兜底：残余的 box-drawing 字符直接替换为占位
  out = out.replace(/[\u2500-\u254F]+/g, '');
  return out;
}

function sanitizeDeep(o) {
  if (typeof o === 'string') return sanitizeString(o);
  if (Array.isArray(o)) return o.map(sanitizeDeep);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) out[k] = sanitizeDeep(o[k]);
    return out;
  }
  return o;
}
const SYSTEM_PROMPT = `你是 {YOUR_BRAND} 的资深品牌视觉策略师，专长是消费品的视觉解构与对标分析。
你的任务是基于【品牌名 + 官网文本】，输出**严格的 JSON**，对应 brand-research skill 定义的 8 大调研维度 + 6 维雷达图。

【8 大维度（每项都必填，简洁但具体）】
1. logo: { type: "wordmark|monogram|emblem|abstract|组合", description: "一句话描述", construction: "构成逻辑（几何/字形/留白）" }
2. palette: 3-6 个色板 [{ hex: "#RRGGBB", name: "英文/中文命名" }]，必须从官网色系提取，HEX 大写
3. typography: { heading: "标题字体（系统名或推测特征）", body: "正文字体", notes: "特征一句话" }
4. photography: { style: "lifestyle|studio|3D|documentary|...（可多选，用逗号）", lighting: "光线特征", tone: "色调关键词", composition: "构图特征" }
5. tone: 3-5 个调性关键词（中文，如"克制冷峻 / 温度感 / 高级感"）
6. toneSummary: 一句话调性总结（30 字内）
7. positioning: 品牌定位/一句话主张
8. targetUser: { age: "年龄段", identity: "身份", pain: "核心痛点", scene: "使用场景" }
9. sellingPoints: 3-5 条核心卖点
10. **brandTakeaway: 严格输出 5 条中文建议**，每条 15-40 字，必须基于该品牌【独特的卖点、视觉策略、可借鉴的动作】，**禁止任何模板化套话**

【6 维雷达图（每项 0-10，允许 0.5 小数）】
- 克制：黑白灰/留白越多分越高
- 温度感：暖色/柔和光/圆角加分
- 游戏化：IP/霓虹/插画加分
- 科技感：等宽字体/深色/数据可视化加分
- 情感连接：真实人物/生活场景/社群加分
- 识别强度：强对比/独特图形/大色块加分

【额外字段】
- name: 英文名（首字母大写）
- nameZh: 中文名/品牌全称（没有就填空字符串）
- url: **品牌官方网址（完整 URL，含 https://）**。如不确定宁可留空字符串也不要乱猜
- tagline: 一句话品牌主张（官网有就用官网的）
- category: 品类（如 "Health Wearable" / "Sleep Tech"）
- country: 国家/地区
- year: 创立年份（不知道就 null）
- summary: 100-150 字的品牌叙事性总结
- primaryColors: 从 palette 里挑前 4 个 hex 字符串数组（前端展示用）

【严格要求】
- 只输出 JSON，不要任何解释、markdown 代码块、前后缀
- **不要使用 <think>...</think> 思考块，不要先做内部推理**
- 直接进入 JSON 输出，第一个字符必须是 { 或 [
- 所有文字字段用中文（除 name/hex/type/style 等专有名词）
- 数据缺失时填合理的推测值，不要留空字符串
- 雷达图分数要有区分度（避免全 5 分）
- **在中文文本里需要引用名词时，必须用中文全角引号 "…"（U+201C / U+201D），绝对不要用 ASCII 的 "，否则会破坏 JSON 结构**

【brandTakeaway 字段的强制要求】
- 必须输出 **正好 5 条**字符串，组成数组
- 每条长度 15-40 字（中文计 1 字）
- 每条必须聚焦该品牌的【独特卖点 / 视觉策略 / 可借鉴动作】三选一或组合
- 禁止使用通用模板套话，例如不要出现：「中性 + 1 暖点缀」「杀手级场景」「斜体 + 大字号」「雾绿」「暖中性色」「长期调性」「全渠道视觉统一」等默认短语
- 每条要包含具体可落地的动作（动词开头如「复刻」「引入」「删减」「重构」「限定」「强约束」等）
- 5 条要尽量分散在：色板策略、字体策略、摄影/排版、产品定位、社群/活动 五个维度，不要五条都讲色板
- 如果品牌是 Nike 这种级别，必须提到 Swoosh、Just Do It、运动员代言矩阵等真实资产，不要泛泛而谈`;

// ---------- brandTakeaway 校验 ----------
// 默认模板套话禁词：出现这些词基本就是模型偷懒
const TAKEAWAY_BAN_PHRASES = [
  '中性 + 1 暖点缀',
  '中性+1暖点缀',
  '杀手级场景',
  '斜体 + 大字号',
  '斜体+大字号',
  '雾绿',
  '暖中性色',
  '长期调性',
  '全渠道视觉统一',
  '杀手级',
  '呼吸感',
  '大字号',
  '安静',
  '泛功能堆叠',
];

// 判定规则：返回 { ok, reason }
// - ok=false 时 reason 会写进 retry prompt
function validateBrandTakeaway(arr) {
  if (!Array.isArray(arr) || arr.length < 5) {
    return { ok: false, reason: `brandTakeaway 数组不足 5 条（当前 ${Array.isArray(arr) ? arr.length : 0} 条），必须输出正好 5 条` };
  }
  // 长度校验：每条 15-40 字
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== 'string') {
      return { ok: false, reason: `第 ${i + 1} 条不是字符串` };
    }
    const len = [...item.trim()].length; // 按字符（中文按 1 字）计算
    if (len < 15 || len > 40) {
      return { ok: false, reason: `第 ${i + 1} 条长度 ${len} 字，不在 15-40 字范围` };
    }
  }
  // 禁词检测：5 条中只要出现任何一个禁词就视为模板套话
  const joined = arr.join(' ');
  for (const ban of TAKEAWAY_BAN_PHRASES) {
    if (joined.includes(ban)) {
      return { ok: false, reason: `检测到模板套话禁词「${ban}」` };
    }
  }
  return { ok: true, reason: '' };
}

async function analyzeWithLLM({ name, url, text, meta, onLog, llmConfig }) {
  const client = makeClient(llmConfig);
  const model = llmConfig?.model || process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || 'MiniMax-M3';

  const userMsg = [
    `【品牌名】${name}`,
    url ? `【官网】${url}` : '【官网】未提供，请基于品牌名做语义推断',
    meta?.title ? `【页面标题】${meta.title}` : '',
    meta?.description ? `【页面描述】${meta.description}` : '',
    text ? `【官网正文（前 8K 字符）】\n${text}` : '【官网正文】未抓取到，请完全基于品牌名 + 你的知识做合理推断',
  ].filter(Boolean).join('\n\n');

  onLog?.({ level: 'info', msg: `→ 调用 LLM (${model}) 做 8 维分析…` });

  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const raw = resp.choices?.[0]?.message?.content || '';
  onLog?.({ level: 'success', msg: `✓ LLM 返回 (${elapsed}s, ${raw.length} 字符)` });

  // 解析 JSON（防御性：剥 thinking block + markdown 围栏 + 智能修复 + 平衡括号提取）
  let data = null;
  try {
    data = parseLLMJson(raw, onLog);
  } catch (e) {
    throw new Error('LLM 返回无法解析为 JSON: ' + e.message);
  }
  if (!data) {
    throw new Error('LLM 返回无法解析为 JSON (前 200 字符): ' + cleanLLMOutput(raw).slice(0, 200));
  }

  // ---------- brandTakeaway 校验 + 一次重试 ----------
  const check = validateBrandTakeaway(data.brandTakeaway);
  if (!check.ok) {
    onLog?.({ level: 'warn', msg: `⚠ brandTakeaway 校验失败：${check.reason}，自动重试一次…` });
    try {
      const retryMsg = [
        `上一次返回的 brandTakeaway 不合格：${check.reason}`,
        '请重新生成 brandTakeaway 字段：',
        '- 必须输出正好 5 条',
        '- 每条 15-40 字',
        '- 严禁出现以下禁词：' + TAKEAWAY_BAN_PHRASES.map((b) => `「${b}」`).join('、'),
        '- 必须基于该品牌的【独特卖点 / 视觉策略 / 可借鉴动作】写具体内容，不要任何通用模板',
      ].join('\n');

      const retryResp = await client.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
          { role: 'assistant', content: raw },
          { role: 'user', content: retryMsg },
        ],
      });
      const retryRaw = retryResp.choices?.[0]?.message?.content || '';
      const retryData = parseLLMJson(retryRaw, onLog);
      if (retryData && validateBrandTakeaway(retryData.brandTakeaway).ok) {
        data.brandTakeaway = retryData.brandTakeaway;
        onLog?.({ level: 'success', msg: `✓ brandTakeaway 重试通过 (${retryData.brandTakeaway.length} 条)` });
      } else if (retryData && Array.isArray(retryData.brandTakeaway)) {
        // 重试仍不合格：保留模型实际返回的内容（不要硬编码兜底）
        const items = retryData.brandTakeaway.slice(0, 5);
        data.brandTakeaway = items;
        onLog?.({ level: 'warn', msg: `⚠ brandTakeaway 重试仍不足 5 条（${items.length} 条），保留模型实际返回内容` });
      } else {
        onLog?.({ level: 'warn', msg: `⚠ brandTakeaway 重试解析失败，保留原始内容` });
      }
    } catch (e) {
      onLog?.({ level: 'warn', msg: `⚠ brandTakeaway 重试异常: ${e.message}，保留原始内容` });
    }
  } else {
    onLog?.({ level: 'info', msg: `✓ brandTakeaway 校验通过 (${data.brandTakeaway.length} 条)` });
  }

  // 兜底
  data.name = data.name || name;
  data.radar = data.radar || {};
  for (const k of ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度']) {
    if (typeof data.radar[k] !== 'number') data.radar[k] = 5;
  }
  data.palette = Array.isArray(data.palette) && data.palette.length ? data.palette : [
    { hex: '#1A1A1A', name: 'Ink' },
    { hex: '#FBF8F3', name: 'Cream' },
    { hex: '#FF7A45', name: 'Orange' },
  ];
  data.primaryColors = (data.primaryColors && data.primaryColors.length)
    ? data.primaryColors
    : data.palette.slice(0, 4).map((p) => p.hex);

  // 编码安全网：递归清洗所有字符串字段，去 mojibake / 控制字符
  data = sanitizeDeep(data);
  if (typeof data.summary === 'string') {
    onLog?.({ level: 'info', msg: `→ 编码安全网：清洗后 summary 长度 ${data.summary.length} 字符` });
  }

  onLog?.({
    level: 'success',
    msg: `✓ 8 维分析完成 · 调性: ${(data.tone || []).slice(0, 3).join(' / ')}`,
  });
  return data;
}

// 抽取 LLM 返回的 JSON 文本并解析；用于初次调用与重试复用
function parseLLMJson(raw, onLog) {
  const cleaned = cleanLLMOutput(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    onLog?.({ level: 'warn', msg: '⚠ LLM 返回非 JSON，尝试智能修复引号…' });
    const repaired = repairJson(cleaned);
    try { return JSON.parse(repaired); }
    catch {
      onLog?.({ level: 'warn', msg: '⚠ 智能修复失败，尝试平衡括号提取…' });
      return extractFirstJSON(cleaned);
    }
  }
}

// ---------- 主入口 ----------
export async function runResearch({ raw, onLog, llmConfig }) {
  const { name, url, slug } = parseInput(raw);
  onLog?.({ level: 'info', msg: `🎯 开始调研: ${name}${url ? ` (${url})` : ' (未提供 URL)'}` });

  const html = await fetchSite(url, onLog);
  const { text, meta } = extractBasics(html, onLog);

  const data = await analyzeWithLLM({ name, url, text, meta, onLog, llmConfig });

  // 合并 meta 信息（favicon、logo candidates）
  if (meta?.favicon) data.favicon = meta.favicon;
  if (meta?.ogImage) data.heroImage = meta.ogImage;
  if (meta?.logoCandidates?.length) data.logoCandidates = meta.logoCandidates;

  // URL 优先级：用户输入的 URL > LLM 给出的 url > 输入解析出的 URL
  const finalUrl = url || (typeof data.url === 'string' && /^https?:\/\//i.test(data.url) ? data.url : null);
  onLog?.({ level: 'info', msg: `→ URL 决策: 输入=${url || '(无)'} | LLM=${data.url || '(无)'} | 最终=${finalUrl || '(无)'}` });

  return { slug, name, url: finalUrl, data, meta };
}

import { load as cheerioLoad } from 'cheerio';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RADAR_KEYS = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];

function makeClient(config = {}) {
  const apiKey = config.apiKey || process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = config.baseUrl || process.env.MINIMAX_BASE_URL || process.env.OPENAI_BASE_URL || 'https://your-llm-provider.example.com/v1';
  if (!apiKey) throw new Error('未配置 AI 模型 API Key。请在设置里填写 API Key，或在 .env 中配置 API Key。');
  return new OpenAI({ apiKey, baseURL });
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

export function parseInput(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('请输入品牌名或网站 URL');
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    return { name: guessNameFromUrl(u), url: s, slug: slugify(u.hostname.replace(/^www\./, '')) };
  }
  return { name: s, url: null, slug: slugify(s) };
}

function guessNameFromUrl(u) {
  const host = u.hostname.replace(/^www\./, '').split('.')[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
}

function inferNameFromMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (m && m[1]) return m[1].replace(/[`*_>#]/g, '').trim();
  }
  for (const line of lines) {
    const t = line.replace(/[`*_>#-]/g, '').trim();
    if (t) return t.slice(0, 40);
  }
  return '';
}

async function fetchSite(url, onLog) {
  if (!url) return null;
  onLog?.({ level: 'info', msg: '抓取官网: ' + url });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
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
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    onLog?.({ level: 'success', msg: '官网 HTML 已抓取 (' + (html.length / 1024).toFixed(1) + ' KB)' });
    return html;
  } catch (e) {
    onLog?.({ level: 'warn', msg: '官网抓取失败: ' + e.message + '。将继续用品牌名做语义分析。' });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
  const logoCandidates = [];
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') || '').toLowerCase();
    const src = $(el).attr('src') || '';
    if (/logo|brand/i.test(alt) || /logo|brand/i.test(src)) logoCandidates.push({ src, alt });
  });
  meta.logoCandidates = logoCandidates.slice(0, 3);
  $('script, style, noscript, svg, iframe').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
  onLog?.({ level: 'info', msg: '提取 meta: title="' + meta.title.slice(0, 40) + '"' });
  return { text, meta };
}

function cleanLLMOutput(raw) {
  let s = String(raw || '');

  // 1) 撕掉所有变种的 reasoning / thinking 标签（部分模型只会闭合其中一种）
  s = s.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '');
  //    没闭合的 <think>：只撕到首个 { 或 [ 出现为止，不要把后面的 JSON 一起吞了
  s = s.replace(/<\s*think(?:ing)?\s*>[\s\S]*?(?=\{|\[)/gi, '');
  //    单独的 </think>：撕它到首个 { 或 [ 之间的内容
  s = s.replace(/<\s*\/\s*think(?:ing)?\s*>[\s\S]*?(?=\{|\[)/gi, '');
  s = s.replace(/<\s*reasoning\s*>[\s\S]*?<\s*\/\s*reasoning\s*>/gi, '');
  s = s.replace(/<\s*reflection\s*>[\s\S]*?<\s*\/\s*reflection\s*>/gi, '');

  // 2) 撕掉模型自己解释 markdown 代码围栏（即便中间没出现 { 也无害）
  s = s.split('```json').join('');
  s = s.split('```JSON').join('');
  s = s.split('```').join('');

  // 3) 撕掉任何 "\nHuman:" / "\nAssistant:" 这种对话续写残留
  s = s.replace(/\n\s*(Human|Assistant|System)\s*:\s*[\s\S]*$/i, '');

  // 4) 如果模型在 JSON 前面写了一堆"内心戏"（policy conflict、developer policy 等），
  //    第一个 { 之前的所有内容都丢掉，只保留 JSON 段落。
  //    注意：不要 trim 到最后一个 }，因为后面可能有 "提示" 等附加文本。
  return s.trim();
}

function extractFirstJSON(s) {
  // 1) 先尝试直接 parse（clean 之后没 { 之前任何字符的情况）
  try { return JSON.parse(s); } catch {}
  // 2) 跳过开头所有非 { 非 [ 字符
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
  // 2a) 如果是 [ 开头，先尝试当 JSON 数组解析
  if (s[start] === '[') {
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (inString) { if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch {}
          break;
        }
      }
    }
  }
  // 2b) 标准对象提取
  let depth = 0, inString = false, escape = false, candidateStart = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      depth++;
      if (candidateStart < 0) candidateStart = i;
    }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && candidateStart >= 0) {
        const candidate = s.slice(candidateStart, i + 1);
        try { return JSON.parse(candidate); } catch {}
        // 没解析成功时不要 return null，继续往后找下一个完整对象
        candidateStart = -1;
        depth = 0;
      }
    }
  }
  return null;
}

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
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const next = s[j] || '';
      if (next === ',' || next === '}' || next === ']' || next === ':') {
        inString = false;
        out += ch;
        continue;
      }
      out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

function sanitizeString(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
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

function parseLLMJson(raw, onLog) {
  let cleaned = cleanLLMOutput(raw);

  // 有些模型在 JSON 之前会先写一段元推理（"developer policy..." / "思考块..."），
  // 就算 cleanLLMOutput 已经撕了 <think> 标签，残留的纯文本仍然会让 parse 失败。
  // 这里把首个 { 或 [ 之前的所有字符都丢掉。
  const firstBracket = cleaned.search(/[\[{]/);
  if (firstBracket > 0) {
    const prefix = cleaned.slice(0, firstBracket);
    onLog?.({ level: 'warn', msg: '检测到 JSON 前的杂文（' + prefix.length + ' 字符），已丢弃。' });
    cleaned = cleaned.slice(firstBracket);
  }

  try { return JSON.parse(cleaned); } catch {}
  onLog?.({ level: 'warn', msg: 'LLM 返回非 JSON，尝试修复引号。' });
  try { return JSON.parse(repairJson(cleaned)); } catch {}
  onLog?.({ level: 'warn', msg: '智能修复失败，尝试提取首个 JSON 对象。' });
  return extractFirstJSON(cleaned);
}

function validateBrandTakeaway(arr) {
  if (!Array.isArray(arr) || arr.length !== 5) {
    return { ok: false, reason: 'brandTakeaway 必须正好 5 条。' };
  }
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string') return { ok: false, reason: 'brandTakeaway 每条必须是字符串。' };
    const len = [...arr[i].trim()].length;
    if (len < 15 || len > 40) return { ok: false, reason: 'brandTakeaway 每条需在 15-40 字之间。' };
  }
  return { ok: true, reason: '' };
}

const SYSTEM_PROMPT = [
  '你是 {YOUR_BRAND} 的资深品牌视觉策略师，同时精通中英双语文案。',
  '请基于品牌名和官网文本，输出严格 JSON，所有文本字段必须同时给出中文版和英文版。',
  '',
  '【最重要的输出格式约束】',
  '1. 你的回复必须以单个 JSON 对象 { 开始，并以对应的 } 结束。',
  '2. 严禁输出任何 "思考" / "推理" / "反思" 文本（包括 <think>…</think>、<thinking>…</thinking>、<reasoning>…</reasoning>、<reflection>…</reflection>、以 "The developer policy" / "思考块" / "Looking again" / "我需要" / "Let me think" / "First, I will" 等开头的元分析段落）。',
  '3. 严禁解释 prompt、引用 system/developer policy、复述规则、输出 markdown 围栏（```）、或添加任何前缀/后缀说明。',
  '4. 任何 "policy conflict" / "self-correction" / "internal reasoning" 类的内心戏都不要写进回复；如果你想"思考"，直接在 JSON 字段里产出最终结论。',
  '5. 唯一允许的输出：一个合法 JSON 对象。',
  '',
  '输出字段（每个字段的 *Zh 表示中文，*En 表示英文；只给出其中一边的，视为不合规）：',
  'name, nameZh, tagline, taglineZh, category, categoryZh, country, countryZh, year,',
  'summary, summaryEn,',
  'tone (Chinese array), toneEn (English array, same length),',
  'toneSummary, toneSummaryEn,',
  'positioning, positioningEn,',
  'targetUser.{age, ageZh, identity, identityZh, pain, painZh, scene, sceneZh}, targetUserEn.{age, identity, pain, scene},',
  'sellingPoints (Chinese array, exactly 5), sellingPointsEn (English array, exactly 5, same order),',
  'brandTakeaway (Chinese array, exactly 5), brandTakeawayEn (English array, exactly 5, same order),',
  '    ^^ brandTakeaway = 5 条对自家品牌（{YOUR_BRAND} 视角）可借鉴的具体行动建议：',
  '       每条 15-40 字，必须是"可立刻去做"的战术动作（例：把首页主色从蓝换成橙；引入 monthly drop 节奏；把 logo 缩小 30% 提升 breathing room）。',
  '       严禁空泛形容词（"提升品牌感"、"增强互动"），严禁复述 sellingPoints。',
  'logo.{type, typeZh, description, descriptionEn, construction, constructionEn},',
  'typography.{heading, headingEn, body, bodyEn, notes, notesEn},',
  'photography.{style, styleEn, lighting, lightingEn, tone, toneEn, composition, compositionEn},',
  'palette (array of {hex, name (Chinese), nameEn (English)}),',
  'primaryColors (array of hex), radar (object with 6 keys: 克制, 温度感, 游戏化, 科技感, 情感连接, 识别强度, values 0-10).',
  '',
  '硬性要求：',
  '1. 只输出 JSON，不要解释、不要 markdown 包装。',
  '2. 英文翻译要自然地道，保留品牌专有名词原文（如 Apple、Just Do It、Swoosh）。',
  '3. brandTakeaway / brandTakeawayEn / sellingPoints / sellingPointsEn 数组长度必须一致，5 条。',
  '4. brandTakeaway 每条 15-40 字，必须具体可执行。',
  '5. radar 六维评分 0-10 分，可有 0.5 小数。',
  '6. 如果信息不足，使用最合理的推断，不要留空字符串。',
].join('\n');

// 单次 LLM 调用已经生成中英双版时，en 数据从顶层 *_En 字段收集；
// 如果未来回退到单语生成，下面的函数负责二次翻译补全。
async function buildEnglishI18nPack(data, llmConfig, onLog) {
  const client = makeClient(llmConfig);
  const model = llmConfig?.model || process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || 'your-default-model';
  const source = {
    name: data.name || '',
    nameZh: data.nameZh || data.name || '',
    tagline: data.tagline || '',
    taglineZh: data.taglineZh || '',
    category: data.category || '',
    categoryZh: data.categoryZh || '',
    country: data.country || '',
    countryZh: data.countryZh || '',
    summary: data.summary || '',
    summaryEn: data.summaryEn || '',
    tone: data.tone || [],
    toneEn: data.toneEn || [],
    toneSummary: data.toneSummary || '',
    toneSummaryEn: data.toneSummaryEn || '',
    positioning: data.positioning || '',
    positioningEn: data.positioningEn || '',
    targetUser: data.targetUser || {},
    targetUserEn: data.targetUserEn || null,
    sellingPoints: data.sellingPoints || [],
    sellingPointsEn: data.sellingPointsEn || [],
    brandTakeaway: data.brandTakeaway || [],
    brandTakeawayEn: data.brandTakeawayEn || [],
    logo: data.logo || {},
    typography: data.typography || {},
    photography: data.photography || {},
    palette: data.palette || [],
  };
  // 已经在主调里拿到双语则无需再调
  const allEnPresent = source.summaryEn && source.toneEn.length === source.tone.length
    && source.brandTakeawayEn.length === source.brandTakeaway.length
    && (source.sellingPointsEn.length === source.sellingPoints.length);
  if (allEnPresent) {
    onLog?.({ level: 'info', msg: '双语字段已由主调生成，跳过二次翻译。' });
    return pickEnglishFromBilingual(source);
  }
  const prompt = [
    'Translate the following brand-research JSON from Chinese into natural English.',
    'Return ONLY valid JSON with the same keys and array lengths.',
    'For any *En field already provided, keep it as-is unless it is clearly empty.',
    'Do not invent facts.',
    JSON.stringify(source),
  ].join('\n');
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 4500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a careful translation engine for brand research reports.' },
      { role: 'user', content: prompt },
    ],
  });
  const raw = resp.choices?.[0]?.message?.content || '';
  const translated = parseLLMJson(raw, onLog) || {};
  return sanitizeDeep(translated);
}

// 从双语主调结果中抽取出 i18n.en 子集
function pickEnglishFromBilingual(d) {
  const en = {
    name: d.name || '',
    nameEn: d.name || '',
    tagline: d.tagline || '',
    taglineEn: d.tagline || '',
    taglineZh: d.taglineZh || '',
    category: d.category || '',
    categoryEn: d.category || '',
    country: d.country || '',
    countryEn: d.country || '',
    summaryEn: d.summaryEn || '',
    toneEn: Array.isArray(d.toneEn) ? d.toneEn : (d.tone || []),
    toneSummaryEn: d.toneSummaryEn || '',
    positioningEn: d.positioningEn || '',
    sellingPointsEn: Array.isArray(d.sellingPointsEn) ? d.sellingPointsEn : (d.sellingPoints || []),
    brandTakeawayEn: Array.isArray(d.brandTakeawayEn) ? d.brandTakeawayEn : (d.brandTakeaway || []),
    targetUserEn: d.targetUserEn || null,
    logo: {},
    typography: {},
    photography: {},
    palette: (d.palette || []).map((p) => ({ ...p, nameEn: p.nameEn || p.name })),
  };
  if (d.logo) {
    en.logo = {
      typeEn: d.logo.typeEn || d.logo.type || '',
      descriptionEn: d.logo.descriptionEn || d.logo.description || '',
      constructionEn: d.logo.constructionEn || d.logo.construction || '',
    };
  }
  if (d.typography) {
    en.typography = {
      headingEn: d.typography.headingEn || d.typography.heading || '',
      bodyEn: d.typography.bodyEn || d.typography.body || '',
      notesEn: d.typography.notesEn || d.typography.notes || '',
    };
  }
  if (d.photography) {
    en.photography = {
      styleEn: d.photography.styleEn || d.photography.style || '',
      lightingEn: d.photography.lightingEn || d.photography.lighting || '',
      toneEn: d.photography.toneEn || d.photography.tone || '',
      compositionEn: d.photography.compositionEn || d.photography.composition || '',
    };
  }
  return en;
}

async function analyzeWithLLM({ name, url, text, meta, onLog, llmConfig, sourceLabel = '网页' }) {
  const client = makeClient(llmConfig);
  const model = llmConfig?.model || process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || 'your-default-model';
  const userMsg = [
    '品牌名：' + name,
    url ? '网站：' + url : '没有可访问网站时，请基于品牌名推断。',
    meta?.title ? '网页 title：' + meta.title : '',
    meta?.description ? '网页 description：' + meta.description : '',
    text ? sourceLabel + '正文（最多 8K）：\n' + text : '请基于品牌名和已知信息输出。',
  ].filter(Boolean).join('\n\n');

  onLog?.({ level: 'info', msg: '调用 LLM (' + model + ') 生成 8 维分析（中英双版）…' });
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content || '';
  onLog?.({ level: 'success', msg: 'LLM 原始返回长度：' + raw.length });
  let data = parseLLMJson(raw, onLog);

  // 第一次解析失败 → 重试一次，给出更明确的"只回 JSON"指令
  if (!data) {
    onLog?.({ level: 'warn', msg: '首次解析失败，重试一次（更严格的 JSON 指令）…' });
    try {
      const retry = await client.chat.completions.create({
        model,
        temperature: 0.2,  // 降温度，让模型更机械
        max_tokens: 8000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你只输出 JSON。不要解释、不要复述规则、不要写思考过程。不要写 <think> 之类的任何标签。直接以 { 开头，以 } 结尾。',
          },
          { role: 'user', content: userMsg },
          { role: 'user', content: '提醒：上一次返回了非 JSON 内容。请这次直接给 JSON，不要有任何前缀/后缀/解释。' },
        ],
      });
      const retryRaw = retry.choices?.[0]?.message?.content || '';
      onLog?.({ level: 'info', msg: '重试返回长度：' + retryRaw.length });
      data = parseLLMJson(retryRaw, onLog);
    } catch (e) {
      onLog?.({ level: 'warn', msg: '重试调用失败：' + e.message });
    }
  }

  if (!data) throw new Error('LLM 返回内容无法解析为 JSON: ' + cleanLLMOutput(raw).slice(0, 200));

  const check = validateBrandTakeaway(data.brandTakeaway);
  if (!check.ok) {
    onLog?.({ level: 'warn', msg: 'brandTakeaway 校验未通过：' + check.reason + '，正在重试…' });
    try {
      const retryMsg = [
        '你上一次的 brandTakeaway 不合格：' + check.reason,
        '请只重写 brandTakeaway 字段。',
        '必须输出正好 5 条。',
        '每条 15-40 字。',
        '每条必须具体、可执行、且避免空泛形容词。',
      ].join('\n');
      const retryResp = await client.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 8000,
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
        // 重试时让 LLM 一次性把 brandTakeawayEn 也带上
        if (Array.isArray(retryData.brandTakeawayEn) && retryData.brandTakeawayEn.length === 5) {
          data.brandTakeawayEn = retryData.brandTakeawayEn;
        } else {
          data.brandTakeawayEn = retryData.brandTakeaway.map((t) => ''); // 占位：buildEnglishI18nPack 会翻译
        }
      }
    } catch (e) {
      onLog?.({ level: 'warn', msg: 'brandTakeaway 重试失败：' + e.message });
    }
  }

  data.name = data.name || name;
  data.radar = data.radar || {};
  for (const k of RADAR_KEYS) if (typeof data.radar[k] !== 'number') data.radar[k] = 5;
  data.palette = Array.isArray(data.palette) && data.palette.length ? data.palette : [
    { hex: '#1A1A1A', name: 'Ink' },
    { hex: '#FBF8F3', name: 'Cream' },
    { hex: '#FF7A45', name: 'Orange' },
  ];
  data.primaryColors = (data.primaryColors && data.primaryColors.length) ? data.primaryColors : data.palette.slice(0, 4).map((p) => p.hex);

  // ---- Heuristic (objective) radar — companion to the LLM subjective radar.
  // Deterministic, computed from the structured 8-dimension data alone.
  // Gives us a second opinion that's reproducible across runs and doesn't
  // depend on what the LLM felt that day.
  try {
    const { computeHeuristicRadar, computeHeuristicRadarArray, computeHeuristicDetail } = await import('./scoring.mjs');
    data.heuristicRadar       = computeHeuristicRadar(data);
    data.heuristicRadarArray  = computeHeuristicRadarArray(data);
    data.heuristicDetail      = computeHeuristicDetail(data);
    data.heuristicMeta        = { computedAt: new Date().toISOString().slice(0, 10) };
  } catch (e) {
    onLog?.({ level: 'warn', msg: '启发式评分生成失败：' + e.message });
  }

  data = sanitizeDeep(data);

  try {
    const en = await buildEnglishI18nPack(data, llmConfig, onLog);
    data.i18n = { en };
    data.nameEn = en.name || en.nameEn || data.nameEn || data.name || name;
  } catch (e) {
    onLog?.({ level: 'warn', msg: '英文影子数据生成失败：' + e.message });
    data.i18n = data.i18n || {};
  }

  onLog?.({ level: 'success', msg: '8 维分析完成，调性关键词：' + (data.tone || []).slice(0, 3).join(' / ') });
  return data;
}

export async function runResearch({ raw, onLog, llmConfig, sourceMarkdown }) {
  const md = String(sourceMarkdown || '').trim();
  const parsed = parseInput(raw || inferNameFromMarkdown(md) || 'brand');
  const name = parsed.name;
  const url = md ? null : parsed.url;
  const slug = parsed.slug;
  onLog?.({ level: 'info', msg: '开始调研 ' + name + (url ? ' (' + url + ')' : md ? ' (Markdown 输入)' : ' (URL 输入)') });

  let text = '';
  let meta = {};
  let sourceLabel = '网页';
  if (md) {
    text = md.slice(0, 8000);
    const inferred = inferNameFromMarkdown(md) || name;
    meta = { title: inferred, description: '用户提交的 Markdown 内容', ogImage: '', ogSiteName: '', favicon: '', h1: inferred, logoCandidates: [] };
    sourceLabel = 'Markdown';
    onLog?.({ level: 'info', msg: '已读取 Markdown 内容（' + text.length + ' 字）' });
  } else {
    const html = await fetchSite(url, onLog);
    const extracted = extractBasics(html, onLog);
    text = extracted.text;
    meta = extracted.meta;
  }

  const data = await analyzeWithLLM({ name, url, text, meta, onLog, llmConfig, sourceLabel });
  if (meta?.favicon) data.favicon = meta.favicon;
  if (meta?.ogImage) data.heroImage = meta.ogImage;
  if (meta?.logoCandidates?.length) data.logoCandidates = meta.logoCandidates;
  const finalUrl = url || (typeof data.url === 'string' && /^https?:\/\//i.test(data.url) ? data.url : null);
  onLog?.({ level: 'info', msg: 'URL 解析：输入=' + (url || '(无)') + ' | LLM=' + (data.url || '(无)') + ' | 最终=' + (finalUrl || '(无)') });
  return { slug, name, url: finalUrl, data, meta };
}

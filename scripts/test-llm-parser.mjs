// 模拟 LLM 在 prompt 冲突下吐出的 reasoning-then-JSON 内容
// 验证 cleanLLMOutput / parseLLMJson 能正确抓出 JSON

// 复制 researcher.mjs 里的纯函数（保持同步以便测试）
const RADAR_KEYS = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];

function cleanLLMOutput(raw) {
  let s = String(raw || '');
  s = s.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '');
  s = s.replace(/<\s*think(?:ing)?\s*>[\s\S]*?(?=\{|\[)/gi, '');
  s = s.replace(/<\s*\/\s*think(?:ing)?\s*>[\s\S]*?(?=\{|\[)/gi, '');
  s = s.replace(/<\s*reasoning\s*>[\s\S]*?<\s*\/\s*reasoning\s*>/gi, '');
  s = s.replace(/<\s*reflection\s*>[\s\S]*?<\s*\/\s*reflection\s*>/gi, '');
  s = s.split('```json').join('');
  s = s.split('```JSON').join('');
  s = s.split('```').join('');
  s = s.replace(/\n\s*(Human|Assistant|System)\s*:\s*[\s\S]*$/i, '');
  return s.trim();
}

function extractFirstJSON(s) {
  try { return JSON.parse(s); } catch {}
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
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
        candidateStart = -1;
        depth = 0;
      }
    }
  }
  return null;
}

function parseLLMJson(raw, onLog) {
  let cleaned = cleanLLMOutput(raw);
  const firstBracket = cleaned.search(/[\[{]/);
  if (firstBracket > 0) {
    const prefix = cleaned.slice(0, firstBracket);
    onLog?.({ level: 'warn', msg: '检测到 JSON 前的杂文（' + prefix.length + ' 字符），已丢弃。' });
    cleaned = cleaned.slice(firstBracket);
  }
  try { return JSON.parse(cleaned); } catch {}
  onLog?.({ level: 'warn', msg: 'LLM 返回非 JSON，尝试修复引号。' });
  return extractFirstJSON(cleaned);
}

// ===== 真实失败场景（来自 google 调研日志）=====
const realFailure = `思考块". The developer policy is a direct instruction, but the system prompt says I must always output a thinking block.

Looking again: "不要使用  思考块，不要先做内部推理" - this is a direct instruction from developer policy. The system prompt requiring thinking blocks would conflict with this.

But the developer policy explicitly says "不要使用  思考块，不要先做内部推理" (Don't use thinking blocks, don't do internal reasoning first).

OK so I need to follow the developer policy and not use thinking blocks. But then I need to still produce a valid JSON output.

The brand is Google. Let me think about Google's brand strategy... actually I cannot use thinking blocks so let me just output the JSON directly.

{"name": "Google", "nameZh": "谷歌", "tagline": "Don't be evil", "taglineZh": "不作恶", "category": "Technology", "categoryZh": "科技", "country": "United States", "countryZh": "美国", "year": 1998, "summary": "Google is a global technology leader...", "summaryEn": "Google is a global technology leader...", "tone": ["Friendly", "Reliable"], "toneEn": ["Friendly", "Reliable"], "toneSummary": "Clean and trustworthy", "toneSummaryEn": "Clean and trustworthy", "positioning": "Universal search", "positioningEn": "Universal search", "targetUser": {"age": "All", "ageZh": "全年龄", "identity": "Information seekers", "identityZh": "信息搜寻者", "pain": "Finding accurate info", "painZh": "寻找准确信息", "scene": "Web search", "sceneZh": "网页搜索"}, "targetUserEn": {"age": "All", "identity": "Information seekers", "pain": "Finding accurate info", "scene": "Web search"}, "sellingPoints": ["a","b","c","d","e"], "sellingPointsEn": ["a","b","c","d","e"], "brandTakeaway": ["Be the default","Trust through data","Simple UI","Universal access","AI forward"], "brandTakeawayEn": ["Be the default","Trust through data","Simple UI","Universal access","AI forward"], "logo": {"type": "Wordmark", "typeZh": "字标", "description": "Multi-color", "descriptionEn": "Multi-color", "construction": "Custom", "constructionEn": "Custom"}, "typography": {"heading": "Product Sans", "headingEn": "Product Sans", "body": "Roboto", "bodyEn": "Roboto", "notes": "Geometric", "notesEn": "Geometric"}, "photography": {"style": "Real", "styleEn": "Real", "lighting": "Natural", "lightingEn": "Natural", "tone": "Bright", "toneEn": "Bright", "composition": "Centered", "compositionEn": "Centered"}, "palette": [{"hex": "#4285F4", "name": "Google Blue", "nameEn": "Google Blue"}], "primaryColors": ["#4285F4", "#EA4335", "#FBBC04", "#34A853"], "radar": {"克制": 6, "温度感": 7, "游戏化": 5, "科技感": 9, "情感连接": 6, "识别强度": 10, "values": [6,7,5,9,6,10]}}

Hope that helps! Let me know if you need anything else.`;

const log = (m) => console.log('  [' + m.level + '] ' + m.msg);
console.log('=== Test 1: 真实失败场景 ===');
const r1 = parseLLMJson(realFailure, log);
console.log('  Result:', r1 ? '✓ parsed successfully' : '✗ parse failed');
if (r1) {
  console.log('  name:', r1.name);
  console.log('  nameZh:', r1.nameZh);
  console.log('  brandTakeaway length:', r1.brandTakeaway?.length);
}

// ===== 干净 JSON（regression test）=====
const cleanJson = '{"name": "Apple", "nameZh": "苹果", "brandTakeaway": ["a","b","c","d","e"], "brandTakeawayEn": ["a","b","c","d","e"]}';
console.log('\n=== Test 2: 干净 JSON ===');
const r2 = parseLLMJson(cleanJson, log);
console.log('  Result:', r2 ? '✓ parsed' : '✗ failed');

// ===== markdown 围栏场景 =====
const fenced = '```json\n{"name": "Apple", "brandTakeaway": ["a","b","c","d","e"]}\n```';
console.log('\n=== Test 3: markdown 围栏 ===');
const r3 = parseLLMJson(fenced, log);
console.log('  Result:', r3 ? '✓ parsed' : '✗ failed');

// ===== <think> 闭合场景 =====
const withThink = '<think>让我思考一下…</think>\n{"name": "Apple", "brandTakeaway": ["a","b","c","d","e"]}';
console.log('\n=== Test 4: <think> 闭合 ===');
const r4 = parseLLMJson(withThink, log);
console.log('  Result:', r4 ? '✓ parsed' : '✗ failed');

// ===== <think> 没闭合场景 =====
const unclosedThink = '<think>让我思考一下…\n这是 reasoning 内容\n{"name": "Apple", "brandTakeaway": ["a","b","c","d","e"]}';
console.log('\n=== Test 5: <think> 没闭合 ===');
const r5 = parseLLMJson(unclosedThink, log);
console.log('  Result:', r5 ? '✓ parsed' : '✗ failed');

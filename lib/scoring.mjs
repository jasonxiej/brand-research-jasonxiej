// lib/scoring.mjs
//
// Heuristic 6-axis tone-radar scoring engine. Given the structured 8-dimension
// brand data (logo / palette / typography / photography / tone / positioning
// / targetUser / sellingPoints) the engine produces a deterministic 0-10 score
// per axis by combining 2-3 quantified sub-indicators that can be observed from
// the data alone.
//
// Each sub-indicator returns 0-1 (clamped). The final score is a weighted
// average of sub-indicators, then scaled to 0-10 with 0.5-step rounding so the
// numbers are visually comparable to the LLM subjective scores.
//
// Axes and sub-indicators:
//   克制      (Restraint)        palette sat variance (low=high score),
//                                palette size (fewer=higher),
//                                description length (shorter=higher)
//   温度感    (Warmth)           mean hue (warm red/orange = higher),
//                                mean saturation (higher = higher),
//                                warm-keyword density in tone / tagline
//   游戏化    (Gamification)     motion / interaction keyword density
//                                in photography / tone / sellingPoints,
//                                playful keywords in targetUser
//   科技感    (Tech)             tech-keyword density in typography,
//                                photography & tone,
//                                geometric/sans typography markers
//   情感连接  (Emotion)          tagline emotional-word density,
//                                targetUser.pain specificity (length),
//                                emotional keywords in tone
//   识别强度  (Identity)         palette chroma (higher = higher),
//                                logo construction uniqueness score,
//                                typography rarity markers
//
// Outputs:
//   computeHeuristicRadar(brand) → { 克制: 7.5, 温度感: 5.5, ... }
//   computeHeuristicDetail(brand) → { 克制: { score, subs: [...] }, ... }
//
// Pure functions — no side effects, no network. Safe to run on existing
// brands/index.json records.

export const RADAR_KEYS = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];

// ---------------- Color helpers ----------------
export function hexToRgb(hex) {
  if (!hex) return null;
  let s = String(hex).trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}
export function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

// ---------------- Math helpers ----------------
function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}
// Warm hue: closer to red/orange (~0° or ~30°) gets higher score.
// Cool hue (cyan ~180°, blue ~240°) gets lower score.
function warmHueScore(h) {
  // h in [0, 360). distance to 30 (orange) using circular distance.
  if (h == null) return 0.5;
  const diff = Math.min(Math.abs(h - 30), 360 - Math.abs(h - 30));
  return clamp01(1 - diff / 180);
}
// Map 0-1 sub-score to 0-10 with 0.5 rounding.
function toTen(v) { return Math.round(clamp01(v) * 20) / 2; }
// Count keyword hits across all joined text.
function kwHits(text, kws) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  let n = 0;
  for (const k of kws) {
    if (!k) continue;
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const m = t.match(re);
    if (m) n += m.length;
  }
  return n;
}
function normalizeHits(hits, max = 4) { return clamp01(hits / max); }

// ---------------- Keyword dictionaries ----------------
const WARM_KW = ['温暖', '温情', '温柔', '亲和', '柔软', '贴心', '治愈', '陪伴', '守护', '温暖', '关怀', '暖心', '亲近', '亲密', 'cozy', 'warm', 'soft', 'caring', 'tender', 'emotional', 'friendly', 'human'];
const PLAYFUL_KW = ['游戏', '玩', '彩蛋', '积分', '动效', '互动', '挑战', '成就', '徽章', '关卡', '等级', '收藏', '盲盒', '抽奖', 'gamif', 'playful', 'playful', 'play', 'earn', 'collect', 'reward', 'challenge', 'badge', 'level', 'quest', 'streak'];
const TECH_KW = ['科技', '未来', '智能', '数字', '数据', '算法', 'AI', '3D', '虚拟', '元宇宙', '区块链', '玻璃', '渐变', '网格', '几何', '极简', '线条', 'parametric', 'futuristic', 'tech', 'tech-forward', 'geometric', 'gradient', 'glassmorphism', 'cyber', 'data', 'algorithm', 'ai', 'digital', 'vector', 'wireframe'];
const EMOTION_KW = ['爱', '梦', '相信', '勇气', '力量', '温暖', '归属', '陪伴', '守护', '故事', '情感', '共鸣', '回忆', '梦想', 'hope', 'love', 'dream', 'belief', 'courage', 'belonging', 'story', 'memory', 'community', 'together', 'feel'];
const RARE_TYPO_KW = ['定制', '专属', '手写', '衬线手写', '原创', '签名', 'custom', 'bespoke', 'handwritten', 'signature', 'proprietary', 'one-of-a-kind', 'one of a kind', 'monogram'];
const GEOM_TYPO_KW = ['几何', '无衬线', '等宽', 'geometric', 'sans-serif', 'monospace', 'mono', 'futura', 'helvetica', 'grotesk'];

// ---------------- Sub-indicator builders ----------------
function sub(name, value, weight, explain) {
  return { name, value: clamp01(value), weight, explain };
}

// ---------------- Axis: 克制 (Restraint) ----------------
function scoreRestraint(brand) {
  const palette = brand.palette || brand.primaryColors?.map((hex) => ({ hex })) || [];
  const sats = palette.map((p) => hexToHsl(p.hex)?.s).filter((x) => x != null);
  const satVar = sats.length > 1 ? variance(sats) : 0;
  const paletteSize = palette.length;
  const desc = (brand.logo?.description || '') + (brand.logo?.descriptionEn || '');
  const descLen = desc.length;
  const toneCount = (brand.tone || []).length;

  return [
    sub('palette sat variance ↓', 1 - Math.min(1, satVar / 0.30), 0.30,
        satVar === 0 ? 'no variance (mono palette)' : `variance ${satVar.toFixed(3)}`),
    sub('palette size ↓',         1 - Math.min(1, paletteSize / 8), 0.25,
        `${paletteSize} colors`),
    sub('tone tag count ↓',       1 - Math.min(1, toneCount / 8), 0.20,
        `${toneCount} tags`),
    sub('logo desc length ↓',     1 - Math.min(1, descLen / 220), 0.25,
        `${descLen} chars`),
  ];
}

// ---------------- Axis: 温度感 (Warmth) ----------------
function scoreWarmth(brand) {
  const palette = brand.palette || brand.primaryColors?.map((hex) => ({ hex })) || [];
  const hsls = palette.map((p) => hexToHsl(p.hex)).filter(Boolean);
  // Hue: warm if mean hue close to 30° (orange).
  const hueScores = hsls.map((hsl) => warmHueScore(hsl.h));
  const meanHueScore = mean(hueScores);
  const meanSat = mean(hsls.map((hsl) => hsl.s));
  // Warm-keyword density in tone + tagline + positioning + targetUser.
  const joinText = [
    brand.tone?.join(' '),
    brand.toneSummary,
    brand.tagline,
    brand.positioning,
    brand.targetUser?.identity,
  ].filter(Boolean).join(' ');
  const warmHits = kwHits(joinText, WARM_KW);

  return [
    sub('mean hue warmth ↑',    meanHueScore, 0.45,
        hsls.length ? `mean hue ${mean(hsls.map((h) => h.h)).toFixed(0)}°` : 'no palette'),
    sub('mean saturation ↑',    meanSat, 0.25,
        hsls.length ? `mean sat ${(meanSat * 100).toFixed(0)}%` : 'no palette'),
    sub('warm-keyword density', normalizeHits(warmHits, 3), 0.3,
        `${warmHits} warm keywords`),
  ];
}

// ---------------- Axis: 游戏化 (Gamification) ----------------
function scoreGamification(brand) {
  const joinText = [
    brand.tone?.join(' '),
    brand.toneSummary,
    brand.positioning,
    brand.photography?.style,
    brand.photography?.composition,
    brand.photography?.styleEn,
    brand.photography?.compositionEn,
    (brand.sellingPoints || []).join(' '),
    (brand.sellingPointsEn || []).join(' '),
  ].filter(Boolean).join(' ');
  const hits = kwHits(joinText, PLAYFUL_KW);
  const youthMarkers = (brand.targetUser?.age || '').match(/\d+/g)?.[0];
  const userAge = youthMarkers ? parseInt(youthMarkers, 10) : null;
  // Younger target user = more playful.
  const ageScore = userAge == null ? 0.5 : clamp01(1 - (userAge - 10) / 50);

  return [
    sub('playful-keyword density', normalizeHits(hits, 6), 0.65, `${hits} hits`),
    sub('target-user age ↓',        ageScore, 0.35,
        userAge != null ? `${userAge} yrs` : 'unknown'),
  ];
}

// ---------------- Axis: 科技感 (Tech) ----------------
function scoreTech(brand) {
  const joinText = [
    brand.typography?.heading,
    brand.typography?.body,
    brand.typography?.notes,
    brand.typography?.headingEn,
    brand.typography?.bodyEn,
    brand.typography?.notesEn,
    brand.photography?.style,
    brand.photography?.lighting,
    brand.photography?.tone,
    brand.photography?.composition,
    brand.photography?.styleEn,
    brand.photography?.lightingEn,
    brand.photography?.toneEn,
    brand.photography?.compositionEn,
    brand.tone?.join(' '),
    brand.toneSummary,
    brand.positioning,
  ].filter(Boolean).join(' ');
  const techHits = kwHits(joinText, TECH_KW);
  const geoHits = kwHits(brand.typography?.heading + ' ' + (brand.typography?.headingEn || ''), GEOM_TYPO_KW);

  return [
    sub('tech-keyword density', normalizeHits(techHits, 6), 0.65, `${techHits} hits`),
    sub('geometric typography', normalizeHits(geoHits, 2), 0.35,
        geoHits ? 'geometric/sans markers found' : 'no geometric markers'),
  ];
}

// ---------------- Axis: 情感连接 (Emotion) ----------------
function scoreEmotion(brand) {
  const tagline = (brand.tagline || '') + ' ' + (brand.taglineEn || '');
  const taglineHits = kwHits(tagline, EMOTION_KW);
  // Tagline density: even 1 emotional kw in a short tagline should be high.
  const taglineDensity = tagline
    ? clamp01(taglineHits / Math.max(1, Math.ceil(tagline.length / 12)))
    : 0;
  const toneHits = kwHits((brand.tone || []).join(' '), EMOTION_KW);
  const painLen = (brand.targetUser?.pain || '').length + (brand.targetUser?.painEn || '').length;
  const painSpec = clamp01(painLen / 30);

  return [
    sub('tagline emotional density', taglineDensity, 0.35,
        tagline ? `${taglineHits} emotional kw in tagline` : 'no tagline'),
    sub('tone emotional words',      normalizeHits(toneHits, 3), 0.25,
        `${toneHits} hits`),
    sub('targetUser.pain specificity ↑', painSpec, 0.40,
        `${painLen} chars`),
  ];
}

// ---------------- Axis: 识别强度 (Identity) ----------------
function scoreIdentity(brand) {
  const palette = brand.palette || brand.primaryColors?.map((hex) => ({ hex })) || [];
  const hsls = palette.map((p) => hexToHsl(p.hex)).filter(Boolean);
  // Distinctiveness proxy: high saturation palette = more memorable.
  const meanSat = mean(hsls.map((h) => h.s));
  // Hue spread — wider spread = more distinctive.
  const hues = hsls.map((h) => h.h);
  const hueSpread = hues.length > 1
    ? Math.max(...hues) - Math.min(...hues)
    : 0;
  // Typographic rarity markers
  const typoText = (brand.typography?.heading || '') + ' ' + (brand.typography?.headingEn || '')
    + ' ' + (brand.typography?.notes || '') + ' ' + (brand.typography?.notesEn || '');
  const rareHits = kwHits(typoText, RARE_TYPO_KW);
  // Logo distinctiveness proxy from construction keywords.
  const logoText = (brand.logo?.description || '') + ' ' + (brand.logo?.descriptionEn || '')
    + ' ' + (brand.logo?.construction || '') + ' ' + (brand.logo?.constructionEn || '');
  const logoKws = ['条纹', '三叶草', '苹果缺口', '勾形', '位图', '网格', '拱形', '镂空', '极简', '几何', 'cross', 'stripes', 'trefoil', 'bite', 'swoosh', 'minimal', 'geometric'];
  const logoHits = kwHits(logoText, logoKws);

  return [
    sub('palette saturation ↑',     meanSat, 0.35,
        hsls.length ? `mean sat ${(meanSat * 100).toFixed(0)}%` : 'no palette'),
    sub('palette hue spread ↑',     clamp01(hueSpread / 240), 0.2,
        hues.length ? `spread ${hueSpread.toFixed(0)}°` : 'no palette'),
    sub('typography rarity markers',normalizeHits(rareHits, 2), 0.2,
        `${rareHits} rarity hits`),
    sub('logo distinctive markers', normalizeHits(logoHits, 2), 0.25,
        `${logoHits} distinctive hits`),
  ];
}

// ---------------- Public API ----------------
const AXIS_FNS = {
  克制:     scoreRestraint,
  温度感:   scoreWarmth,
  游戏化:   scoreGamification,
  科技感:   scoreTech,
  情感连接: scoreEmotion,
  识别强度: scoreIdentity,
};

export function computeHeuristicDetail(brand) {
  const detail = {};
  for (const k of RADAR_KEYS) {
    const subs = AXIS_FNS[k](brand);
    const wSum = subs.reduce((s, x) => s + x.weight, 0);
    const score = subs.reduce((s, x) => s + x.value * x.weight, 0) / (wSum || 1);
    detail[k] = { score: toTen(score), subs };
  }
  return detail;
}

export function computeHeuristicRadar(brand) {
  const detail = computeHeuristicDetail(brand);
  const out = {};
  for (const k of RADAR_KEYS) out[k] = detail[k].score;
  return out;
}

export function computeHeuristicRadarArray(brand) {
  const detail = computeHeuristicDetail(brand);
  return RADAR_KEYS.map((k) => detail[k].score);
}

// Compare two radars — returns per-axis delta and average delta.
export function diffRadar(llmRadar, heuRadar) {
  const out = {};
  let sum = 0, n = 0;
  for (const k of RADAR_KEYS) {
    const a = llmRadar?.[k] ?? 5;
    const b = heuRadar?.[k] ?? 5;
    out[k] = { llm: a, heu: b, delta: Math.round((a - b) * 10) / 10 };
    sum += Math.abs(a - b);
    n++;
  }
  out.avgDelta = Math.round((sum / n) * 10) / 10;
  return out;
}
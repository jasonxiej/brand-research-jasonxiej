#!/usr/bin/env node
// scripts/backfill-bilingual.mjs
// 为已存在的品牌补齐全部 *En 字段（palette 名称 / logo 描述 / typography / photography /
// targetUser / sellingPoints / brandTakeaway / tone / toneSummary / positioning / radar labels）。
// 通过你配置的 LLM 一次性翻译，结果写回 brands/index.json。
// 运行：`node scripts/backfill-bilingual.mjs`
//   FORCE=1 强制重译（覆盖已有的 *En / *Zh 字段）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.resolve(ROOT, 'brands/index.json');

function getClient() {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.MINIMAX_BASE_URL || process.env.OPENAI_BASE_URL || 'https://your-llm-provider.example.com/v1';
  const model = process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || 'your-default-model';
  if (!apiKey) {
    console.error('❌ 未配置 API Key。请在 .env 中设置 MINIMAX_API_KEY 或 OPENAI_API_KEY');
    process.exit(1);
  }
  return { client: new OpenAI({ apiKey, baseURL }), model };
}

const ZH = /[一-龥]/;
const isChinese = (s) => !!s && ZH.test(s);

async function translateOne(client, model, system, user) {
  const r = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const txt = r.choices?.[0]?.message?.content || '{}';
  // 1) 直接 parse
  try { return JSON.parse(txt); } catch (_) {}
  // 2) 去掉 <think>...</think> / ```json``` 围栏 / 任意前缀
  let s = txt
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/m, '')
    .trim();
  try { return JSON.parse(s); } catch (_) {}
  // 3) 找第一个 { 到最后一个 } 之间
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = s.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch (_) {}
  }
  throw new Error('LLM 返回无法解析: ' + txt.slice(0, 200));
}

async function main() {
  const { client, model } = getClient();
  const force = process.env.FORCE === '1';

  const raw = fs.readFileSync(INDEX_FILE, 'utf8');
  const data = JSON.parse(raw);
  const brands = data.brands || [];
  console.log(`📚 找到 ${brands.length} 条品牌，开始补齐 *En 字段`);

  let updated = 0;
  for (let i = 0; i < brands.length; i++) {
    const b = brands[i];
    // 收集所有需要翻译的字段（去重后送 LLM 一次）
    const needsTranslate = {};

    // 顶层短字段
    if (isChinese(b.summary) && (force || !b.summaryEn)) needsTranslate.summary = b.summary;
    if (isChinese(b.category) && (force || !b.categoryEn)) needsTranslate.category = b.category;
    if (isChinese(b.country) && (force || !b.countryEn)) needsTranslate.country = b.country;
    if (isChinese(b.tagline) && (force || !b.taglineEn)) needsTranslate.tagline = b.tagline;

    // tone 数组
    if (Array.isArray(b.tone) && b.tone.some(isChinese) && (force || !b.toneEn?.length)) {
      needsTranslate.tone = b.tone;
    }

    // 文本
    if (isChinese(b.toneSummary) && (force || !b.toneSummaryEn)) needsTranslate.toneSummary = b.toneSummary;
    if (isChinese(b.positioning) && (force || !b.positioningEn)) needsTranslate.positioning = b.positioning;

    // sellingPoints
    if (Array.isArray(b.sellingPoints) && b.sellingPoints.some(isChinese) && (force || !b.sellingPointsEn?.length)) {
      needsTranslate.sellingPoints = b.sellingPoints;
    }

    // brandTakeaway
    if (Array.isArray(b.brandTakeaway) && b.brandTakeaway.some(isChinese) && (force || !b.brandTakeawayEn?.length)) {
      needsTranslate.brandTakeaway = b.brandTakeaway;
    }

    // brandTakeaway 可能为 []（旧数据漏生成）→ 整条从其他字段推断生成
    const takeawayEmpty = !Array.isArray(b.brandTakeaway) || b.brandTakeaway.length < 5;
    if (takeawayEmpty && (force || !Array.isArray(b.brandTakeawayEn) || b.brandTakeawayEn.length < 5)) {
      needsTranslate._generateTakeaway = {
        name: b.nameZh || b.name || b.id,
        tone: b.tone || [],
        sellingPoints: b.sellingPoints || [],
        palette: (b.palette || []).map((p) => p.name).filter(Boolean),
        primaryColors: b.primaryColors || [],
      };
    }

    // logo 子字段
    if (b.logo) {
      const lo = {};
      let anyZh = false;
      if (isChinese(b.logo.type) && (force || !b.logo.typeEn)) { lo.type = b.logo.type; anyZh = true; }
      if (isChinese(b.logo.description) && (force || !b.logo.descriptionEn)) { lo.description = b.logo.description; anyZh = true; }
      if (isChinese(b.logo.construction) && (force || !b.logo.constructionEn)) { lo.construction = b.logo.construction; anyZh = true; }
      if (anyZh) needsTranslate.logo = lo;
    }

    // typography 子字段
    if (b.typography) {
      const ty = {};
      let anyZh = false;
      if (isChinese(b.typography.heading) && (force || !b.typography.headingEn)) { ty.heading = b.typography.heading; anyZh = true; }
      if (isChinese(b.typography.body) && (force || !b.typography.bodyEn)) { ty.body = b.typography.body; anyZh = true; }
      if (isChinese(b.typography.notes) && (force || !b.typography.notesEn)) { ty.notes = b.typography.notes; anyZh = true; }
      if (anyZh) needsTranslate.typography = ty;
    }

    // photography 子字段
    if (b.photography) {
      const ph = {};
      let anyZh = false;
      if (isChinese(b.photography.style) && (force || !b.photography.styleEn)) { ph.style = b.photography.style; anyZh = true; }
      if (isChinese(b.photography.lighting) && (force || !b.photography.lightingEn)) { ph.lighting = b.photography.lighting; anyZh = true; }
      if (isChinese(b.photography.tone) && (force || !b.photography.toneEn)) { ph.tone = b.photography.tone; anyZh = true; }
      if (isChinese(b.photography.composition) && (force || !b.photography.compositionEn)) { ph.composition = b.photography.composition; anyZh = true; }
      if (anyZh) needsTranslate.photography = ph;
    }

    // targetUser 子字段
    if (b.targetUser) {
      const tu = {};
      let anyZh = false;
      if (isChinese(b.targetUser.age) && (force || !b.targetUserEn?.age)) { tu.age = b.targetUser.age; anyZh = true; }
      if (isChinese(b.targetUser.identity) && (force || !b.targetUserEn?.identity)) { tu.identity = b.targetUser.identity; anyZh = true; }
      if (isChinese(b.targetUser.pain) && (force || !b.targetUserEn?.pain)) { tu.pain = b.targetUser.pain; anyZh = true; }
      if (isChinese(b.targetUser.scene) && (force || !b.targetUserEn?.scene)) { tu.scene = b.targetUser.scene; anyZh = true; }
      if (anyZh) needsTranslate.targetUser = tu;
    }

    // palette 名称
    if (Array.isArray(b.palette) && b.palette.some((p) => isChinese(p.name) && (force || !p.nameEn))) {
      needsTranslate.palette = b.palette.map((p) => ({ hex: p.hex, name: p.name }));
    }

    if (Object.keys(needsTranslate).length === 0) {
      console.log(`  ⏭  [${i + 1}/${brands.length}] ${b.id} 已是完整双语，跳过`);
      continue;
    }

    console.log(`  🌐 [${i + 1}/${brands.length}] ${b.id} 翻译 ${Object.keys(needsTranslate).length} 个字段...`);
    let res = {};
    try {
      // 分两路：_generateTakeaway 走"从已有信息生成"提示；其余走翻译提示
      const needsTrans = needsTranslate;
      const genSpec = needsTrans._generateTakeaway;
      delete needsTrans._generateTakeaway;

      if (Object.keys(needsTrans).length > 0) {
        const sys = `You are a senior brand strategist translating Chinese brand research into natural English.
Keep brand voice and tone. Do NOT translate brand names (e.g. "Apple" stays "Apple", "Hatch" stays "Hatch").
For arrays, return arrays of the SAME LENGTH. Return STRICT JSON.`;
        const usr = JSON.stringify(needsTrans, null, 2);
        res = await translateOne(client, model, sys, usr);
      }

      // 单独生成 brandTakeaway（中文 + 英文各 5 条）
      if (genSpec) {
        const sys = `You are a senior brand strategist.
You will be given a brand's name, tone keywords, selling points, palette color names, and primary hex colors.
Generate a "brandTakeaway" field with exactly 5 CHINESE strings and a "brandTakeawayEn" field with exactly 5 ENGLISH strings (same order, same length).
Each item 15-40 characters.
Each item must be a SPECIFIC, IMMEDIATELY ACTIONABLE tactical suggestion for an external brand (the {USER_BRAND} perspective) to learn from this brand.
Examples: "把首页主色从蓝换成橙", "引入 monthly drop 节奏", "把 logo 缩小 30% 提升 breathing room", "Switch homepage CTA from blue to orange", "Adopt a monthly drop rhythm".
Do NOT use vague adjectives (no "提升品牌感", "增强互动").
Do NOT repeat the selling points.
Return STRICT JSON: {"brandTakeaway": [...5 zh...], "brandTakeawayEn": [...5 en...]}.`;
        const usr = JSON.stringify(genSpec, null, 2);
        const genRes = await translateOne(client, model, sys, usr);
        if (Array.isArray(genRes.brandTakeaway) && genRes.brandTakeaway.length === 5) {
          b.brandTakeaway = genRes.brandTakeaway.map(String);
        }
        if (Array.isArray(genRes.brandTakeawayEn) && genRes.brandTakeawayEn.length === 5) {
          b.brandTakeawayEn = genRes.brandTakeawayEn.map(String);
        }
        console.log(`    ✨  生成 brandTakeaway × 5（双版）`);
      }
    } catch (e) {
      console.warn(`    ⚠  翻译失败：${e.message}`);
      continue;
    }

    // 写回
    if (res.summary) b.summaryEn = String(res.summary).trim();
    if (res.category) b.categoryEn = String(res.category).trim();
    if (res.country) b.countryEn = String(res.country).trim();
    if (res.tagline) b.taglineEn = String(res.tagline).trim();
    if (Array.isArray(res.tone)) b.toneEn = res.tone.map(String);
    if (res.toneSummary) b.toneSummaryEn = String(res.toneSummary).trim();
    if (res.positioning) b.positioningEn = String(res.positioning).trim();
    if (Array.isArray(res.sellingPoints)) b.sellingPointsEn = res.sellingPoints.map(String);
    if (Array.isArray(res.brandTakeaway)) b.brandTakeawayEn = res.brandTakeaway.map(String);

    if (res.logo) {
      b.logo = b.logo || {};
      if (res.logo.type) b.logo.typeEn = String(res.logo.type).trim();
      if (res.logo.description) b.logo.descriptionEn = String(res.logo.description).trim();
      if (res.logo.construction) b.logo.constructionEn = String(res.logo.construction).trim();
    }
    if (res.typography) {
      b.typography = b.typography || {};
      if (res.typography.heading) b.typography.headingEn = String(res.typography.heading).trim();
      if (res.typography.body) b.typography.bodyEn = String(res.typography.body).trim();
      if (res.typography.notes) b.typography.notesEn = String(res.typography.notes).trim();
    }
    if (res.photography) {
      b.photography = b.photography || {};
      if (res.photography.style) b.photography.styleEn = String(res.photography.style).trim();
      if (res.photography.lighting) b.photography.lightingEn = String(res.photography.lighting).trim();
      if (res.photography.tone) b.photography.toneEn = String(res.photography.tone).trim();
      if (res.photography.composition) b.photography.compositionEn = String(res.photography.composition).trim();
    }
    if (res.targetUser) {
      b.targetUserEn = b.targetUserEn || {};
      if (res.targetUser.age) b.targetUserEn.age = String(res.targetUser.age).trim();
      if (res.targetUser.identity) b.targetUserEn.identity = String(res.targetUser.identity).trim();
      if (res.targetUser.pain) b.targetUserEn.pain = String(res.targetUser.pain).trim();
      if (res.targetUser.scene) b.targetUserEn.scene = String(res.targetUser.scene).trim();
    }
    if (Array.isArray(res.palette)) {
      b.palette = (b.palette || []).map((p, idx) => {
        const r = res.palette[idx] || {};
        return { ...p, nameEn: r.name ? String(r.name).trim() : (p.nameEn || p.name) };
      });
    }

    updated++;
    // 间隔避免限流
    await new Promise((r) => setTimeout(r, 200));
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`\n✅ 完成。本次更新 ${updated} 条，结果已写回 brands/index.json`);
}

main().catch((e) => {
  console.error('❌ 运行失败:', e);
  process.exit(1);
});
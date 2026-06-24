#!/usr/bin/env node
// scripts/translate-brands.mjs
// 把 brands/index.json 中每条品牌的 summary / category / country 翻译成英文并写回。
// 运行：`node scripts/translate-brands.mjs`
// 可选环境变量：
//   MINIMAX_API_KEY / OPENAI_API_KEY（必须）
//   MINIMAX_BASE_URL / OPENAI_BASE_URL（默认 https://your-llm-provider.example.com/v1）
//   MINIMAX_MODEL / OPENAI_MODEL（默认 your-default-model）
//   FORCE=1 强制重新翻译已有 summaryEn 的条目

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.resolve(ROOT, 'brands/index.json');

// ---------- helpers ----------
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
  try {
    return JSON.parse(txt);
  } catch (e) {
    // 兼容不带 JSON 模式的输出
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('LLM 返回无法解析: ' + txt.slice(0, 200));
  }
}

async function main() {
  const { client, model } = getClient();
  const force = process.env.FORCE === '1';

  const raw = fs.readFileSync(INDEX_FILE, 'utf8');
  const data = JSON.parse(raw);
  const brands = data.brands || [];
  console.log(`📚 找到 ${brands.length} 条品牌，开始翻译 summary → summaryEn`);

  let updated = 0;
  for (let i = 0; i < brands.length; i++) {
    const b = brands[i];
    const needSummary = isChinese(b.summary) && (force || !b.summaryEn);
    const needCategory = isChinese(b.category) && (force || !b.categoryEn);
    const needCountry = isChinese(b.country) && (force || !b.countryEn);
    const needTagline = isChinese(b.tagline) && (force || !b.taglineEn);

    if (!needSummary && !needCategory && !needCountry && !needTagline) {
      console.log(`  ⏭  [${i + 1}/${brands.length}] ${b.id} 已有英文，跳过`);
      continue;
    }

    console.log(`  🌐 [${i + 1}/${brands.length}] ${b.id} (${b.nameZh || b.name})`);
    const sys = `You are a senior brand strategist translating Chinese brand research into polished English.
Keep brand voice, tone, and brand-specific terms intact. Do NOT translate brand names (e.g. "Apple" stays "Apple", "阿迪达斯" stays "阿迪达斯" only if it is the canonical local name, otherwise use the official English brand name).
Return STRICT JSON only with these keys: summaryEn, categoryEn, countryEn, taglineEn. Omit any key whose source value is missing or already English.`;
    const usr = JSON.stringify({
      name: b.name || b.nameZh || b.id,
      nameZh: b.nameZh || '',
      summary: b.summary || '',
      category: b.category || '',
      country: b.country || '',
      tagline: b.tagline || '',
    }, null, 2);

    let res = {};
    try {
      res = await translateOne(client, model, sys, usr);
    } catch (e) {
      console.warn(`    ⚠  翻译失败：${e.message}，回退到内置映射`);
      // 回退：使用内置词表
      if (needCategory) {
        res.categoryEn = FALLBACK_CATEGORY[b.category] || b.category;
      }
      if (needCountry) {
        res.countryEn = FALLBACK_COUNTRY[b.country] || b.country;
      }
    }

    if (needSummary && res.summaryEn) {
      b.summaryEn = String(res.summaryEn).trim();
    }
    if (needCategory && res.categoryEn) {
      b.categoryEn = String(res.categoryEn).trim();
    }
    if (needCountry && res.countryEn) {
      b.countryEn = String(res.countryEn).trim();
    }
    if (needTagline && res.taglineEn) {
      b.taglineEn = String(res.taglineEn).trim();
    }
    updated++;
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`\n✅ 完成。本次更新 ${updated} 条，结果已写回 brands/index.json`);
}

// 内置回退映射（与 index.html 中的 COUNTRY_EN / CATEGORY_EN 保持一致）
const FALLBACK_COUNTRY = {
  '德国': 'Germany', '美国': 'United States', '芬兰': 'Finland', '日本': 'Japan',
  '中国': 'China', '英国': 'United Kingdom', '法国': 'France', '意大利': 'Italy',
  '韩国': 'South Korea', '瑞典': 'Sweden', '丹麦': 'Denmark', '荷兰': 'Netherlands',
  '瑞士': 'Switzerland', '加拿大': 'Canada', '澳大利亚': 'Australia',
  '新加坡': 'Singapore', '挪威': 'Norway', '比利时': 'Belgium', '奥地利': 'Austria',
  '爱尔兰': 'Ireland', '新西兰': 'New Zealand', '巴西': 'Brazil', '印度': 'India', '俄罗斯': 'Russia',
};
const FALLBACK_CATEGORY = {
  '运动服饰': 'Sportswear',
  '运动服饰与运动装备': 'Sportswear & Equipment',
  '运动装备': 'Sports Equipment',
  '消费电子': 'Consumer Electronics',
  '游戏平台 / 游戏主机': 'Gaming Platform / Console',
  '游戏平台': 'Gaming Platform',
  '游戏主机': 'Gaming Console',
  '智能硬件': 'Smart Hardware',
  '可穿戴设备': 'Wearable Device',
  '健康科技': 'Health Tech',
  '生活方式': 'Lifestyle',
};

main().catch((e) => {
  console.error('❌ 运行失败:', e);
  process.exit(1);
});
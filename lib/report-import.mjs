import { slugify } from './researcher.mjs';

const RADAR_LABELS = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractEmbeddedBrandData(html) {
  const match = String(html || '').match(/<script[^>]*id=["']__BRAND_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const payload = decodeHtmlEntities(match[1].trim());
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function normalizeRadar(data) {
  if (Array.isArray(data.radarValues) && data.radarValues.length === 6) {
    const radar = {};
    RADAR_LABELS.forEach((label, idx) => {
      radar[label] = Number(data.radarValues[idx]) || 0;
    });
    return radar;
  }

  if (Array.isArray(data.radar)) {
    if (data.radar.every((item) => typeof item === 'number')) {
      const radar = {};
      RADAR_LABELS.forEach((label, idx) => {
        radar[label] = Number(data.radar[idx]) || 0;
      });
      return radar;
    }

    if (data.radar.every((item) => item && typeof item === 'object')) {
      const radar = {};
      for (const item of data.radar) {
        const key = String(item.dimension || item.name || item.label || '').trim();
        if (!key) continue;
        radar[key] = Number(item.score ?? item.value ?? item.v ?? 0) || 0;
      }
      return radar;
    }
  }

  if (data.radar && typeof data.radar === 'object' && !Array.isArray(data.radar)) {
    return data.radar;
  }

  return {};
}

function normalizePalette(data) {
  if (Array.isArray(data.palette) && data.palette.length) return data.palette;
  if (Array.isArray(data.primaryColors) && data.primaryColors.length) {
    return data.primaryColors.map((hex, index) => ({
      hex,
      name: `Color ${index + 1}`,
    }));
  }
  return [];
}

export function parseImportedReportInput(input) {
  if (input && typeof input === 'object') return input;

  const raw = String(input || '').trim();
  if (!raw) return null;

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  const embedded = extractEmbeddedBrandData(raw);
  if (embedded) return embedded;

  return null;
}

export function normalizeImportedReport(input, fallback = {}) {
  const source = parseImportedReportInput(input) || {};
  const data = { ...source };

  if (!data.name && data.nameZh) data.name = data.nameZh;
  if (!data.name && fallback.name) data.name = fallback.name;
  if (!data.nameZh && fallback.nameZh) data.nameZh = fallback.nameZh;
  if (!data.url && fallback.url) data.url = fallback.url;
  if (!data.tagline && fallback.tagline) data.tagline = fallback.tagline;
  if (!data.category && fallback.category) data.category = fallback.category;
  if (!data.country && fallback.country) data.country = fallback.country;
  if (!data.summary && fallback.summary) data.summary = fallback.summary;

  data.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  data.palette = normalizePalette(data);
  data.primaryColors = Array.isArray(data.primaryColors) && data.primaryColors.length
    ? data.primaryColors
    : data.palette.slice(0, 4).map((p) => p.hex).filter(Boolean);
  data.radar = normalizeRadar(data);
  data.logo = data.logo && typeof data.logo === 'object' ? data.logo : {};
  data.typography = data.typography && typeof data.typography === 'object' ? data.typography : {};
  data.photography = data.photography && typeof data.photography === 'object' ? data.photography : {};
  data.targetUser = data.targetUser && typeof data.targetUser === 'object' ? data.targetUser : {};
  data.sellingPoints = Array.isArray(data.sellingPoints) ? data.sellingPoints : [];
  data.tone = Array.isArray(data.tone) ? data.tone : [];

  if (!data.slug) {
    const name = String(data.name || data.nameZh || fallback.name || 'brand').trim();
    data.slug = slugify(data.id || name);
  }

  return data;
}

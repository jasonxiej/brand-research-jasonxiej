// lib/trash-store.mjs
// ============================================================
// 回收站数据管理
//   - brands/trash.json: { version, updated, retainDays, items[] }
//   - 每个 item 含原 brand 数据 + deletedAt + expiresAt
//   - 启动时 / 每小时检查并清理过期项（删除对应 HTML）
// ============================================================

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TRASH_FILE = path.join(ROOT, 'brands', 'trash.json');
const INDEX_FILE = path.join(ROOT, 'brands', 'index.json');
const DEFAULT_RETAIN_DAYS = 30;

// ---------- 工具 ----------
async function readJSON(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function nowISO() { return new Date().toISOString(); }

function defaultTrash() {
  return {
    version: '1.0.0',
    updated: nowISO(),
    description: '{YOUR_BRAND} 品牌调研中心 · 回收站。删除的品牌暂存 30 天，到期后自动清理。',
    retainDays: DEFAULT_RETAIN_DAYS,
    items: [],
  };
}

// ---------- 公开 API ----------

/** 读回收站全部数据 */
export async function loadTrash() {
  const t = await readJSON(TRASH_FILE, null);
  if (!t || !Array.isArray(t.items)) return defaultTrash();
  return t;
}

/** 列出回收站项（不返回完整 brand 数据，省流量） */
export async function listTrash() {
  const t = await loadTrash();
  return t.items.map((it) => ({
    id: it.id,
    deletedAt: it.deletedAt,
    expiresAt: it.expiresAt,
    daysLeft: Math.max(0, Math.ceil((new Date(it.expiresAt) - Date.now()) / 86400000)),
    expired: new Date(it.expiresAt) < new Date(),
    reportFile: it.reportFile,
    reportUrl: it.reportUrl,
    name: it.brand?.name,
    nameZh: it.brand?.nameZh,
    tagline: it.brand?.tagline,
    category: it.brand?.category,
    summary: it.brand?.summary,
    primaryColors: it.brand?.primaryColors,
    radar: it.brand?.radar,
  }));
}

/** 列出回收站里的 id 集合（用于 refresh-index 跳过） */
export async function listTrashIds() {
  const t = await loadTrash();
  return t.items.map((it) => it.id);
}

/** 把 id 移到回收站。返回 { ok, item, error? } */
export async function moveToTrash(id) {
  const index = await readJSON(INDEX_FILE, { brands: [] });
  const idx = (index.brands || []).findIndex((b) => b.id === id);
  if (idx < 0) return { ok: false, error: `品牌 ${id} 不在 index.json 中` };

  const brand = index.brands[idx];

  // 从 index 移除
  index.brands.splice(idx, 1);
  index.updated = nowISO();
  await writeJSON(INDEX_FILE, index);

  // 加入 trash
  const trash = await loadTrash();
  const deletedAt = nowISO();
  const expiresAt = new Date(Date.now() + (trash.retainDays || DEFAULT_RETAIN_DAYS) * 86400000).toISOString();
  const item = {
    id,
    deletedAt,
    expiresAt,
    reportFile: brand.reportFile,
    reportUrl: brand.reportUrl,
    brand,
  };
  // 同 id 已存在则覆盖
  trash.items = trash.items.filter((it) => it.id !== id);
  trash.items.push(item);
  trash.updated = nowISO();
  await writeJSON(TRASH_FILE, trash);

  return { ok: true, item };
}

/** 从回收站恢复：把 brand 加回 index.json */
export async function restoreFromTrash(id) {
  const trash = await loadTrash();
  const idx = trash.items.findIndex((it) => it.id === id);
  if (idx < 0) return { ok: false, error: `回收站中没有 ${id}` };

  const item = trash.items[idx];

  // 从 trash 移除
  trash.items.splice(idx, 1);
  trash.updated = nowISO();
  await writeJSON(TRASH_FILE, trash);

  // 加回 index
  const index = await readJSON(INDEX_FILE, { brands: [] });
  // 避免重复
  index.brands = (index.brands || []).filter((b) => b.id !== id);
  index.brands.push(item.brand);
  index.updated = nowISO();
  await writeJSON(INDEX_FILE, index);

  return { ok: true, item };
}

/** 立即永久删除：删除 HTML + 从 trash 移除 */
export async function purgeTrashItem(id) {
  const trash = await loadTrash();
  const idx = trash.items.findIndex((it) => it.id === id);
  if (idx < 0) return { ok: false, error: `回收站中没有 ${id}` };

  const item = trash.items[idx];
  // 删 HTML
  if (item.reportFile) {
    const fp = path.join(ROOT, item.reportFile);
    try { await fsp.unlink(fp); } catch { /* 文件可能已经不在 */ }
  }

  trash.items.splice(idx, 1);
  trash.updated = nowISO();
  await writeJSON(TRASH_FILE, trash);

  return { ok: true, item: { id, reportFile: item.reportFile } };
}

/** 清理所有过期项。返回 { purged: [{id, reportFile}] } */
export async function purgeExpired() {
  const trash = await loadTrash();
  const now = new Date();
  const purged = [];
  const kept = [];
  for (const it of trash.items) {
    if (new Date(it.expiresAt) < now) {
      if (it.reportFile) {
        const fp = path.join(ROOT, it.reportFile);
        try { await fsp.unlink(fp); } catch {}
      }
      purged.push({ id: it.id, reportFile: it.reportFile });
    } else {
      kept.push(it);
    }
  }
  if (purged.length) {
    trash.items = kept;
    trash.updated = nowISO();
    await writeJSON(TRASH_FILE, trash);
  }
  return { purged, retainDays: trash.retainDays || DEFAULT_RETAIN_DAYS };
}

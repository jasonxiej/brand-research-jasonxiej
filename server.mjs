// server.mjs
// ============================================================
// {YOUR_BRAND} Brand Research Hub 路 Node 鍚庣
// 鏇夸唬 python -m http.server锛屾彁渚涳細
//   - 闈欐€佹枃浠舵湇鍔★紙./锛?
//   - POST /api/research  鎺ユ敹鍝佺墝鍚嶏紝鍚姩璋冪爺
//   - GET  /api/research/:id/events  SSE 瀹炴椂鏃ュ織娴?
//   - POST /api/refresh-index  閲嶅缓 brands/index.json
//   - GET  /api/health 鍋ュ悍妫€鏌?
//   - GET  /api/jobs/:id 鏌ヨ鍗曚釜 job 鐘舵€?
// ============================================================

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import { runResearch, slugify } from './lib/researcher.mjs';
import { renderReport } from './lib/report-template.mjs';
import { normalizeImportedReport } from './lib/report-import.mjs';
import mammoth from 'mammoth';
import Busboy from 'busboy';
import {
  listTrash, listTrashIds,
  moveToTrash, restoreFromTrash, purgeTrashItem, purgeExpired,
} from './lib/trash-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const LAN_HOST = process.env.LAN_HOST || '';  // 閽夋灞€鍩熺綉 IP 鐨勭幆澧冨彉閲忥紱涓嶅～灏辫嚜鍔ㄦ帰娴?
const DEFAULT_BRAND_NAME = 'Kiwii';

function currentBrandName() {
  return (process.env.BRAND_NAME || DEFAULT_BRAND_NAME).trim() || DEFAULT_BRAND_NAME;
}

// ---------- 宸ュ叿锛氭帰娴嬫湰鏈哄眬鍩熺綉 IPv4 ----------
function detectLanIp() {
  // 1) 濡傛灉鐢ㄦ埛閽夋浜?LAN_HOST锛岀洿鎺ョ敤
  if (LAN_HOST) return LAN_HOST;
  // 2) 鍚﹀垯浠?os.networkInterfaces 鎵剧涓€涓潪 internal 鐨?IPv4
  try {
    const ifaces = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(ifaces)) {
      for (const i of ifaces[name] || []) {
        if (i.family === 'IPv4' && !i.internal) {
          // 浼樺厛 192.168 / 10. / 172.16-31 绉佹湁缃戞
          const pri = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address) ? 1 : 0;
          candidates.push({ addr: i.address, pri, name });
        }
      }
    }
    candidates.sort((a, b) => b.pri - a.pri);
    if (candidates.length) return candidates[0].addr;
  } catch {}
  return '127.0.0.1';
}

// ---------- MIME ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.map':  'application/json',
};

// ---------- Job 鐘舵€侊紙鍐呭瓨锛?----------
/** @type {Map<string, {id:string, status:string, events:any[], result?:any, error?:string, createdAt:number}>} */
const jobs = new Map();
// 24h 鍚庤嚜鍔ㄦ竻鐞?
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}, 3600 * 1000).unref();

// ---------- 宸ュ叿 ----------
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

// 闃叉璺緞绌胯秺
function safeJoin(rel) {
  const decoded = decodeURIComponent(rel.split('?')[0]);
  const target = path.normalize(path.join(ROOT, decoded));
  if (!target.startsWith(ROOT)) return null;
  return target;
}

// ---------- 闈欐€佹枃浠舵湇鍔?----------
async function serveStatic(req, res, relPath) {
  let target = safeJoin(relPath || '/');
  if (!target) return sendText(res, 403, 'Forbidden');

  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    return sendText(res, 404, 'Not Found: ' + relPath);
  }

  let filePath = target;
  try {
    await fsp.access(filePath);
  } catch {
    return sendText(res, 404, 'Not Found: ' + relPath);
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

// ---------- POST /api/research ----------
async function handleResearch(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { return sendJSON(res, 400, { error: 'invalid json' }); }

  const raw = (payload.brand || payload.input || '').trim();
  if (!raw) return sendJSON(res, 400, { error: 'brand 涓嶈兘涓虹┖' });

  const jobId = randomUUID();
  const job = { id: jobId, status: 'pending', events: [], result: null, error: null, createdAt: Date.now() };
  jobs.set(jobId, job);

  sendJSON(res, 202, { jobId, status: 'pending', message: '璋冪爺宸插惎鍔紝璁㈤槄 /api/research/' + jobId + '/events 鑾峰彇瀹炴椂鏃ュ織' });

  // 寮傛鎵ц锛堜笉 await锛岃鍝嶅簲鍏堣繑鍥烇級
  runJob(job, raw).catch((e) => {
    job.status = 'failed';
    job.error = e?.message || String(e);
    job.events.push({ level: 'error', msg: '❌失败: ' + job.error, ts: Date.now() });
  });
}

async function handleResearchMd(req, res) {
  const body = await readBody(req);
  const md = String(body.content || body.md || body.markdown || '').trim();
  const brandName = String(body.brandName || body.brand || '').trim();
  if (!md) return sendJSON(res, 400, { ok: false, error: 'content 不能为空' });

  const result = await runResearch({
    raw: brandName || md.slice(0, 40),
    sourceMarkdown: md,
    onLog: () => {},
  });

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileId = `${result.slug}-${date}`;
  const data = result.data || {};

  // Save the raw data as JSON — no HTML written. /report/<id> renders
  // HTML on demand. Keeps the brand library from bloating with 50KB+
  // rendered HTML per research.
  const payload = {
    id: fileId,
    name: data.name || result.name || '',
    nameZh: data.nameZh || '',
    nameEn: data.nameEn || '',
    url: data.url || result.url || '',
    tagline: data.tagline || '',
    taglineEn: data.taglineEn || '',
    category: data.category || '',
    categoryEn: data.categoryEn || '',
    country: data.country || '',
    countryEn: data.countryEn || '',
    summary: data.summary || '',
    summaryEn: data.summaryEn || '',
    primaryColors: data.primaryColors || [],
    palette: data.palette || [],
    logo: data.logo || {},
    typography: data.typography || {},
    photography: data.photography || {},
    tone: data.tone || [],
    toneEn: data.toneEn || [],
    toneSummary: data.toneSummary || '',
    toneSummaryEn: data.toneSummaryEn || '',
    positioning: data.positioning || '',
    positioningEn: data.positioningEn || '',
    targetUser: data.targetUser || {},
    targetUserEn: data.targetUserEn || {},
    sellingPoints: data.sellingPoints || [],
    sellingPointsEn: data.sellingPointsEn || [],
    brandTakeaway: data.brandTakeaway || [],
    brandTakeawayEn: data.brandTakeawayEn || [],
    radar: data.radar || {},
    radarValues: data.radarValues || [],
    heuristicRadar: data.heuristicRadar || {},
    heuristicRadarArray: data.heuristicRadarArray || [],
    heuristicDetail: data.heuristicDetail || {},
    heuristicMeta: data.heuristicMeta || null,
    meta: data.meta || {},
    reportFile: 'brands/' + fileId + '.json',
    reportUrl: '/report/' + fileId,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  await fsp.writeFile(path.join(ROOT, 'brands', fileId + '.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await runRefreshIndex();

  sendJSON(res, 200, {
    ok: true,
    status: 'done',
    brand: payload.name,
    reportUrl: payload.reportUrl,
    jsonFile: 'brands/' + fileId + '.json',
    result: {
      slug: result.slug,
      brand: payload.name,
      file: fileId + '.json',
      reportUrl: payload.reportUrl,
    },
  });
}

// ============================================================
// POST /api/parse-file
//   Accepts multipart/form-data with a single file part. Extracts
//   plain text from:
//     - .md / .markdown / .txt   → UTF-8 read directly
//     - .docx                    → mammoth.extractRawText({ buffer })
//     - .doc (legacy binary)     → 415 (we cannot safely parse this
//                                   on the server without LibreOffice
//                                   or similar; ask user to save-as
//                                   .docx in Word)
//   Returns { ok:true, text, charCount, filename, kind } on success,
//   or { ok:false, error } on failure. 10 MB hard cap on input size.
// ============================================================
async function handleParseFile(req, res) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('multipart/form-data')) {
    return sendJSON(res, 415, { ok: false, error: '需要 multipart/form-data 上传' });
  }

  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_BYTES, files: 1 },
  });

  let resolved = false;
  function done(status, body) {
    if (resolved) return;
    resolved = true;
    try { req.unpipe(busboy); } catch {}
    sendJSON(res, status, body);
  }

  busboy.on('file', async (_field, fileStream, info) => {
    const filename = info.filename || 'upload';
    const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
    const chunks = [];
    let total = 0;
    let tooLarge = false;

    fileStream.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        tooLarge = true;
        // Drain the rest so busboy can finish cleanly, but we already have enough
        fileStream.resume();
      } else {
        chunks.push(chunk);
      }
    });

    fileStream.on('limit', () => { tooLarge = true; });

    fileStream.on('end', async () => {
      if (tooLarge) {
        return done(413, { ok: false, error: `文件超过 ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB 上限` });
      }
      const buffer = Buffer.concat(chunks);
      try {
        let text = '';
        let kind = ext;
        if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
          // Strip UTF-8 BOM if present
          let buf = buffer;
          if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
            buf = buf.subarray(3);
          }
          text = buf.toString('utf8');
          kind = 'markdown';
        } else if (ext === 'docx') {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value || '';
          // mammoth's messages include style warnings — drop them in the
          // returned text but expose for debugging
          kind = 'docx';
        } else if (ext === 'doc') {
          return done(415, {
            ok: false,
            error: '暂不支持 .doc（旧版二进制 Word），请在 Word 里"另存为 .docx"后重新上传',
          });
        } else {
          return done(415, {
            ok: false,
            error: `不支持的文件类型: .${ext || '(无后缀)'}\n支持: .md / .markdown / .txt / .docx`,
          });
        }

        // Normalize line endings, collapse trailing whitespace per line
        text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n');

        done(200, {
          ok: true,
          filename,
          kind,
          charCount: text.length,
          text,
        });
      } catch (e) {
        done(500, { ok: false, error: '解析失败: ' + (e?.message || String(e)) });
      }
    });

    fileStream.on('error', (err) => {
      done(500, { ok: false, error: '上传流错误: ' + (err?.message || String(err)) });
    });
  });

  busboy.on('error', (err) => {
    done(400, { ok: false, error: '上传解析失败: ' + (err?.message || String(err)) });
  });

  req.pipe(busboy);
}

// ---------- 后台异步调研 ----------
async function runJob(job, raw) {
  const log = (evt) => {
    const e = { ...evt, ts: Date.now() };
    job.events.push(e);
    // 鎴柇澶暱鐨勫巻鍙诧紝鏈€澶氫繚鐣?200 鏉?
    if (job.events.length > 200) job.events.splice(0, job.events.length - 200);
  };

  job.status = 'running';
  log({ level: 'info', msg: `🚀 任务启动 (jobId=${job.id.slice(0, 8)})` });

  try {
    // 1. 璋冪爺
    const result = await runResearch({
      raw,
      onLog: log,
    });

    // 2. 保存调研数据为 JSON（HTML 由 /report/:id 按需渲染，不再写入 .html）
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileId = `${result.slug}-${date}`;
    const _data = result.data || {};

    log({ level: 'info', msg: '💾 保存调研数据 brands/' + fileId + '.json' });
    const _payload = {
      id: fileId,
      name: _data.name || result.name || '',
      nameZh: _data.nameZh || '',
      nameEn: _data.nameEn || '',
      url: _data.url || result.url || '',
      tagline: _data.tagline || '',
      taglineEn: _data.taglineEn || '',
      category: _data.category || '',
      categoryEn: _data.categoryEn || '',
      country: _data.country || '',
      countryEn: _data.countryEn || '',
      summary: _data.summary || '',
      summaryEn: _data.summaryEn || '',
      primaryColors: _data.primaryColors || [],
      palette: _data.palette || [],
      logo: _data.logo || {},
      typography: _data.typography || {},
      photography: _data.photography || {},
      tone: _data.tone || [],
      toneEn: _data.toneEn || [],
      toneSummary: _data.toneSummary || '',
      toneSummaryEn: _data.toneSummaryEn || '',
      positioning: _data.positioning || '',
      positioningEn: _data.positioningEn || '',
      targetUser: _data.targetUser || {},
      targetUserEn: _data.targetUserEn || {},
      sellingPoints: _data.sellingPoints || [],
      sellingPointsEn: _data.sellingPointsEn || [],
      brandTakeaway: _data.brandTakeaway || [],
      brandTakeawayEn: _data.brandTakeawayEn || [],
      radar: _data.radar || {},
      radarValues: _data.radarValues || [],
      heuristicRadar: _data.heuristicRadar || {},
      heuristicRadarArray: _data.heuristicRadarArray || [],
      heuristicDetail: _data.heuristicDetail || {},
      heuristicMeta: _data.heuristicMeta || null,
      meta: _data.meta || {},
      reportFile: 'brands/' + fileId + '.json',
      reportUrl: '/report/' + fileId,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    await fsp.writeFile(path.join(ROOT, 'brands', fileId + '.json'), JSON.stringify(_payload, null, 2) + '\n', 'utf8');
    log({ level: 'success', msg: '✅ 调研数据已保存（' + (JSON.stringify(_payload).length / 1024).toFixed(1) + ' KB）' });

    // 3. 刷新品牌库索引
    log({ level: 'info', msg: '刷新品牌库索引…' });
    await runRefreshIndex();
    log({ level: 'success', msg: '✅ 品牌库索引已更新' });

    job.status = 'done';
    job.result = {
      slug: result.slug,
      brand: _payload.name,
      file: fileId + '.json',
      url: '/report/' + fileId,
      reportUrl: '/report/' + fileId,
    };
    log({ level: 'success', msg: '🎉 调研完成；查看报告 <a href="/report/' + fileId + '" target="_blank">' + fileId + '</a>' });
  } catch (e) {
    job.status = 'failed';
    job.error = e?.message || String(e);
    log({ level: 'error', msg: '❌调研失败: ' + job.error });
  }
}

// ---------- POST /api/refresh-index ----------
async function handleRefreshIndex(req, res) {
  try {
    await runRefreshIndex();
    sendJSON(res, 200, { ok: true, message: 'index 已刷新' });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
}

// ---------- POST /api/config ----------
// 鎶?API key / base URL / model 鍐欏叆 .env锛岀珛鍗崇敓鏁堬紙鍚屼竴杩涚▼鐨?researcher 浼氳鍒帮級
async function handleConfigSave(req, res) {
  try {
    const body = await readBody(req);
    const { apiKey, baseUrl, model, brandName } = body || {};

    // 鏍￠獙锛氳嚦灏戣鏈変竴涓瓧娈?
    if (!apiKey && !baseUrl && !model && !brandName) {
      return sendJSON(res, 400, { error: '至少需要提供一个字段（brandName / apiKey / baseUrl / model）' });
    }

    const envPath = path.join(ROOT, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');

    function upsertEnv(content, key, value) {
      // 涓嶅啓鍏ョ┖瀛楃涓?
      if (!value && value !== 0) return content;
      const re = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      if (re.test(content)) return content.replace(re, line);
      return content.replace(/\n?$/, '\n') + line + '\n';
    }

    let updated = envContent;
    if (brandName) updated = upsertEnv(updated, 'BRAND_NAME', brandName);
    if (apiKey)  updated = upsertEnv(updated, 'MINIMAX_API_KEY', apiKey);
    if (baseUrl) updated = upsertEnv(updated, 'MINIMAX_BASE_URL', baseUrl);
    if (model)   updated = upsertEnv(updated, 'MINIMAX_MODEL', model);

    // 澶囦唤鏃?.env
    if (fs.existsSync(envPath)) {
      const bakPath = envPath + '.bak.' + Date.now();
      fs.copyFileSync(envPath, bakPath);
    }
    fs.writeFileSync(envPath, updated, 'utf8');

    // 绔嬪嵆璁╂湰杩涚▼鐨?dotenv 閲嶆柊鍔犺浇锛坮esearcher.mjs 閫氳繃 dotenv.config 璇诲彇锛?
    // 娉細dotenv 涓嶄細瑕嗙洊宸插瓨鍦ㄧ殑 env var锛岄渶瑕侀噸缃?
    if (brandName) delete process.env.BRAND_NAME;
    if (apiKey)  delete process.env.MINIMAX_API_KEY;
    if (baseUrl) delete process.env.MINIMAX_BASE_URL;
    if (model)   delete process.env.MINIMAX_MODEL;
    // 閲嶆柊瑙ｆ瀽 .env
    const dotenv = await import('dotenv');
    dotenv.config({ path: envPath, override: true });

    // 閲嶆柊鍔犺浇 researcher 妯″潡浠ヨ鍙栨柊 env锛坮equire cache锛?
    try {
      const researcherUrl = require.resolve('./lib/researcher.mjs');
      delete require.cache[researcherUrl];
    } catch {}

    sendJSON(res, 200, {
      ok: true,
      message: '已写入 .env，立即生效',
      brandName: currentBrandName(),
      updated: { brandName: !!brandName, apiKey: !!apiKey, baseUrl: !!baseUrl, model: !!model },
    });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

// ---------- 鍥炴敹绔欒矾鐢卞鐞?----------
async function handleListTrash(req, res) {
  const items = await listTrash();
  sendJSON(res, 200, { ok: true, items, count: items.length, lastPurge: lastPurgeResult });
}

async function handleMoveToTrash(req, res, id) {
  const r = await moveToTrash(id);
  if (!r.ok) return sendJSON(res, 400, r);
  sendJSON(res, 200, r);
}

async function handleRestoreFromTrash(req, res, id) {
  const r = await restoreFromTrash(id);
  if (!r.ok) return sendJSON(res, 400, r);
  sendJSON(res, 200, r);
}

async function handlePurgeTrashItem(req, res, id) {
  const r = await purgeTrashItem(id);
  if (!r.ok) return sendJSON(res, 400, r);
  sendJSON(res, 200, r);
}

async function handlePurgeExpired(req, res) {
  const r = await purgeExpired();
  lastPurgeResult = { purged: r.purged, at: new Date().toISOString() };
  sendJSON(res, 200, { ok: true, ...r });
}

function runRefreshIndex() {
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT, 'scripts', 'refresh-index.cjs');
    const p = spawn(process.execPath, [script], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('refresh-index.cjs exit ' + code)));
  });
}

// ---------- 鍚姩鏃舵竻鐞嗗洖鏀剁珯杩囨湡椤?----------
let lastPurgeResult = { purged: [], at: null };
async function startupPurge() {
  try {
    const r = await purgeExpired();
    lastPurgeResult = { purged: r.purged, at: new Date().toISOString() };
    if (r.purged.length) {
      console.log(`[鍥炴敹绔橾 鍚姩娓呯悊锛氭案涔呭垹闄?${r.purged.length} 涓繃鏈熼」: ${r.purged.map((p) => p.id).join(', ')}`);
    } else {
      console.log(`[鍥炴敹绔橾 鍚姩娓呯悊锛氭棤杩囨湡椤癸紙淇濈暀 ${r.retainDays} 澶╋級`);
    }
  } catch (e) {
    console.error('[鍥炴敹绔橾 鍚姩娓呯悊澶辫触:', e.message);
  }
}
// 姣忓皬鏃舵鏌ヤ竴娆?
setInterval(async () => {
  const r = await purgeExpired();
  if (r.purged.length) {
    lastPurgeResult = { purged: r.purged, at: new Date().toISOString() };
    console.log(`[鍥炴敹绔橾 瀹氭椂娓呯悊锛氭案涔呭垹闄?${r.purged.length} 涓繃鏈熼」: ${r.purged.map((p) => p.id).join(', ')}`);
  }
}, 60 * 60 * 1000).unref();

// ---------- GET /report/:id ----------
// On-demand HTML rendering. Reads brands/:id.json (preferred) and falls back
// to extracting __BRAND_DATA__ from the legacy .html file if only HTML
// exists. The full HTML is generated by renderReport() at request time so
// the workspace never has to store a rendered copy.
async function handleReport(req, res, id) {
  const jsonPath = path.join(ROOT, 'brands', id + '.json');
  const htmlPath = path.join(ROOT, id + '.html');
  let data = null;
  if (fs.existsSync(jsonPath)) {
    try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
  } else if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      const m = html.match(/<script\s+id="__BRAND_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        const raw = m[1]
          .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        data = JSON.parse(raw);
      }
    } catch {}
  }
  if (!data) return sendText(res, 404, 'Report not found: ' + id);

  try {
    const rendered = renderReport({
      name: data.name,
      url: data.url,
      data,
      meta: data.meta,
      createdAt: data.createdAt,
      userBrand: currentBrandName(),
    });
    sendText(res, 200, rendered, 'text/html; charset=utf-8');
  } catch (e) {
    sendText(res, 500, 'Render error: ' + (e?.message || e));
  }
}

// ---------- GET /api/research/:id/events  (SSE) ----------
function handleSSE(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) return sendText(res, 404, 'job not found');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(':ok\n\n');

  // 鍏堟妸鍘嗗彶 events 鍏ㄩ儴鎺ㄤ竴閬?
  for (const evt of job.events) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  // 鐒跺悗鐢ㄥ畾鏃跺櫒杞鏂颁簨浠?
  let lastIndex = job.events.length;
  const tick = setInterval(() => {
    try {
      // 鎺ㄩ€佹柊浜嬩欢
      while (lastIndex < job.events.length) {
        res.write(`data: ${JSON.stringify(job.events[lastIndex])}\n\n`);
        lastIndex++;
      }
      // 缁堟€?
      if (job.status === 'done') {
        res.write(`event: done\ndata: ${JSON.stringify({ ok: true, ...job.result })}\n\n`);
        clearInterval(tick);
        res.end();
      } else if (job.status === 'failed') {
        res.write(`event: done\ndata: ${JSON.stringify({ ok: false, error: job.error })}\n\n`);
        clearInterval(tick);
        res.end();
      }
    } catch {
      clearInterval(tick);
    }
  }, 400);

  // 蹇冭烦
  const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch {} }, 15000);

  req.on('close', () => { clearInterval(tick); clearInterval(hb); });
}

// ---------- GET /api/jobs/:id ----------
function handleGetJob(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) return sendJSON(res, 404, { error: 'job not found' });
  sendJSON(res, 200, {
    id: job.id,
    status: job.status,
    events: job.events,
    result: job.result,
    error: job.error,
  });
}

// ---------- 璺敱鍒嗗彂 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const method = req.method;

  // CORS 棰勬
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 绠€鍗曡闂棩蹇?
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`${method} ${p} 鈫?${res.statusCode} (${ms}ms)`);
  });

  try {
    // API
    if (p === '/api/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, uptime: process.uptime(), jobs: jobs.size, brandName: currentBrandName() });
    }
    if ((p === '/api/state' || p === '/api/config') && method === 'GET') {
      return sendJSON(res, 200, {
        ok: true,
        brandName: currentBrandName(),
        baseUrl: process.env.MINIMAX_BASE_URL || process.env.OPENAI_BASE_URL || '',
        model: process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || '',
        hasApiKey: !!(process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY),
      });
    }
    if (p === '/api/network-info' && method === 'GET') {
      const lanIp = detectLanIp();
      return sendJSON(res, 200, {
        host: HOST,
        port: PORT,
        lanIp,
        pinned: !!LAN_HOST,
        urls: {
          local: `http://localhost:${PORT}/`,
          loopback: `http://127.0.0.1:${PORT}/`,
          lan: `http://${lanIp}:${PORT}/`,
        },
      });
    }
    if (p === '/api/config' && method === 'POST') return await handleConfigSave(req, res);
    if (p === '/api/research' && method === 'POST') return handleResearch(req, res);
    if (p === '/api/research.md' && method === 'POST') return await handleResearchMd(req, res);
    if (p === '/api/parse-file' && method === 'POST') return await handleParseFile(req, res);
    if (p === '/api/refresh-index' && method === 'POST') return handleRefreshIndex(req, res);
    // On-demand report rendering: /report/<slug>-<YYYYMMDD>
    const reportMatch = p.match(/^\/report\/([a-z0-9-]+-\d{8})$/);
    if (reportMatch && (method === 'GET' || method === 'HEAD')) return handleReport(req, res, reportMatch[1]);
    const sseMatch = p.match(/^\/api\/research\/([0-9a-f-]+)\/events$/);
    if (sseMatch && method === 'GET') return handleSSE(req, res, sseMatch[1]);
    const jobMatch = p.match(/^\/api\/jobs\/([0-9a-f-]+)$/);
    if (jobMatch && method === 'GET') return handleGetJob(req, res, jobMatch[1]);

    // 鍥炴敹绔?API
    if (p === '/api/trash' && method === 'GET') return await handleListTrash(req, res);
    if (p === '/api/trash' && method === 'POST') {
      const body = await readBody(req);
      if (body?.action === 'purge-expired') return await handlePurgeExpired(req, res);
      if (!body?.id) return sendJSON(res, 400, { ok: false, error: '缂哄皯鍝佺墝 id' });
      return await handleMoveToTrash(req, res, body.id);
    }
    if (p === '/api/trash/purge-expired' && method === 'POST') return await handlePurgeExpired(req, res);
    const trashMoveMatch = p.match(/^\/api\/trash\/([\w-]+)$/);
    if (trashMoveMatch && method === 'POST') return await handleMoveToTrash(req, res, trashMoveMatch[1]);
    const trashRestoreMatch = p.match(/^\/api\/trash\/([\w-]+)\/restore$/);
    if (trashRestoreMatch && method === 'POST') return await handleRestoreFromTrash(req, res, trashRestoreMatch[1]);
    const trashPurgeMatch = p.match(/^\/api\/trash\/([\w-]+)\/purge$/);
    if (trashPurgeMatch && method === 'POST') return await handlePurgeTrashItem(req, res, trashPurgeMatch[1]);

    // 闈欐€佹枃浠?
    if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, p);

    sendText(res, 405, 'Method Not Allowed');
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  startupPurge();
  console.log('');
  console.log('==================================================');
  console.log('==================================================');
  console.log('   {YOUR_BRAND} Brand Research Hub - Node backend');
  console.log('==================================================');
  console.log(`   Listening : http://${HOST}:${PORT}`);
  const lanIp = detectLanIp();
  console.log(`   Local      : http://localhost:${PORT}/`);
  console.log(`   LAN        : http://${lanIp}:${PORT}/${LAN_HOST ? '  (pinned by LAN_HOST)' : ''}`);
  console.log(`   Static dir : ${ROOT}`);
  console.log(`   Health     : http://localhost:${PORT}/api/health`);
  console.log(`   Network    : http://localhost:${PORT}/api/network-info`);
  console.log('==================================================');
  console.log('');
});



// server.mjs
// ============================================================
// Kiwii Brand Research Hub · Node 后端
// 替代 python -m http.server，提供：
//   - 静态文件服务（./）
//   - POST /api/research  接收品牌名，启动调研
//   - GET  /api/research/:id/events  SSE 实时日志流
//   - POST /api/refresh-index  重建 brands/index.json
//   - GET  /api/health 健康检查
//   - GET  /api/jobs/:id 查询单个 job 状态
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
import {
  listTrash, listTrashIds,
  moveToTrash, restoreFromTrash, purgeTrashItem, purgeExpired,
} from './lib/trash-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const LAN_HOST = process.env.LAN_HOST || '';  // 钉死局域网 IP 的环境变量；不填就自动探测

// ---------- 工具：探测本机局域网 IPv4 ----------
function detectLanIp() {
  // 1) 如果用户钉死了 LAN_HOST，直接用
  if (LAN_HOST) return LAN_HOST;
  // 2) 否则从 os.networkInterfaces 找第一个非 internal 的 IPv4
  try {
    const ifaces = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(ifaces)) {
      for (const i of ifaces[name] || []) {
        if (i.family === 'IPv4' && !i.internal) {
          // 优先 192.168 / 10. / 172.16-31 私有网段
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

// ---------- Job 状态（内存） ----------
/** @type {Map<string, {id:string, status:string, events:any[], result?:any, error?:string, createdAt:number}>} */
const jobs = new Map();
// 24h 后自动清理
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}, 3600 * 1000).unref();

// ---------- 工具 ----------
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

// 防止路径穿越
function safeJoin(rel) {
  const decoded = decodeURIComponent(rel.split('?')[0]);
  const target = path.normalize(path.join(ROOT, decoded));
  if (!target.startsWith(ROOT)) return null;
  return target;
}

// ---------- 静态文件服务 ----------
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
  if (!raw) return sendJSON(res, 400, { error: 'brand 不能为空' });

  const jobId = randomUUID();
  const job = { id: jobId, status: 'pending', events: [], result: null, error: null, createdAt: Date.now() };
  jobs.set(jobId, job);

  sendJSON(res, 202, { jobId, status: 'pending', message: '调研已启动，订阅 /api/research/' + jobId + '/events 获取实时日志' });

  // 异步执行（不 await，让响应先返回）
  runJob(job, raw).catch((e) => {
    job.status = 'failed';
    job.error = e?.message || String(e);
    job.events.push({ level: 'error', msg: '✗ 失败: ' + job.error, ts: Date.now() });
  });
}

// ---------- 后台跑调研 ----------
async function runJob(job, raw) {
  const log = (evt) => {
    const e = { ...evt, ts: Date.now() };
    job.events.push(e);
    // 截断太长的历史，最多保留 200 条
    if (job.events.length > 200) job.events.splice(0, job.events.length - 200);
  };

  job.status = 'running';
  log({ level: 'info', msg: `🎬 任务启动 (jobId=${job.id.slice(0, 8)})` });

  try {
    // 1. 调研
    const result = await runResearch({
      raw,
      onLog: log,
    });

    // 2. 生成报告 HTML
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `${result.slug}-${date}.html`;
    const filePath = path.join(ROOT, fileName);

    log({ level: 'info', msg: `→ 生成报告 HTML: ${fileName}` });
    const html = renderReport({
      name: result.name,
      url: result.url,
      data: result.data,
      meta: result.meta,
      createdAt: new Date().toISOString().slice(0, 10),
    });
    await fsp.writeFile(filePath, html, 'utf8');
    log({ level: 'success', msg: `✓ 报告已写入: ${fileName} (${(html.length / 1024).toFixed(1)} KB)` });

    // 3. 刷新品牌库索引
    log({ level: 'info', msg: '→ 刷新品牌库索引…' });
    await runRefreshIndex();
    log({ level: 'success', msg: '✓ 品牌库索引已更新' });

    job.status = 'done';
    job.result = {
      slug: result.slug,
      brand: result.data.name || result.name,
      file: fileName,
      url: '/' + fileName,
      reportUrl: './' + fileName,
    };
    log({ level: 'success', msg: `🎉 调研完成！查看报告: <a href="./${fileName}" target="_blank">${fileName}</a>` });
  } catch (e) {
    job.status = 'failed';
    job.error = e?.message || String(e);
    log({ level: 'error', msg: '✗ 调研失败: ' + job.error });
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

// ---------- 回收站路由处理 ----------
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

// ---------- 启动时清理回收站过期项 ----------
let lastPurgeResult = { purged: [], at: null };
async function startupPurge() {
  try {
    const r = await purgeExpired();
    lastPurgeResult = { purged: r.purged, at: new Date().toISOString() };
    if (r.purged.length) {
      console.log(`[回收站] 启动清理：永久删除 ${r.purged.length} 个过期项: ${r.purged.map((p) => p.id).join(', ')}`);
    } else {
      console.log(`[回收站] 启动清理：无过期项（保留 ${r.retainDays} 天）`);
    }
  } catch (e) {
    console.error('[回收站] 启动清理失败:', e.message);
  }
}
// 每小时检查一次
setInterval(async () => {
  const r = await purgeExpired();
  if (r.purged.length) {
    lastPurgeResult = { purged: r.purged, at: new Date().toISOString() };
    console.log(`[回收站] 定时清理：永久删除 ${r.purged.length} 个过期项: ${r.purged.map((p) => p.id).join(', ')}`);
  }
}, 60 * 60 * 1000).unref();

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

  // 先把历史 events 全部推一遍
  for (const evt of job.events) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  // 然后用定时器轮询新事件
  let lastIndex = job.events.length;
  const tick = setInterval(() => {
    try {
      // 推送新事件
      while (lastIndex < job.events.length) {
        res.write(`data: ${JSON.stringify(job.events[lastIndex])}\n\n`);
        lastIndex++;
      }
      // 终态
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

  // 心跳
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

// ---------- 路由分发 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const method = req.method;

  // CORS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 简单访问日志
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`${method} ${p} → ${res.statusCode} (${ms}ms)`);
  });

  try {
    // API
    if (p === '/api/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, uptime: process.uptime(), jobs: jobs.size });
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
    if (p === '/api/research' && method === 'POST') return handleResearch(req, res);
    if (p === '/api/refresh-index' && method === 'POST') return handleRefreshIndex(req, res);
    const sseMatch = p.match(/^\/api\/research\/([0-9a-f-]+)\/events$/);
    if (sseMatch && method === 'GET') return handleSSE(req, res, sseMatch[1]);
    const jobMatch = p.match(/^\/api\/jobs\/([0-9a-f-]+)$/);
    if (jobMatch && method === 'GET') return handleGetJob(req, res, jobMatch[1]);

    // 回收站 API
    if (p === '/api/trash' && method === 'GET') return await handleListTrash(req, res);
    if (p === '/api/trash/purge-expired' && method === 'POST') return await handlePurgeExpired(req, res);
    const trashMoveMatch = p.match(/^\/api\/trash\/([\w-]+)$/);
    if (trashMoveMatch && method === 'POST') return await handleMoveToTrash(req, res, trashMoveMatch[1]);
    const trashRestoreMatch = p.match(/^\/api\/trash\/([\w-]+)\/restore$/);
    if (trashRestoreMatch && method === 'POST') return await handleRestoreFromTrash(req, res, trashRestoreMatch[1]);
    const trashPurgeMatch = p.match(/^\/api\/trash\/([\w-]+)\/purge$/);
    if (trashPurgeMatch && method === 'POST') return await handlePurgeTrashItem(req, res, trashPurgeMatch[1]);

    // 静态文件
    if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, p);

    sendText(res, 405, 'Method Not Allowed');
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  // 启动时清理回收站过期项
  startupPurge();
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Kiwii Brand Research Hub · Node 后端');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   监听地址 : http://${HOST}:${PORT}`);
  const lanIp = detectLanIp();
  console.log(`   本机访问 : http://localhost:${PORT}/`);
  console.log(`   局域网   : http://${lanIp}:${PORT}/${LAN_HOST ? '  (已用 LAN_HOST 钉死)' : ''}`);
  console.log(`   静态目录 : ${ROOT}`);
  console.log(`   健康检查 : http://localhost:${PORT}/api/health`);
  console.log(`   网络信息 : http://localhost:${PORT}/api/network-info`);
  console.log('');
  const apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey) {
    const masked = apiKey.slice(0, 6) + '…' + apiKey.slice(-4);
    console.log(`   LLM Key  : ${masked}  ✓`);
    const baseURL = process.env.MINIMAX_BASE_URL || process.env.OPENAI_BASE_URL || '(default)';
    const model = process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || '(default)';
    console.log(`   LLM URL  : ${baseURL}`);
    console.log(`   LLM Model: ${model}`);
  } else {
    console.log('   ⚠ 未配置 LLM API Key，请在 .env 中设置 MINIMAX_API_KEY');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
});

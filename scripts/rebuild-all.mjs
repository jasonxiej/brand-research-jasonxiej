// scripts/rebuild-all.mjs
// 备份现有 4 个报告 → 触发重做 → 刷新索引

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKUP = path.join(ROOT, 'archived');

const TARGETS = [
  { brand: 'Oura',  expectedFile: 'oura-20260622.html' },
  { brand: 'Linear', expectedFile: null },
  { brand: 'Notion', expectedFile: null },
  { brand: 'Hatch',  expectedFile: null },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(brand) {
  const r = await fetch('http://localhost:8000/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand }),
  });
  if (!r.ok) throw new Error(`POST /api/research -> ${r.status}: ${await r.text()}`);
  return r.json();
}

function consumeSSE(jobId) {
  return new Promise(async (resolve, reject) => {
    const r = await fetch(`http://localhost:8000/api/research/${jobId}/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    if (!r.ok || !r.body) return reject(new Error('SSE failed: ' + r.status));
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message';
        const dataLines = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const data = dataLines.join('\n');
        if (!data) continue;
        if (event === 'done') {
          const payload = JSON.parse(data);
          return payload.ok ? resolve(payload) : reject(new Error(payload.error || 'failed'));
        }
        const evt = JSON.parse(data);
        const ts = new Date(evt.ts).toLocaleTimeString('zh-CN', { hour12: false });
        const tag = { success: '✓', error: '✗', warn: '⚠' }[evt.level] || '·';
        console.log(`    ${ts} ${tag} ${evt.msg.replace(/<[^>]+>/g, '')}`);
      }
    }
    reject(new Error('SSE closed without done event'));
  });
}

async function main() {
  // 1) 备份
  await fsp.mkdir(BACKUP, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const files = await fsp.readdir(ROOT);
  for (const f of files) {
    if (/\-(2026\d{4})\.html$/.test(f)) {
      const src = path.join(ROOT, f);
      const dst = path.join(BACKUP, f.replace(/(\-2026\d{4}\.html)$/, `-${stamp}$1`));
      await fsp.rename(src, dst);
      console.log(`  [backup] ${f} -> archived/${path.basename(dst)}`);
    }
  }
  console.log('');

  // 2) 逐个调研
  for (const { brand } of TARGETS) {
    console.log(`\n=== 调研: ${brand} ===`);
    try {
      const { jobId } = await post(brand);
      const r = await consumeSSE(jobId);
      console.log(`  ✓ 完成: ${r.file}`);
    } catch (e) {
      console.log(`  ✗ 失败: ${e.message}`);
    }
    // 间隔一下避免限流
    await sleep(1500);
  }

  // 3) 刷新索引
  console.log('\n=== 刷新品牌库索引 ===');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'refresh-index.cjs')], {
      stdio: 'inherit',
    });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('exit ' + code)));
  });
}

main().catch((e) => { console.error(e); process.exit(1); });

// scripts/smoke-test.mjs
// 端到端冒烟测试：启动调研 → 订阅 SSE → 打印完整日志流
// 使用：node scripts/smoke-test.mjs [brand]

import { setTimeout as sleep } from 'node:timers/promises';

const brand = process.argv[2] || 'Oura';
const base = 'http://localhost:8000';

async function main() {
  console.log(`\n=== 端到端冒烟测试 ===\n  品牌：${brand}\n  后端：${base}\n`);

  // 1) POST 启动
  const r = await fetch(`${base}/api/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand }),
  });
  console.log(`[1] POST /api/research → HTTP ${r.status}`);
  if (!r.ok) {
    console.log('  ✗ 启动失败:', await r.text());
    return;
  }
  const { jobId } = await r.json();
  console.log(`  ✓ jobId = ${jobId}\n`);

  // 2) 订阅 SSE
  console.log(`[2] GET /api/research/${jobId}/events (SSE)\n`);
  const res = await fetch(`${base}/api/research/${jobId}/events`, {
    headers: { Accept: 'text/event-stream' },
  });
  if (!res.ok || !res.body) {
    console.log('  ✗ SSE 连接失败:', res.status);
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ended = false;

  // 5 分钟超时
  const timeout = setTimeout(() => {
    if (!ended) { console.log('\n[!] 5 分钟超时，强制退出'); process.exit(1); }
  }, 5 * 60 * 1000);

  try {
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // 解析 SSE 帧
        let event = 'message';
        const dataLines = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue; // 注释
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const data = dataLines.join('\n');
        if (!data) continue;

        if (event === 'done') {
          const payload = JSON.parse(data);
          if (payload.ok) {
            console.log(`\n  ✓ 调研完成！`);
            console.log(`    文件: ${payload.file}`);
            console.log(`    链接: ${payload.url}`);
          } else {
            console.log(`\n  ✗ 调研失败: ${payload.error}`);
          }
          ended = true;
          break;
        } else {
          // 普通日志事件
          const evt = JSON.parse(data);
          const ts = new Date(evt.ts).toLocaleTimeString('zh-CN', { hour12: false });
          const tag = { success: '✓', error: '✗', warn: '⚠' }[evt.level] || '·';
          console.log(`  ${ts} ${tag} ${evt.msg}`);
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

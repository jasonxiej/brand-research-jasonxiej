// lib/report-template.mjs
// ============================================================
// 把 researcher.mjs 返回的 JSON 数据渲染为 HTML 报告
// 风格对齐 oura-20260622.html：米色底 + InstrumentSerif + accent #FF7A45
// 输出单文件、自包含（字体 / echarts 都用 _shared 下的资源）
// ============================================================

const C = {
  bg: '#FBF8F3',
  bg2: '#FFFFFF',
  bg3: '#F4EFE6',
  ink: '#1A1A1A',
  muted: '#6B6B6B',
  rule: '#E8E0D4',
  accent: '#FF7A45',
  accent2: '#7FB069',
  accent3: '#6B4EFF',
};

const RADAR_LABELS = ['克制', '温度感', '游戏化', '科技感', '情感连接', '识别强度'];

// ---------- 工具：转义 ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 子组件 ----------
function renderSwatch({ hex, name }) {
  return `
    <div class="swatch">
      <div class="swatch-block" style="background:${esc(hex)};"></div>
      <div class="swatch-info"><span>${esc(hex)}</span>${esc(name || '')}</div>
    </div>`;
}

function renderChapter2(data, url) {
  const d = data;
  const palette = (d.palette || []).slice(0, 6).map(renderSwatch).join('');
  const swatches = palette || `
    <div class="swatch"><div class="swatch-block" style="background:${C.accent};"></div>
    <div class="swatch-info"><span>${C.accent}</span>Accent</div></div>`;

  const toneTags = (d.tone || []).map((t) => `<strong>${esc(t)}</strong>`).join('、');
  const sellingPoints = (d.sellingPoints || []).map((p, i) => `${i + 1}. ${esc(p)}`).join('<br>');

  const targetUser = d.targetUser || {};
  const targetUserHTML = `
    年龄：${esc(targetUser.age || '—')}<br>
    身份：${esc(targetUser.identity || '—')}<br>
    痛点：${esc(targetUser.pain || '—')}<br>
    场景：${esc(targetUser.scene || '—')}`;

  const sitePreviewHTML = url ? `
    <div class="site-preview" data-url="${esc(url)}" data-name="${esc(d.name)}">
      <div class="site-preview-header">
        <span class="label"><span class="dot"></span>官网预览 · ${esc(url)}</span>
        <div class="actions">
          <button type="button" data-mode="screenshot" class="active">截图</button>
          <button type="button" data-mode="frame">内嵌</button>
          <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">新窗口打开 ↗</a>
        </div>
      </div>
      <div class="site-preview-body mode-screenshot">
        <span class="site-preview-loading">LOADING…</span>
        <img class="screenshot" alt="${esc(d.name)} 官网截图" loading="lazy">
        <iframe class="frame" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        <div class="fallback">
          <div class="icon">🔗</div>
          <div class="msg">该官网无法在当前页面内嵌预览（受 X-Frame-Options / CSP 限制）。点击下方按钮在新窗口中查看完整页面。</div>
          <a class="open-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">在新窗口打开 ${esc(d.name)} 官网 ↗</a>
        </div>
      </div>
    </div>` : '';

  const logo = d.logo || {};
  const typography = d.typography || {};
  const photo = d.photography || {};

  return `
    <section class="chapter" id="ch2">
      <div class="chapter-header">
        <span class="chapter-num">Chapter 01</span>
        <h2>8 维视觉与商业拆解</h2>
      </div>
      <p class="chapter-desc">从 Logo 到核心卖点，逐项拆解 ${esc(d.name)} 品牌的视觉资产与商业逻辑。</p>

      <div class="brand-card">
        <div class="brand-name">${esc(d.nameZh || d.name)} <span class="tag">${esc(d.category || 'Brand')} · ${esc(d.country || '—')}</span></div>

        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">1 · Logo</div>
            <div class="detail-value">类型：<strong>${esc(logo.type || '—')}</strong><br>${esc(logo.description || '')}<br><em>${esc(logo.construction || '')}</em></div>
          </div>

          <div class="detail-item">
            <div class="detail-label">2 · 色板</div>
            <div class="palette">${swatches}</div>
          </div>

          <div class="detail-item">
            <div class="detail-label">3 · 字体系统</div>
            <div class="detail-value">标题：${esc(typography.heading || '—')}<br>正文：${esc(typography.body || '—')}<br><em>${esc(typography.notes || '')}</em></div>
          </div>

          <div class="detail-item">
            <div class="detail-label">4 · 摄影风格</div>
            <div class="detail-value">类型：<strong>${esc(photo.style || '—')}</strong><br>光线：${esc(photo.lighting || '—')}<br>色调：${esc(photo.tone || '—')}<br>构图：${esc(photo.composition || '—')}</div>
          </div>

          <div class="detail-item full">
            <div class="detail-label">5 · 品牌调性</div>
            <div class="detail-value">关键词：${toneTags || '—'}<br>${esc(d.toneSummary || '')}</div>
          </div>

          <div class="detail-item full">
            <div class="detail-label">6 · 品牌定位</div>
            <div class="detail-value">${d.tagline ? `Tagline：<em>${esc(d.tagline)}</em><br>` : ''}${esc(d.positioning || '')}</div>
          </div>

          <div class="detail-item">
            <div class="detail-label">7 · 目标用户</div>
            <div class="detail-value">${targetUserHTML}</div>
          </div>

          <div class="detail-item">
            <div class="detail-label">8 · 核心卖点</div>
            <div class="detail-value">${sellingPoints || '—'}</div>
          </div>
        </div>

        ${sitePreviewHTML}
      </div>
    </section>`;
}

function renderChapter3(data) {
  return `
    <section class="chapter" id="ch3">
      <div class="chapter-header">
        <span class="chapter-num">Chapter 02</span>
        <h2>品牌叙事总结</h2>
      </div>
      <div class="summary-block">
        <h3>Summary · 一段话理解 ${esc(data.name)}</h3>
        <p>${esc(data.summary || '—')}</p>
      </div>
    </section>`;
}

function renderChapter4(data) {
  const values = RADAR_LABELS.map((k) => Number(data.radar?.[k] ?? 5));
  return `
    <section class="chart-section" id="ch4">
      <div class="chapter-header">
        <span class="chapter-num">Chapter 03</span>
        <h2>六维调性雷达图</h2>
      </div>
      <p class="chapter-desc">克制度 / 温度感 / 游戏化 / 科技感 / 情感连接 / 识别强度，每个维度 0-10 分。</p>
      <div class="chart-card">
        <div id="radar-chart"></div>
      </div>
    </section>

    <script>
      window.__RADAR_DATA__ = {
        name: ${JSON.stringify(data.name || '')},
        values: ${JSON.stringify(values)},
      };
    </script>`;
}

function renderChapter5(data) {
  const items = (data.kiwiiTakeaway && data.kiwiiTakeaway.length)
    ? data.kiwiiTakeaway
    : [
        `用「中性 + 1 暖点缀」取代高饱和撞色，保持全渠道视觉统一。`,
        `建立 1–2 个「杀手级场景」而非泛功能堆叠，让品牌叙事聚焦。`,
        `把「克制度 / 温度感 / 情感」作为长期调性，避免游戏化与高识别强度。`,
        `用「斜体 + 大字号」做强调，营造安静、有呼吸感的语气。`,
        `色板中预留 1–2 个暖中性色（沙色 / 雾绿），为系列延展留空间。`,
      ];

  return `
    <section class="chapter" id="ch5">
      <div class="chapter-header">
        <span class="chapter-num">Chapter 04</span>
        <h2>对 Kiwii 的 5 条可执行建议</h2>
      </div>
      <p class="chapter-desc">基于本品牌的视觉与商业策略，提取对 Kiwii 最具借鉴价值的洞察。</p>
      <div class="takeaway">
        <h3>Takeaway · 5 Actionable Insights</h3>
        <ul>
          ${items.map((t) => `<li>${esc(t)}</li>`).join('')}
        </ul>
      </div>
    </section>`;
}

// ---------- 主入口 ----------
export function renderReport({ name, url, data, meta, createdAt }) {
  const d = data || {};
  const date = createdAt || new Date().toISOString().slice(0, 10);
  const heroImage = meta?.ogImage || '';

  // 调取子组件
  const ch2 = renderChapter2(d, url);
  const ch3 = renderChapter3(d);
  const ch4 = renderChapter4(d);
  const ch5 = renderChapter5(d);

  // 主色：取 palette 的第一色作为 accent2（雷达图描边色）
  const radarColor = (d.primaryColors && d.primaryColors[0]) || '#1A1A1A';

  // 完整品牌数据 payload（写到 <script id="__BRAND_DATA__"> 块，供 refresh-index / 前端使用）
  const slug = (name || d.name || 'brand').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'brand';
  const dateCompact = date.replace(/-/g, '');
  const fileName = `${slug}-${dateCompact}.html`;
  const brandDataPayload = {
    id: `${slug}-${dateCompact}`,
    name: d.name || name,
    nameZh: d.nameZh || '',
    url: url || d.url || '',
    tagline: d.tagline || '',
    category: d.category || '',
    country: d.country || '',
    year: d.year || null,
    summary: d.summary || '',
    primaryColors: d.primaryColors || (d.palette || []).slice(0, 4).map((p) => p.hex),
    palette: d.palette || [],
    logo: d.logo || {},
    typography: d.typography || {},
    photography: d.photography || {},
    tone: d.tone || [],
    toneSummary: d.toneSummary || '',
    positioning: d.positioning || '',
    targetUser: d.targetUser || {},
    sellingPoints: d.sellingPoints || [],
    radar: d.radar || {},
    meta: {
      favicon: meta?.favicon || d.favicon || '',
      ogImage: meta?.ogImage || d.heroImage || '',
      heroImage: meta?.ogImage || d.heroImage || '',
      logoCandidates: meta?.logoCandidates || d.logoCandidates || [],
    },
    reportFile: fileName,
    reportUrl: './' + fileName,
    createdAt: date,
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(d.name || name)} 品牌视觉研究</title>
${heroImage ? `  <meta property="og:image" content="${esc(heroImage)}">\n` : ''}  <link rel="stylesheet" href="./_shared/css/report-base.css">
  <style>
    :root {
      --bg: ${C.bg}; --bg2: ${C.bg2}; --bg3: ${C.bg3};
      --ink: ${C.ink}; --muted: ${C.muted}; --rule: ${C.rule};
      --accent: ${C.accent}; --accent2: ${C.accent2}; --accent3: ${C.accent3};
      --font-serif: 'InstrumentSerif', Georgia, serif;
      --font-sans: 'InstrumentSans', Helvetica, Arial, sans-serif;
      --font-mono: 'GeistMono', 'Courier New', monospace;
      --max: 1920px;
      --radius: 12px; --radius-sm: 8px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; scroll-behavior: smooth; }
    body { font-family: var(--font-sans); color: var(--ink); background: var(--bg); line-height: 1.75; -webkit-font-smoothing: antialiased; }
    img { max-width: 100%; display: block; }
    a { color: var(--accent3); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .page { max-width: var(--max); margin: 0 auto; padding: 2rem 1.5rem 4rem; }

    .cover { text-align: center; padding: 6rem 1rem 4rem; border-bottom: 1px solid var(--rule); margin-bottom: 3rem; }
    .cover-label { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); margin-bottom: 1.5rem; }
    .cover h1 { font-family: var(--font-serif); font-size: clamp(2.2rem, 5vw, 3.6rem); font-weight: 400; line-height: 1.2; color: var(--ink); margin-bottom: 1rem; }
    .cover h1 em { color: var(--accent); font-style: italic; }
    .cover .subtitle { font-size: 1.1rem; color: var(--muted); max-width: 600px; margin: 0 auto; line-height: 1.8; }
    .cover-meta { margin-top: 2rem; font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); }

    .toc { background: var(--bg2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 2rem 2.5rem; margin-bottom: 3.5rem; }
    .toc h2 { font-family: var(--font-serif); font-size: 1.4rem; font-weight: 400; margin-bottom: 1.2rem; }
    .toc ol { list-style: none; counter-reset: toc-counter; }
    .toc ol li { counter-increment: toc-counter; padding: 0.4rem 0; }
    .toc ol li::before { content: counter(toc-counter, decimal-leading-zero); font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); margin-right: 0.8rem; }
    .toc ol li a { color: var(--ink); font-size: 0.95rem; }

    .chapter { margin-bottom: 4rem; scroll-margin-top: 2rem; }
    .chapter-header { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.5rem; padding-bottom: 0.8rem; border-bottom: 2px solid var(--rule); }
    .chapter-num { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
    .chapter-header h2 { font-family: var(--font-serif); font-size: 1.8rem; font-weight: 400; line-height: 1.3; }
    .chapter-desc { color: var(--muted); font-size: 0.95rem; margin-bottom: 2rem; }

    .brand-card { background: var(--bg2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 2.5rem; margin-bottom: 2.5rem; }
    .brand-name { font-family: var(--font-serif); font-size: 1.6rem; font-weight: 400; margin-bottom: 0.3rem; }
    .brand-name .tag { display: inline-block; font-family: var(--font-mono); font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); background: var(--bg3); padding: 0.2rem 0.6rem; border-radius: 4px; vertical-align: middle; margin-left: 0.5rem; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem 2rem; margin: 1.5rem 0; }
    .detail-item .detail-label { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.4rem; }
    .detail-item .detail-value { color: var(--ink); font-size: 0.95rem; line-height: 1.7; }
    .detail-item.full { grid-column: 1 / -1; }

    .palette { display: flex; gap: 0.8rem; flex-wrap: wrap; margin-top: 0.4rem; }
    .swatch { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; }
    .swatch-block { width: 38px; height: 38px; border-radius: var(--radius-sm); border: 1px solid var(--rule); }
    .swatch-info { text-align: center; font-family: var(--font-mono); font-size: 0.65rem; color: var(--muted); }
    .swatch-info span { color: var(--ink); display: block; }

    .summary-block { background: var(--bg3); border-left: 3px solid var(--accent); padding: 1.5rem 1.8rem; border-radius: var(--radius-sm); margin-top: 1.5rem; }
    .summary-block h3 { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.8rem; }
    .summary-block p { color: var(--ink); font-size: 1rem; line-height: 1.85; }

    .chart-section { margin-top: 3rem; }
    .chart-card { background: var(--bg2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 2rem; }
    #radar-chart { width: 100%; height: 460px; }

    .takeaway { background: var(--bg2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 2.5rem; margin-top: 2rem; }
    .takeaway h3 { font-family: var(--font-serif); font-size: 1.4rem; font-weight: 400; margin-bottom: 1rem; }
    .takeaway ul { list-style: none; padding: 0; counter-reset: takeaway; }
    .takeaway li { padding: 0.7rem 0 0.7rem 1.5rem; position: relative; border-bottom: 1px solid var(--rule); line-height: 1.7; counter-increment: takeaway; }
    .takeaway li::before { content: counter(takeaway); position: absolute; left: 0; top: 0.85rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); }
    .takeaway li:last-child { border-bottom: 0; }

    .site-preview { border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; margin-top: 1.5rem; }
    .site-preview-header { display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 1rem; background: var(--bg3); border-bottom: 1px solid var(--rule); }
    .site-preview-header .label { font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); display: flex; align-items: center; gap: 0.5rem; }
    .site-preview-header .dot { width: 6px; height: 6px; background: var(--accent2); border-radius: 50%; }
    .site-preview-header .actions { display: flex; gap: 0.5rem; align-items: center; }
    .site-preview-header .actions button,
    .site-preview-header .actions a { font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.25rem 0.6rem; border-radius: 4px; border: 1px solid var(--rule); background: var(--bg2); color: var(--ink); cursor: pointer; text-decoration: none; }
    .site-preview-header .actions button.active { background: var(--ink); color: var(--bg2); border-color: var(--ink); }
    .site-preview-body { position: relative; min-height: 360px; background: var(--bg2); }
    .site-preview-body .screenshot { display: none; width: 100%; height: auto; }
    .site-preview-body .frame { display: none; width: 100%; height: 480px; border: 0; }
    .site-preview-body .fallback { display: none; padding: 3rem 2rem; text-align: center; }
    .site-preview-body .fallback .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .site-preview-body .fallback .msg { color: var(--muted); font-size: 0.9rem; max-width: 520px; margin: 0 auto 1rem; }
    .site-preview-body .fallback .open-btn { display: inline-block; padding: 0.6rem 1.2rem; background: var(--ink); color: var(--bg2); border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; }
    .site-preview-body.mode-screenshot .screenshot { display: block; }
    .site-preview-body.mode-frame .frame { display: block; }
    .site-preview-body.mode-fallback .fallback { display: block; }
    .site-preview-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 0.8rem; letter-spacing: 0.2em; color: var(--muted); }
    .site-preview-body.mode-screenshot.loaded .site-preview-loading,
    .site-preview-body.mode-frame.loaded .site-preview-loading,
    .site-preview-body.mode-fallback.loaded .site-preview-loading { display: none; }

    footer { border-top: 1px solid var(--rule); padding-top: 2rem; margin-top: 3rem; text-align: center; color: var(--muted); font-family: var(--font-mono); font-size: 0.78rem; }
    footer code { background: var(--bg3); padding: 1px 5px; border-radius: 3px; font-size: 0.72rem; }

    @media (max-width: 768px) {
      .cover { padding: 3rem 0.5rem 2.5rem; }
      .cover h1 { font-size: 2rem; }
      .toc { padding: 1.5rem; }
      .brand-card { padding: 1.5rem; }
      .detail-grid { grid-template-columns: 1fr; }
      .chapter-header { flex-direction: column; gap: 0.3rem; }
      .chapter-header h2 { font-size: 1.4rem; }
      #radar-chart { height: 360px; }
      .page { padding: 1.5rem 1rem 3rem; }
    }
  </style>
</head>
<body>
  <article class="page">
    <header class="cover">
      <div class="cover-label">Brand Research Report</div>
      <h1>${esc(d.name || name)} 品牌<em>视觉</em>研究</h1>
      <p class="subtitle">${esc(d.name || name)} 的 Logo、色板、字体、摄影、调性、定位、用户、卖点 8 维拆解 + 雷达图</p>
      <div class="cover-meta">${esc(date)} &middot; Brand Research &middot; ${esc(d.tagline || d.category || '')}</div>
    </header>

    <nav class="toc">
      <h2>目录</h2>
      <ol>
        <li><a href="#ch2">8 维视觉与商业拆解</a></li>
        <li><a href="#ch3">品牌叙事总结</a></li>
        <li><a href="#ch4">六维调性雷达图</a></li>
        <li><a href="#ch5">对 Kiwii 的 5 条可执行建议</a></li>
      </ol>
    </nav>

    ${ch2}
    ${ch3}
    ${ch4}
    ${ch5}

    <footer>
      Generated by Kiwii Brand Lab · ${esc(date)}<br>
      Powered by <code>brand-research</code> skill + MiniMax M3
    </footer>
  </article>

  <script id="__BRAND_DATA__" type="application/json">${esc(JSON.stringify(brandDataPayload))}</script>

  <script src="./_shared/js/echarts.min.js"></script>
  <script>
    (function () {
      var data = window.__RADAR_DATA__;
      var c = document.getElementById('radar-chart');
      if (!c || !window.echarts) return;
      var chart = window.echarts.init(c, null, { renderer: 'canvas' });
      var color = ${JSON.stringify(radarColor)};
      chart.setOption({
        color: [color],
        legend: { show: false },
        radar: {
          indicator: [
            { name: '克制', max: 10 },
            { name: '温度感', max: 10 },
            { name: '游戏化', max: 10 },
            { name: '科技感', max: 10 },
            { name: '情感连接', max: 10 },
            { name: '识别强度', max: 10 }
          ],
          shape: 'polygon',
          splitNumber: 5,
          axisName: { color: '#1A1A1A', fontFamily: 'InstrumentSans, sans-serif', fontSize: 13 },
          splitLine: { lineStyle: { color: '#E8E0D4' } },
          splitArea: { areaStyle: { color: ['rgba(251,248,243,0.6)', 'rgba(244,239,230,0.4)', 'rgba(251,248,243,0.6)', 'rgba(244,239,230,0.4)', 'rgba(251,248,243,0.6)'] } },
          axisLine: { lineStyle: { color: '#E8E0D4' } }
        },
        series: [{
          type: 'radar',
          data: [{
            value: data.values,
            name: data.name,
            lineStyle: { width: 2, color: color },
            itemStyle: { color: color },
            areaStyle: { color: color + '20' }
          }]
        }]
      });
      window.addEventListener('resize', function () { chart.resize(); });
    })();
  </script>
  <script>
    // Site preview：截图 / 内嵌 / 失败 三态切换
    (function () {
      var sp = document.querySelector('.site-preview');
      if (!sp) return;
      var url = sp.getAttribute('data-url');
      var name = sp.getAttribute('data-name') || '';
      var body = sp.querySelector('.site-preview-body');
      var screenshotImg = sp.querySelector('.screenshot');
      var iframe = sp.querySelector('.frame');
      var btns = sp.querySelectorAll('.actions button[data-mode]');

      // 尝试截图（用第三方免费服务，不稳定则走 fallback）
      function tryScreenshot() {
        // 用 https://image.thum.io/get/ 抓取公开页面的截图（CDN 服务）
        // 注意：很多站点会通过 UA/Referer 拦截，这里加一个友好 UA
        var shotUrl = 'https://image.thum.io/get/width/1200/crop/800/png/' + url;
        screenshotImg.src = shotUrl;
        screenshotImg.onload = function () { body.classList.add('loaded'); };
        screenshotImg.onerror = function () { setMode('fallback'); };
        // 超时 fallback
        setTimeout(function () {
          if (!body.classList.contains('loaded')) setMode('fallback');
        }, 8000);
      }

      function setMode(mode) {
        body.classList.remove('mode-screenshot', 'mode-frame', 'mode-fallback');
        body.classList.add('mode-' + mode);
        if (mode === 'frame') {
          iframe.src = url;
          iframe.onload = function () { body.classList.add('loaded'); };
          iframe.onerror = function () { setMode('fallback'); };
        }
        btns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
      }

      btns.forEach(function (b) {
        b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
      });

      tryScreenshot();
    })();
  </script>
</body>
</html>`;
}

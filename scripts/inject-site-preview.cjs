// scripts/inject-site-preview.cjs
// ============================================================
// 把"官网预览"板块（截图 / 嵌套 / 新窗口）注入到已有报告里
// - 1. 找出每个报告对应的品牌 URL（hardcoded 映射，未来 LLM 自动给）
// - 2. 读 HTML，找到 <footer> 之前的位置，注入 site-preview
// - 3. 同步更新 __BRAND_DATA__ 块的 url 字段
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');

// brand id (从文件名取) -> 官方 URL
const URLS = {
  'oura-20260622': 'https://ouraring.com',
  'hatch-20260622': 'https://www.hatch.co',
  'linear-20260622': 'https://linear.app',
  'b-o-20260622': 'https://www.bang-olufsen.com',
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sitePreviewHTML(url, name) {
  return `
    <section class="site-preview" data-url="${esc(url)}" data-name="${esc(name)}">
      <div class="site-preview-header">
        <span class="label"><span class="dot"></span>官网预览 · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></span>
        <div class="actions">
          <button type="button" data-mode="screenshot" class="active">截图</button>
          <button type="button" data-mode="frame">内嵌</button>
          <a class="open-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">新窗口打开 ↗</a>
        </div>
      </div>
      <div class="site-preview-body mode-screenshot">
        <span class="site-preview-loading">LOADING…</span>
        <img class="screenshot" alt="${esc(name)} 官网截图" loading="lazy">
        <iframe class="frame" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        <div class="fallback">
          <div class="icon">🔗</div>
          <div class="msg">该官网无法在当前页面内嵌预览（受 X-Frame-Options / CSP 限制）。点击下方按钮在新窗口中查看完整页面。</div>
          <a class="open-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">在新窗口打开 ${esc(name)} 官网 ↗</a>
        </div>
      </div>
    </section>`;
}

function sitePreviewCSS() {
  return `
    .site-preview { border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; margin: 2rem 0; background: var(--bg2); }
    .site-preview-header { display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 1rem; background: var(--bg3); border-bottom: 1px solid var(--rule); flex-wrap: wrap; gap: 0.5rem; }
    .site-preview-header .label { font-family: var(--font-mono); font-size: 0.72rem; color: var(--muted); display: flex; align-items: center; gap: 0.5rem; }
    .site-preview-header .label a { color: var(--muted); text-decoration: underline; text-decoration-color: var(--rule); }
    .site-preview-header .label a:hover { color: var(--ink); text-decoration-color: var(--ink); }
    .site-preview-header .dot { width: 6px; height: 6px; background: var(--accent2); border-radius: 50%; flex-shrink: 0; }
    .site-preview-header .actions { display: flex; gap: 0.4rem; align-items: center; }
    .site-preview-header .actions button { padding: 0.32rem 0.75rem; background: transparent; border: 1px solid var(--rule); border-radius: 99px; font-family: var(--font-mono); font-size: 0.7rem; color: var(--muted); cursor: pointer; transition: all 0.15s; }
    .site-preview-header .actions button:hover { color: var(--ink); border-color: var(--ink); }
    .site-preview-header .actions button.active { background: var(--accent); color: white; border-color: var(--accent); }
    .site-preview-header .actions a.open-link { padding: 0.32rem 0.75rem; border: 1px solid var(--rule); border-radius: 99px; font-family: var(--font-mono); font-size: 0.7rem; color: var(--ink); text-decoration: none; }
    .site-preview-header .actions a.open-link:hover { background: var(--ink); color: var(--bg2); }
    .site-preview-body { position: relative; aspect-ratio: 16 / 9; background: var(--bg3); overflow: hidden; }
    .site-preview-body .screenshot, .site-preview-body .frame, .site-preview-body .fallback { position: absolute; inset: 0; width: 100%; height: 100%; }
    .site-preview-body .screenshot { object-fit: cover; object-position: top center; opacity: 0; transition: opacity 0.4s; }
    .site-preview-body .screenshot.loaded { opacity: 1; }
    .site-preview-body .frame { border: 0; display: none; background: white; }
    .site-preview-body .fallback { display: none; padding: 2rem; text-align: center; align-content: center; color: var(--muted); font-size: 0.85rem; }
    .site-preview-body .fallback .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .site-preview-body .fallback .open-btn { display: inline-block; margin-top: 0.8rem; padding: 0.5rem 1rem; background: var(--accent); color: white; border-radius: 99px; text-decoration: none; font-size: 0.8rem; }
    .site-preview-body .fallback .open-btn:hover { background: var(--ink); }
    .site-preview-body .site-preview-loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-family: var(--font-mono); font-size: 0.7rem; color: var(--muted); letter-spacing: 0.1em; z-index: 1; }
    .site-preview-body.mode-screenshot .screenshot.loaded ~ .site-preview-loading { display: none; }
    .site-preview-body.mode-frame .frame { display: block; }
    .site-preview-body.mode-frame .screenshot, .site-preview-body.mode-frame .fallback { display: none; }
    .site-preview-body.mode-frame .site-preview-loading { display: none; }
    .site-preview-body.mode-fallback .fallback { display: block; }
    .site-preview-body.mode-fallback .screenshot, .site-preview-body.mode-fallback .frame { display: none; }
    .site-preview-body.mode-fallback .site-preview-loading { display: none; }`;
}

function sitePreviewJS() {
  return `
    (function initSitePreview() {
      const previews = document.querySelectorAll('.site-preview');
      previews.forEach((root) => {
        const url = root.dataset.url;
        const name = root.dataset.name;
        if (!url) return;
        const body = root.querySelector('.site-preview-body');
        const img = root.querySelector('.screenshot');
        const iframe = root.querySelector('.frame');
        const buttons = root.querySelectorAll('.actions button[data-mode]');
        const fallback = root.querySelector('.fallback');
        const loading = root.querySelector('.site-preview-loading');

        // 1. 加载截图（thum.io 免费服务）
        const shotUrl = 'https://image.thum.io/get/width/1280/crop/720/' + url;
        img.src = shotUrl;
        img.onload = () => { img.classList.add('loaded'); loading.style.display = 'none'; };
        img.onerror = () => {
          loading.style.display = 'none';
          body.classList.remove('mode-screenshot');
          body.classList.add('mode-fallback');
        };

        // 2. 设置 iframe src（懒加载）
        iframe.dataset.src = 'https://' + url.replace(/^https?:\\/\\//, '');

        // 3. 模式切换
        buttons.forEach((btn) => {
          btn.addEventListener('click', () => {
            buttons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.dataset.mode;
            body.classList.remove('mode-screenshot', 'mode-frame', 'mode-fallback');
            if (mode === 'screenshot') {
              body.classList.add('mode-screenshot');
            } else if (mode === 'frame') {
              if (!iframe.src) iframe.src = iframe.dataset.src;
              body.classList.add('mode-frame');
            }
          });
        });
      });
    })();`;
}

function processFile(filePath) {
  const fileName = path.basename(filePath);
  const id = fileName.replace(/\.html$/i, '');
  const url = URLS[id];
  if (!url) {
    console.log(`SKIP: ${fileName} 没有对应的 URL 映射`);
    return false;
  }
  console.log(`\n处理: ${fileName} -> ${url}`);
  let html = fs.readFileSync(filePath, 'utf8');

  // 0. 取出 brand name（从 <title> 或 <h1> 或 brand-name div）
  const $ = cheerio.load(html);
  let name = $('title').first().text().split('·')[0].trim();
  if (!name || name === fileName) {
    const bn = $('.brand-card .brand-name').contents().filter((_, n) => n.type === 'text').first();
    if (bn.length) name = bn.text().trim();
  }
  console.log(`  brand name: ${name}`);

  // 1. 注入 CSS
  if (!html.includes('.site-preview-header .label')) {
    // 插在最后一个 </style> 之前
    html = html.replace('</style>', sitePreviewCSS() + '\n  </style>');
    console.log('  ✓ 注入 CSS');
  } else {
    console.log('  - CSS 已存在，跳过');
  }

  // 2. 注入 HTML 板块（插在 footer 之前；如果没有 footer 插在 </article> 之前）
  const block = sitePreviewHTML(url, name);
  if (html.includes('class="site-preview"')) {
    // 已存在则替换
    html = html.replace(/<section class="site-preview"[\s\S]*?<\/section>/, block.trim());
    console.log('  ✓ 替换已存在的 site-preview');
  } else if (html.includes('<footer>')) {
    html = html.replace('<footer>', block + '\n  <footer>');
    console.log('  ✓ 插入到 <footer> 之前');
  } else if (html.includes('</article>')) {
    html = html.replace('</article>', block + '\n</article>');
    console.log('  ✓ 插入到 </article> 之前');
  } else {
    console.log('  WARN: 没找到 <footer> 或 </article>');
    return false;
  }

  // 3. 注入 JS（先看看是否已有 initSitePreview）
  if (!html.includes('function initSitePreview')) {
    // 找最后一段 <script> 块（echarts 那个），之后插入；或插在 </body> 之前
    if (html.match(/<script>[\s\S]*?echarts[\s\S]*?<\/script>/)) {
      html = html.replace(/(<\/script>)(?=[^<]*<script>[\s\S]*?echarts)/, '$1');
      html = html.replace(/(<script>[\s\S]*?<\/script>)\s*<\/body>/, `$1\n    <script>${sitePreviewJS()}</script>\n  </body>`);
    } else {
      html = html.replace('</body>', `    <script>${sitePreviewJS()}</script>\n  </body>`);
    }
    console.log('  ✓ 注入 JS');
  } else {
    console.log('  - JS 已存在，跳过');
  }

  // 4. 更新 __BRAND_DATA__ 块的 url 字段
  if (html.includes('id="__BRAND_DATA__"')) {
    html = html.replace(/<script id="__BRAND_DATA__" type="application\/json">([\s\S]*?)<\/script>/, (_, json) => {
      try {
        const data = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
        data.url = url;
        return `<script id="__BRAND_DATA__" type="application/json">${esc(JSON.stringify(data))}</script>`;
      } catch (e) {
        console.log('  WARN: 解析 __BRAND_DATA__ 失败: ' + e.message);
        return _;
      }
    });
    console.log('  ✓ 更新 __BRAND_DATA__.url');
  } else {
    console.log('  - 没有 __BRAND_DATA__ 块，跳过 url 更新');
  }

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  DONE: ${fileName}`);
  return true;
}

const files = ['oura-20260622.html', 'hatch-20260622.html', 'linear-20260622.html', 'b-o-20260622.html'];
let updated = 0;
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { console.log(`SKIP: ${f} 不存在`); continue; }
  if (processFile(p)) updated++;
}
console.log(`\nDONE: 更新了 ${updated} 个文件`);
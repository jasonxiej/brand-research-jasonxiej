# Kiwii Brand Research Hub

> 让品牌视觉调研成为 Kiwii 的常态。输入品牌名 → 自动生成 8 维结构化报告 → 沉淀到品牌库 → 多选横向对比。

![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-blue?logo=github)
![License](https://img.shields.io/badge/license-MIT-green)
![No Build](https://img.shields.io/badge/build-none-success)
![Pure Static](https://img.shields.io/badge/static-HTML%20%2B%20JS-yellow)

## ✨ 特性

- **🎨 0 依赖纯静态** — 纯 HTML + JS + JSON，**无需 npm / 构建工具**，双击或推 GitHub Pages 即可访问
- **🧠 8 维结构化拆解** — Logo / 色板 / 字体 / 摄影 / 调性 / 定位 / 用户 / 卖点
- **📊 六维调性雷达图** — 克制度 / 温度感 / 游戏化 / 科技感 / 情感连接 / 识别强度
- **🔀 多品牌横向对比** — 最多 4 个品牌叠加雷达 + 8 维表 + 自动生成 Kiwii 视觉北极星建议
- **🔌 skill 友好** — 与 `consulting-analysis` + `brand-research` skill 配合，一键生成新报告
- **📡 局域网共享** — 一键启动脚本，绑定 `0.0.0.0` 让手机/同事同 Wi-Fi 访问
- **📦 报告自动沉淀** — 每次新报告生成后自动加入品牌库，无需手动改配置

## 🚀 Demo

**在线版**（GitHub Pages 部署后）：`<your-username>.github.io/brand-research/`

**本地版**（克隆后启动）：

```bash
# 方式 1：直接用 Python（推荐）
python -m http.server 8000 --bind 0.0.0.0

# 方式 2：Windows 双击
./start-server.bat

# 浏览器访问
http://localhost:8000/
```

## 📁 文件结构

```
brand-research/
├── index.html              # 品牌调研中心首页（输入表单 + 品牌库）
├── compare.html            # 多品牌对比页（最多 4 个品牌）
├── README.md               # 本文件
├── LICENSE                 # MIT 协议
├── .gitignore              # Git 忽略规则
│
├── brands/
│   └── index.json          # 品牌库索引（自动生成 + 可手填）
│
├── scripts/
│   └── refresh-index.js    # 扫描 *.html → 写回 brands/index.json
│
├── _shared/                # 共享资源（字体 + ECharts）
│   ├── fonts/              # InstrumentSerif / InstrumentSans / GeistMono
│   └── js/echarts.min.js   # 雷达图渲染
│
├── assets/                 # 共享资源（参考图、charts.js）
│
├── start-server.bat        # Windows 一键启动（绑定 0.0.0.0 局域网可访问）
├── stop-server.bat         # Windows 一键停止
│
└── <brand-slug>-<YYYYMMDD>.html   # 每次调研生成的报告
```

## 🛠 快速开始

### 1. 启动本地服务

```bash
cd brand-research
python -m http.server 8000 --bind 0.0.0.0
```

> Windows 用户可以直接双击 `start-server.bat`，会自动检测本机 IP 并打印局域网访问地址。

### 2. 开始一次新调研

1. 打开 `http://localhost:8000/`
2. 在首页输入框填写品牌名（如 `Hatch`）或品牌官网 URL
3. 点击「调研」→ 复制生成的 prompt 给 Trae 对话或 Trae CLI
4. 调用 `brand-research` skill 生成 `<slug>-<YYYYMMDD>.html` 报告
5. 回到首页点击「刷新」→ 新品牌自动出现在品牌库

### 3. 多选品牌做对比

在首页品牌库点选 2–4 个品牌（卡片右上角圆圈）→ 点击「生成对比页 →」，进入对比页查看：
- 8 维拆解总览表
- 六维调性雷达图（叠加）
- 色板并置
- Kiwii 视觉北极星建议（4 条自动洞察）

## 📦 部署到 GitHub Pages

### 方式 1：项目页面（推荐新手）

**仓库名**：`brand-research` 或任意 → 访问地址：`https://<user>.github.io/brand-research/`

1. 在 GitHub 新建仓库（**Public**）
2. 推送代码：
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Kiwii Brand Research Hub"
   git branch -M main
   git remote add origin https://github.com/<your-username>/brand-research.git
   git push -u origin main
   ```
3. 进入仓库 **Settings → Pages**
4. **Source** 选 `Deploy from a branch` → Branch 选 `main` / `(root)` → **Save**
5. 等 1–2 分钟，访问 `https://<your-username>.github.io/brand-research/`

### 方式 2：用户主页（独立域名感）

**仓库名必须**叫 `<your-username>.github.io` → 访问地址：`https://<your-username>.github.io/`

1. 在 GitHub 新建仓库 `<your-username>.github.io`
2. 把本目录所有文件 push 到该仓库的 `main` 分支
3. 进入 **Settings → Pages** → 确认 `Build and deployment` 是 `Deploy from a branch`
4. 几分钟后访问 `https://<your-username>.github.io/`

### 方式 3：GitHub Actions 自动部署（高级）

本项目已包含 `.github/workflows/pages.yml`，推送到 main 分支自动部署。

## 🔧 与 skill 配合使用

本项目为 [`consulting-analysis`](https://github.com) + `brand-research` skill 提供可视化载体：

1. 在 Trae 对话里调用 `brand-research` skill 生成新报告
2. 报告保存为 `<slug>-<YYYYMMDD>.html` 格式
3. 运行 `node scripts/refresh-index.js`（或让 skill 自动跑）刷新品牌库索引
4. 推送到 GitHub → 自动部署

### HTML 报告命名规范

```
<brand-slug>-<YYYYMMDD>.html
```

例如：
- ✅ `oura-20260622.html`
- ✅ `hatch-20260622.html`
- ❌ `oura.html`（缺日期）
- ❌ `oura-research.html`（格式不对）

`<brand-slug>` 建议用品牌名小写 + 短横线，如 `oura`、`hatch`、`whoop`、`casper`。

## 🎨 视觉系统

所有页面沿用 **Kiwii Editorial Reference**：

| Token | 值 |
|-------|---|
| 背景 | `#FBF8F3` |
| 卡片底 | `#FFFFFF` |
| 主文字 | `#1A1A1A` |
| 次文字 | `#6B6B6B` |
| 强调 1 | `#FF7A45`（暖橙） |
| 强调 2 | `#7FB069`（绿） |
| 强调 3 | `#6B4EFF`（紫） |
| 标题字体 | `InstrumentSerif` |
| 正文字体 | `InstrumentSans` |
| 数据字体 | `GeistMono` |

字体文件位于 `_shared/fonts/`，所有 HTML 报告必须用相对路径引用。

## 🐛 常见问题

**Q：首页 fetch 失败？**
A：必须通过 HTTP 服务器访问，不能直接双击 HTML。

**Q：刷新品牌库没看到新品牌？**
A：① 确认文件名是 `<slug>-<YYYYMMDD>.html` 格式；② 浏览器按 Ctrl+F5 强制刷新；③ 手动跑 `node scripts/refresh-index.js`。

**Q：雷达图打不开？**
A：检查 `_shared/js/echarts.min.js` 是否存在（已 Git LFS 或普通提交）。

**Q：GitHub Pages 部署后样式丢了？**
A：检查 `_shared/fonts/*.ttf` 是否在仓库里（部分超过 100KB 的文件 GitHub 会警告但能正常托管）。

**Q：能私有部署吗？**
A：GitHub Pages 免费版只支持 public 仓库。如需私有，可改用：
- [Vercel](https://vercel.com)（推荐，免费，支持 private）
- [Netlify](https://netlify.com)
- [Cloudflare Pages](https://pages.cloudflare.com)

## 📄 License

MIT © 2026 Kiwii Brand Lab

详见 [LICENSE](./LICENSE)。

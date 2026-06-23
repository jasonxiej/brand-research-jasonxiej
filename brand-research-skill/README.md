# Brand Research Skill (Kiwii)

> 品牌视觉调研 skill · 8 维结构化拆解 + 6 轴调性雷达 · 一键安装即用

把整个 `brand-research` 项目打包成可分发的 skill。别人下载后丢进自己的 agent 就能用：输入品牌名 → 自动生成 8 维报告 + 雷达图 → 沉淀到本地品牌库 → 多选横向对比。

---

## 安装（30 秒）

### 方式 1：放进 SOLO / Trae 的 skills 目录

```bash
# Windows PowerShell
Copy-Item -Path ".\brand-research-skill" -Destination "$env:USERPROFILE\.trae\skills\brand-research" -Recurse -Force
```

```bash
# macOS / Linux
cp -r brand-research-skill ~/.trae/skills/brand-research
```

### 方式 2：放进 Claude Code / Cursor 的 skills 目录

```bash
# Claude Code
cp -r brand-research-skill ~/.claude/skills/brand-research

# Cursor
cp -r brand-research-skill ~/.cursor/skills/brand-research
```

### 3. 解压项目代码

`brand-research-skill/brand-research-project.zip` 里是项目源码（不含 `node_modules` / 用户报告 / 私人配置）。

```bash
# 解压到当前目录的 brand-research 文件夹
unzip brand-research-skill/brand-research-project.zip -d ./brand-research

# Windows PowerShell 也可以用 Expand-Archive
Expand-Archive -Path brand-research-skill/brand-research-project.zip -DestinationPath ./brand-research -Force
```

### 4. 安装依赖 + 启动

```bash
cd brand-research
npm install

# 准备 API Key
cp .env.example .env
# 用编辑器打开 .env，填入 MINIMAX_API_KEY（必填）和 OPENAI_BASE_URL（可选，默认官方地址）

# 启动（Windows / macOS / Linux 通用）
./start-server.bat     # Windows
./start-server.sh      # macOS / Linux
```

打开浏览器 `http://localhost:8000/` 就能看到 hub。同 Wi-Fi 设备用 `http://<你的IP>:8000/`（启动脚本会自动打印）。想钉死局域网 IP，可以 `set LAN_HOST=192.168.1.100 && start-server.bat`。

---

## 文件清单

```
brand-research-skill/
├── SKILL.md                      ← 必读，agent 用它判断何时调用本 skill
├── README.md                     ← 本文件，人类阅读
├── LICENSE                       ← MIT
├── skill.json                    ← 元数据（版本、依赖等，给 marketplace 用）
├── INSTALL.txt                   ← 一行安装命令速查
└── brand-research-project.zip    ← 项目源码包（不含 node_modules / 用户报告）
```

---

## 触发场景（让 agent 知道什么时候用它）

skill 装好后，agent 在以下场景会自动调用 `brand-research`：

- 用户在 hub 输入框里写品牌名并点"调研"
- 用户说"分析一下 X 品牌的视觉" / "对 X 做品牌调研" / "加 X 到品牌库"
- 用户想要生成多品牌对比页
- 用户说"调取 Hatch 报告" / "show Oura's radar"

详细触发条件见 `SKILL.md` 的 frontmatter 描述字段。

---

## 升级

```bash
cd brand-research
# 重新解包新版 zip 覆盖
unzip ../brand-research-skill/brand-research-project.zip -d .
npm install
node scripts/refresh-index.cjs
```

老报告 HTML 文件不动，新报告走最新模板。

---

## 卸载

```bash
rm -rf ~/.trae/skills/brand-research   # 或 ~/.claude/skills/brand-research
rm -rf ./brand-research                # 项目代码
```

---

## 关键能力一览

- **8 维结构化拆解**：logo / palette / typography / photography / tone / positioning / targetUser / sellingPoints
- **6 轴调性雷达**：克制 / 温度感 / 游戏化 / 科技感 / 情感连接 / 识别强度
- **本地品牌库**：所有报告落地为自包含 HTML，索引进 `brands/index.json`
- **回收站**：误删的 30 天可恢复（`brands/trash.json`）
- **多品牌对比**：`compare.html?ids=a,b,c,d` 一页看 4 个
- **局域网共享**：右下角 LAN 卡片实时显示 LAN IP，手机/平板同 Wi-Fi 直连
- **乱码防护**：LLM 返回的非 UTF-8 字节自动从 Latin-1 还原为 UTF-8（见 `lib/researcher.mjs` 的 `sanitizeDeep`）

---

## License

MIT © 2026 Kiwii Brand Lab
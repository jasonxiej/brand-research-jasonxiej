# DEPLOY.md — 部署到 Vercel + Supabase 全流程

目标：把网站（前端 + API）部署到 Vercel，把品牌数据存在 Supabase。

```
┌─────────────────────────────────────────────────────────────┐
│  Browser  →  https://your-project.vercel.app                │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│  Vercel                                                     │
│    /index.html              ← 前端                          │
│    /api/brands, /api/research, /api/trash, ...              │
└────────────────────────┬────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
┌──────────────────────┐   ┌──────────────────────┐
│ Supabase Postgres    │   │ LLM API              │
│   brand_reports 表   │   │   MINIMAX / OpenAI   │
│   app_settings 表    │   │   (配置 base URL)    │
└──────────────────────┘   └──────────────────────┘
```

---

## 一次性步骤（约 15 分钟）

### ① 创建 Supabase 项目

1. 打开 https://supabase.com/dashboard
2. 登录 → **New project**
3. 填写：
   - Name：`brand-research-hub`（或你喜欢的）
   - Database Password：**复制保存**
   - Region：选离你最近的
4. 点 **Create new project**，等 1-2 分钟初始化

### ② 在 Supabase 建表

1. 进入项目 → 左侧 **SQL Editor** → **New query**
2. 把 `supabase/migrations/202606240001_brand_reports.sql` 文件**全部内容**粘进去
3. 点 **Run** (Ctrl+Enter)
4. 看到 "Success. No rows returned" 表示成功
5. 左侧 **Table Editor** 应该能看到 `brand_reports` 和 `app_settings` 两张表

### ③ 拿到 Supabase API 凭据

1. 左侧 **Settings** → **API**
2. 复制这两个值：
   - **Project URL**（形如 `https://xxxx.supabase.co`）→ 这是 `SUPABASE_URL`
   - **service_role key**（**不是 anon key！** service_role 有完全权限）→ 这是 `SUPABASE_SERVICE_ROLE_KEY`
3. ⚠️ service_role key **绝不能暴露到前端**——只用于 Vercel 后端

### ④ 拿到 LLM API 凭据

- **OpenAI**：https://platform.openai.com/api-keys
- **Anthropic / 其他 OpenAI 兼容服务**（比如 MiniMax）：参考其文档

需要三个值：
- `MINIMAX_API_KEY`（或 `OPENAI_API_KEY`）
- `MINIMAX_BASE_URL`（默认 OpenAI 是 `https://api.openai.com/v1`）
- `MINIMAX_MODEL`（默认 OpenAI 是 `gpt-4o-mini` 等）

### ⑤ 在 Vercel 配环境变量

1. 打开 https://vercel.com/dashboard
2. 选 `brand-research-jasonxiej` 项目
3. 顶部 **Settings** → **Environment Variables**
4. 逐个添加（**Key** 区分大小写，**Value** 从前面步骤复制）：

| Name | Value | 环境 |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | ✅ Production / Preview / Development |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | ✅ Production / Preview / Development |
| `MINIMAX_API_KEY` | `sk-xxxx` | ✅ Production / Preview / Development |
| `MINIMAX_BASE_URL` | `https://api.openai.com/v1`（或你的） | ✅ Production / Preview / Development |
| `MINIMAX_MODEL` | `gpt-4o-mini`（或你的） | ✅ Production / Preview / Development |
| `BRAND_NAME`（可选）| `Kiwii`（默认）| ✅ Production |

5. 全部填好后点 **Save**

### ⑥ 让 Vercel 重新部署（吃掉最新代码）

⚠️ **关键步骤** —— 如果跳过，Vercel 跑的还是旧代码。

**方法 A（推荐）：Redeploy 现有 deployment**

1. 顶部 **Deployments** 标签
2. 找最新一条 deployment（commit `af75cb5` 或更新）
3. 右侧 ⋮ → **Redeploy**
4. 弹窗**取消勾选** "Use existing Build Cache"
5. 点 Redeploy → 等 30-60 秒

**方法 B：触发新 build**

如果 auto-deploy 已经配置好，push 到 main 就行：

```bash
git commit --allow-empty -m "chore: trigger Vercel redeploy"
git push origin main
```

### ⑦ 验证部署成功

```bash
# 健康检查
curl https://brand-research-jasonxiej-psi.vercel.app/api/health
# 期望：{"ok":true,"brandName":"Kiwii","hasApiKey":true,"supabase":true}

# 配置检查
curl https://brand-research-jasonxiej-psi.vercel.app/api/config
# 期望：{"ok":true,"brandName":"Kiwii","baseUrl":"...","model":"...","hasApiKey":true}

# 品牌列表（刚建的库应该是空的）
curl https://brand-research-jasonxiej-psi.vercel.app/api/brands
# 期望：{"ok":true,"brands":[],"count":0}
```

如果 `hasApiKey: false` 或 `supabase: false`，说明环境变量没配全，回到步骤 ⑤ 检查。

---

## 把现有本地数据导入 Supabase（可选）

如果你本地 `brands/` 下已经有调研好的品牌 JSON，想把它们也放到云端：

### 步骤 A：本地准备 env

```bash
cd brand-research-jasonxiej
cp .env.example .env.local
# 用编辑器打开 .env.local，把 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 填进去
```

### 步骤 B：先 dry run 看会导入什么

```bash
node scripts/import-to-supabase.mjs --dry-run
```

应该会列出所有 `brands/*.json` 文件，准备导入。

### 步骤 C：实际导入（不含 HTML）

只导入品牌元数据（brandName、tagline、positioning、radar 数据等）：

```bash
node scripts/import-to-supabase.mjs
```

### 步骤 D：导入元数据 + HTML（完整迁移）

```bash
node scripts/import-to-supabase.mjs --include-html
```

会读取每个 brand 同名的 `.html` 文件，一并存进 Supabase 的 `html` 列。

### 步骤 E：只导入某几个

```bash
node scripts/import-to-supabase.mjs --id=kiwii-20260625 --id=hatch-20260625
```

---

## 数据流向（部署完成后）

| 操作 | 数据写到哪 |
|---|---|
| 网页上提交新的 brand 调研 | Supabase `brand_reports` 表（upsert） |
| 网页上删除 brand | Supabase 该行 `deleted_at` 设为当前时间（软删） |
| 网页上 restore | Supabase 该行 `deleted_at` 设回 null |
| 网页上 purge | Supabase 真删除该行 |
| 30 天后过期清理 | Supabase 删除 `expires_at < now()` 且 `deleted_at` 非空的行 |

**所有数据都存在 Supabase**，不再依赖 Vercel 部署目录（Vercel 目录只读）。

---

## 常见问题

### Q: Vercel 部署后访问 404 / 接口 500
A: 大概率是环境变量没配齐或 Redeploy 没成功。检查：
- `/api/health` 是否返回 `hasApiKey:true, supabase:true`
- Vercel 项目 Settings → Environment Variables 是否有这 6 个变量
- Redeploy 时是否取消了 "Use existing Build Cache"

### Q: 访问 `/api/brands` 返回 404
A: 老 Vercel 部署没这个端点。Redeploy 让新代码生效即可。

### Q: Supabase 表里有什么字段？
A: 见 `supabase/migrations/202606240001_brand_reports.sql`：
- `brand_reports`：id / file_name / brand (jsonb) / html / deleted_at / expires_at / created_at / updated_at
- `app_settings`：key / value / is_secret / updated_at

### Q: 我想换 LLM 模型
A: Vercel 环境变量改 `MINIMAX_MODEL` 就行，不用动代码。

### Q: 我想改默认品牌名
A: Vercel 环境变量加 `BRAND_NAME=xxx`，或者在网页上点设置按钮直接改（会写到 `app_settings` 表）。

### Q: 服务端函数跑太久超时？
A: Vercel 免费 plan 10 秒超时，Pro 60 秒。品牌调研可能要 30-60 秒，可能需要 Pro plan。

### Q: 数据备份？
A: Supabase 控制台 → Database → Backups（免费 tier 7 天自动备份）。

---

## 一旦部署好，所有用户共用同一个 Supabase 数据库

- 任何用户提交的品牌都会出现在公开的品牌列表里（这是当前设计）
- 如果想要每个用户独立数据，需要加 RLS + 用户认证，那是另一套设计

---

## 完整流程清单

- [ ] 创建 Supabase 项目
- [ ] 在 Supabase SQL Editor 跑 `supabase/migrations/202606240001_brand_reports.sql`
- [ ] 复制 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY
- [ ] 拿到 LLM 的 API key / base URL / model
- [ ] 在 Vercel Environment Variables 加 6 个变量
- [ ] Redeploy Vercel（取消勾选 Build Cache）
- [ ] `curl /api/health` 确认 `hasApiKey:true, supabase:true`
- [ ]（可选）`node scripts/import-to-supabase.mjs` 导入本地数据
- [ ] 给别人分享你的 Vercel URL 🎉

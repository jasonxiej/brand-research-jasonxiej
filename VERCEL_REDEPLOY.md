# 触发 Vercel 重新部署 — 解决"线上版本删除不成功"

## 症状

访问 `https://brand-research-jasonxiej-psi.vercel.app/` 删除任意品牌时，浏览器弹窗显示：

```
Deleted 0 · 4
```

控制台 Network 里 `POST /api/trash` 返回 HTTP 500：

```json
{"error":"EROFS: read-only file system, open '/var/task/brands/index.json'"}
```

## 根因

`/api/health` 当前返回的是**旧版** schema：

```json
{"ok":true,"uptime":347.83,"jobs":0,"brandName":"Kiwii"}
```

而最新版本应该返回：

```json
{"ok":true,"brandName":"Kiwii","hasApiKey":true,"supabase":true}
```

说明 **Vercel 当前运行的是 Supabase 迁移之前的老 bundle**，老代码里
`api/trash.js` 走的是 `lib/trash-store.mjs`（写本地 JSON）。
Vercel 的部署目录是 **read-only filesystem**，所以写入失败 → 500。

`git log` 显示本地 `main` 上最新的 commit 是 `e06ac9b`（已 push 到
GitHub），但 Vercel 的 deployment 还在更老的 commit 上。

## 解决：手动 Redeploy

Vercel 的 GitHub auto-deploy 当前**没有自动触发**（可能被禁用，或者
GitHub App 权限过期）。需要手动操作：

### 方法 A：Vercel Dashboard（推荐）

1. 打开 https://vercel.com/dashboard
2. 选 `brand-research-jasonxiej` 项目
3. 顶部 `Deployments` 标签
4. 找到最新那条 deployment（应该是 commit `e06ac9b` 或更新）
5. 右侧三个点菜单 → `Redeploy`
6. 弹窗**取消勾选** `Use existing Build Cache`，确认
7. 等 30-60 秒，重新刷新网页

### 方法 B：Vercel CLI

如果方法 A 找不到项目（个人账号登录问题），用 CLI：

```bash
npm i -g vercel
cd path/to/brand-research-jasonxiej
vercel login                     # 浏览器授权
vercel link                      # 关联当前目录到 Vercel 项目
vercel env pull .env.local       # 把 Vercel 环境变量拉下来（验证有
                                 # SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）
vercel --prod                    # 强制重新部署 production
```

### 方法 C：检查 auto-deploy 设置

方法 A / B 跑过一次后，建议在 Vercel Dashboard 把 auto-deploy 打开：

1. `Settings` → `Git`
2. `Production Branch` 确认是 `main`
3. `Automatic Deployments from GitHub` 确认是 `Enabled`
4. 必要时 `Disconnect` 再 `Connect` 一次 GitHub

## 验证修复

部署完成后，浏览器硬刷新（Ctrl+Shift+R），再选品牌 → 删除。
应该看到：

- 弹窗 **不出现**（全部成功就是静默成功）
- 或成功移入回收站（http://localhost:8000/api/trash GET 应该能看到该 id）

可以用 curl 直接验证 Vercel：

```bash
# 1. health 应该返回新字段
curl https://brand-research-jasonxiej-psi.vercel.app/api/health
# {"ok":true,"brandName":"Kiwii","hasApiKey":true,"supabase":true}

# 2. brands 不再 404
curl https://brand-research-jasonxiej-psi.vercel.app/api/brands
# {"ok":true,"brands":[...],"count":N}

# 3. 删除应该返回 200（不是 EROFS 500）
curl -X POST https://brand-research-jasonxiej-psi.vercel.app/api/trash \
  -H 'Content-Type: application/json' \
  -d '{"id":"apple-20260625"}'
# {"ok":true,"item":{...}}
```

如果还看到 EROFS，说明部署还是旧版——再 Redeploy 一次。

## 本次 commit 已经做的改进（即使还没部署到 Vercel，本地也更好用）

| 文件 | 改动 |
|---|---|
| `api/trash.js` | EROFS 错误翻译为 `code: 'STALE_DEPLOY'` + 提示 Redeploy；新增 503 检查 Supabase 环境变量 |
| `index.html` | 批量删除失败时优先弹出服务器返回的具体原因（不再只是 "Deleted 0 · 4"） |

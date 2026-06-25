import { json, methodNotAllowed, readJson } from '../lib/http-api.mjs';
import { listTrash, moveToTrash, purgeExpired, hasSupabaseConfig } from '../lib/supabase-store.mjs';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const items = await listTrash();
      return json(res, 200, { ok: true, items, count: items.length, retainDays: 30 });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'purge-expired') {
        const r = await purgeExpired();
        return json(res, 200, { ok: true, ...r });
      }
      const id = String(body.id || '').trim();
      if (!id) return json(res, 400, { ok: false, error: '缺少品牌 id' });
      if (!hasSupabaseConfig()) {
        return json(res, 503, {
          ok: false,
          error: '线上版需要在 Vercel 环境变量里配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY。请到 Vercel → Project → Settings → Environment Variables 添加后再重试。',
        });
      }
      const r = await moveToTrash(id);
      return json(res, r.ok ? 200 : 400, r);
    }
    return methodNotAllowed(res);
  } catch (e) {
    // Make EROFS / read-only file-system errors obviously attributable to
    // a stale Vercel deployment that still has the old filesystem-based
    // trash-store.mjs in its bundle, instead of leaking a cryptic Node
    // error to the user.
    const msg = String(e?.message || e || '');
    if (/EROFS|read-only file system/i.test(msg)) {
      return json(res, 500, {
        ok: false,
        error: 'Vercel 当前运行的还是旧版本代码（写本地 JSON），请到 Vercel → Deployments → 最新一条 → Redeploy，让最新代码生效后再试。',
        code: 'STALE_DEPLOY',
      });
    }
    return json(res, 500, { ok: false, error: msg });
  }
}

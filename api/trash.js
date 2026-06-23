import { json, methodNotAllowed, readJson } from '../lib/http-api.mjs';
import { listTrash, moveToTrash, purgeExpired } from '../lib/supabase-store.mjs';

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
      const r = await moveToTrash(id);
      return json(res, r.ok ? 200 : 400, r);
    }
    return methodNotAllowed(res);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

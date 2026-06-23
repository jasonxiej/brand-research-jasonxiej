import { json, methodNotAllowed } from '../../../lib/http-api.mjs';
import { restoreFromTrash } from '../../../lib/supabase-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    const r = await restoreFromTrash(req.query.id);
    return json(res, r.ok ? 200 : 400, r);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

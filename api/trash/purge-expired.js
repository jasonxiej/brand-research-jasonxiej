import { json, methodNotAllowed } from '../../lib/http-api.mjs';
import { purgeExpired } from '../../lib/supabase-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    const r = await purgeExpired();
    return json(res, 200, { ok: true, ...r });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

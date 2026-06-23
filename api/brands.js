import { json, methodNotAllowed } from '../lib/http-api.mjs';
import { listBrandReports } from '../lib/supabase-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  try {
    const brands = await listBrandReports();
    return json(res, 200, { ok: true, brands, count: brands.length, updated: new Date().toISOString() });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

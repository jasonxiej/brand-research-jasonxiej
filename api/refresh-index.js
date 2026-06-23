import { json, methodNotAllowed } from '../lib/http-api.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  return json(res, 200, { ok: true, message: '线上品牌库由 Supabase 实时读取，无需刷新 index.json' });
}

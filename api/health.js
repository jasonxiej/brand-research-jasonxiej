import { json, methodNotAllowed } from '../lib/http-api.mjs';
import { getRuntimeConfig } from '../lib/runtime-config.mjs';
import { hasSupabaseConfig } from '../lib/supabase-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  const config = await getRuntimeConfig();
  return json(res, 200, {
    ok: true,
    brandName: config.brandName,
    hasApiKey: !!config.apiKey,
    supabase: hasSupabaseConfig(),
  });
}

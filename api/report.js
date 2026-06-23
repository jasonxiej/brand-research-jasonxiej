import { getReportHtml } from '../lib/supabase-store.mjs';
import { methodNotAllowed, text } from '../lib/http-api.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  try {
    const id = String(req.query?.id || '').trim();
    const fileName = String(req.query?.file || '').trim();
    if (!id && !fileName) return text(res, 400, 'Missing report id');
    const html = await getReportHtml({ id, fileName });
    if (!html) return text(res, 404, 'Report not found');
    return text(res, 200, html, 'text/html; charset=utf-8');
  } catch (e) {
    return text(res, 500, e.message);
  }
}

import { createClient } from '@supabase/supabase-js';

const DEFAULT_RETAIN_DAYS = 30;
let cachedClient = null;

export function hasSupabaseConfig() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdmin() {
  if (!hasSupabaseConfig()) {
    throw new Error('未配置 Supabase。请在 Vercel 环境变量中设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。');
  }
  if (!cachedClient) {
    cachedClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

function reportUrlForId(id) {
  return '/api/report?id=' + encodeURIComponent(id);
}

function normalizeBrand(row) {
  const brand = { ...(row.brand || {}) };
  brand.id = row.id;
  brand.reportFile = row.file_name;
  brand.reportUrl = reportUrlForId(row.id);
  brand.createdAt = brand.createdAt || String(row.created_at || '').slice(0, 10);
  return brand;
}

export async function listBrandReports() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('brand_reports')
    .select('id,file_name,brand,created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeBrand);
}

export async function saveBrandReport({ id, fileName, brand, html }) {
  const supabase = getSupabaseAdmin();
  const payload = {
    id,
    file_name: fileName,
    brand: { ...brand, id, reportFile: fileName, reportUrl: reportUrlForId(id) },
    html,
    deleted_at: null,
    expires_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('brand_reports').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
  return payload.brand;
}

export async function getReportHtml({ id, fileName }) {
  const supabase = getSupabaseAdmin();
  let query = supabase.from('brand_reports').select('html');
  query = id ? query.eq('id', id) : query.eq('file_name', fileName);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.html || '';
}

export async function listTrash() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('brand_reports')
    .select('id,file_name,brand,deleted_at,expires_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => {
    const brand = normalizeBrand(row);
    const expiresAt = row.expires_at;
    return {
      ...brand,
      deletedAt: row.deleted_at,
      expiresAt,
      daysLeft: expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt) - Date.now()) / 86400000)) : null,
      expired: expiresAt ? new Date(expiresAt) < new Date() : false,
      retainDays: DEFAULT_RETAIN_DAYS,
    };
  });
}

export async function moveToTrash(id) {
  const supabase = getSupabaseAdmin();
  const deletedAt = new Date();
  const expiresAt = new Date(deletedAt.getTime() + DEFAULT_RETAIN_DAYS * 86400000);
  const { data, error } = await supabase
    .from('brand_reports')
    .update({
      deleted_at: deletedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id,file_name,brand,deleted_at,expires_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: `品牌 ${id} 不存在或已在回收站` };
  return { ok: true, item: normalizeBrand(data) };
}

export async function restoreFromTrash(id) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('brand_reports')
    .update({ deleted_at: null, expires_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('id,file_name,brand')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: `回收站中没有 ${id}` };
  return { ok: true, item: normalizeBrand(data) };
}

export async function purgeTrashItem(id) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('brand_reports')
    .delete()
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('id,file_name')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: `回收站中没有 ${id}` };
  return { ok: true, item: { id: data.id, reportFile: data.file_name } };
}

export async function purgeExpired() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('brand_reports')
    .delete()
    .not('deleted_at', 'is', null)
    .lte('expires_at', new Date().toISOString())
    .select('id,file_name');
  if (error) throw error;
  return { purged: (data || []).map((row) => ({ id: row.id, reportFile: row.file_name })), retainDays: DEFAULT_RETAIN_DAYS };
}

export async function loadSettings() {
  if (!hasSupabaseConfig()) return {};
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('app_settings').select('key,value');
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.key, row.value || '']));
}

export async function saveSettings(values) {
  const rows = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => ({
      key,
      value: String(value),
      is_secret: key === 'apiKey',
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
}

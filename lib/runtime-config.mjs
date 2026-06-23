import { loadSettings } from './supabase-store.mjs';

export const DEFAULT_BRAND_NAME = 'Kiwii';

export async function getRuntimeConfig() {
  let settings = {};
  try {
    settings = await loadSettings();
  } catch {}
  return {
    brandName: process.env.BRAND_NAME || settings.brandName || DEFAULT_BRAND_NAME,
    apiKey: process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || settings.apiKey || '',
    baseUrl: process.env.MINIMAX_BASE_URL || process.env.OPENAI_BASE_URL || settings.baseUrl || '',
    model: process.env.MINIMAX_MODEL || process.env.OPENAI_MODEL || settings.model || '',
  };
}

export function publicConfig(config) {
  return {
    ok: true,
    brandName: config.brandName || DEFAULT_BRAND_NAME,
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    hasApiKey: !!config.apiKey,
  };
}

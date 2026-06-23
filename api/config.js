import { getRuntimeConfig, publicConfig } from '../lib/runtime-config.mjs';
import { saveSettings } from '../lib/supabase-store.mjs';
import { json, methodNotAllowed, readJson } from '../lib/http-api.mjs';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return json(res, 200, publicConfig(await getRuntimeConfig()));
    }
    if (req.method !== 'POST') return methodNotAllowed(res);

    const body = await readJson(req);
    const values = {
      brandName: body.brandName,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model,
    };
    if (!Object.values(values).some((v) => String(v || '').trim())) {
      return json(res, 400, { ok: false, error: '至少需要提供一个字段（brandName / apiKey / baseUrl / model）' });
    }
    await saveSettings(values);
    return json(res, 200, {
      ok: true,
      message: '已保存',
      brandName: values.brandName || (await getRuntimeConfig()).brandName,
      updated: {
        brandName: !!values.brandName,
        apiKey: !!values.apiKey,
        baseUrl: !!values.baseUrl,
        model: !!values.model,
      },
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

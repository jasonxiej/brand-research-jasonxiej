import { runResearch } from '../lib/researcher.mjs';
import { renderReport } from '../lib/report-template.mjs';
import { buildReportEntry } from '../lib/report-entry.mjs';
import { getRuntimeConfig } from '../lib/runtime-config.mjs';
import { saveBrandReport } from '../lib/supabase-store.mjs';
import { json, methodNotAllowed, readJson } from '../lib/http-api.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const events = [];
  const log = (evt) => events.push({ ...evt, ts: Date.now() });

  try {
    const body = await readJson(req);
    const content = String(body.content || body.md || body.markdown || '').trim();
    const brandName = String(body.brandName || body.brand || '').trim();
    if (!content) return json(res, 400, { ok: false, error: 'content 不能为空' });

    const config = await getRuntimeConfig();
    if (!config.apiKey) {
      return json(res, 400, { ok: false, error: '未配置 AI 模型 API Key。请先在设置里填写。' });
    }

    log({ level: 'info', msg: `📄 读取用户提交 Markdown：${brandName || 'brand'}` });
    const result = await runResearch({
      raw: brandName || content.slice(0, 40),
      sourceMarkdown: content,
      onLog: log,
      llmConfig: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      },
    });

    const createdAt = new Date().toISOString().slice(0, 10);
    const date = createdAt.replace(/-/g, '');
    const fileName = `${result.slug}-${date}.html`;
    const id = fileName.replace(/\.html$/i, '');

    const html = renderReport({
      name: result.name,
      url: result.url,
      data: result.data,
      meta: result.meta,
      createdAt,
      userBrand: config.brandName,
    });

    const brand = buildReportEntry({ fileName, result, createdAt });
    await saveBrandReport({ id, fileName, brand, html });

    return json(res, 200, {
      ok: true,
      status: 'done',
      events,
      result: {
        slug: result.slug,
        brand: result.data.name || result.name,
        file: fileName,
        reportUrl: brand.reportUrl,
      },
      reportUrl: brand.reportUrl,
      brand: result.data.name || result.name,
    });
  } catch (e) {
    log({ level: 'error', msg: '✗ 失败: ' + (e.message || e) });
    return json(res, 500, { ok: false, error: e.message || String(e), events });
  }
}

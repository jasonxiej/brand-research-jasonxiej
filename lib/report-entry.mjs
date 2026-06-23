export function buildReportEntry({ fileName, result, createdAt }) {
  const id = fileName.replace(/\.html$/i, '');
  const data = result?.data || {};
  const radar = data.radar || {};
  const radarValues = radar['识别强度'] !== undefined
    ? [radar['克制'], radar['温度感'], radar['游戏化'], radar['科技感'], radar['情感连接'], radar['识别强度']]
    : null;

  return {
    id: data.id || id,
    name: data.name || result?.name || result?.slug || id,
    nameZh: data.nameZh || '',
    url: result?.url || data.url || '',
    tagline: data.tagline || '',
    category: data.category || '',
    country: data.country || '',
    year: data.year || null,
    reportFile: fileName,
    reportUrl: '/api/report?id=' + encodeURIComponent(id),
    createdAt,
    summary: data.summary || '',
    primaryColors: data.primaryColors || [],
    radar,
    radarValues,
    palette: data.palette || [],
    logo: data.logo || {},
    typography: data.typography || {},
    photography: data.photography || {},
    tone: data.tone || [],
    toneSummary: data.toneSummary || '',
    positioning: data.positioning || '',
    targetUser: data.targetUser || {},
    sellingPoints: data.sellingPoints || [],
    meta: data.meta || result?.meta || {},
  };
}

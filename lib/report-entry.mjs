export function buildReportEntry({ fileName, result, createdAt }) {
  const id = fileName.replace(/\.html$/i, '');
  const data = result?.data || {};
  const i18nEn = data.i18n?.en || {};
  const radar = data.radar || {};
  const radarValues = radar['识别强度'] !== undefined
    ? [radar['克制'], radar['温度感'], radar['游戏化'], radar['科技感'], radar['情感连接'], radar['识别强度']]
    : null;

  return {
    id: data.id || id,
    name: data.name || result?.name || result?.slug || id,
    nameZh: data.nameZh || data.name || '',
    nameEn: data.nameEn || i18nEn.name || data.name || '',
    url: result?.url || data.url || '',
    tagline: data.tagline || '',
    taglineEn: i18nEn.tagline || '',
    category: data.category || '',
    categoryEn: i18nEn.category || '',
    country: data.country || '',
    countryEn: i18nEn.country || '',
    year: data.year || null,
    reportFile: fileName,
    reportUrl: '/api/report?id=' + encodeURIComponent(id),
    createdAt,
    summary: data.summary || '',
    summaryEn: i18nEn.summary || '',
    primaryColors: data.primaryColors || [],
    radar,
    radarValues,
    palette: data.palette || [],
    logo: data.logo || {},
    logoEn: i18nEn.logo || {},
    typography: data.typography || {},
    typographyEn: i18nEn.typography || {},
    photography: data.photography || {},
    photographyEn: i18nEn.photography || {},
    tone: data.tone || [],
    toneEn: i18nEn.tone || [],
    toneSummary: data.toneSummary || '',
    toneSummaryEn: i18nEn.toneSummary || '',
    positioning: data.positioning || '',
    positioningEn: i18nEn.positioning || '',
    targetUser: data.targetUser || {},
    targetUserEn: i18nEn.targetUser || {},
    sellingPoints: data.sellingPoints || [],
    sellingPointsEn: i18nEn.sellingPoints || [],
    brandTakeawayEn: i18nEn.brandTakeaway || [],
    meta: data.meta || result?.meta || {},
  };
}

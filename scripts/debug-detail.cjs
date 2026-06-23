const c = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('oura-20260622.html', 'utf8');
const $ = c.load(html);
console.log('detail-item count:', $('.detail-item').length);
$('.detail-item').each((i, el) => {
  const label = $(el).find('.detail-label').text().trim();
  const value = $(el).find('.detail-value').text().trim().slice(0, 100);
  console.log(i, JSON.stringify(label), '|', JSON.stringify(value));
});
console.log('---');
console.log('palette swatch count:', $('.palette .swatch').length);
$('.palette .swatch').each((i, el) => {
  const bg = $(el).find('.swatch-block').attr('style') || '';
  const info = $(el).find('.swatch-info').text().trim();
  console.log(i, bg, '|', info);
});

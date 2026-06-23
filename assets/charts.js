/* Brand Research — Radar Chart (Oura) */
(function () {
  'use strict';
  var container = document.getElementById('radar-chart');
  if (!container || typeof echarts === 'undefined') return;

  var chart = echarts.init(container, null, { renderer: 'canvas' });

  var option = {
    color: ['#1F1F1F'],
    legend: { show: false },
    radar: {
      indicator: [
        { name: '克制度', max: 10 },
        { name: '温度感', max: 10 },
        { name: '游戏化', max: 10 },
        { name: '科技感', max: 10 },
        { name: '情感连接', max: 10 },
        { name: '识别强度', max: 10 }
      ],
      shape: 'polygon',
      splitNumber: 5,
      axisName: {
        color: '#1A1A1A',
        fontFamily: 'InstrumentSans, sans-serif',
        fontSize: 13
      },
      splitLine: { lineStyle: { color: '#E8E0D4' } },
      splitArea: {
        areaStyle: {
          color: ['rgba(251,248,243,0.6)', 'rgba(244,239,230,0.4)', 'rgba(251,248,243,0.6)', 'rgba(244,239,230,0.4)', 'rgba(251,248,243,0.6)']
        }
      },
      axisLine: { lineStyle: { color: '#E8E0D4' } }
    },
    series: [{
      type: 'radar',
      data: [
        {
          value: [9.5, 8.0, 3.0, 7.0, 8.5, 8.5],
          name: 'Oura',
          lineStyle: { width: 2, color: '#1F1F1F' },
          itemStyle: { color: '#1F1F1F' },
          areaStyle: { color: 'rgba(31, 31, 31, 0.12)' }
        }
      ]
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', function () { chart.resize(); });
})();

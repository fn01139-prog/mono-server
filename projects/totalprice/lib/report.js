/**
 * projects/goldprice/lib/report.js
 * 원시 시세 목록(list: [{date, s_pure, p_pure, s_18k, p_18k, s_14k, p_14k,
 * s_white, p_white, s_silver, p_silver}, ...])을 통계/차트용 데이터로 가공한다.
 */
const SERIES = [
  { key: 'pure', label: '순금(24K)' },
  { key: '18k', label: '18K' },
  { key: '14k', label: '14K' },
  { key: 'white', label: '화이트골드' },
  { key: 'silver', label: '은' },
];
const COLORS = ['#c9962c', '#8a7968', '#b08d57', '#5c6b73', '#7d7d7d'];

function stat(values) {
  const first = values[0];
  const last = values[values.length - 1];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const changePct = Number((((last - first) / first) * 100).toFixed(2));
  return { first, last, max, min, avg, changePct };
}

function buildReport(list) {
  // API는 최신순(내림차순)으로 내려주므로, 차트/통계용으로 오름차순 정렬
  const sorted = [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
  const labels = sorted.map(d => d.date.split(' ')[0]);

  const series = SERIES.map((s, i) => {
    const buyValues = sorted.map(d => d[`s_${s.key}`]);
    const sellValues = sorted.map(d => d[`p_${s.key}`]);
    return {
      key: s.key,
      label: s.label,
      color: COLORS[i],
      buy: stat(buyValues),
      sell: stat(sellValues),
      buyData: buyValues,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    periodStart: labels[0] ?? null,
    periodEnd: labels[labels.length - 1] ?? null,
    count: sorted.length,
    labels,
    series,
    rows: sorted,
  };
}

module.exports = { buildReport, SERIES, COLORS };

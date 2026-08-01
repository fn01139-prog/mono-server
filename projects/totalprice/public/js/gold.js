/**
 * projects/totalprice/public/js/gold.js
 * /totalprice/api/gold/report 를 호출해 금/은 시세 탭을 그린다.
 */
(function () {
  const fmt = n => n.toLocaleString('ko-KR') + '원';

  function statCardHtml(s) {
    const dir = s.buy.changePct >= 0 ? 'up' : 'down';
    const sign = s.buy.changePct >= 0 ? '+' : '';
    return `
    <div class="stat-card">
      <h3>${s.label} <span class="unit">(3.75g 기준)</span></h3>
      <div class="stat-row"><span>내가 살 때</span><strong>${fmt(s.buy.last)}</strong></div>
      <div class="stat-row"><span>내가 팔 때</span><strong>${fmt(s.sell.last)}</strong></div>
      <div class="stat-sub">기간 최고 ${fmt(s.buy.max)} · 최저 ${fmt(s.buy.min)} · 평균 ${fmt(s.buy.avg)}</div>
      <div class="stat-change ${dir}">기간 등락률(살 때 기준): ${sign}${s.buy.changePct}%</div>
    </div>`;
  }

  function rowHtml(row) {
    return `<tr>
      <td>${row.date}</td>
      <td>${fmt(row.s_pure)}</td>
      <td>${fmt(row.p_pure)}</td>
      <td>${fmt(row.s_18k)}</td>
      <td>${fmt(row.s_14k)}</td>
      <td>${fmt(row.s_silver)}</td>
    </tr>`;
  }

  function render(data) {
    const generatedAt = new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const staleNote = data.stale ? ' · ⚠️ 실시간 조회 실패, 마지막 캐시 표시 중' : '';
    document.getElementById('meta').textContent =
      `조회 기간: ${data.periodStart} ~ ${data.periodEnd} · 생성 시각: ${generatedAt} · 출처: 한국금거래소(비공식 내부 API)${staleNote}`;

    document.getElementById('statGrid').innerHTML = data.series.map(statCardHtml).join('\n');

    document.getElementById('rowCount').textContent = data.count;
    document.getElementById('dataTableBody').innerHTML = data.rows.map(rowHtml).join('\n');

    const ctx = document.getElementById('priceChart');
    if (window.__goldChart) window.__goldChart.destroy();
    window.__goldChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: data.series.map((s, i) => ({
          label: `${s.label} (살 때)`,
          data: s.buyData,
          borderColor: s.color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 0,
          hidden: i > 0, // 기본은 순금만 표시, 나머지는 범례 클릭으로 on/off
        })),
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: item => `${item.dataset.label}: ${item.formattedValue}원`,
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12 } },
          y: { ticks: { callback: v => v.toLocaleString('ko-KR') + '원' } },
        },
      },
    });
  }

  async function initGoldTab() {
    if (window.__goldLoaded) return;
    window.__goldLoaded = true;
    try {
      const res = await fetch('/totalprice/api/gold/report');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '조회 실패');
      render(json.data);
    } catch (err) {
      document.getElementById('meta').textContent = `시세 조회 실패: ${err.message}`;
    }
  }

  window.initGoldTab = initGoldTab;
})();

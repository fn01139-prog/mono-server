/**
 * projects/totalprice/public/js/stocks.js
 * 종목 검색(select box 형태의 자동완성) + 일별/시간별 시세 조회·렌더링.
 */
(function () {
  let selected = null; // { code, name }
  let mode = 'daily'; // 'daily' | 'intraday'
  let searchTimer = null;

  // 즐겨찾기(최근 검색한 종목) — 브라우저별 localStorage에 최대 10개, 최신순으로 보관
  const FAVORITES_KEY = 'totalprice_recent_stocks';
  const MAX_FAVORITES = 10;

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveFavorite(code, name) {
    const list = loadFavorites().filter(f => f.code !== code);
    list.unshift({ code, name });
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list.slice(0, MAX_FAVORITES)));
    renderFavorites();
  }

  function removeFavorite(code) {
    const list = loadFavorites().filter(f => f.code !== code);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    renderFavorites();
  }

  function renderFavorites() {
    const box = document.getElementById('stockFavorites');
    const list = loadFavorites();
    box.classList.toggle('hidden', list.length === 0);
    box.innerHTML = list
      .map(f => `<span class="favorite-chip" data-code="${f.code}" data-name="${f.name}">
        ${f.name} <span class="code">${f.code}</span>
        <button type="button" class="remove" data-remove="${f.code}" title="즐겨찾기 제거">×</button>
      </span>`)
      .join('');
  }

  const fmtNum = n => (n === null || n === undefined ? '-' : n.toLocaleString('ko-KR'));
  const fmtWon = n => (n === null || n === undefined ? '-' : n.toLocaleString('ko-KR') + '원');

  function changeHtml(change) {
    if (change === null || change === undefined) return '-';
    const cls = change > 0 ? 'price-up' : change < 0 ? 'price-down' : '';
    const sign = change > 0 ? '+' : '';
    return `<span class="${cls}">${sign}${fmtNum(change)}</span>`;
  }

  async function searchStocks(q) {
    const box = document.getElementById('stockSuggestions');
    if (!q) {
      box.classList.remove('open');
      box.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/totalprice/api/stocks/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      const rows = json.success ? json.data : [];
      if (rows.length === 0) {
        box.innerHTML = `<div class="suggestion-empty">검색 결과가 없습니다.</div>`;
      } else {
        box.innerHTML = rows
          .map(r => `<div class="suggestion-item" data-code="${r.code}" data-name="${r.name}">
            <span>${r.name}</span><span class="code">${r.code} · ${r.market}</span>
          </div>`)
          .join('');
      }
      box.classList.add('open');
    } catch (err) {
      box.innerHTML = `<div class="suggestion-empty">검색 실패: ${err.message}</div>`;
      box.classList.add('open');
    }
  }

  function renderDailyTable(rows) {
    document.getElementById('stockTableHead').innerHTML =
      '<tr><th>날짜</th><th>종가</th><th>전일비</th><th>시가</th><th>고가</th><th>저가</th><th>거래량</th></tr>';
    document.getElementById('stockTableBody').innerHTML = rows
      .map(r => `<tr>
        <td>${r.date}</td>
        <td>${fmtWon(r.close)}</td>
        <td>${changeHtml(r.change)}</td>
        <td>${fmtWon(r.open)}</td>
        <td>${fmtWon(r.high)}</td>
        <td>${fmtWon(r.low)}</td>
        <td>${fmtNum(r.volume)}</td>
      </tr>`)
      .join('');
  }

  function renderIntradayTable(rows) {
    document.getElementById('stockTableHead').innerHTML =
      '<tr><th>체결시각</th><th>체결가</th><th>전일비</th><th>매도</th><th>매수</th><th>거래량</th><th>변동량</th></tr>';
    document.getElementById('stockTableBody').innerHTML = rows
      .map(r => `<tr>
        <td>${r.time}</td>
        <td>${fmtWon(r.price)}</td>
        <td>${changeHtml(r.change)}</td>
        <td>${fmtWon(r.ask)}</td>
        <td>${fmtWon(r.bid)}</td>
        <td>${fmtNum(r.volume)}</td>
        <td>${fmtNum(r.diff)}</td>
      </tr>`)
      .join('');
  }

  function renderChart(labels, values, label) {
    const ctx = document.getElementById('stockChart');
    if (window.__stockChart) window.__stockChart.destroy();
    window.__stockChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data: values,
          borderColor: '#2f6ea8',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: item => `${item.formattedValue}원` } },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12 } },
          y: { ticks: { callback: v => v.toLocaleString('ko-KR') + '원' } },
        },
      },
    });
  }

  async function loadAndRender() {
    if (!selected) return;
    document.getElementById('stockTitle').innerHTML =
      `${selected.name} <span class="code">${selected.code}</span>`;
    document.getElementById('stockRowCount').textContent = '...';

    try {
      if (mode === 'daily') {
        const res = await fetch(`/totalprice/api/stocks/${selected.code}/daily?pages=6`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const rows = json.data.rows;
        document.getElementById('stockRowCount').textContent = rows.length;
        // 차트는 시간순(과거→최근)이 맞아야 왼쪽에서 오른쪽으로 자연스럽게 그려지므로 rows를
        // 그대로 쓰고, "전체 데이터 보기" 표는 최신 날짜가 먼저 보이도록 뒤집은 사본을 쓴다.
        renderDailyTable([...rows].reverse());
        renderChart(rows.map(r => r.date), rows.map(r => r.close), '종가');
      } else {
        const res = await fetch(`/totalprice/api/stocks/${selected.code}/intraday?pages=5`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const rows = json.data.rows;
        document.getElementById('stockRowCount').textContent = rows.length;
        renderIntradayTable([...rows].reverse());
        renderChart(rows.map(r => r.time), rows.map(r => r.price), '체결가');
      }
    } catch (err) {
      document.getElementById('stockTitle').innerHTML =
        `${selected.name} <span class="code">${selected.code}</span> — 조회 실패: ${err.message}`;
    }
  }

  const SENTIMENT_LABEL = { positive: '긍정적', neutral: '중립적', negative: '부정적' };

  function insightList(items) {
    if (!items || items.length === 0) return '<p class="insight-empty">해당 없음</p>';
    return `<ul>${items.map(x => `<li>${x}</li>`).join('')}</ul>`;
  }

  function renderInsight(data) {
    const panel = document.getElementById('insightPanel');
    const sentiment = data.analysis.sentiment || 'neutral';
    panel.innerHTML = `
      <div class="insight-header">
        <span class="insight-badge ${sentiment}">${SENTIMENT_LABEL[sentiment] || '중립적'}</span>
        <span class="insight-meta">${new Date(data.generatedAt).toLocaleString('ko-KR')} · ${data.model}</span>
      </div>
      <p class="insight-summary">${data.analysis.summary || ''}</p>
      <div class="insight-cols">
        <div><h4>긍정적으로 볼 수 있는 요인</h4>${insightList(data.analysis.positiveFactors)}</div>
        <div><h4>리스크로 볼 수 있는 요인</h4>${insightList(data.analysis.riskFactors)}</div>
      </div>
      <div><h4>앞으로 참고할 점</h4>${insightList(data.analysis.watchPoints)}</div>
      <p class="insight-disclaimer">${data.disclaimer}</p>
    `;
  }

  // 서버(aiAdvisor.js)가 Anthropic 에러 타입을 errorCode로 분류해서 내려준다.
  // billing_error(크레딧/요금 부족)만 충전 링크를 따로 보여주고, 나머지는 메시지 그대로 표시.
  function renderInsightError(json) {
    const panel = document.getElementById('insightPanel');
    const code = json.errorCode;
    const retryable = ['rate_limit_error', 'overloaded_error', 'server_error', 'connection_error'].includes(code);

    if (code === 'billing_error') {
      panel.innerHTML = `
        <div class="insight-error">
          <strong>💳 AI 호출 요금이 부족합니다</strong>
          <p>${json.error}</p>
          <a class="btn-insight" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Anthropic 콘솔에서 충전하기 ↗</a>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div class="insight-error">
        <strong>AI 분석 실패</strong>
        <p>${json.error}</p>
        ${retryable ? '<p class="insight-meta">잠시 후 다시 시도해보세요.</p>' : ''}
      </div>`;
  }

  async function loadInsight() {
    if (!selected) return;
    const panel = document.getElementById('insightPanel');
    const btn = document.getElementById('insightBtn');
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="insight-loading">AI가 시세/뉴스를 분석하고 있습니다… (몇 초 정도 걸릴 수 있어요)</div>';
    btn.disabled = true;
    try {
      const res = await fetch(`/totalprice/api/stocks/${selected.code}/insight`);
      const json = await res.json();
      if (!json.success) return renderInsightError(json);
      renderInsight(json.data);
    } catch (err) {
      panel.innerHTML = `<div class="insight-error"><strong>AI 분석 실패</strong><p>${err.message}</p></div>`;
    } finally {
      btn.disabled = false;
    }
  }

  function selectStock(code, name) {
    selected = { code, name };
    document.getElementById('stockSearchInput').value = `${name} (${code})`;
    document.getElementById('stockSuggestions').classList.remove('open');
    document.getElementById('stockEmpty').classList.add('hidden');
    document.getElementById('stockContent').classList.remove('hidden');
    const panel = document.getElementById('insightPanel');
    panel.classList.add('hidden');
    panel.innerHTML = '';
    saveFavorite(code, name);
    loadAndRender();
  }

  function initStocksTab() {
    if (window.__stocksWired) return;
    window.__stocksWired = true;

    const input = document.getElementById('stockSearchInput');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      searchTimer = setTimeout(() => searchStocks(q), 250);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.stock-search')) {
        document.getElementById('stockSuggestions').classList.remove('open');
      }
    });
    document.getElementById('stockSuggestions').addEventListener('click', e => {
      const item = e.target.closest('.suggestion-item');
      if (!item || !item.dataset.code) return;
      selectStock(item.dataset.code, item.dataset.name);
    });

    document.getElementById('stockFavorites').addEventListener('click', e => {
      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn) {
        removeFavorite(removeBtn.dataset.remove);
        return;
      }
      const chip = e.target.closest('.favorite-chip');
      if (chip) selectStock(chip.dataset.code, chip.dataset.name);
    });
    renderFavorites();

    document.getElementById('modeDaily').addEventListener('click', () => setMode('daily'));
    document.getElementById('modeIntraday').addEventListener('click', () => setMode('intraday'));
    document.getElementById('insightBtn').addEventListener('click', loadInsight);
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    document.getElementById('modeDaily').classList.toggle('active', mode === 'daily');
    document.getElementById('modeIntraday').classList.toggle('active', mode === 'intraday');
    loadAndRender();
  }

  window.initStocksTab = initStocksTab;
})();

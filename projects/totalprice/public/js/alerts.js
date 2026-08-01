/**
 * projects/totalprice/public/js/alerts.js
 * AI 참고 자료 알림 예약(종목/주기/시간/알림채널) 등록 화면.
 * 주기 선택에 따라 필요한 하위 입력(요일/시간/분)만 보여준다.
 * 실제 발송은 core/jobs/totalprice-alert-runner.js(플랫폼 공통 배치잡)가 담당한다.
 */
(function () {
  const CHANNEL_LABEL = { telegram: '텔레그램', discord: '디스코드', ntfy: 'ntfy', webpush: '웹푸시' };
  const WEEKDAY_LABEL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

  let selectedStock = null; // { code, name }
  let searchTimer = null;

  function fmtDate(s) {
    return s ? new Date(s).toLocaleString('ko-KR') : '-';
  }

  function scheduleLabel(a) {
    if (a.frequency === 'hourly') return `매시간 ${String(a.run_minute).padStart(2, '0')}분`;
    if (a.frequency === 'weekly') return `매주 ${WEEKDAY_LABEL[a.run_weekday]} ${a.run_time}`;
    return `매일 ${a.run_time}`;
  }

  async function loadApis() {
    const json = await fetch('/totalprice/api/alerts/apis').then(r => r.json());
    const select = document.getElementById('alertApiSelect');
    select.innerHTML = (json.data || []).map(a => `<option value="${a.key}">${a.label}</option>`).join('');
  }

  async function loadChannels() {
    const json = await fetch('/totalprice/api/alerts/channels').then(r => r.json());
    const select = document.getElementById('alertChannelSelect');
    const rows = json.data || [];
    if (rows.length === 0) {
      select.innerHTML = `<option value="">연결된 알림 채널이 없습니다</option>`;
      select.disabled = true;
    } else {
      select.disabled = false;
      select.innerHTML = rows.map(c => `<option value="${c.type}">${c.label}</option>`).join('');
    }
  }

  async function searchAlertStocks(q) {
    const box = document.getElementById('alertStockSuggestions');
    if (!q) {
      box.classList.remove('open');
      box.innerHTML = '';
      return;
    }
    const json = await fetch(`/totalprice/api/stocks/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    const rows = json.success ? json.data : [];
    box.innerHTML = rows.length
      ? rows.map(r => `<div class="suggestion-item" data-code="${r.code}" data-name="${r.name}">
          <span>${r.name}</span><span class="code">${r.code} · ${r.market}</span>
        </div>`).join('')
      : `<div class="suggestion-empty">검색 결과가 없습니다.</div>`;
    box.classList.add('open');
  }

  async function loadAlerts() {
    const json = await fetch('/totalprice/api/alerts').then(r => r.json());
    const rows = json.data || [];
    const tbody = document.getElementById('alertListBody');
    tbody.innerHTML = rows.length
      ? rows.map(a => `<tr data-id="${a.id}">
          <td>${a.stock_name || a.code} <span class="code">${a.code}</span></td>
          <td>${a.api_key}</td>
          <td>${scheduleLabel(a)}</td>
          <td>${CHANNEL_LABEL[a.notify_channel] || a.notify_channel}</td>
          <td>
            <label class="alert-toggle-label">
              <input type="checkbox" class="alert-toggle" ${a.is_active ? 'checked' : ''} />
              ${a.is_active ? '활성' : '중지'}
            </label>
          </td>
          <td>${fmtDate(a.last_run_at)}${a.last_status === 'error' ? ' <span class="price-down">(실패)</span>' : ''}</td>
          <td><button class="alert-delete" type="button">삭제</button></td>
        </tr>`).join('')
      : `<tr><td colspan="7" class="insight-empty">등록된 알림이 없습니다.</td></tr>`;
  }

  function setMsg(text, type) {
    const msg = document.getElementById('alertFormMsg');
    msg.textContent = text;
    msg.className = `alert-form-msg ${type || ''}`;
  }

  // 주기 선택에 따라 필요한 하위 입력(요일/시간/분)만 보여준다.
  function applyFrequencyVisibility() {
    const frequency = document.getElementById('alertFrequencySelect').value;
    document.getElementById('weekdayRow').classList.toggle('hidden', frequency !== 'weekly');
    document.getElementById('timeRow').classList.toggle('hidden', frequency === 'hourly');
    document.getElementById('minuteRow').classList.toggle('hidden', frequency !== 'hourly');
  }

  async function submitAlert() {
    setMsg('', '');
    if (!selectedStock) return setMsg('종목을 검색해서 선택하세요.', 'error');

    const channelSelect = document.getElementById('alertChannelSelect');
    if (!channelSelect.value) {
      return setMsg('연결된 알림 채널이 없습니다. 먼저 "🔔 알림 설정"에서 채널을 연결하세요.', 'error');
    }

    const frequency = document.getElementById('alertFrequencySelect').value;
    const body = {
      apiKey: document.getElementById('alertApiSelect').value,
      code: selectedStock.code,
      stockName: selectedStock.name,
      frequency,
      notifyChannel: channelSelect.value,
    };
    if (frequency === 'daily') {
      body.runTime = document.getElementById('alertTimeInput').value;
    } else if (frequency === 'weekly') {
      body.runTime = document.getElementById('alertTimeInput').value;
      body.runWeekday = Number(document.getElementById('alertWeekdaySelect').value);
    } else if (frequency === 'hourly') {
      body.runMinute = Number(document.getElementById('alertMinuteSelect').value);
    }

    try {
      const res = await fetch('/totalprice/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setMsg('알림이 등록되었습니다.', 'success');
      document.getElementById('alertStockInput').value = '';
      selectedStock = null;
      loadAlerts();
    } catch (err) {
      setMsg(`등록 실패: ${err.message}`, 'error');
    }
  }

  function initAlertsTab() {
    if (window.__alertsWired) {
      loadAlerts();
      return;
    }
    window.__alertsWired = true;

    loadApis();
    loadChannels();
    loadAlerts();
    applyFrequencyVisibility();

    document.getElementById('alertFrequencySelect').addEventListener('change', applyFrequencyVisibility);

    const input = document.getElementById('alertStockInput');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      selectedStock = null;
      const q = input.value.trim();
      searchTimer = setTimeout(() => searchAlertStocks(q), 250);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.alert-stock-search')) {
        document.getElementById('alertStockSuggestions').classList.remove('open');
      }
    });
    document.getElementById('alertStockSuggestions').addEventListener('click', e => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      selectedStock = { code: item.dataset.code, name: item.dataset.name };
      input.value = `${item.dataset.name} (${item.dataset.code})`;
      document.getElementById('alertStockSuggestions').classList.remove('open');
    });

    document.getElementById('alertSubmitBtn').addEventListener('click', submitAlert);

    document.getElementById('alertListBody').addEventListener('click', async e => {
      if (!e.target.classList.contains('alert-delete')) return;
      const row = e.target.closest('tr');
      if (!row || !confirm('이 알림을 삭제할까요?')) return;
      await fetch(`/totalprice/api/alerts/${row.dataset.id}`, { method: 'DELETE' });
      loadAlerts();
    });

    document.getElementById('alertListBody').addEventListener('change', async e => {
      if (!e.target.classList.contains('alert-toggle')) return;
      const row = e.target.closest('tr');
      await fetch(`/totalprice/api/alerts/${row.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: e.target.checked }),
      });
      loadAlerts();
    });
  }

  window.initAlertsTab = initAlertsTab;
})();

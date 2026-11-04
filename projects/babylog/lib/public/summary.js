(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const params = new URLSearchParams(location.search);
  const RN = window.ReactNativeWebView;            // Expo 앱 안에서 열렸는지
  const embed = !!RN || params.get('embed') === '1';
  const AUTH_KEY = 'babylog.auth', BABY_KEY = 'babylog.baby';

  const TYPE_LABEL = { feeding: '수유·식사', diaper: '기저귀', sleep: '수면', medicine: '투약', bath: '목욕', etc: '기타' };
  const KIND_LABEL = { formula: '분유', breast: '모유', solid: '이유식', milk: '우유', snack: '간식', unknown: '', pee: '소변', poo: '대변', both: '소변+대변', sleep: '잠듦', wake: '깸' };
  const COLOR = { sleep: 'var(--sleep)', feeding: 'var(--feed)', diaper: 'var(--diaper)', medicine: 'var(--other)', bath: 'var(--other)', etc: 'var(--other)' };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = (msg) => { if (RN) RN.postMessage(JSON.stringify(msg)); };

  // ---------- 날짜 (기기 시간대 기준) ----------
  const tzMin = -new Date().getTimezoneOffset();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  function shiftDate(s, days) { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + days)); }
  function dateLabel(s) { const [y, m, d] = s.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return `${m}월 ${d}일 (${WEEK[w]})`; }
  const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function dur(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
  }
  function ago(min) {
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    if (min < 1440) return `${dur(min)} 전`;
    return `${Math.floor(min / 1440)}일 전`;
  }

  let date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : todayStr();
  let babyId = params.get('baby') || store.get(BABY_KEY, null);
  let metric = 'ml';
  const VIEW_KEY = 'babylog.summaryView';
  let view = params.get('view') === 'pattern' ? 'pattern' : store.get(VIEW_KEY, 'day') === 'pattern' ? 'pattern' : 'day';
  let pdata = null;
  let data = null;

  // ---------- 인증 ----------
  // 앱: 네이티브가 window.__BABYLOG__.accessToken 을 주입, 만료 시 window.__babylogSetToken() 으로 교체
  // 웹: PWA 로그인 정보(localStorage) 사용, 만료 시 refresh
  const token = () => window.__BABYLOG__?.accessToken || store.get(AUTH_KEY, null)?.accessToken;
  let tokenWaiters = [];
  window.__babylogSetToken = (t) => {
    window.__BABYLOG__ = { ...(window.__BABYLOG__ || {}), accessToken: t };
    tokenWaiters.forEach((r) => r(true)); tokenWaiters = [];
  };
  window.__babylogNavigate = (opt = {}) => {      // 네이티브에서 아기/날짜 변경
    if (opt.baby) babyId = opt.baby;
    if (opt.date) date = opt.date;
    load();
  };

  function waitForNativeToken() {
    return new Promise((resolve) => {
      tokenWaiters.push(resolve);
      post({ type: 'auth-expired' });
      setTimeout(() => resolve(false), 10000);
    });
  }

  async function refreshWeb() {
    const auth = store.get(AUTH_KEY, null);
    if (!auth?.refreshToken) return false;
    const res = await fetch('api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: auth.refreshToken }) });
    if (!res.ok) return false;
    store.set(AUTH_KEY, await res.json());
    return true;
  }

  async function api(path, retried) {
    const res = await fetch(path, { headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
    if (res.status === 401 && !retried) {
      const ok = RN ? await waitForNativeToken() : await refreshWeb();
      if (ok) return api(path, true);
      if (!RN) location.href = './';              // 웹: 로그인 화면으로
      throw new Error('로그인이 필요합니다');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '불러오기 실패');
    return body;
  }

  // ---------- 로드 ----------
  async function load() {
    $('err').hidden = true;
    document.querySelector('main').classList.add('skeleton');
    try {
      if (!embed) await loadBabies();
      if (!babyId) throw new Error('아기를 먼저 등록해 주세요.');
      if (view === 'pattern') {
        pdata = await api(`api/babies/${encodeURIComponent(babyId)}/patterns?end=${date}&days=14&tz=${tzMin}`);
        renderPattern();
      } else {
        data = await api(`api/babies/${encodeURIComponent(babyId)}/summary?date=${date}&tz=${tzMin}`);
        render();
      }
      post({ type: 'loaded', date, babyId });
    } catch (e) {
      $('err').textContent = e.message; $('err').hidden = false;
    } finally {
      document.querySelector('main').classList.remove('skeleton');
    }
  }

  let babiesLoaded = false;
  async function loadBabies() {
    if (babiesLoaded) return;
    const me = await api('api/me');
    babiesLoaded = true;
    if (!me.babies.find((b) => b.id === babyId)) babyId = me.babies[0]?.id || null;
    const sel = $('babySel');
    if (me.babies.length > 1) {
      sel.innerHTML = me.babies.map((b) => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
      sel.hidden = false;
      $('babyName').hidden = true;
    }
  }
  $('babySel').addEventListener('change', (e) => { babyId = e.target.value; store.set(BABY_KEY, babyId); load(); });

  // ---------- 렌더 ----------
  function render() {
    const d = data, t = d.totals;
    $('babyName').textContent = d.baby.name;
    $('babyAge').textContent = d.baby.age_days > 0 ? `D+${d.baby.age_days}` : '';
    $('dateLabel').innerHTML = esc(dateLabel(d.date)) + (d.is_today ? '<span class="today">오늘</span>' : '');
    $('nextBtn').disabled = d.date >= todayStr();
    document.title = `${d.baby.name} · ${dateLabel(d.date)}`;

    // 지금 상태 (오늘만)
    const nowCard = $('nowCard');
    if (d.is_today) {
      const rows = [];
      if (d.sleeping_now) rows.push(['sleep', `<b>자는 중</b> ${dur(d.sleeping_now.minutes)}째`, `${hm(d.sleeping_now.since)}부터`]);
      if (d.last.feeding) rows.push(['feeding', `마지막 수유 <b>${ago(d.last.feeding.minutes_ago)}</b>`, amountText(d.last.feeding)]);
      if (d.last.diaper) rows.push(['diaper', `마지막 기저귀 <b>${ago(d.last.diaper.minutes_ago)}</b>`, KIND_LABEL[d.last.diaper.detail?.kind] || '']);
      nowCard.innerHTML = rows.map(([type, main, side]) => `<div class="now-row"><span class="sw" style="background:${COLOR[type]}"></span><span>${main}</span><span class="muted">${esc(side)}</span></div>`).join('');
      nowCard.hidden = !rows.length;
    } else nowCard.hidden = true;

    // 합계 타일
    const kinds = t.feeding.by_kind;
    const feedSub = [kinds.formula && `분유 ${kinds.formula}`, kinds.breast && `모유 ${kinds.breast}`, kinds.solid && `이유식 ${kinds.solid}`].filter(Boolean).join(' · ');
    $('tiles').innerHTML = [
      tile('feeding', '수유량', `${fmtNum(t.feeding.ml)}<small>ml</small>`, `${t.feeding.count}회${feedSub ? ' · ' + feedSub : ''}`),
      tile('feeding', '이유식', `${fmtNum(t.feeding.solid_g)}<small>g</small>`, t.feeding.breast_min ? `모유 직수 ${dur(t.feeding.breast_min)}` : ' '),
      tile('diaper', '기저귀', `${t.diaper.count}<small>회</small>`, `소변 ${t.diaper.pee} · 대변 ${t.diaper.poo}`),
      tile('sleep', '수면', sleepVal(t.sleep.total_min), t.sleep.nap_min ? `낮잠 ${dur(t.sleep.nap_min)}` : ' '),
    ].join('');

    renderTimeline();
    renderTrend();
    renderEvents();
  }

  const fmtNum = (n) => Math.round(n).toLocaleString('ko-KR');
  function sleepVal(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}<small>시간</small>${m ? ` ${m}<small>분</small>` : ''}` : `${m}<small>분</small>`; }
  function tile(type, lbl, val, sub) {
    return `<div class="tile"><div class="lbl"><span class="sw" style="background:${COLOR[type]}"></span>${lbl}</div><div class="val">${val}</div><div class="sub">${esc(sub)}</div></div>`;
  }
  function amountText(e) {
    const k = KIND_LABEL[e.detail?.kind] || '';
    const a = e.amount != null ? `${e.amount}${e.unit || ''}` : '';
    return [k, a, e.detail?.food].filter(Boolean).join(' ');
  }
  function eventText(e) {
    if (e.type === 'feeding') return [KIND_LABEL[e.detail?.kind], e.amount != null ? `${e.amount}${e.unit || ''}` : '', e.detail?.food, e.detail?.duration_min ? `${e.detail.duration_min}분` : ''].filter(Boolean).join(' ');
    if (e.type === 'diaper') return [KIND_LABEL[e.detail?.kind], e.detail?.note].filter(Boolean).join(' · ');
    if (e.type === 'sleep') return [KIND_LABEL[e.detail?.kind], e.detail?.nap ? '낮잠' : '', e.detail?.duration_min ? dur(e.detail.duration_min) : ''].filter(Boolean).join(' ');
    if (e.type === 'medicine') return [e.detail?.name, e.amount != null ? `${e.amount}${e.unit || ''}` : ''].filter(Boolean).join(' ');
    return e.detail?.memo || '';
  }

  // ---------- SVG 헬퍼 + 툴팁 ----------
  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function tipFor(container) {
    let tip = container.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; container.appendChild(tip); }
    return {
      show(html, x, y) { tip.innerHTML = html; tip.hidden = false; const w = container.clientWidth; tip.style.left = Math.min(Math.max(x, 70), w - 70) + 'px'; tip.style.top = y + 'px'; },
      hide() { tip.hidden = true; },
    };
  }
  function bindHit(node, tip, html, x, y) {
    const show = (ev) => { ev.stopPropagation(); tip.show(html, x, y); };
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointerdown', show);
    node.addEventListener('pointerleave', () => tip.hide());
  }
  document.addEventListener('pointerdown', () => document.querySelectorAll('.tip').forEach((t) => { t.hidden = true; }));

  // ---------- 24시간 타임라인 ----------
  function renderTimeline() {
    const box = $('timeline');
    box.innerHTML = '';
    const W = box.clientWidth || 340, L = 56, R = 8, laneH = 34, top = 6;
    const lanes = [['sleep', '수면'], ['feeding', '수유'], ['diaper', '기저귀'], ['other', '기타']];
    const H = top + lanes.length * laneH + 22;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': '24시간 타임라인' }, box);
    const tip = tipFor(box);
    const [y0, m0, d0] = data.date.split('-').map(Number);
    const dayStart = new Date(y0, m0 - 1, d0).getTime(), DAY = 86400000;
    const x = (ms) => L + ((ms - dayStart) / DAY) * (W - L - R);
    const laneY = (i) => top + i * laneH + laneH / 2;

    // 격자 (3시간 간격, 6시간마다 라벨)
    for (let h = 0; h <= 24; h += 3) {
      const gx = x(dayStart + h * 3600000);
      el('line', { x1: gx, x2: gx, y1: top, y2: top + lanes.length * laneH, stroke: h % 6 ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }, svg);
      if (h % 6 === 0) el('text', { x: gx, y: H - 6, 'text-anchor': h === 0 ? 'start' : h === 24 ? 'end' : 'middle' }, svg).textContent = h === 24 ? '24시' : `${h}시`;
    }
    lanes.forEach(([, name], i) => {
      el('text', { x: 0, y: laneY(i) + 4, class: 'lane-lbl' }, svg).textContent = name;
      if (i) el('line', { x1: L, x2: W - R, y1: top + i * laneH, y2: top + i * laneH, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    });

    // 지금 시각 표시
    if (data.is_today) {
      const nx = x(Date.now());
      el('line', { x1: nx, x2: nx, y1: top - 2, y2: top + lanes.length * laneH, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
    }

    // 수면 구간 막대
    for (const s of data.sleep_sessions) {
      const a = Math.max(new Date(s.start).getTime(), dayStart), b = Math.min(new Date(s.end).getTime(), dayStart + DAY);
      const bx = x(a), bw = Math.max(x(b) - bx, 4);
      el('rect', { x: bx, y: laneY(0) - 7, width: bw, height: 14, rx: 4, fill: COLOR.sleep }, svg);
      const hit = el('rect', { x: bx, y: laneY(0) - 16, width: Math.max(bw, 24), height: 32, fill: 'transparent', class: 'hit' }, svg);
      bindHit(hit, tip, `${s.nap ? '낮잠' : '수면'} ${hm(s.start)}–${s.ongoing ? '지금' : hm(s.end)}<br>${dur(s.minutes)}`, bx + bw / 2, laneY(0) - 8);
    }

    // 이벤트 점
    const laneOf = (e) => (e.type === 'feeding' ? 2 : e.type === 'diaper' ? 3 : e.type === 'sleep' ? 0 : 4) - 1;
    for (const e of data.events) {
      if (e.type === 'sleep') continue; // 막대로 표시
      const i = laneOf(e);
      const cx = x(new Date(e.time).getTime()), cy = laneY(i);
      el('circle', { cx, cy, r: 5.5, fill: COLOR[e.type], stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      const hit = el('circle', { cx, cy, r: 14, fill: 'transparent', class: 'hit' }, svg);
      bindHit(hit, tip, `${hm(e.time)} ${TYPE_LABEL[e.type]}<br>${esc(eventText(e)) || '&nbsp;'}`, cx, cy - 6);
    }
  }

  // ---------- 7일 추이 (단일 계열 막대) ----------
  const METRIC = {
    ml: { color: 'feeding', fmt: (v) => `${fmtNum(v)}ml`, axis: (v) => fmtNum(v) },
    diapers: { color: 'diaper', fmt: (v) => `${v}회`, axis: (v) => String(v) },
    sleep_min: { color: 'sleep', fmt: (v) => dur(v), axis: (v) => `${Math.round(v / 60)}h` },
  };
  document.querySelectorAll('#metricSeg button').forEach((b) => b.addEventListener('click', () => {
    metric = b.dataset.m;
    document.querySelectorAll('#metricSeg button').forEach((x) => x.classList.toggle('on', x === b));
    renderTrend();
  }));

  function niceMax(v, unitStep) {
    if (v <= 0) return unitStep;
    const raw = v / 3, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return Math.max(Math.ceil(v / step) * step, unitStep);
  }

  function renderTrend() {
    const box = $('trend');
    box.innerHTML = '';
    const M = METRIC[metric];
    const vals = data.trend.map((d) => d[metric]);
    const unitStep = metric === 'sleep_min' ? 180 : metric === 'diapers' ? 3 : 100;
    const max = niceMax(Math.max(...vals), unitStep);
    const W = box.clientWidth || 340, L = 40, R = 4, top = 20, ph = 120, H = top + ph + 34;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': '최근 7일 추이' }, box);
    const tip = tipFor(box);
    const y = (v) => top + ph - (v / max) * ph;

    // y 격자 3칸
    for (let i = 0; i <= 3; i++) {
      const v = (max / 3) * i, gy = y(v);
      el('line', { x1: L, x2: W - R, y1: gy, y2: gy, stroke: i ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }, svg);
      el('text', { x: L - 6, y: gy + 4, 'text-anchor': 'end' }, svg).textContent = M.axis(v);
    }

    const slot = (W - L - R) / 7, bw = Math.min(28, slot - 2);
    data.trend.forEach((d, i) => {
      const cx = L + slot * i + slot / 2, v = d[metric];
      const sel = d.date === data.date;
      if (v > 0) {
        const bx = cx - bw / 2, by = y(v), bh = top + ph - by, r = Math.min(4, bh);
        // 위쪽만 4px 둥글게, 바닥은 기준선에 붙임
        el('path', { d: `M${bx},${top + ph} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${top + ph} Z`, fill: COLOR[M.color] }, svg);
      }
      if (sel && v > 0) el('text', { x: cx, y: y(v) - 6, 'text-anchor': 'middle', class: 'val-lbl' }, svg).textContent = M.fmt(v);
      const [, mm, dd] = d.date.split('-').map(Number);
      const w = WEEK[new Date(+d.date.slice(0, 4), mm - 1, dd).getDay()];
      const t1 = el('text', { x: cx, y: top + ph + 16, 'text-anchor': 'middle' }, svg);
      t1.textContent = `${dd}`;
      if (sel) { t1.setAttribute('class', 'val-lbl'); }
      el('text', { x: cx, y: top + ph + 30, 'text-anchor': 'middle' }, svg).textContent = w;
      // 터치 영역: 막대 전체 칸 → 탭하면 그날로 이동
      const hit = el('rect', { x: cx - slot / 2, y: top, width: slot, height: ph + 34, fill: 'transparent', class: 'hit' }, svg);
      bindHit(hit, tip, `${mm}/${dd} (${w}) ${M.fmt(v)}`, cx, Math.min(y(v), top + ph) - 4);
      hit.addEventListener('click', () => { if (d.date !== data.date) { date = d.date; load(); } });
    });
  }

  // ---------- 기록 표 (표 보기 = 접근성 대체 수단) ----------
  function renderEvents() {
    const rows = data.events.slice().reverse();
    $('eventCount').textContent = rows.length ? `${rows.length}건` : '';
    $('eventRows').innerHTML = rows.length
      ? rows.map((e) => `<tr><td class="t">${hm(e.time)}</td><td><span class="sw" style="background:${COLOR[e.type]}"></span>${TYPE_LABEL[e.type]} ${esc(eventText(e))}
          ${e.recorded_by_name ? `<div class="by">${esc(e.recorded_by_name)}${e.approx_time ? ' · 대략' : ''}</div>` : ''}</td></tr>`).join('')
      : '<tr><td class="empty" colspan="2">이 날은 기록이 없어요.</td></tr>';
  }

  // ---------- 패턴 (최근 14일) ----------
  const hhmmOf = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const shortDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}/${d}`; };
  const wkOf = (s) => WEEK[new Date(s + 'T00:00:00Z').getUTCDay()];
  function barPath(x, y, w, h, r) {   // 위쪽만 둥근 막대 (바닥은 기준선에 붙음)
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  }
  function deltaText(a, b, fmt) {
    if (a == null || b == null || a === b) return '';
    return `<div class="delta">이전 7일보다 ${a > b ? '+' : '−'}${fmt(Math.abs(a - b))}</div>`;
  }

  function renderPattern() {
    const p = pdata, r = p.recent, pv = p.previous;
    $('babyName').textContent = p.baby.name;
    $('dateLabel').innerHTML = `${shortDate(p.days[0].date)} ~ ${shortDate(p.end)}` + (p.end === todayStr() ? '<span class="today">최근 14일</span>' : '');
    $('nextBtn').disabled = p.end >= todayStr();
    document.title = `${p.baby.name} · 수면 패턴`;
    const hasAny = p.days.some((d) => d.has_sleep);
    $('pEmpty').hidden = hasAny;
    $('pCaption').hidden = !r;
    const tileP = (type, lbl, val, sub, delta = '') =>
      `<div class="tile"><div class="lbl"><span class="sw" style="background:${type === 'nap' ? 'var(--nap)' : COLOR[type]}"></span>${lbl}</div><div class="val">${val}</div>${delta}<div class="sub">${esc(sub)}</div></div>`;
    const naps = (n) => `${n}회`;
    $('pTiles').innerHTML = r ? [
      tileP('sleep', '하루 수면', sleepVal(r.sleep_min), `밤 ${dur(r.night_min)} · 낮 ${dur(r.nap_min)}`, deltaText(r.sleep_min, pv?.sleep_min, dur)),
      tileP('nap', '낮잠', `${r.naps}<small>회</small>`, `평균 ${dur(r.nap_min)}`, deltaText(r.naps, pv?.naps, (v) => naps(Math.round(v * 10) / 10))),
      tileP('sleep', '깨어 있는 시간', r.wake_avg_min != null ? sleepVal(r.wake_avg_min) : '–', '잠 사이 평균', deltaText(r.wake_avg_min, pv?.wake_avg_min, dur)),
      tileP('sleep', '가장 길게 잔 잠', r.longest_min != null ? sleepVal(r.longest_min) : '–', '하루에 한 번 평균', deltaText(r.longest_min, pv?.longest_min, dur)),
    ].join('') : '';
    renderHeatmap(); renderSleepBars(); renderWakeLine();
  }

  function renderHeatmap() {
    const box = $('heatmap'); box.innerHTML = '';
    const rows = pdata.days.slice().reverse();          // 최근 날이 위로
    const W = box.clientWidth || 340, L = 54, R = 6, rowH = 22, top = 2;
    const H = top + rows.length * rowH + 20;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': '14일 수면 패턴' }, box);
    const tip = tipFor(box);
    const x = (min) => L + (min / 1440) * (W - L - R);
    for (let h = 0; h <= 24; h += 3) {
      const gx = x(h * 60);
      el('line', { x1: gx, x2: gx, y1: top, y2: top + rows.length * rowH, stroke: h % 6 ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }, svg);
      if (h % 6 === 0) el('text', { x: gx, y: H - 5, 'text-anchor': h === 0 ? 'start' : h === 24 ? 'end' : 'middle' }, svg).textContent = `${h}시`;
    }
    rows.forEach((d, i) => {
      const y0 = top + i * rowH;
      const lbl = el('text', { x: 0, y: y0 + 15, class: 'lane-lbl' }, svg);
      lbl.textContent = `${shortDate(d.date)} ${wkOf(d.date)}`;
      if (d.date === pdata.end) lbl.setAttribute('class', 'val-lbl');
      if (d.future) return;
      if (!d.has_sleep && !d.feed_count) {
        el('text', { x: x(720), y: y0 + 15, 'text-anchor': 'middle' }, svg).textContent = '기록 없음';
        return;
      }
      for (const g of d.segments) {
        const bx = x(g.from_min), bw = Math.max(x(g.to_min) - bx, 2);
        el('rect', { x: bx, y: y0 + 4, width: bw, height: rowH - 8, rx: 3, fill: g.nap ? 'var(--nap)' : 'var(--sleep)' }, svg);
        const hit = el('rect', { x: bx, y: y0, width: Math.max(bw, 16), height: rowH, fill: 'transparent', class: 'hit' }, svg);
        bindHit(hit, tip, `${shortDate(d.date)} ${g.nap ? '낮잠' : '잠'} ${hhmmOf(g.from_min)}–${g.ongoing ? '지금' : hhmmOf(g.to_min)}<br>${dur(g.to_min - g.from_min)}`, bx + bw / 2, y0 + 2);
      }
      for (const m of d.feeds) {
        const cx = x(m), cy = y0 + rowH / 2;
        el('circle', { cx, cy, r: 3.5, fill: 'var(--feed)', stroke: 'var(--surface)', 'stroke-width': 1.5 }, svg);
        const hit = el('circle', { cx, cy, r: 10, fill: 'transparent', class: 'hit' }, svg);
        bindHit(hit, tip, `${shortDate(d.date)} 수유 ${hhmmOf(m)}`, cx, cy - 6);
      }
      if (d.partial) {
        const now = new Date(), nx = x(now.getHours() * 60 + now.getMinutes());
        el('line', { x1: nx, x2: nx, y1: y0 + 1, y2: y0 + rowH - 1, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '2 2' }, svg);
      }
    });
  }

  function renderSleepBars() {
    const box = $('sleepBars'); box.innerHTML = '';
    const days = pdata.days;
    const vals = days.filter((d) => d.has_sleep).map((d) => d.sleep_min);
    const peakH = (vals.length ? Math.max(...vals) : 0) / 60;
    const stepH = peakH <= 12 ? 3 : 4;
    const max = Math.max(1, Math.ceil(peakH / stepH)) * stepH * 60;
    const W = box.clientWidth || 340, L = 34, R = 4, top = 10, ph = 130, H = top + ph + 34;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': '하루 수면 시간 (밤잠·낮잠)' }, box);
    const tip = tipFor(box);
    const y = (v) => top + ph - (v / max) * ph, base = top + ph;
    for (let v = 0; v <= max; v += stepH * 60) {
      const gy = y(v);
      el('line', { x1: L, x2: W - R, y1: gy, y2: gy, stroke: v ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }, svg);
      el('text', { x: L - 5, y: gy + 4, 'text-anchor': 'end' }, svg).textContent = `${v / 60}h`;
    }
    const slot = (W - L - R) / days.length, bw = Math.min(18, slot - 4), every = slot < 20 ? 2 : 1;
    days.forEach((d, i) => {
      const cx = L + slot * i + slot / 2, bx = cx - bw / 2;
      if (d.has_sleep && !d.future) {
        const g = el('g', { opacity: d.partial ? 0.45 : 1 }, svg);
        const nh = (d.night_min / max) * ph, gap = d.nap_min && d.night_min ? 2 : 0, nph = (d.nap_min / max) * ph;
        if (nh > 0) el(d.nap_min ? 'rect' : 'path', d.nap_min ? { x: bx, y: base - nh, width: bw, height: nh, fill: 'var(--sleep)' } : { d: barPath(bx, base - nh, bw, nh, 4), fill: 'var(--sleep)' }, g);
        if (nph > 0) el('path', { d: barPath(bx, base - nh - gap - nph, bw, nph, 4), fill: 'var(--nap)' }, g);
      } else if (!d.future) {
        el('text', { x: cx, y: base - 4, 'text-anchor': 'middle' }, svg).textContent = '–';
      }
      if ((days.length - 1 - i) % every === 0) {
        const [, , dd] = d.date.split('-').map(Number);
        const t1 = el('text', { x: cx, y: base + 15, 'text-anchor': 'middle' }, svg); t1.textContent = `${dd}`;
        if (d.date === pdata.end) t1.setAttribute('class', 'val-lbl');
        el('text', { x: cx, y: base + 29, 'text-anchor': 'middle' }, svg).textContent = wkOf(d.date);
      }
      if (d.future) return;
      const hit = el('rect', { x: cx - slot / 2, y: top, width: slot, height: ph + 34, fill: 'transparent', class: 'hit' }, svg);
      const html = d.has_sleep
        ? `${shortDate(d.date)} (${wkOf(d.date)})${d.partial ? ' · 진행 중' : ''}<br>수면 ${dur(d.sleep_min)} · 밤 ${dur(d.night_min)} · 낮 ${dur(d.nap_min)}`
        : `${shortDate(d.date)} 기록 없음`;
      bindHit(hit, tip, html, cx, y(d.has_sleep ? d.sleep_min : 0) - 4);
      hit.addEventListener('click', () => { date = d.date; setView('day'); });
    });
  }

  function renderWakeLine() {
    const box = $('wakeLine'); box.innerHTML = '';
    const days = pdata.days;
    const vals = days.map((d) => (d.future ? null : d.wake_avg_min));
    const present = vals.filter((v) => v != null);
    if (!present.length) { box.innerHTML = '<p class="empty">잠과 잠 사이 기록이 쌓이면 보여요.</p>'; return; }
    const peak = Math.max(...present), stepM = peak <= 150 ? 30 : 60;
    const max = Math.max(1, Math.ceil(peak / stepM)) * stepM;
    const W = box.clientWidth || 340, L = 34, R = 8, top = 12, ph = 100, H = top + ph + 22;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': '깨어 있는 시간 추이' }, box);
    const tip = tipFor(box);
    const slot = (W - L - R) / days.length;
    const x = (i) => L + slot * i + slot / 2, y = (v) => top + ph - (v / max) * ph;
    const every = max / stepM > 4 ? 2 : 1;
    for (let v = 0, k = 0; v <= max; v += stepM, k++) {
      if (k % every && v !== max) continue;
      const gy = y(v);
      el('line', { x1: L, x2: W - R, y1: gy, y2: gy, stroke: v ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }, svg);
      el('text', { x: L - 5, y: gy + 4, 'text-anchor': 'end' }, svg).textContent = v % 60 ? (v < 60 ? `${v}m` : `${Math.floor(v / 60)}h30`) : `${v / 60}h`;
    }
    // 기록 없는 날은 선을 끊음
    let dPath = '', pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } dPath += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
    el('path', { d: dPath, fill: 'none', stroke: 'var(--sleep)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    const cross = el('line', { x1: 0, x2: 0, y1: top, y2: top + ph, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    vals.forEach((v, i) => {
      if (v != null) el('circle', { cx: x(i), cy: y(v), r: 4, fill: 'var(--sleep)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: days[i].partial ? 0.5 : 1 }, svg);
      if (i % (slot < 20 ? 2 : 1) === (days.length - 1) % (slot < 20 ? 2 : 1)) {
        const [, , dd] = days[i].date.split('-').map(Number);
        el('text', { x: x(i), y: H - 5, 'text-anchor': 'middle' }, svg).textContent = `${dd}`;
      }
      if (days[i].future) return;
      const hit = el('rect', { x: x(i) - slot / 2, y: top, width: slot, height: ph, fill: 'transparent', class: 'hit' }, svg);
      const html = v != null ? `${shortDate(days[i].date)} ${dur(v)}<br>잠 사이 ${days[i].wake_count}번 평균${days[i].partial ? ' · 진행 중' : ''}` : `${shortDate(days[i].date)} 기록 없음`;
      bindHit(hit, tip, html, x(i), v != null ? y(v) - 6 : top + ph / 2);
      hit.addEventListener('pointerenter', () => { cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible'); });
      hit.addEventListener('pointerleave', () => cross.setAttribute('visibility', 'hidden'));
    });
  }

  // ---------- 하루 / 패턴 전환 ----------
  function setView(v) {
    view = v; store.set(VIEW_KEY, v);
    document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    $('dayView').hidden = v !== 'day';
    $('patternView').hidden = v !== 'pattern';
    load();
  }
  document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));

  // ---------- 이벤트 ----------
  $('prevBtn').addEventListener('click', () => { date = shiftDate(date, -1); load(); });
  $('nextBtn').addEventListener('click', () => { if (date < todayStr()) { date = shiftDate(date, 1); load(); } });
  $('refreshBtn').addEventListener('click', () => load());
  if (RN) {
    $('recordBtn').hidden = false;
    $('recordBtn').addEventListener('click', () => post({ type: 'open-record', babyId }));
  }
  // 내보내기: 앱에서는 네이티브 공유 시트, 브라우저에서는 파일 다운로드
  $('exportBtn').addEventListener('click', async () => {
    if (!babyId) return;
    if (RN) { post({ type: 'export', babyId, to: date }); return; }
    const btn = $('exportBtn'); btn.disabled = true;
    try {
      const url = `api/babies/${encodeURIComponent(babyId)}/export.csv?to=${date}&tz=${tzMin}`;
      let res = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } });
      if (res.status === 401 && await refreshWeb()) res = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } });
      if (!res.ok) throw new Error('내보내기 실패');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${data?.baby?.name || 'baby'}_${shiftDate(date, -29)}_${date}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { $('err').textContent = e.message; $('err').hidden = false; }
    finally { btn.disabled = false; }
  });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (view === 'pattern' && pdata) renderPattern(); else if (data) { renderTimeline(); renderTrend(); } }, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && data?.is_today) load(); });

  post({ type: 'ready' });
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  $('dayView').hidden = view !== 'day';
  $('patternView').hidden = view !== 'pattern';
  load();
})();

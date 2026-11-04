(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AUTH_KEY = 'babylog.auth';
  const BABY_KEY = 'babylog.baby';

  const TYPE_LABEL = { feeding: '수유·식사', diaper: '기저귀', sleep: '수면', medicine: '투약', bath: '목욕', etc: '기타' };
  const KIND_LABEL = {
    formula: '분유', breast: '모유', solid: '이유식', milk: '우유', snack: '간식', unknown: '',
    pee: '소변', poo: '대변', both: '소변+대변', sleep: '잠듦', wake: '깸',
  };
  const UNITS = ['ml', 'g', '스푼', '그릇', '개'];

  // ---------- localStorage 헬퍼 (실패해도 동작) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let auth = store.get(AUTH_KEY, null); // { accessToken, refreshToken, user }
  let me = null;                         // { user, families, babies }
  let babyId = store.get(BABY_KEY, null);
  let draft = [];
  const queueKey = () => 'babylog.queue.' + (auth?.user?.id || 'anon');

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function setStatus(s) { $('status').textContent = s; }

  // ---------- API (토큰 자동 갱신) ----------
  class ApiError extends Error { constructor(status, body) { super(body.error || 'HTTP ' + status); this.status = status; this.body = body; } }
  let refreshing = null;

  async function refreshTokens() {
    if (!auth?.refreshToken) throw new ApiError(401, { code: 'REFRESH_INVALID' });
    refreshing ||= (async () => {
      const res = await fetch('api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, body);
      auth = body; store.set(AUTH_KEY, auth);
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function api(method, path, body, retried) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth.accessToken } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !retried && auth?.refreshToken && path.indexOf('api/auth/') !== 0) {
      try { await refreshTokens(); } catch (e) {
        if (e.status === 401) { signOut('로그인이 만료됐어요. 다시 로그인해 주세요.'); }
        throw e;
      }
      return api(method, path, body, true);
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  // ---------- 로그인 / 가입 ----------
  let mode = 'login';
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('#authForm .reg').forEach((el) => { el.hidden = mode !== 'register'; });
    $('authForm').password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('authBtn').textContent = mode === 'register' ? '가입하기' : '로그인';
    $('authErr').textContent = '';
  }));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { email: f.email.value.trim(), password: f.password.value };
    if (!body.email || !body.password) { $('authErr').textContent = '이메일과 비밀번호를 입력하세요.'; return; }
    if (mode === 'register') {
      body.name = f.name.value.trim();
      body.inviteCode = f.inviteCode.value.trim();
      if (!body.name) { $('authErr').textContent = '이름을 입력하세요.'; return; }
      if (body.password.length < 8) { $('authErr').textContent = '비밀번호는 8자 이상이에요.'; return; }
    }
    $('authBtn').disabled = true;
    try {
      auth = await api('POST', 'api/auth/' + mode, body);
      store.set(AUTH_KEY, auth);
      f.password.value = '';
      await enterApp();
    } catch (err) {
      $('authErr').textContent = err.body?.error || '서버에 연결할 수 없어요.';
    } finally { $('authBtn').disabled = false; }
  });
  $('authForm').addEventListener('input', () => { $('authErr').textContent = ''; });

  function signOut(msg) {
    const rt = auth?.refreshToken;
    if (rt) fetch('api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => {});
    auth = null; me = null; store.del(AUTH_KEY);
    $('appView').hidden = true; $('authView').hidden = false;
    $('authErr').textContent = msg || '';
  }
  $('logoutBtn').addEventListener('click', () => signOut());

  // ---------- 앱 진입 ----------
  async function enterApp() {
    $('authView').hidden = true; $('appView').hidden = false;
    await loadMe();
    flushQueue();
  }

  async function loadMe() {
    me = await api('GET', 'api/me');
    if (!me.babies.find((b) => b.id === babyId)) babyId = me.babies[0]?.id || null;
    store.set(BABY_KEY, babyId);
    renderHeader();
    renderSettings();
    renderDraft();
    loadRecent();
  }

  function babyName(id) { return me?.babies.find((b) => b.id === id)?.name || '?'; }

  function renderHeader() {
    const sel = $('baby');
    sel.innerHTML = me.babies.length
      ? me.babies.map((b) => `<option value="${b.id}" ${b.id === babyId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')
      : '<option value="">아기 없음</option>';
    const none = !me.babies.length;
    $('mic').disabled = none || !SR;
    $('parseBtn').disabled = none;
    if (none) { $('settings').hidden = false; setStatus('먼저 설정에서 아기를 등록해 주세요.'); }
    $('recentTitle').textContent = none ? '최근 기록' : `${babyName(babyId)} 최근 기록`;
  }

  $('baby').addEventListener('change', (e) => {
    babyId = e.target.value; store.set(BABY_KEY, babyId);
    renderHeader(); loadRecent();
  });

  // ---------- 설정 패널 ----------
  $('settingsBtn').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden; });

  function renderSettings() {
    const fam = me.families[0];
    $('famName').textContent = fam ? `${fam.name} · ${fam.member_count}명` : '가족';
    $('famCode').textContent = fam?.invite_code || '';
    $('meName').textContent = `${me.user.name} (${me.user.email})`;
    $('babyList').innerHTML = me.babies.length
      ? me.babies.map((b) => `<div class="baby-item"><span>${esc(b.name)}</span><span class="muted">${b.birth_date || ''}</span></div>`).join('')
      : '<p class="empty">등록된 아기가 없어요.</p>';
  }

  $('copyCode').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('famCode').textContent); $('copyCode').textContent = '복사됨'; }
    catch { $('copyCode').textContent = '직접 복사'; }
    setTimeout(() => { $('copyCode').textContent = '복사'; }, 1500);
  });

  $('babyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (!name) { $('babyErr').textContent = '이름을 입력하세요.'; return; }
    try {
      const baby = await api('POST', 'api/babies', { name, birth_date: f.birth_date.value || null, family_id: me.families[0]?.id });
      babyId = baby.id; f.reset(); $('babyErr').textContent = '';
      await loadMe();
      setStatus(`${baby.name} 등록 완료. 이제 말해 보세요.`);
    } catch (err) { $('babyErr').textContent = err.body?.error || '등록 실패'; }
  });
  $('babyForm').addEventListener('input', () => { $('babyErr').textContent = ''; });

  $('joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = e.target.inviteCode.value.trim();
    if (!code) { $('joinErr').textContent = '초대 코드를 입력하세요.'; return; }
    try {
      await api('POST', 'api/families/join', { inviteCode: code });
      e.target.reset(); $('joinErr').textContent = '';
      await loadMe();
    } catch (err) { $('joinErr').textContent = err.body?.error || '합류 실패'; }
  });

  // ---------- 음성 인식 ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  if (!SR) {
    $('mic').innerHTML = '음성 인식<br>미지원';
  } else {
    rec = new SR();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 3;
    rec.onstart = () => { listening = true; $('mic').classList.add('listening'); setStatus('듣는 중… 말씀하세요'); };
    rec.onend = () => { listening = false; $('mic').classList.remove('listening'); };
    rec.onerror = (e) => {
      setStatus({ 'no-speech': '말소리가 안 들렸어요. 다시 눌러 주세요.', 'not-allowed': '마이크 권한을 허용해 주세요.', network: '네트워크 오류로 인식하지 못했어요.' }[e.error] || '인식 오류: ' + e.error);
    };
    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += pickBest(r); else interim += r[0].transcript;
      }
      if (interim) setStatus('… ' + interim);
      if (final) { $('text').value = final; setStatus('인식: "' + final + '"'); runParse(final); }
    };
    $('mic').addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      try { rec.start(); } catch {}
    });
  }

  function pickBest(result) {
    const names = (me?.babies || []).map((b) => b.name).join('|');
    const kw = new RegExp('분유|모유|이유식|기저귀|소변|대변|응가|잤|깼|재웠|먹였|해열제|약|목욕|미리|그램' + (names ? '|' + names : ''));
    for (let i = 0; i < result.length; i++) if (kw.test(result[i].transcript)) return result[i].transcript;
    return result[0].transcript;
  }

  // ---------- 파싱 + 아기 지정 ----------
  $('parseBtn').addEventListener('click', () => runParse($('text').value));
  $('text').addEventListener('keydown', (e) => { if (e.key === 'Enter') runParse($('text').value); });

  /** 문장에 아기 이름이 있으면 그 아기로, 없으면 현재 선택된 아기로 */
  function assignBaby(ev) {
    const babies = [...me.babies].sort((a, b) => b.name.length - a.name.length);
    const inSeg = babies.find((b) => ev.segment?.includes(b.name));
    if (inSeg) return inSeg.id;
    const inRaw = babies.filter((b) => ev.raw_text.includes(b.name));
    if (inRaw.length === 1) return inRaw[0].id;
    return babyId;
  }

  // 규칙 파서가 확신 못 하면 서버 AI 보정 시도 (서버에 키가 없으면 501 → 이후 시도 안 함)
  let aiAvailable = true;
  async function aiAssist(text, events) {
    if (!aiAvailable || !events.some((e) => e.confidence === 'low' || e.type === 'etc')) return events;
    setStatus('AI로 다시 해석하는 중…');
    try {
      const r = await api('POST', 'api/parse', { text, baby_id: babyId, tz: -new Date().getTimezoneOffset() });
      if (!r.events.length) return events;
      setStatus('AI가 보정했어요. 확인 후 저장하세요.');
      return r.events.map((e) => ({ ...e, id: newId(), time: BabyParser.toLocalISO(new Date(e.time)) }));
    } catch (err) {
      if (err.status === 501) aiAvailable = false;
      return events;
    }
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- 음성 질문: "마지막으로 언제 먹였어?" ----------
  function speak(s) {
    try {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(s); u.lang = 'ko-KR'; u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch {}
  }
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  async function answerQuestion(q) {
    const baby = me.babies.find((b) => b.name === q.babyName) || me.babies.find((b) => b.id === babyId);
    const d = new Date(); if (q.day === 'yesterday') d.setDate(d.getDate() - 1);
    try {
      let text;
      if (q.intent === 'next_dose') text = BabyQuestion.answer(q, null, '', { medicines: await api('GET', `api/babies/${baby.id}/medicines`) });
      else if (q.intent === 'duty') text = BabyQuestion.answer(q, null, '', { duty: await api('GET', `api/families/${me.families[0].id}/duty`) });
      else {
        const s = await api('GET', `api/babies/${baby.id}/summary?date=${ymd(d)}&tz=${-d.getTimezoneOffset()}`);
        text = BabyQuestion.answer(q, s, me.babies.length > 1 ? baby.name : '');
      }
      $('answer').textContent = text; $('answer').hidden = false;
      setStatus('');
      speak(text);
    } catch { setStatus('답을 가져오지 못했어요.'); }
  }

  async function runParse(text) {
    if (!text.trim() || !me?.babies.length) return;
    $('text').value = '';
    $('answer').hidden = true;
    const q = BabyQuestion.detect(text, me.babies.map((b) => b.name), medNames);
    if (q) return answerQuestion(q);
    let { events } = BabyParser.parse(text);
    events.forEach((ev) => { ev.baby_id = assignBaby(ev); });
    events = await aiAssist(text, events);
    draft = draft.concat(events);
    renderDraft();
  }

  // ---------- 확인 카드 ----------
  function kindOptions(type) {
    return { feeding: ['formula', 'breast', 'solid', 'milk', 'snack', 'unknown'], diaper: ['pee', 'poo', 'both', 'unknown'], sleep: ['sleep', 'wake'] }[type] || [];
  }

  function renderDraft() {
    const box = $('cards');
    $('json').textContent = JSON.stringify(draft.map(toPayload), null, 2);
    $('saveBtn').disabled = !draft.length;
    $('saveBtn').textContent = draft.length ? `${draft.length}건 저장` : '저장';
    if (!draft.length) { box.innerHTML = '<p class="empty">아직 인식된 기록이 없어요.</p>'; return; }
    const multi = me.babies.length > 1;

    box.innerHTML = '';
    draft.forEach((ev, idx) => {
      const card = document.createElement('div');
      card.className = 'card' + (ev.confidence === 'low' ? ' low' : '');
      const kinds = kindOptions(ev.type);
      card.innerHTML = `
        <div class="top">
          <span class="tag">${multi ? esc(babyName(ev.baby_id)) + ' · ' : ''}${TYPE_LABEL[ev.type]} ${KIND_LABEL[ev.detail.kind] || ''}</span>
          <span>${ev.confidence === 'low' ? '<span class="warn">확인 필요</span>' : ''}${ev.source === 'ai' ? '<span class="warn">AI 보정</span>' : ''}
          <button class="x" aria-label="삭제" data-del>×</button></span>
        </div>
        <div class="grid">
          ${multi ? `<label class="full">아기<select data-f="baby_id">${me.babies.map((b) => `<option value="${b.id}" ${b.id === ev.baby_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
          <label>종류<select data-f="type">${Object.keys(TYPE_LABEL).map((t) => `<option value="${t}" ${t === ev.type ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select></label>
          <label>세부${kinds.length
            ? `<select data-f="kind">${kinds.map((k) => `<option value="${k}" ${k === ev.detail.kind ? 'selected' : ''}>${KIND_LABEL[k] || '미지정'}</option>`).join('')}</select>`
            : `<input data-f="memo" value="${esc(ev.detail.name || ev.detail.memo || '')}">`}</label>
          <label class="full">시간<input type="datetime-local" data-f="time" value="${ev.time.slice(0, 16)}"></label>
          <label>용량<input type="number" inputmode="decimal" data-f="amount" value="${ev.amount ?? ''}"></label>
          <label>단위<select data-f="unit"><option value=""></option>${UNITS.map((u) => `<option ${u === ev.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          ${ev.detail.food ? `<label class="full">메뉴<input data-f="food" value="${esc(ev.detail.food)}"></label>` : ''}
        </div>
        <details><summary>원문</summary>${esc(ev.raw_text)}</details>`;

      card.querySelector('[data-del]').onclick = () => { draft.splice(idx, 1); renderDraft(); };
      card.querySelectorAll('[data-f]').forEach((el) => {
        el.addEventListener('change', () => {
          const f = el.dataset.f, v = el.value;
          if (f === 'type') { ev.type = v; ev.detail = {}; ev.confidence = 'high'; renderDraft(); return; }
          if (f === 'baby_id') { ev.baby_id = v; renderDraft(); return; }
          if (f === 'time') ev.time = BabyParser.toLocalISO(new Date(v));
          else if (f === 'amount') ev.amount = v === '' ? null : Number(v);
          else if (f === 'unit') ev.unit = v || null;
          else if (f === 'kind') ev.detail.kind = v;
          else if (f === 'food') ev.detail.food = v;
          else if (f === 'memo') ev.detail[ev.type === 'medicine' ? 'name' : 'memo'] = v;
          ev.confidence = 'high';
          $('json').textContent = JSON.stringify(draft.map(toPayload), null, 2);
        });
      });
      box.appendChild(card);
    });
  }

  // 서버로 보낼 필드만
  function toPayload(ev) {
    const { id, baby_id, type, time, amount, unit, detail, raw_text, approx_time } = ev;
    return { id, baby_id, type, time, amount, unit, detail, raw_text, approx_time };
  }

  // ---------- 전송 (실패 시 로컬 큐) ----------
  $('saveBtn').addEventListener('click', async () => {
    if (!draft.length) return;
    store.set(queueKey(), store.get(queueKey(), []).concat(draft.map(toPayload)));
    draft = [];
    renderDraft();
    await flushQueue();
  });

  let flushing = false;
  async function flushQueue() {
    if (flushing || !auth) return;
    flushing = true;
    try {
      const q = store.get(queueKey(), []);
      if (!q.length) return;
      const done = new Set();
      for (let i = 0; i < q.length; i += 50) {
        const batch = q.slice(i, i + 50);
        try {
          const r = await api('POST', 'api/events', { events: batch });
          batch.forEach((e) => done.add(e.id));
          setStatus(`${r.received}건 저장했어요.`);
        } catch (err) {
          if (err.status === 400 || err.status === 403) {
            // 데이터·권한 문제는 재시도해도 실패 → 큐에서 제거
            batch.forEach((e) => done.add(e.id));
            setStatus('저장 거부: ' + (err.body?.error || '오류'));
          } else break; // 오프라인/서버 오류 → 다음에 재시도
        }
      }
      store.set(queueKey(), store.get(queueKey(), []).filter((e) => !done.has(e.id)));
    } finally {
      flushing = false;
      showQueue();
      loadRecent();
    }
  }

  function showQueue() {
    const n = auth ? store.get(queueKey(), []).length : 0;
    $('queue').textContent = n ? `· 전송 대기 ${n}건` : '';
  }
  window.addEventListener('online', flushQueue);
  setInterval(flushQueue, 30000);

  // ---------- 최근 기록 ----------
  let medNames = [];   // 음성 질문에서 약 이름을 알아듣기 위해
  async function loadRecent() {
    if (babyId) api('GET', `api/babies/${babyId}/medicines`).then((m) => { medNames = m.medicines.flatMap((x) => [x.name, ...(x.aliases || [])]); }).catch(() => {});
    const box = $('recent');
    if (!me || !babyId) { box.innerHTML = '<p class="empty">아기를 먼저 등록해 주세요.</p>'; return; }
    const current = babyId;
    try {
      const { events } = await api('GET', `api/babies/${current}/events?limit=30`);
      if (current !== babyId) return; // 그새 아기를 바꿨으면 무시
      const pending = store.get(queueKey(), []).filter((e) => e.baby_id === current);
      const ids = new Set(events.map((e) => e.id));
      const all = pending.filter((e) => !ids.has(e.id)).map((e) => ({ ...e, _pending: true })).concat(events)
        .sort((a, b) => new Date(b.time) - new Date(a.time));
      if (!all.length) { box.innerHTML = '<p class="empty">저장된 기록이 없어요.</p>'; return; }
      box.innerHTML = all.map((e) => `
        <div class="log">
          <time>${fmtTime(e.time)}</time>
          <span class="what">${TYPE_LABEL[e.type] || e.type} ${KIND_LABEL[e.detail?.kind] || ''}
            ${e.amount != null ? `${e.amount}${esc(e.unit || '')}` : ''} ${esc(e.detail?.food || e.detail?.name || e.detail?.memo || '')}
            ${e._pending ? '<span class="warn">대기</span>' : `<span class="who">${esc(e.recorded_by_name || '')}</span>`}</span>
          ${e._pending ? '' : `<button class="x" aria-label="삭제" data-id="${esc(e.id)}">×</button>`}
        </div>`).join('');
      box.querySelectorAll('[data-id]').forEach((b) => b.onclick = async () => {
        if (!confirm('이 기록을 삭제할까요?')) return;
        try { await api('DELETE', `api/events/${encodeURIComponent(b.dataset.id)}`); } catch {}
        loadRecent();
      });
    } catch (err) {
      if (err.status !== 401) box.innerHTML = '<p class="empty">서버에 연결할 수 없어요. 저장은 대기열에 보관됩니다.</p>';
    }
  }

  function fmtTime(iso) {
    const d = new Date(iso), today = new Date();
    const hm = d.toTimeString().slice(0, 5);
    return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  // ---------- 시작 ----------
  if (auth?.accessToken) {
    enterApp().catch((err) => {
      if (err.status === 401) return; // signOut 이미 처리
      // 오프라인: 마지막 상태로라도 앱 화면은 보여줌
      $('authView').hidden = true; $('appView').hidden = false;
      setStatus('오프라인입니다. 기록은 대기열에 저장됩니다.');
    });
  } else {
    $('authView').hidden = false;
  }
})();

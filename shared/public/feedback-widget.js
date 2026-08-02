/**
 * shared/public/feedback-widget.js
 * 모든 프로젝트 공통: Ctrl+H(⌘+H)를 누르면 버그/개선요청 신고 모달을 띄운다.
 * 브라우저에 따라 Ctrl+H가 예약 단축키(예: Chrome "방문 기록")라 preventDefault가 먹히지
 * 않을 수 있어, 항상 우하단 플로팅 버튼도 함께 제공한다.
 * 각 앱의 index.html 등 진입 HTML에 /shared-assets/auth-guard.js와 나란히 추가한다.
 */
(function () {
  if (window.__monoFeedbackWidgetInstalled) return;
  window.__monoFeedbackWidgetInstalled = true;

  const CATEGORY_OPTIONS = [
    { value: 'bug', label: '🐛 버그' },
    { value: 'improvement', label: '✨ 기능개선' },
  ];
  const TYPE_OPTIONS = [
    { value: 'ui', label: '화면구성' },
    { value: 'error', label: '시스템 오류' },
    { value: 'feature', label: '추가기능' },
  ];

  const STYLE = `
    #mono-fb-btn {
      position: fixed; right: 20px; bottom: 20px; z-index: 999998;
      width: 44px; height: 44px; border-radius: 50%;
      background: #1a1a1a; border: 1px solid #333; color: #e0e0e0;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.4);
      font-family: 'Segoe UI', sans-serif;
    }
    #mono-fb-btn:hover { border-color: #4a9eff; transform: translateY(-2px); }
    #mono-fb-overlay {
      position: fixed; inset: 0; z-index: 999999; display: none;
      background: rgba(0,0,0,.6); align-items: center; justify-content: center;
      font-family: 'Segoe UI', sans-serif;
    }
    #mono-fb-overlay.open { display: flex; }
    #mono-fb-modal {
      background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 22px; width: 420px; max-width: 92vw; color: #e0e0e0;
      box-shadow: 0 8px 30px rgba(0,0,0,.5);
    }
    #mono-fb-modal h3 { color: #fff; font-size: 1.05rem; margin: 0 0 4px; }
    #mono-fb-modal p.mono-fb-sub { color: #888; font-size: 0.78rem; margin: 0 0 16px; }
    .mono-fb-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
    .mono-fb-field label { font-size: 0.78rem; color: #aaa; }
    .mono-fb-seg { display: flex; gap: 6px; flex-wrap: wrap; }
    .mono-fb-seg button {
      flex: 1; min-width: 80px; padding: 7px 8px; border-radius: 6px;
      border: 1px solid #2a2a2a; background: #0f0f0f; color: #ccc;
      font-size: 0.82rem; cursor: pointer;
    }
    .mono-fb-seg button.active { border-color: #4a9eff; color: #4a9eff; background: rgba(74,158,255,.1); }
    #mono-fb-content {
      width: 100%; box-sizing: border-box; resize: vertical; min-height: 90px;
      padding: 9px 10px; background: #0f0f0f; border: 1px solid #2a2a2a; border-radius: 6px;
      color: #e0e0e0; font-size: 0.85rem; font-family: inherit;
    }
    #mono-fb-content:focus, .mono-fb-seg button:focus { outline: none; border-color: #4a9eff; }
    #mono-fb-meta { font-size: 0.75rem; color: #666; margin-bottom: 14px; }
    #mono-fb-error { color: #f85149; font-size: 0.78rem; margin-bottom: 10px; display: none; }
    .mono-fb-btns { display: flex; justify-content: flex-end; gap: 8px; }
    .mono-fb-btns button {
      padding: 7px 14px; border-radius: 6px; font-size: 0.85rem; cursor: pointer;
      border: 1px solid #2a2a2a; background: #21262d; color: #c9d1d9;
    }
    .mono-fb-btns button.primary { background: #4a9eff; border-color: #4a9eff; color: #fff; }
    .mono-fb-btns button:disabled { opacity: .5; cursor: default; }
    #mono-fb-toast {
      position: fixed; bottom: 76px; right: 20px; z-index: 999999;
      background: #21262d; border: 1px solid #30363d; color: #e0e0e0;
      padding: 9px 16px; border-radius: 8px; font-size: 0.82rem; display: none;
      font-family: 'Segoe UI', sans-serif;
    }
    #mono-fb-toast.err { border-color: #f85149; color: #f85149; }
  `;

  let state = { category: 'bug', type: 'ui' };
  let userNamePromise = null;
  let els = null;

  function getUserName() {
    if (!userNamePromise) {
      userNamePromise = fetch('/auth/me', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(u => (u && u.name) || null)
        .catch(() => null);
    }
    return userNamePromise;
  }

  function currentAppPrefix() {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? '/' + seg : '/';
  }

  function build() {
    if (els) return els;

    const style = document.createElement('style');
    style.id = 'mono-fb-style';
    style.textContent = STYLE;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'mono-fb-btn';
    btn.type = 'button';
    btn.title = '버그/개선 요청 (Ctrl+H)';
    btn.textContent = '💬';
    btn.addEventListener('click', open);

    const overlay = document.createElement('div');
    overlay.id = 'mono-fb-overlay';
    overlay.innerHTML = `
      <div id="mono-fb-modal" role="dialog" aria-label="버그/개선 요청">
        <h3>💬 버그 · 개선 요청</h3>
        <p class="mono-fb-sub">발견한 문제나 개선 아이디어를 남겨주세요. 관리자가 확인 후 반영합니다.</p>
        <div id="mono-fb-error"></div>
        <div class="mono-fb-field">
          <label>분류</label>
          <div class="mono-fb-seg" id="mono-fb-category">
            ${CATEGORY_OPTIONS.map(o => `<button type="button" data-value="${o.value}">${o.label}</button>`).join('')}
          </div>
        </div>
        <div class="mono-fb-field">
          <label>종류</label>
          <div class="mono-fb-seg" id="mono-fb-type">
            ${TYPE_OPTIONS.map(o => `<button type="button" data-value="${o.value}">${o.label}</button>`).join('')}
          </div>
        </div>
        <div class="mono-fb-field">
          <label>내용</label>
          <textarea id="mono-fb-content" placeholder="무엇이 문제였는지, 어떻게 개선되면 좋을지 적어주세요"></textarea>
        </div>
        <div id="mono-fb-meta"></div>
        <div class="mono-fb-btns">
          <button type="button" id="mono-fb-cancel">취소</button>
          <button type="button" id="mono-fb-submit" class="primary">제출</button>
        </div>
      </div>
    `;

    const toast = document.createElement('div');
    toast.id = 'mono-fb-toast';

    document.body.appendChild(btn);
    document.body.appendChild(overlay);
    document.body.appendChild(toast);

    els = { btn, overlay, toast };

    overlay.querySelectorAll('#mono-fb-category button').forEach(b => {
      b.addEventListener('click', () => { state.category = b.dataset.value; syncSeg(); });
    });
    overlay.querySelectorAll('#mono-fb-type button').forEach(b => {
      b.addEventListener('click', () => { state.type = b.dataset.value; syncSeg(); });
    });
    overlay.querySelector('#mono-fb-cancel').addEventListener('click', close);
    overlay.querySelector('#mono-fb-submit').addEventListener('click', submit);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    syncSeg();
    return els;
  }

  function syncSeg() {
    document.querySelectorAll('#mono-fb-category button').forEach(b => {
      b.classList.toggle('active', b.dataset.value === state.category);
    });
    document.querySelectorAll('#mono-fb-type button').forEach(b => {
      b.classList.toggle('active', b.dataset.value === state.type);
    });
  }

  function toast(msg, isErr) {
    const t = build().toast;
    t.textContent = msg;
    t.className = isErr ? 'err' : '';
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.display = 'none'; }, 3000);
  }

  async function open() {
    const { overlay } = build();
    document.getElementById('mono-fb-error').style.display = 'none';
    document.getElementById('mono-fb-content').value = '';
    state = { category: 'bug', type: 'ui' };
    syncSeg();
    overlay.classList.add('open');
    document.getElementById('mono-fb-content').focus();

    const meta = document.getElementById('mono-fb-meta');
    meta.textContent = '요청자 확인 중...';
    const name = await getUserName();
    meta.textContent = name
      ? `요청자: ${name} · 페이지: ${currentAppPrefix()}`
      : `페이지: ${currentAppPrefix()} (로그인 필요)`;
  }

  function close() {
    if (!els) return;
    els.overlay.classList.remove('open');
  }

  async function submit() {
    const content = document.getElementById('mono-fb-content').value.trim();
    const errEl = document.getElementById('mono-fb-error');
    errEl.style.display = 'none';
    if (!content) {
      errEl.textContent = '내용을 입력하세요.';
      errEl.style.display = 'block';
      return;
    }
    const submitBtn = document.getElementById('mono-fb-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '제출 중...';
    try {
      const res = await fetch('/auth/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appPrefix: currentAppPrefix(),
          category: state.category,
          type: state.type,
          content,
          pageUrl: location.href,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      close();
      toast('신고가 접수되었습니다. 감사합니다!');
    } catch (e) {
      errEl.textContent = '제출 실패: ' + e.message;
      errEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '제출';
    }
  }

  document.addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'h') {
      // Ctrl+H는 일부 브라우저(Chrome 등)에서 방문 기록 단축키로 예약되어 있어
      // preventDefault가 먹히지 않을 수 있다 — 그런 경우에도 우하단 버튼으로 항상 열 수 있다.
      e.preventDefault();
      e.stopPropagation();
      if (els && els.overlay.classList.contains('open')) close();
      else open();
    } else if (key === 'escape' && els && els.overlay.classList.contains('open')) {
      close();
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();

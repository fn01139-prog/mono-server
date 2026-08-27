(function () {
  'use strict';

  const state = {
    isAdmin: false,
    tree: { majors: [] },
    currentDocId: null,
  };

  const el = {
    breadcrumb: document.getElementById('breadcrumb'),
    tree: document.getElementById('tree'),
    sidebarToolbar: document.getElementById('sidebar-toolbar'),
    sidebar: document.getElementById('sidebar'),
    resizer: document.getElementById('resizer'),
    content: document.getElementById('content'),
    placeholder: document.getElementById('placeholder'),
    docFrame: document.getElementById('docFrame'),
    editorFrame: document.getElementById('editorFrame'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalOk: document.getElementById('modal-ok'),
    modalCancel: document.getElementById('modal-cancel'),
    modalError: document.getElementById('modal-error'),
    btnAddMajor: document.getElementById('btn-add-major'),
    platformUserChip: document.getElementById('platformUserChip'),
    btnLogout: document.getElementById('btn-logout'),
  };

  // 모든 API fetch는 상대경로("api/...")를 쓴다. <base href="/memo/">가 실제
  // prefix를 결정하므로, mono-server가 이 모듈을 다른 경로에 마운트해도
  // index.html의 <base> 태그 한 줄만 바꾸면 이 파일은 그대로 동작한다.
  // (플랫폼 공용 엔드포인트인 /auth/me, /auth/logout은 절대경로로 별도 호출한다.)
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- generic modal ----------

  let modalResolve = null;

  function openModal(title, bodyHtml) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = bodyHtml;
    el.modalError.textContent = '';
    el.modalOverlay.style.display = 'flex';
    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function closeModal(result) {
    el.modalOverlay.style.display = 'none';
    if (modalResolve) { modalResolve(result); modalResolve = null; }
  }

  el.modalCancel.addEventListener('click', () => closeModal(null));
  el.modalOverlay.addEventListener('click', (e) => { if (e.target === el.modalOverlay) closeModal(null); });

  async function promptText(title, placeholder) {
    const html = `<input type="text" id="modal-input" placeholder="${placeholder || ''}" autocomplete="off" />`;
    const p = openModal(title, html);
    setTimeout(() => document.getElementById('modal-input')?.focus(), 0);
    el.modalOk.onclick = () => {
      const val = document.getElementById('modal-input').value.trim();
      if (!val) { el.modalError.textContent = '값을 입력하세요.'; return; }
      closeModal(val);
    };
    return p;
  }

  async function promptCode(title, hint, placeholder) {
    const html = `<p class="modal-hint">${hint || ''}</p><input type="password" id="modal-input" placeholder="${placeholder || '권한 코드'}" autocomplete="off" />`;
    const p = openModal(title, html);
    setTimeout(() => document.getElementById('modal-input')?.focus(), 0);
    el.modalOk.onclick = () => {
      const val = document.getElementById('modal-input').value.trim();
      if (!val) { el.modalError.textContent = '값을 입력하세요.'; return; }
      closeModal(val);
    };
    return p;
  }

  function showInfo(title, bodyHtml) {
    openModal(title, bodyHtml);
    el.modalOk.onclick = () => closeModal(true);
  }

  // ---------- 플랫폼 로그인 사용자 표시 / 로그아웃 ----------
  // 관리자 여부는 이 모듈이 아니라 mono-server 플랫폼 로그인(GET /auth/me)이 결정한다.
  // 대분류/중분류 관리 버튼 노출 등 UI 분기는 여기서 받은 role로만 판단하고,
  // 실제 쓰기 권한은 서버(index.js의 auth.requireAdmin)가 다시 검사한다.

  async function loadPlatformUser() {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      if (!res.ok) throw new Error();
      const me = await res.json();
      state.isAdmin = me.role === 'admin';
      el.platformUserChip.textContent = `${me.name}${state.isAdmin ? ' (관리자)' : ''}`;
    } catch {
      state.isAdmin = false;
    }
  }

  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    location.href = '/login';
  }

  el.btnLogout.addEventListener('click', logout);

  // ---------- tree rendering ----------

  function nodeLabel(cls, name, icons) {
    const wrap = document.createElement('div');
    wrap.className = 'node-label ' + cls;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'node-name';
    nameSpan.textContent = name;
    wrap.appendChild(nameSpan);
    (icons || []).forEach((icon) => wrap.appendChild(icon));
    return wrap;
  }

  function iconBtn(symbol, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn owner-only';
    b.style.display = state.isAdmin ? '' : 'none';
    b.title = title;
    b.textContent = symbol;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function renderTree() {
    el.tree.innerHTML = '';
    el.sidebarToolbar.style.display = state.isAdmin ? '' : 'none';

    if (!state.tree.majors.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '등록된 문서가 없습니다.';
      el.tree.appendChild(li);
      return;
    }

    state.tree.majors.forEach((major) => {
      const majorLi = document.createElement('li');
      const majorIcons = [
        iconBtn('✎', '대분류 이름변경', () => renameMajor(major)),
        iconBtn('+중', '중분류 추가', () => addMid(major)),
        iconBtn('🗑', '대분류 삭제', () => deleteMajor(major)),
      ];
      const majorLabel = nodeLabel('major', major.name, majorIcons);
      const midUl = document.createElement('ul');
      majorLabel.addEventListener('click', () => {
        midUl.style.display = midUl.style.display === 'none' ? '' : 'none';
      });
      majorLi.appendChild(majorLabel);
      majorLi.appendChild(midUl);

      major.mids.forEach((mid) => {
        const midLi = document.createElement('li');
        const locked = mid.hasCode && !mid.unlocked;

        const lockBadge = document.createElement('span');
        lockBadge.className = 'lock-badge';
        lockBadge.title = mid.hasCode ? (locked ? '읽기 잠김 — 클릭해서 코드 입력' : '코드로 잠금 해제됨') : '';
        lockBadge.textContent = mid.hasCode ? (locked ? '🔒' : '🔓') : '';

        const midIcons = [
          lockBadge,
          iconBtn('✎', '중분류 이름변경', () => renameMid(mid)),
          iconBtn(mid.hasCode ? '🔑' : '🔒', mid.hasCode ? '코드 재설정' : '코드 설정', () => setMidCode(mid)),
          iconBtn('+문서', '새 문서 작성', () => newDoc(major, mid)),
          iconBtn('🗑', '중분류 삭제', () => deleteMid(major, mid)),
        ];
        const midLabel = nodeLabel('mid', mid.name, midIcons);
        const docUl = document.createElement('ul');
        midLabel.addEventListener('click', async () => {
          if (locked) {
            if (await ensureUnlocked(mid)) refreshTree();
            return;
          }
          docUl.style.display = docUl.style.display === 'none' ? '' : 'none';
        });
        midLi.appendChild(midLabel);
        midLi.appendChild(docUl);

        if (locked) {
          const lockedLi = document.createElement('li');
          lockedLi.className = 'empty';
          lockedLi.textContent = `잠김 (${mid.docCount}개 문서) — 이름을 클릭해 코드를 입력하세요`;
          docUl.appendChild(lockedLi);
        } else if (!mid.docs.length) {
          const empty = document.createElement('li');
          empty.className = 'empty';
          empty.textContent = '(문서 없음)';
          docUl.appendChild(empty);
        } else {
          mid.docs.forEach((doc) => {
            const docLi = document.createElement('li');
            const docIcons = [
              iconBtn('✎', '문서 수정', () => editDoc(major, mid, doc)),
              iconBtn('🗑', '문서 삭제', () => deleteDoc(major, mid, doc)),
            ];
            const docLabel = nodeLabel('doc', doc.title, docIcons);
            if (doc.id === state.currentDocId) docLabel.classList.add('active');
            docLabel.addEventListener('click', () => loadDoc(doc.id));
            docLi.appendChild(docLabel);
            docUl.appendChild(docLi);
          });
        }

        midUl.appendChild(midLi);
      });

      el.tree.appendChild(majorLi);
    });
  }

  function resetView() {
    state.currentDocId = null;
    el.breadcrumb.textContent = '문서를 선택하세요';
    el.docFrame.style.display = 'none';
    el.editorFrame.style.display = 'none';
    el.placeholder.style.display = '';
  }

  // ---------- doc viewing ----------

  async function loadDoc(docId) {
    try {
      const doc = await api('GET', `api/docs/${docId}`);
      state.currentDocId = docId;
      el.breadcrumb.textContent = `${doc.majorName} - ${doc.midName} - ${doc.title}`;
      el.placeholder.style.display = 'none';
      el.editorFrame.style.display = 'none';
      el.docFrame.style.display = '';
      el.docFrame.srcdoc = doc.html;
      renderTree();
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- admin: major/mid management ----------

  async function addMajor() {
    const name = await promptText('대분류 추가', '예: 대상㈜ 영업본부');
    if (!name) return;
    try {
      await api('POST', 'api/admin/majors', { name });
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  async function renameMajor(major) {
    const name = await promptText('대분류 이름 변경', major.name);
    if (!name) return;
    try {
      await api('PUT', `api/admin/majors/${major.id}`, { name });
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  async function addMid(major) {
    const name = await promptText('중분류 추가', '예: 합병프로젝트 대응');
    if (!name) return;
    try {
      await api('POST', `api/admin/majors/${major.id}/mids`, { name });
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  async function renameMid(mid) {
    const name = await promptText('중분류 이름 변경', mid.name);
    if (!name) return;
    try {
      await api('PUT', `api/admin/mids/${mid.id}`, { name });
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  async function setMidCode(mid) {
    const code = await promptText(mid.hasCode ? '권한 코드 재설정' : '권한 코드 설정', '4자 이상 코드 입력');
    if (!code) return;
    try {
      const result = await api('PUT', `api/admin/mids/${mid.id}/code`, { code });
      await refreshTree();
      showInfo(
        '코드가 설정되었습니다',
        `<div class="modal-code-display">${result.code}</div><p class="modal-hint">이 코드는 지금만 표시됩니다. 문서를 작성/수정할 사람에게 전달해두세요.</p>`
      );
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- admin: delete ----------

  async function deleteMajor(major) {
    if (!confirm(`"${major.name}" 대분류를 삭제하면 안에 있는 모든 중분류/문서가 함께 삭제됩니다. 계속할까요?`)) return;
    try {
      await api('DELETE', `api/admin/majors/${major.id}`);
      if (major.mids.some((m) => m.docs.some((d) => d.id === state.currentDocId))) resetView();
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteMid(major, mid) {
    if (!confirm(`"${mid.name}" 중분류를 삭제하면 안에 있는 모든 문서가 함께 삭제됩니다. 계속할까요?`)) return;
    try {
      await api('DELETE', `api/admin/mids/${mid.id}`);
      if (mid.docs.some((d) => d.id === state.currentDocId)) resetView();
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteDoc(major, mid, doc) {
    if (!confirm(`"${doc.title}" 문서를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    if (!(await ensureUnlocked(mid))) return;
    try {
      await api('DELETE', `api/docs/${doc.id}`);
      if (state.currentDocId === doc.id) resetView();
      await refreshTree();
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- write-access unlock flow (중분류 코드, 관리자 여부와는 별개) ----------

  async function ensureUnlocked(mid) {
    const status = await api('GET', `api/mids/${mid.id}/unlock-status`);
    if (status.unlocked) return true;
    if (!mid.hasCode) {
      alert('관리자가 먼저 이 중분류에 권한 코드를 설정해야 합니다.');
      return false;
    }
    const code = await promptCode('권한 코드 입력', `"${mid.name}" 중분류에 설정된 코드를 입력하세요.`);
    if (!code) return false;
    try {
      await api('POST', `api/mids/${mid.id}/unlock`, { code });
      return true;
    } catch (e) {
      alert(e.message);
      return false;
    }
  }

  // ---------- editor iframe flow ----------

  function openEditor(query) {
    el.placeholder.style.display = 'none';
    el.docFrame.style.display = 'none';
    el.editorFrame.style.display = '';
    // 에디터 페이지는 admin.requireAdmin으로 보호되는 API 라우터(GET /memo/api/admin/editor) 아래 있다.
    el.editorFrame.src = `api/admin/editor?${query}`;
  }

  async function newDoc(major, mid) {
    if (!(await ensureUnlocked(mid))) return;
    openEditor(`majorId=${encodeURIComponent(major.id)}&midId=${encodeURIComponent(mid.id)}`);
  }

  async function editDoc(major, mid, doc) {
    if (!(await ensureUnlocked(mid))) return;
    openEditor(`docId=${encodeURIComponent(doc.id)}`);
  }

  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'memo:saved') {
      refreshTree().then(() => {
        if (event.data.docId) loadDoc(event.data.docId);
        else {
          el.editorFrame.style.display = 'none';
          el.placeholder.style.display = '';
        }
      });
    } else if (event.data.type === 'memo:cancelled') {
      el.editorFrame.style.display = 'none';
      if (state.currentDocId) {
        el.docFrame.style.display = '';
      } else {
        el.placeholder.style.display = '';
      }
    }
  });

  // ---------- sidebar resizer ----------

  (function setupResizer() {
    const saved = parseInt(localStorage.getItem('memo.sidebarWidth'), 10);
    if (saved && saved > 100) el.sidebar.style.width = saved + 'px';

    let dragging = false;
    el.resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      el.resizer.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = el.sidebar.parentElement.getBoundingClientRect();
      const width = Math.min(Math.max(e.clientX - rect.left, 160), rect.width * 0.7);
      el.sidebar.style.width = width + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.resizer.classList.remove('dragging');
      localStorage.setItem('memo.sidebarWidth', parseInt(el.sidebar.style.width, 10) || 280);
    });
  })();

  // ---------- boot ----------

  el.btnAddMajor.addEventListener('click', addMajor);

  async function refreshTree() {
    state.tree = await api('GET', 'api/tree');
    renderTree();
  }

  async function boot() {
    await loadPlatformUser();
    await refreshTree();
  }

  boot();
})();

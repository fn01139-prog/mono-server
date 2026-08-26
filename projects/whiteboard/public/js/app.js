// projects/whiteboard/public/js/app.js
//
// 여러 명이 함께 쓰는 공유 화이트보드. 보드(채널) 안에 참여자별 레이어가 있고,
// 레이어 안에 펜 드로잉(stroke)/스티키노트(note)가 쌓인다. 서버에 WebSocket
// 인프라가 없어 실시간 반영 대신 배치 동기화를 쓴다 — 내가 그리거나 수정한 내용은
// 로컬에만 쌓이다가 자동(REFRESH_MS, 1분 주기) 또는 새로고침 버튼 클릭 시점에
// syncNow()가 한꺼번에 push한 뒤 서버 최신 상태를 pull한다.

const BASE = (() => {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts.length ? '/' + parts[0] : '';
})();

const CANVAS_W = 4000;
const CANVAS_H = 2500;
const REFRESH_MS = 60000; // 자동 동기화 주기 — 1분. 그 전에 확인하고 싶으면 새로고침 버튼으로 즉시 동기화.

const el = id => document.getElementById(id);

const state = {
  me: null,
  boards: [],
  board: null,
  layers: [],
  layerById: new Map(),
  elements: [],
  tool: 'pen',
  hiddenLayers: new Set(),
  pollTimer: null,
  syncing: false,
  drawing: null,
  draggingNote: null,
  editingNoteId: null,
  viewport: { scale: 1, x: 0, y: 0 },   // 화면 확대/이동 — 뷰어(브라우저)별 로컬 상태, 서버에 저장/공유되지 않음
  activePointers: new Map(),            // pointerId -> {x,y} (client 좌표) — 동시에 몇 손가락이 닿아있는지 추적
  pinch: null,                          // 2손가락 이상 제스처 시작 시점 기준값
  panning: null,                        // '이동' 툴로 한 손가락/마우스 드래그 중인 시작 기준값

  // ── 배치 동기화 ──────────────────────────────────────────────────────
  // 내가 그리거나 수정한 내용은 서버에 즉시 보내지 않고 로컬 state.elements에만
  // 반영한 뒤, 자동(1분)/수동(새로고침 버튼) 동기화 시점에 한꺼번에 push한다.
  // 아직 서버에 없는 요소는 임시로 음수 id를 붙여 구분한다(서버 id는 항상 양수).
  nextLocalId: -1,
  pendingUpdates: new Set(),  // 이미 서버에 있는(id>0) 요소 중 로컬 수정만 되고 아직 push 안 된 id
  pendingDeletes: new Set(),  // 이미 서버에 있는 요소 중 로컬 삭제만 되고 아직 push 안 된 id
};

const canvas = el('strokeCanvas');
const ctx = canvas.getContext('2d');
const wrap = el('canvasWrap');
const inner = el('canvasInner');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
inner.style.width = CANVAS_W + 'px';
inner.style.height = CANVAS_H + 'px';

/* ============================================================
   유틸
   ============================================================ */

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function timeAgo(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function textColorFor(bgHex) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(bgHex) ? bgHex : '#4a9eff';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#14161a' : '#f5f6fa';
}

async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok || !json || json.success === false) {
    throw new Error((json && json.error) || `요청 실패 (${res.status})`);
  }
  return json.data;
}

/* ============================================================
   라우팅 (경로 기반 — 목록 vs 특정 보드)
   ============================================================ */

function currentRoute() {
  const m = location.pathname.match(new RegExp('^' + BASE + '/board/(\\d+)'));
  return m ? { view: 'board', id: Number(m[1]) } : { view: 'list' };
}

function navigate(path) {
  history.pushState(null, '', path);
  route();
}

async function route() {
  stopAutoSync();
  // 다른 보드로 넘어가거나 목록으로 돌아가기 전, 아직 push 안 된 변경사항이 있으면
  // 먼저 동기화한다 — 안 그러면 새 보드를 열 때 state.elements가 통째로 교체되면서
  // 이전 보드에서 그린(아직 서버에 없는) 내용이 조용히 사라진다.
  if (state.board && pendingCount() > 0) {
    await syncNow();
  }
  const r = currentRoute();
  if (r.view === 'board') {
    el('viewList').classList.add('hidden');
    el('viewBoard').classList.remove('hidden');
    await openBoard(r.id);
  } else {
    el('viewBoard').classList.add('hidden');
    el('viewList').classList.remove('hidden');
    await loadBoardList();
  }
}

/* ============================================================
   인증
   ============================================================ */

async function loadMe() {
  const res = await fetch('/auth/me', { credentials: 'include' });
  if (!res.ok) return;
  state.me = await res.json();
  el('meLabel').textContent = `${state.me.name} · ${state.me.role === 'admin' ? '관리자' : '사용자'}`;
}

/* ============================================================
   목록 뷰 (보드 = 채널)
   ============================================================ */

async function loadBoardList() {
  try {
    state.boards = await api('GET', '/boards');
  } catch (e) {
    toast(e.message);
    state.boards = [];
  }
  renderBoardList();
}

function renderBoardList() {
  const grid = el('boardGrid');
  el('listEmpty').classList.toggle('hidden', state.boards.length > 0);
  grid.innerHTML = state.boards.map(b => `
    <div class="board-card" data-id="${b.id}">
      <div class="board-card-title">🖊️ ${escapeHtml(b.title)}${b.canManage ? ' <span class="board-card-badge">내 보드</span>' : ''}</div>
      <div class="board-card-desc">${escapeHtml(b.description || '설명이 없습니다.')}</div>
      <div class="board-card-meta">
        <span>👥 ${b.participant_count}명 · ✏️ ${b.element_count}개</span>
        <span>${timeAgo(b.updated_at)}</span>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.board-card').forEach(card => {
    card.addEventListener('click', () => navigate(`${BASE}/board/${card.dataset.id}`));
  });
}

async function createBoard() {
  const title = window.prompt('새 보드(채널) 이름을 입력하세요', '');
  if (!title || !title.trim()) return;
  const description = window.prompt('간단한 설명 (선택 — 비워둬도 됩니다)', '') || '';
  try {
    const board = await api('POST', '/boards', { title: title.trim(), description: description.trim() });
    toast('보드를 만들었습니다');
    navigate(`${BASE}/board/${board.id}`);
  } catch (e) {
    toast(e.message);
  }
}

/* ============================================================
   보드 뷰 — 열기 / 폴링
   ============================================================ */

async function openBoard(id) {
  state.drawing = null;
  state.draggingNote = null;
  state.editingNoteId = null;
  state.tool = 'pen';
  state.activePointers.clear();
  state.pinch = null;
  state.panning = null;
  // 새 보드로 이동 — 이전 보드의 미동기화 항목이 섞여 들어가지 않도록 초기화
  // (route()가 이미 가능한 경우 flush를 시도했지만, 실패했더라도 다른 보드로 잘못
  // 들어가는 것보다는 초기화하는 편이 안전하다)
  state.elements = [];
  state.nextLocalId = -1;
  state.pendingUpdates.clear();
  state.pendingDeletes.clear();
  resetViewport();
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pen'));

  // 좁은 화면에서는 참여자 패널이 캔버스 위에 겹쳐 뜨므로(모바일 CSS), 그리기 영역을
  // 가리지 않도록 기본적으로 접어둔다 — '참여자' 버튼으로 언제든 펼칠 수 있다.
  el('layersPanel').classList.toggle('collapsed', window.matchMedia('(max-width: 720px)').matches);

  try {
    state.board = await api('GET', `/boards/${id}`);
  } catch (e) {
    toast(e.message);
    navigate(BASE + '/');
    return;
  }

  el('boardTitleInput').value = state.board.title;
  el('btnBoardManage').classList.toggle('hidden', !state.board.canManage);
  el('btnBoardDelete').classList.toggle('hidden', !state.board.canManage);
  loadHiddenLayers(id);
  el('noteLayer').innerHTML = '';

  try {
    await api('POST', `/boards/${id}/join`, {});
    await refreshLayers();
    await refreshElements();
  } catch (e) {
    toast(e.message);
  }
  renderAll();
  startAutoSync();
}

function startAutoSync() {
  stopAutoSync();
  state.pollTimer = setInterval(syncNow, REFRESH_MS);
}
function stopAutoSync() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function refreshLayers() {
  state.layers = await api('GET', `/boards/${state.board.id}/layers`);
  state.layerById = new Map(state.layers.map(l => [l.id, l]));
}
async function refreshElements() {
  // 아직 push 안 된(id<0) 로컬 요소는 서버 응답에 없으므로, 통째로 덮어써도
  // 사라지지 않도록 다시 붙여준다.
  const pending = state.elements.filter(e => e.id < 0);
  state.elements = await api('GET', `/boards/${state.board.id}/elements`);
  if (pending.length) state.elements.push(...pending);
}

/** 아직 push 안 된 로컬 변경사항 개수 (생성 대기 + 수정 대기 + 삭제 대기) */
function pendingCount() {
  return state.elements.filter(e => e.id < 0).length + state.pendingUpdates.size + state.pendingDeletes.size;
}

function updateSyncBadge() {
  const badge = el('syncBadge');
  if (!badge) return;
  const n = pendingCount();
  if (state.syncing) {
    badge.textContent = '동기화 중…';
    badge.title = '서버와 동기화하는 중입니다';
  } else if (n > 0) {
    badge.textContent = `저장 대기 ${n}개`;
    badge.title = '아직 서버에 반영되지 않은 변경사항이 있습니다 — 1분 내 자동 반영되거나, 새로고침 버튼으로 즉시 반영할 수 있습니다';
  } else {
    badge.textContent = '';
    badge.title = '자동 동기화 (1분 주기)';
  }
  badge.classList.toggle('pending', n > 0 && !state.syncing);
}

/** 로컬 변경사항을 서버에 push하고, 서버의 최신 상태를 pull한다 (자동 1분 주기 + 새로고침 버튼 공용) */
async function syncNow() {
  if (!state.board || state.syncing) return;
  state.syncing = true;
  const badge = el('syncBadge');
  badge.classList.add('syncing');
  updateSyncBadge();
  try {
    // 1) 아직 서버에 없는 요소 생성
    for (const elem of state.elements.filter(e => e.id < 0)) {
      const created = await api('POST', `/boards/${state.board.id}/elements`, { type: elem.type, data: elem.data });
      const idx = state.elements.indexOf(elem);
      if (idx !== -1) state.elements[idx] = created;
      if (elem.type === 'note') {
        // 진행 중인 DOM 요소도 실제 id로 맞춰서 다음 렌더에서 재생성/깜빡임 없이 이어지게 한다
        const node = document.getElementById('note-' + elem.id);
        if (node) { node.id = 'note-' + created.id; node.dataset.id = created.id; }
      }
    }
    // 2) 기존 요소 중 수정된 것 반영
    for (const id of [...state.pendingUpdates]) {
      const elem = state.elements.find(x => x.id === id);
      if (elem) await api('PUT', `/elements/${id}`, { data: elem.data });
      state.pendingUpdates.delete(id);
    }
    // 3) 삭제 반영
    for (const id of [...state.pendingDeletes]) {
      await api('DELETE', `/elements/${id}`);
      state.pendingDeletes.delete(id);
    }
    // 4) 최신 상태 pull (다른 참여자 변경사항 포함)
    await refreshLayers();
    await refreshElements();
    renderAll();
    badge.classList.remove('syncing', 'error');
  } catch (e) {
    badge.classList.remove('syncing');
    badge.classList.add('error');
    toast('동기화 실패: ' + e.message);
  } finally {
    state.syncing = false;
    updateSyncBadge();
  }
}

function renderAll() {
  renderLayersPanel();
  renderStrokes();
  renderNotes();
}

/* ============================================================
   레이어 패널 (참여자별 표시/관리)
   ============================================================ */

function hiddenKey(boardId) { return `wb_hidden_${boardId}`; }
function loadHiddenLayers(boardId) {
  try {
    const raw = localStorage.getItem(hiddenKey(boardId));
    state.hiddenLayers = new Set(raw ? JSON.parse(raw) : []);
  } catch { state.hiddenLayers = new Set(); }
}
function saveHiddenLayers() {
  try { localStorage.setItem(hiddenKey(state.board.id), JSON.stringify([...state.hiddenLayers])); } catch {}
}

function layerColor(layerId) {
  return state.layerById.get(layerId)?.color || '#4a9eff';
}

function renderLayersPanel() {
  el('layersHeading').textContent = `참여자 레이어 (${state.layers.length})`;
  const list = el('layersList');
  list.innerHTML = state.layers.map(l => `
    <li class="layer-item ${l.isMine ? 'mine' : ''}" data-id="${l.id}">
      <input type="checkbox" class="layer-vis" data-id="${l.id}" ${state.hiddenLayers.has(l.id) ? '' : 'checked'} title="내 화면에서 표시/숨김" />
      <span class="layer-dot" style="background:${l.color}"></span>
      <span class="layer-name">${escapeHtml(l.owner_name)}${l.isMine ? ' (나)' : ''}</span>
      <span class="layer-count">${l.element_count}</span>
      ${l.canManage ? `<button class="layer-del" data-id="${l.id}" title="레이어 삭제 (작성한 내용 전체 삭제)">🗑</button>` : ''}
    </li>
  `).join('');

  list.querySelectorAll('.layer-vis').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) state.hiddenLayers.delete(id); else state.hiddenLayers.add(id);
      saveHiddenLayers();
      renderStrokes();
      renderNotes();
    });
  });
  list.querySelectorAll('.layer-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const layer = state.layerById.get(id);
      if (!window.confirm(`'${layer?.owner_name}' 레이어를 삭제할까요?\n작성한 내용이 모두 사라지며 되돌릴 수 없습니다.`)) return;
      try {
        await api('DELETE', `/layers/${id}`);
        toast('레이어를 삭제했습니다');
        await refreshLayers();
        await refreshElements();
        renderAll();
      } catch (e) { toast(e.message); }
    });
  });

  const mine = state.layers.find(l => l.isMine);
  if (mine) el('myColorInput').value = mine.color;
}

/* ============================================================
   캔버스 — 펜 드로잉(stroke) 렌더링
   ============================================================ */

function renderStrokes() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  for (const elem of state.elements) {
    if (elem.type !== 'stroke' || state.hiddenLayers.has(elem.layer_id)) continue;
    drawStroke(elem);
  }
}

function drawStroke(elem) {
  const pts = elem.data.points;
  if (!pts || !pts.length) return;
  const color = layerColor(elem.layer_id);
  const width = elem.data.width || 3;
  if (pts.length === 1) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/* ============================================================
   스티키노트(note) 렌더링 — DOM 오버레이 (드래그/편집 위해)
   ============================================================ */

function canEditElement(elem) {
  return !!state.me && (state.me.role === 'admin' || elem.author_id === state.me.userId || !!state.board.canManage);
}

/** 새 요소를 로컬에만 추가 (서버 push는 다음 동기화 시점에) — 임시 음수 id 부여 */
function addLocalElement(type, data) {
  const layer = state.layers.find(l => l.isMine);
  const now = new Date().toISOString();
  const elem = {
    id: state.nextLocalId--,
    board_id: state.board.id,
    layer_id: layer ? layer.id : null,
    author_id: state.me.userId,
    type, data,
    created_at: now, updated_at: now,
  };
  state.elements.push(elem);
  updateSyncBadge();
  return elem;
}

/** 기존 요소의 data를 로컬에서 수정 표시 — 이미 서버에 있는(id>0) 요소만 push 대상으로 등록 */
function markEdited(elem) {
  elem.updated_at = new Date().toISOString();
  if (elem.id > 0) state.pendingUpdates.add(elem.id);
  updateSyncBadge();
}

/** 요소를 로컬에서 제거 — 서버에 없던 요소(id<0)는 그냥 사라지고, 있던 요소는 삭제 대기로 등록 */
function removeLocalElement(id) {
  state.elements = state.elements.filter(x => x.id !== id);
  if (id > 0) {
    state.pendingUpdates.delete(id);
    state.pendingDeletes.add(id);
  }
  updateSyncBadge();
}

function renderNotes() {
  const seen = new Set();
  for (const elem of state.elements) {
    if (elem.type !== 'note') continue;
    seen.add(elem.id);
    if (state.hiddenLayers.has(elem.layer_id)) {
      document.getElementById('note-' + elem.id)?.classList.add('hidden');
      continue;
    }
    upsertNoteEl(elem);
  }
  el('noteLayer').querySelectorAll('.note').forEach(node => {
    if (!seen.has(Number(node.dataset.id))) node.remove();
  });
}

function upsertNoteEl(elem) {
  let node = document.getElementById('note-' + elem.id);
  if (!node) {
    node = document.createElement('div');
    node.id = 'note-' + elem.id;
    node.className = 'note';
    node.dataset.id = elem.id;
    node.innerHTML = `
      <div class="note-author"></div>
      <div class="note-text" spellcheck="false"></div>
      <button class="note-del" type="button" title="삭제">✕</button>
    `;
    el('noteLayer').appendChild(node);
    attachNoteHandlers(node);
  }
  node.classList.remove('hidden');

  const color = layerColor(elem.layer_id);
  node.style.background = color;
  node.style.color = textColorFor(color);
  node.style.left = elem.data.x + 'px';
  node.style.top = elem.data.y + 'px';
  if (elem.data.w) node.style.width = elem.data.w + 'px';

  const editable = canEditElement(elem);
  node.classList.toggle('readonly', !editable);
  node.querySelector('.note-del').classList.toggle('can-edit', editable);

  const layer = state.layerById.get(elem.layer_id);
  node.querySelector('.note-author').textContent = layer ? layer.owner_name : '';

  const textEl = node.querySelector('.note-text');
  if (state.editingNoteId !== elem.id) textEl.textContent = elem.data.text || '';
  textEl.contentEditable = editable ? 'true' : 'false';
}

function selectAllText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function attachNoteHandlers(node) {
  const textEl = node.querySelector('.note-text');
  const delBtn = node.querySelector('.note-del');

  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteElement(Number(node.dataset.id), node);
  });

  textEl.addEventListener('focus', () => { state.editingNoteId = Number(node.dataset.id); });
  textEl.addEventListener('blur', () => {
    const id = Number(node.dataset.id);
    state.editingNoteId = null;
    const elem = state.elements.find(x => x.id === id);
    if (!elem) return;
    const text = textEl.textContent;
    if (text === (elem.data.text || '')) return;
    elem.data = { ...elem.data, text };
    markEdited(elem);
  });
  textEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
  });

  node.addEventListener('pointerdown', (e) => {
    if (state.activePointers.size >= 2 || state.tool === 'pan') return;
    if (node.classList.contains('readonly') || state.tool === 'eraser' || e.target === textEl || e.target === delBtn) return;
    e.stopPropagation();
    const id = Number(node.dataset.id);
    const elem = state.elements.find(x => x.id === id);
    if (!elem) return;
    const p = canvasPos(e);
    node.setPointerCapture(e.pointerId);
    state.draggingNote = {
      id, node,
      offsetX: p.x - elem.data.x,
      offsetY: p.y - elem.data.y,
    };
    node.classList.add('dragging');
  });
  node.addEventListener('pointermove', (e) => {
    if (!state.draggingNote || state.draggingNote.node !== node) return;
    const p = canvasPos(e);
    const x = Math.max(0, Math.round(p.x - state.draggingNote.offsetX));
    const y = Math.max(0, Math.round(p.y - state.draggingNote.offsetY));
    node.style.left = x + 'px';
    node.style.top = y + 'px';
  });
  node.addEventListener('pointerup', (e) => {
    if (!state.draggingNote || state.draggingNote.node !== node) return;
    node.classList.remove('dragging');
    const { id } = state.draggingNote;
    state.draggingNote = null;
    const elem = state.elements.find(x => x.id === id);
    if (!elem) return;
    elem.data = { ...elem.data, x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
    markEdited(elem);
  });

  node.addEventListener('click', () => {
    if (state.tool === 'eraser' && !node.classList.contains('readonly')) {
      deleteElement(Number(node.dataset.id), node);
    }
  });
}

function deleteElement(id, node) {
  node?.remove();
  removeLocalElement(id);
}

function createNoteAt(p) {
  const w = 180;
  const data = { x: Math.round(p.x - w / 2), y: Math.round(Math.max(0, p.y - 40)), w, text: '더블클릭해서 내용을 입력하세요' };
  const elem = addLocalElement('note', data);
  renderNotes();
  setTimeout(() => {
    const node = document.getElementById('note-' + elem.id);
    const t = node?.querySelector('.note-text');
    if (t) { t.focus(); selectAllText(t); }
  }, 30);
}

/* ============================================================
   캔버스 포인터 입력 — 펜 / 스티키노트 배치 / 지우개
   ============================================================ */

function canvasPos(e) {
  const rect = inner.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / state.viewport.scale,
    y: (e.clientY - rect.top) / state.viewport.scale,
  };
}

function setStrokeStyle(width) {
  const mine = state.layers.find(l => l.isMine);
  ctx.strokeStyle = mine ? mine.color : '#4a9eff';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.board || state.activePointers.size >= 2) return;
  if (state.tool === 'pen') {
    canvas.setPointerCapture(e.pointerId);
    const p = canvasPos(e);
    const width = Number(el('penWidth').value);
    state.drawing = { points: [p], width };
    setStrokeStyle(width);
    ctx.beginPath();
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.tool === 'note') {
    createNoteAt(canvasPos(e));
  } else if (state.tool === 'eraser') {
    eraseAt(canvasPos(e));
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (state.activePointers.size >= 2) return;
  if (state.tool !== 'pen' || !state.drawing) return;
  const p = canvasPos(e);
  const last = state.drawing.points[state.drawing.points.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
  state.drawing.points.push(p);
  setStrokeStyle(state.drawing.width);
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
});

window.addEventListener('pointerup', () => {
  if (state.tool !== 'pen' || !state.drawing || !state.board) return;
  const stroke = state.drawing;
  state.drawing = null;
  addLocalElement('stroke', { points: stroke.points, width: stroke.width });
});

function distToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

function hitStroke(elem, p) {
  const pts = elem.data.points;
  const threshold = Math.max(8, elem.data.width || 3);
  if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= threshold;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(p, pts[i], pts[i + 1]) <= threshold) return true;
  }
  return false;
}

function eraseAt(p) {
  const strokes = state.elements.filter(e => e.type === 'stroke' && !state.hiddenLayers.has(e.layer_id));
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (!hitStroke(strokes[i], p)) continue;
    const s = strokes[i];
    if (!canEditElement(s)) { toast('다른 사람이 그린 내용은 지울 수 없어요'); return; }
    removeLocalElement(s.id);
    renderStrokes();
    return;
  }
}

/* ============================================================
   화면 확대/이동
   ─────────────────────────────────────────────────────────────
   canvasWrap에서 캡처링 단계로 모든 포인터를 추적한다 — 캔버스/스티키노트
   각각의 pointerdown 핸들러보다 먼저 실행되므로, (1) 손가락이 2개 이상이
   되는 순간 진행 중이던 펜 드로잉/노트 드래그를 취소하고 핀치 확대/이동으로
   전환하거나, (2) '이동' 툴이 선택된 상태에서 캔버스든 스티키노트든 어디를
   눌러도 항상 화면 이동으로 처리할 수 있다.
   손가락 2개 핀치는 기기별 터치 처리 차이로 신뢰도가 떨어질 수 있어,
   펜/노트/지우개와 별도인 명시적 '이동' 툴(한 손가락/마우스 드래그)을
   기본 이동 수단으로 둔다.
   ============================================================ */

// 캔버스(2400x1400)는 크기가 고정돼 있는데 팬 이동에는 제한이 없어서, 화면을 계속
// 이동하면 캔버스 밖(그릴 수 없는 canvas-wrap 배경만 있는 영역)까지 보이던 문제가
// 있었다 — 뷰포트가 캔버스 경계를 벗어나지 못하도록 매번 여기서 clamp한다.
function clampViewport() {
  const wrapRect = wrap.getBoundingClientRect();
  const canvasW = CANVAS_W * state.viewport.scale;
  const canvasH = CANVAS_H * state.viewport.scale;

  state.viewport.x = canvasW <= wrapRect.width
    ? (wrapRect.width - canvasW) / 2
    : Math.min(0, Math.max(wrapRect.width - canvasW, state.viewport.x));

  state.viewport.y = canvasH <= wrapRect.height
    ? (wrapRect.height - canvasH) / 2
    : Math.min(0, Math.max(wrapRect.height - canvasH, state.viewport.y));
}

function applyViewportTransform() {
  clampViewport();
  inner.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`;
}

function resetViewport() {
  state.viewport = { scale: 1, x: 0, y: 0 };
  applyViewportTransform();
}

function pointerDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pointerMidpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function cancelActiveDrawing() {
  if (state.drawing) { state.drawing = null; renderStrokes(); }
  if (state.draggingNote) {
    state.draggingNote.node.classList.remove('dragging');
    state.draggingNote = null;
    renderNotes(); // 진행 중이던 이동은 취소하고 마지막 저장 위치로 되돌린다
  }
  state.panning = null;
}

function startPinch() {
  const pts = [...state.activePointers.values()].slice(0, 2);
  state.pinch = {
    startDist: pointerDistance(pts[0], pts[1]),
    startMid: pointerMidpoint(pts[0], pts[1]),
    startScale: state.viewport.scale,
    startX: state.viewport.x,
    startY: state.viewport.y,
  };
}

wrap.addEventListener('pointerdown', (e) => {
  state.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (state.activePointers.size === 2) {
    cancelActiveDrawing();
    startPinch();
  } else if (state.activePointers.size > 2 && !state.pinch) {
    startPinch();
  } else if (state.activePointers.size === 1 && state.tool === 'pan') {
    state.panning = {
      pointerId: e.pointerId,
      startClientX: e.clientX, startClientY: e.clientY,
      startX: state.viewport.x, startY: state.viewport.y,
    };
  }
}, true);

wrap.addEventListener('pointermove', (e) => {
  if (!state.activePointers.has(e.pointerId)) return;
  state.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (state.activePointers.size >= 2 && state.pinch) {
    const pts = [...state.activePointers.values()].slice(0, 2);
    const dist = pointerDistance(pts[0], pts[1]);
    const mid = pointerMidpoint(pts[0], pts[1]);
    state.viewport.scale = Math.max(0.4, Math.min(3, state.pinch.startScale * (dist / state.pinch.startDist)));
    state.viewport.x = state.pinch.startX + (mid.x - state.pinch.startMid.x);
    state.viewport.y = state.pinch.startY + (mid.y - state.pinch.startMid.y);
    applyViewportTransform();
    return;
  }
  if (state.panning && state.panning.pointerId === e.pointerId) {
    state.viewport.x = state.panning.startX + (e.clientX - state.panning.startClientX);
    state.viewport.y = state.panning.startY + (e.clientY - state.panning.startClientY);
    applyViewportTransform();
  }
}, true);

function releasePointer(e) {
  state.activePointers.delete(e.pointerId);
  if (state.activePointers.size < 2) state.pinch = null;
  if (state.panning && state.panning.pointerId === e.pointerId) state.panning = null;
}
wrap.addEventListener('pointerup', releasePointer, true);
wrap.addEventListener('pointercancel', releasePointer, true);

// 데스크톱: 트랙패드/휠 스크롤로 이동 (canvas-wrap이 overflow:hidden이라 네이티브
// 스크롤 대신 동일한 viewport 이동으로 처리 — 확대 배율과 함께 동작하려면 필요)
wrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.viewport.x -= e.deltaX;
  state.viewport.y -= e.deltaY;
  applyViewportTransform();
}, { passive: false });

el('btnResetView').addEventListener('click', resetViewport);
el('btnSyncNow').addEventListener('click', () => { startAutoSync(); syncNow(); });

// 아직 서버에 반영 안 된 변경사항이 있는 채로 탭을 닫거나 새로고침하면 그 내용이
// 사라질 수 있다는 걸 브라우저 기본 확인창으로 알려준다 (SPA 내 이동은 route()에서 flush).
window.addEventListener('beforeunload', (e) => {
  if (pendingCount() === 0) return;
  e.preventDefault();
  e.returnValue = '';
});

// 창 크기/화면 회전이 바뀌면(모바일 세로↔가로 등) 뷰포트 경계도 다시 계산해야
// 캔버스 밖 여백이 드러나지 않는다. 보드를 보고 있을 때만 의미가 있다.
window.addEventListener('resize', () => { if (state.board) applyViewportTransform(); });

/* ============================================================
   툴바 / 보드 관리
   ============================================================ */

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.tool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b === btn));
    canvas.style.cursor = state.tool === 'note' ? 'copy' : state.tool === 'pan' ? 'grab' : 'crosshair';
  });
});

el('myColorInput').addEventListener('change', async () => {
  const mine = state.layers.find(l => l.isMine);
  if (!mine) return;
  try {
    await api('PUT', `/layers/${mine.id}`, { color: el('myColorInput').value });
    await refreshLayers();
    renderAll();
  } catch (e) { toast(e.message); }
});

el('btnLayersToggle').addEventListener('click', () => {
  el('layersPanel').classList.toggle('collapsed');
});

el('btnBoardManage').addEventListener('click', async () => {
  if (!state.board) return;
  const title = window.prompt('보드 제목', state.board.title);
  if (title === null) return;
  const description = window.prompt('설명', state.board.description || '');
  if (description === null) return;
  try {
    state.board = await api('PUT', `/boards/${state.board.id}`, {
      title: title.trim() || state.board.title,
      description: description.trim(),
    });
    el('boardTitleInput').value = state.board.title;
    toast('보드 정보를 수정했습니다');
  } catch (e) { toast(e.message); }
});

el('btnBoardDelete').addEventListener('click', async () => {
  if (!state.board) return;
  if (!window.confirm(`'${state.board.title}' 보드를 삭제할까요?\n모든 참여자의 내용이 함께 삭제되며 되돌릴 수 없습니다.`)) return;
  try {
    await api('DELETE', `/boards/${state.board.id}`);
    toast('보드를 삭제했습니다');
    navigate(BASE + '/');
  } catch (e) { toast(e.message); }
});

el('btnNewBoard').addEventListener('click', createBoard);
el('btnBack').addEventListener('click', () => navigate(BASE + '/'));

/* ============================================================
   초기화
   ============================================================ */

window.addEventListener('popstate', route);

(async function init() {
  await loadMe();
  await route();
})();

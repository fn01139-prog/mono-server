// projects/mindmap/public/js/app.js

/* ============================================================
   상태
   ============================================================ */

const state = {
  boards: [],
  boardId: null,
  objects: [],      // {id, name, content, pos_x, pos_y, color, width, height, shape}
  relations: [],    // {id, parent_id, child_id, label}

  selectedId: null,           // 상세 패널에 표시할 단일 선택 ID
  selectedIds: new Set(),     // 다중 선택 ID 집합

  relationMode: false,
  relationFirst: null,

  drag: null,                 // 드래그 진행 중 정보
  viewport: { scale: 1, panX: 0, panY: 0 },
  spaceHeld: false,
  isPanning: false,
  inlineEdit: null,           // {objId, input, nodeEl}
  searchQuery: '',
};

/* ============================================================
   Undo / Redo
   ============================================================ */

const undoStack = [];   // 되돌리기 스택
const redoStack = [];   // 다시실행 스택
const MAX_HISTORY = 50;

// action 형식
// { type: 'move',         before: [{id, pos_x, pos_y}], after: [...] }
// { type: 'relation_add', relation: {id, board_id, parent_id, child_id, label} }
// { type: 'relation_del', relation: {...} }
// { type: 'inline_name',  id, before: string, after: string }

function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

async function undo() {
  if (!undoStack.length) { toast('더 이상 되돌릴 수 없습니다'); return; }
  const action = undoStack.pop();
  redoStack.push(action);
  await applyAction(action, 'undo');
}

async function redo() {
  if (!redoStack.length) { toast('다시 실행할 내용이 없습니다'); return; }
  const action = redoStack.pop();
  undoStack.push(action);
  await applyAction(action, 'redo');
}

async function applyAction(action, dir) {
  if (action.type === 'move') {
    const positions = dir === 'undo' ? action.before : action.after;
    positions.forEach(({ id, pos_x, pos_y }) => {
      const o = state.objects.find(obj => obj.id === id);
      if (o) {
        o.pos_x = pos_x;
        o.pos_y = pos_y;
        markDetailDirty(id, { pos_x, pos_y });
      }
    });
    renderCanvas();
    return;
  }

  if (action.type === 'relation_add') {
    if (dir === 'undo') {
      await api('DELETE', `api/relations/${action.relation.id}`);
      state.relations = state.relations.filter(r => r.id !== action.relation.id);
    } else {
      const created = await api('POST', `api/boards/${state.boardId}/relations`, {
        parent_id: action.relation.parent_id,
        child_id: action.relation.child_id,
        label: action.relation.label,
      });
      state.relations.push(created);
      action.relation.id = created.id;  // redo 시 id 갱신
    }
    renderCanvas();
    if (state.selectedId) renderRelationList(state.selectedId);
    return;
  }

  if (action.type === 'relation_del') {
    if (dir === 'undo') {
      const created = await api('POST', `api/boards/${state.boardId}/relations`, {
        parent_id: action.relation.parent_id,
        child_id: action.relation.child_id,
        label: action.relation.label,
      });
      state.relations.push(created);
      action.relation.id = created.id;
    } else {
      await api('DELETE', `api/relations/${action.relation.id}`);
      state.relations = state.relations.filter(r => r.id !== action.relation.id);
    }
    renderCanvas();
    if (state.selectedId) renderRelationList(state.selectedId);
    return;
  }

  if (action.type === 'inline_name') {
    const name = dir === 'undo' ? action.before : action.after;
    const o = state.objects.find(obj => obj.id === action.id);
    if (o) {
      o.name = name;
      markHeaderDirty(action.id, { name: o.name, content: o.content });
      renderObjectList();
      renderCanvas();
      if (state.selectedId === action.id) el('fName').value = o.name;
    }
    return;
  }
}

/* ============================================================
   유틸
   ============================================================ */

const el = (id) => document.getElementById(id);

function toast(msg) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok || !json || json.success === false) {
    throw new Error((json && json.message) || `요청 실패 (${res.status})`);
  }
  return json.data;
}

function parseObjectNumerics(o) {
  return {
    ...o,
    pos_x: Number(o.pos_x) || 0,
    pos_y: Number(o.pos_y) || 0,
    width: Number(o.width) || 140,
    height: Number(o.height) || 60,
  };
}

function isInputFocused() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/* ============================================================
   지연 저장 (Deferred DB flush)
   ============================================================ */

const FLUSH_INTERVAL = 25000;

const pendingUpdates = {
  headers: new Map(),
  details: new Map(),
};

let flushTimer = null;

function hasPending() {
  return pendingUpdates.headers.size > 0 || pendingUpdates.details.size > 0;
}

function markHeaderDirty(objId, data) {
  const prev = pendingUpdates.headers.get(objId) || {};
  pendingUpdates.headers.set(objId, { ...prev, ...data });
  scheduleFlush();
}

function markDetailDirty(objId, data) {
  const prev = pendingUpdates.details.get(objId) || {};
  pendingUpdates.details.set(objId, { ...prev, ...data });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flushPending, FLUSH_INTERVAL);
}

async function flushPending() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!hasPending()) return;

  const headerEntries = [...pendingUpdates.headers.entries()];
  const detailEntries = [...pendingUpdates.details.entries()];
  pendingUpdates.headers.clear();
  pendingUpdates.details.clear();

  await Promise.all([
    ...headerEntries.map(([id, data]) =>
      api('PUT', `api/objects/${id}`, data).catch((err) => toast('자동 저장 실패: ' + err.message))
    ),
    ...detailEntries.map(([id, data]) =>
      api('PUT', `api/objects/${id}/detail`, data).catch((err) => toast('자동 저장 실패: ' + err.message))
    ),
  ]);
}

/* ============================================================
   뷰포트 (팬 / 줌)
   ============================================================ */

function applyViewport() {
  const { scale, panX, panY } = state.viewport;
  el('canvasInner').style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
}

function updateZoomLabel() {
  const lbl = el('zoomLabel');
  if (lbl) lbl.textContent = Math.round(state.viewport.scale * 100) + '%';
}

// 스크린 좌표 → 캔버스 논리 좌표
function toCanvas(clientX, clientY) {
  const rect = el('canvasWrap').getBoundingClientRect();
  return {
    x: (clientX - rect.left  - state.viewport.panX) / state.viewport.scale,
    y: (clientY - rect.top   - state.viewport.panY) / state.viewport.scale,
  };
}

function zoomAt(clientX, clientY, factor) {
  const rect = el('canvasWrap').getBoundingClientRect();
  const scx = clientX - rect.left;
  const scy = clientY - rect.top;
  const oldScale = state.viewport.scale;
  const newScale = Math.min(4, Math.max(0.1, oldScale * factor));
  const ratio = newScale / oldScale;
  state.viewport.panX = scx - (scx - state.viewport.panX) * ratio;
  state.viewport.panY = scy - (scy - state.viewport.panY) * ratio;
  state.viewport.scale = newScale;
  applyViewport();
  updateZoomLabel();
}

function resetZoom() {
  state.viewport = { scale: 1, panX: 0, panY: 0 };
  applyViewport();
  updateZoomLabel();
}

function startPan(e) {
  e.preventDefault();
  state.isPanning = true;
  const startX = e.clientX - state.viewport.panX;
  const startY = e.clientY - state.viewport.panY;
  el('canvasWrap').classList.add('panning');

  function onMove(ev) {
    state.viewport.panX = ev.clientX - startX;
    state.viewport.panY = ev.clientY - startY;
    applyViewport();
  }
  function onUp() {
    state.isPanning = false;
    el('canvasWrap').classList.remove('panning');
    if (state.spaceHeld) el('canvasWrap').classList.add('pan-ready');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ============================================================
   초기화
   ============================================================ */

async function init() {
  bindGlobalEvents();
  setActionButtonsEnabled(false);
  applyViewport();
  updateZoomLabel();
  try {
    await loadBoards();
    setActionButtonsEnabled(true);
  } catch (err) {
    toast('초기 데이터를 불러오지 못했습니다: ' + err.message);
  }
}

function setActionButtonsEnabled(enabled) {
  el('btnNewObject').disabled = !enabled;
  el('btnRelationMode').disabled = !enabled;
  el('btnAutoLayout').disabled = !enabled;
}

async function loadBoards() {
  state.boards = await api('GET', 'api/boards');

  if (state.boards.length === 0) {
    const created = await api('POST', 'api/boards', { title: '새 마인드맵' });
    state.boards = [created];
  }

  renderBoardSelect();

  const remembered = localStorage.getItem('mindmap:lastBoardId');
  const rememberedExists = state.boards.find((b) => String(b.id) === remembered);
  await selectBoard(rememberedExists ? remembered : state.boards[0].id);
}

function renderBoardSelect() {
  const sel = el('boardSelect');
  sel.innerHTML = '';
  state.boards.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.title;
    sel.appendChild(opt);
  });
}

async function selectBoard(boardId) {
  await flushPending();

  state.boardId = String(boardId);
  state.selectedId = null;
  state.selectedIds = new Set();
  localStorage.setItem('mindmap:lastBoardId', state.boardId);

  el('boardSelect').value = state.boardId;
  const board = state.boards.find((b) => String(b.id) === state.boardId);
  el('boardTitle').value = board ? board.title : '';

  undoStack.length = 0;
  redoStack.length = 0;

  await Promise.all([loadObjects(), loadRelations()]);
  renderObjectList();
  renderCanvas();
  renderDetailPanel();
}

async function loadObjects() {
  const raw = await api('GET', `api/boards/${state.boardId}/objects`);
  state.objects = raw.map(parseObjectNumerics);
}

async function loadRelations() {
  state.relations = await api('GET', `api/boards/${state.boardId}/relations`);
}

/* ============================================================
   보드 관리
   ============================================================ */

async function createBoard() {
  const title = window.prompt('새 마인드맵의 제목을 입력하세요', '새 마인드맵');
  if (!title) return;
  const created = await api('POST', 'api/boards', { title });
  state.boards.unshift(created);
  renderBoardSelect();
  await selectBoard(created.id);
}

async function updateBoardTitle(title) {
  if (!state.boardId) return;
  const updated = await api('PUT', `api/boards/${state.boardId}`, { title });
  const idx = state.boards.findIndex((b) => String(b.id) === state.boardId);
  if (idx >= 0) state.boards[idx] = updated;
  renderBoardSelect();
  el('boardSelect').value = state.boardId;
}

/* ============================================================
   객체 목록 (좌측 패널)
   ============================================================ */

function renderObjectList() {
  const ul = el('objectList');
  ul.innerHTML = '';

  const q = state.searchQuery.trim().toLowerCase();
  const filtered = q ? state.objects.filter(o => o.name.toLowerCase().includes(q)) : state.objects;

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = q ? '검색 결과 없음' : '아직 항목이 없습니다';
    ul.appendChild(li);
    return;
  }

  filtered.forEach((obj) => {
    const isSelected = state.selectedIds.has(obj.id) || obj.id === state.selectedId;
    const li = document.createElement('li');
    li.className = 'object-item' + (isSelected ? ' selected' : '');
    li.dataset.id = obj.id;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = obj.color || '#F2A93B';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = obj.name;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = '삭제';
    remove.addEventListener('click', (e) => { e.stopPropagation(); deleteObject(obj.id); });

    li.append(swatch, name, remove);
    li.addEventListener('click', () => selectObject(obj.id));
    ul.appendChild(li);
  });
}

/* ============================================================
   다중 선택
   ============================================================ */

function clearSelection() {
  state.selectedIds = new Set();
  state.selectedId = null;
  updateMultiSelectBanner();
  renderObjectList();
  renderCanvas();
  renderDetailPanel();
}

function selectOnly(objId) {
  state.selectedIds = new Set([objId]);
  state.selectedId = objId;
  updateMultiSelectBanner();
}

function toggleInSelection(objId) {
  if (state.selectedIds.has(objId)) {
    state.selectedIds.delete(objId);
    state.selectedId = state.selectedIds.size > 0 ? [...state.selectedIds].at(-1) : null;
  } else {
    state.selectedIds.add(objId);
    state.selectedId = objId;
  }
  updateMultiSelectBanner();
}

function updateMultiSelectBanner() {
  const banner = el('multiSelectBanner');
  const count = state.selectedIds.size;
  if (count > 1) {
    banner.textContent = `${count}개 항목 선택됨 · Delete로 삭제`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

/* ============================================================
   캔버스 렌더링
   ============================================================ */

function renderCanvas() {
  el('canvasHint').classList.toggle('hidden', state.objects.length > 0);

  const layer = el('nodeLayer');
  // 인라인 편집 중인 input 요소는 유지
  const editInput = state.inlineEdit ? state.inlineEdit.input : null;
  layer.innerHTML = '';
  if (editInput) layer.appendChild(editInput);

  state.objects.forEach((obj) => {
    const isDetailSelected = obj.id === state.selectedId;
    const isMultiSelected  = state.selectedIds.has(obj.id);

    const node = document.createElement('div');
    let cls = 'node';
    if (state.relationMode && state.relationFirst === obj.id) cls += ' relation-pending';
    else if (isMultiSelected && state.selectedIds.size > 1) cls += ' multi-selected';
    else if (isDetailSelected) cls += ' selected';

    if (state.searchQuery.trim()) {
      const q = state.searchQuery.trim().toLowerCase();
      if (obj.name.toLowerCase().includes(q)) {
        if (!isDetailSelected && !isMultiSelected) cls += ' search-match';
      } else {
        if (!isDetailSelected && !isMultiSelected) cls += ' search-dim';
      }
    }

    node.className = cls;

    node.dataset.id = obj.id;
    node.dataset.shape = obj.shape || 'rounded-rect';
    node.style.left   = `${obj.pos_x}px`;
    node.style.top    = `${obj.pos_y}px`;
    node.style.width  = `${obj.width}px`;
    node.style.height = `${obj.height}px`;
    node.style.background = obj.color || '#F2A93B';

    // 인라인 편집 중인 노드는 숨김 (nodeEl 참조도 갱신)
    if (state.inlineEdit && state.inlineEdit.objId === obj.id) {
      node.style.visibility = 'hidden';
      state.inlineEdit.nodeEl = node;
    }

    node.textContent = obj.name;

    node.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (state.inlineEdit) return;
      if (state.relationMode) {
        e.stopPropagation();
        handleRelationClick(obj.id);
        return;
      }
      startDrag(e, obj.id);
    });

    node.addEventListener('dblclick', (e) => {
      if (state.relationMode) return;
      e.stopPropagation();
      startInlineEdit(obj.id);
    });

    layer.appendChild(node);
  });

  drawRelations();
}

function nodeCenter(obj) {
  return { x: obj.pos_x + obj.width / 2, y: obj.pos_y + obj.height / 2 };
}

function drawRelations() {
  const svg = el('relationLayer');
  const byId = Object.fromEntries(state.objects.map((o) => [String(o.id), o]));

  const defs = `<defs>
    <marker id="arrowHead" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent-2)"></path>
    </marker>
  </defs>`;

  const paths = state.relations.map((rel) => {
    const parent = byId[String(rel.parent_id)];
    const child  = byId[String(rel.child_id)];
    if (!parent || !child) return '';

    const p1 = nodeCenter(parent);
    const p2 = nodeCenter(child);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const co = Math.max(-40, Math.min(40, dy * 0.25 - dx * 0.05));

    // 베지어 t=0.5 중점
    const lx = midX + co / 2;
    const ly = midY - co / 2;
    const labelEl = rel.label
      ? `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle"
               font-size="11" font-family="Inter,sans-serif" fill="var(--accent-2)"
               paint-order="stroke" stroke="var(--bg)" stroke-width="4" stroke-linejoin="round">${escapeHtml(rel.label)}</text>`
      : '';

    return `<path d="M ${p1.x} ${p1.y} Q ${midX + co} ${midY - co} ${p2.x} ${p2.y}"
                  stroke="var(--accent-2)" stroke-width="2" fill="none"
                  opacity="0.85" marker-end="url(#arrowHead)" data-relation-id="${rel.id}"></path>
            ${labelEl}`;
  }).join('');

  svg.innerHTML = defs + paths;
}

/* ============================================================
   드래그 이동 (단일 / 다중)
   ============================================================ */

function startDrag(e, objId) {
  if (state.relationMode) return;
  e.preventDefault();
  e.stopPropagation();

  const shiftHeld = e.shiftKey;

  // Shift 클릭이면 선택 토글 후 드래그 없이 종료
  if (shiftHeld) {
    toggleInSelection(objId);
    renderObjectList();
    renderCanvas();
    renderDetailPanel();
    return;
  }

  // 선택 집합 결정: 클릭한 노드가 이미 선택 집합에 없으면 단독 선택
  if (!state.selectedIds.has(objId)) {
    selectOnly(objId);
    renderObjectList();
    renderCanvas();
    renderDetailPanel();
  }

  const startCanvas = toCanvas(e.clientX, e.clientY);
  const startPositions = [...state.selectedIds].map((id) => {
    const o = state.objects.find((obj) => obj.id === id);
    return { id, pos_x: o.pos_x, pos_y: o.pos_y };
  });

  const dragState = {
    startCanvasX: startCanvas.x,
    startCanvasY: startCanvas.y,
    startPositions,
    moved: false,
  };
  state.drag = dragState;

  function onMove(ev) {
    const cur = toCanvas(ev.clientX, ev.clientY);
    const dx = cur.x - dragState.startCanvasX;
    const dy = cur.y - dragState.startCanvasY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true;

    dragState.startPositions.forEach(({ id, pos_x, pos_y }) => {
      const o = state.objects.find((obj) => obj.id === id);
      if (!o) return;
      o.pos_x = Math.max(0, pos_x + dx);
      o.pos_y = Math.max(0, pos_y + dy);
      const nodeEl = el('nodeLayer').querySelector(`[data-id="${id}"]`);
      if (nodeEl) {
        nodeEl.style.left = `${o.pos_x}px`;
        nodeEl.style.top  = `${o.pos_y}px`;
      }
    });
    drawRelations();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    if (dragState.moved) {
      const afterPositions = dragState.startPositions.map(({ id }) => {
        const o = state.objects.find((obj) => obj.id === id);
        return { id, pos_x: o.pos_x, pos_y: o.pos_y };
      });
      pushUndo({ type: 'move', before: dragState.startPositions, after: afterPositions });
      dragState.startPositions.forEach(({ id }) => {
        const o = state.objects.find((obj) => obj.id === id);
        if (o) markDetailDirty(id, { pos_x: o.pos_x, pos_y: o.pos_y });
      });
    } else if (!shiftHeld) {
      // 이동 없이 클릭 → 단독 선택 (이미 처리됨)
    }

    state.drag = null;
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ============================================================
   마키 선택 (Rubber-band)
   ============================================================ */

function startMarquee(e) {
  const wrapRect = el('canvasWrap').getBoundingClientRect();
  const startX = e.clientX - wrapRect.left;
  const startY = e.clientY - wrapRect.top;

  const marqueeEl = el('marquee');
  marqueeEl.classList.remove('hidden');
  marqueeEl.style.cssText = `left:${startX}px;top:${startY}px;width:0;height:0;`;

  let moved = false;

  function onMove(ev) {
    const cx = ev.clientX - wrapRect.left;
    const cy = ev.clientY - wrapRect.top;
    const x  = Math.min(cx, startX);
    const y  = Math.min(cy, startY);
    const w  = Math.abs(cx - startX);
    const h  = Math.abs(cy - startY);
    if (w > 3 || h > 3) moved = true;
    marqueeEl.style.left   = `${x}px`;
    marqueeEl.style.top    = `${y}px`;
    marqueeEl.style.width  = `${w}px`;
    marqueeEl.style.height = `${h}px`;
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    marqueeEl.classList.add('hidden');

    if (!moved) return;

    const cx = ev.clientX - wrapRect.left;
    const cy = ev.clientY - wrapRect.top;
    const mx = Math.min(cx, startX);
    const my = Math.min(cy, startY);
    const mw = Math.abs(cx - startX);
    const mh = Math.abs(cy - startY);
    if (mw < 4 || mh < 4) return;

    // 마키 좌표를 캔버스 논리 좌표로 변환
    const { panX, panY, scale } = state.viewport;
    const minCX = (mx - panX) / scale;
    const minCY = (my - panY) / scale;
    const maxCX = minCX + mw / scale;
    const maxCY = minCY + mh / scale;

    const hit = state.objects.filter((o) =>
      o.pos_x < maxCX && o.pos_x + o.width  > minCX &&
      o.pos_y < maxCY && o.pos_y + o.height > minCY
    );

    if (hit.length === 0) return;

    if (e.shiftKey) {
      hit.forEach((o) => state.selectedIds.add(o.id));
    } else {
      state.selectedIds = new Set(hit.map((o) => o.id));
    }
    state.selectedId = [...state.selectedIds].at(-1);
    updateMultiSelectBanner();
    renderObjectList();
    renderCanvas();
    renderDetailPanel();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ============================================================
   인라인 편집 (더블클릭)
   ============================================================ */

function startInlineEdit(objId) {
  const obj = state.objects.find((o) => o.id === objId);
  if (!obj) return;
  cancelInlineEdit();

  selectOnly(objId);

  const shapeRadius = {
    'rounded-rect': '14px',
    'ellipse': '50%',
    'circle': '50%',
    'diamond': '6px',
  }[obj.shape || 'rounded-rect'] || '14px';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit';
  input.value = obj.name;
  input.style.left         = `${obj.pos_x}px`;
  input.style.top          = `${obj.pos_y}px`;
  input.style.width        = `${obj.width}px`;
  input.style.height       = `${obj.height}px`;
  input.style.background   = obj.color || '#F2A93B';
  input.style.borderRadius = shapeRadius;

  el('nodeLayer').appendChild(input);

  const nodeEl = el('nodeLayer').querySelector(`[data-id="${objId}"]`);
  if (nodeEl) nodeEl.style.visibility = 'hidden';

  state.inlineEdit = { objId, input, nodeEl };

  input.focus();
  input.select();

  const prevName = obj.name;

  const commit = () => {
    if (!state.inlineEdit || state.inlineEdit.input !== input) return;
    const newName = input.value.trim() || prevName;
    cleanup();
    if (newName !== prevName) {
      pushUndo({ type: 'inline_name', id: objId, before: prevName, after: newName });
      obj.name = newName;
      markHeaderDirty(objId, { name: obj.name, content: obj.content });
    }
    renderObjectList();
    renderCanvas();
    if (state.selectedId === objId) el('fName').value = obj.name;
  };

  const cleanup = () => {
    if (!state.inlineEdit || state.inlineEdit.input !== input) return;
    if (state.inlineEdit.nodeEl) state.inlineEdit.nodeEl.style.visibility = '';
    input.remove();
    state.inlineEdit = null;
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();  // Ctrl+Z 등 전역 단축키 차단
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { cleanup(); renderCanvas(); }
  });
  input.addEventListener('blur', commit);
}

function cancelInlineEdit() {
  if (!state.inlineEdit) return;
  if (state.inlineEdit.nodeEl) state.inlineEdit.nodeEl.style.visibility = '';
  state.inlineEdit.input.remove();
  state.inlineEdit = null;
}

/* ============================================================
   객체 생성 / 삭제
   ============================================================ */

async function createObject() {
  if (!state.boardId) {
    toast('보드를 아직 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    return;
  }

  const count = state.objects.length;
  const pos_x = 60 + (count % 8) * 40;
  const pos_y = 60 + Math.floor(count / 8) * 100;

  const created = await api('POST', `api/boards/${state.boardId}/objects`, {
    name: '새 항목', content: '', pos_x, pos_y,
  });
  state.objects.push(parseObjectNumerics(created));
  selectOnly(created.id);
  renderObjectList();
  renderCanvas();
  await renderDetailPanel();
  el('fName').focus();
  el('fName').select();
}

async function deleteObject(objId) {
  if (!window.confirm('이 항목을 삭제할까요? 연결된 관계와 메모도 함께 삭제됩니다.')) return;

  pendingUpdates.headers.delete(objId);
  pendingUpdates.details.delete(objId);

  await api('DELETE', `api/objects/${objId}`);
  state.objects = state.objects.filter((o) => o.id !== objId);
  state.relations = state.relations.filter((r) => r.parent_id !== objId && r.child_id !== objId);
  state.selectedIds.delete(objId);
  if (state.selectedId === objId) state.selectedId = [...state.selectedIds].at(-1) ?? null;
  updateMultiSelectBanner();
  renderObjectList();
  renderCanvas();
  renderDetailPanel();
}

async function deleteSelectedObjects() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const msg = ids.length === 1
    ? '이 항목을 삭제할까요? 연결된 관계와 메모도 함께 삭제됩니다.'
    : `선택한 ${ids.length}개 항목을 모두 삭제할까요?`;
  if (!window.confirm(msg)) return;

  for (const id of ids) {
    pendingUpdates.headers.delete(id);
    pendingUpdates.details.delete(id);
    await api('DELETE', `api/objects/${id}`);
  }

  const idSet = new Set(ids);
  state.objects   = state.objects.filter((o) => !idSet.has(o.id));
  state.relations = state.relations.filter((r) => !idSet.has(r.parent_id) && !idSet.has(r.child_id));
  state.selectedIds = new Set();
  state.selectedId  = null;
  updateMultiSelectBanner();
  renderObjectList();
  renderCanvas();
  renderDetailPanel();
}

/* ============================================================
   상세 패널 (우측)
   ============================================================ */

async function selectObject(objId) {
  selectOnly(objId);
  renderObjectList();
  renderCanvas();
  await renderDetailPanel();
}

async function renderDetailPanel() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  el('detailEmpty').classList.toggle('hidden', !!obj);
  el('detailForm').classList.toggle('hidden', !obj);
  if (!obj) return;

  el('fName').value    = obj.name || '';
  el('fContent').value = obj.content || '';
  el('fColor').value   = obj.color || '#F2A93B';
  el('fShape').value   = obj.shape || 'rounded-rect';
  el('fWidth').value   = obj.width;
  el('fHeight').value  = obj.height;

  renderRelationList(obj.id);
  await renderMemoList(obj.id);
}

function renderRelationList(objId) {
  const ul = el('relationList');
  ul.innerHTML = '';
  const byId = Object.fromEntries(state.objects.map((o) => [o.id, o]));
  const related = state.relations.filter((r) => r.parent_id === objId || r.child_id === objId);

  if (related.length === 0) {
    const li = document.createElement('li');
    li.textContent = '연결된 관계가 없습니다';
    li.style.color = 'var(--text-muted)';
    ul.appendChild(li);
    return;
  }

  related.forEach((rel) => {
    const isParent = rel.parent_id === objId;
    const otherId  = isParent ? rel.child_id : rel.parent_id;
    const other    = byId[otherId];

    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = `<span class="arrow">${isParent ? '↳ 자식' : '↰ 부모'}</span> ${other ? other.name : '(삭제됨)'}`;
    nameSpan.style.flex = '1';
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'relation-label-input';
    labelInput.value = rel.label || '';
    labelInput.placeholder = '라벨';
    labelInput.title = '관계선 라벨';

    const commitLabel = async () => {
      const newLabel = labelInput.value.trim() || null;
      const curLabel = rel.label || null;
      if (newLabel === curLabel) return;
      try {
        await updateRelationLabel(rel.id, newLabel);
      } catch (err) {
        toast('라벨 저장 실패: ' + err.message);
        labelInput.value = rel.label || '';
      }
    };
    labelInput.addEventListener('blur', commitLabel);
    labelInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); labelInput.blur(); }
      if (e.key === 'Escape') { labelInput.value = rel.label || ''; labelInput.blur(); }
    });

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '✕';
    remove.title = '관계 삭제';
    remove.addEventListener('click', () => deleteRelation(rel.id));

    li.append(nameSpan, labelInput, remove);
    ul.appendChild(li);
  });
}

/* ----- 상세 폼 → 지연 저장 ----- */

function bindDetailFormEvents() {
  el('fName').addEventListener('change', saveHeader);
  el('fContent').addEventListener('change', saveHeader);
  el('fColor').addEventListener('input', saveDetail);
  el('fShape').addEventListener('change', saveDetail);
  el('fWidth').addEventListener('change', saveDetail);
  el('fHeight').addEventListener('change', saveDetail);
  el('btnDeleteObject').addEventListener('click', () => {
    if (state.selectedId) deleteObject(state.selectedId);
  });
}

function saveHeader() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;
  obj.name    = el('fName').value || '새 항목';
  obj.content = el('fContent').value;
  markHeaderDirty(obj.id, { name: obj.name, content: obj.content });
  renderObjectList();
  renderCanvas();
}

function saveDetail() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;
  obj.color  = el('fColor').value;
  obj.shape  = el('fShape').value;
  obj.width  = Number(el('fWidth').value)  || 140;
  obj.height = Number(el('fHeight').value) || 60;
  markDetailDirty(obj.id, { color: obj.color, shape: obj.shape, width: obj.width, height: obj.height });
  renderObjectList();
  renderCanvas();
}

/* ============================================================
   관계 연결 모드
   ============================================================ */

function toggleRelationMode() {
  state.relationMode  = !state.relationMode;
  state.relationFirst = null;
  el('btnRelationMode').dataset.active = String(state.relationMode);
  el('relationBanner').classList.toggle('hidden', !state.relationMode);
  renderCanvas();
}

async function handleRelationClick(objId) {
  if (state.relationFirst === null) {
    state.relationFirst = objId;
    renderCanvas();
    return;
  }
  if (state.relationFirst === objId) {
    state.relationFirst = null;
    renderCanvas();
    return;
  }

  const parent_id = state.relationFirst;
  const child_id  = objId;
  state.relationFirst = null;

  try {
    const created = await api('POST', `api/boards/${state.boardId}/relations`, { parent_id, child_id });
    state.relations.push(created);
    pushUndo({ type: 'relation_add', relation: { ...created } });
  } catch (err) {
    toast(err.message);
  }
  renderCanvas();
  if (state.selectedId === parent_id || state.selectedId === child_id) {
    renderRelationList(state.selectedId);
  }
}

async function deleteRelation(relationId) {
  const rel = state.relations.find((r) => r.id === relationId);
  await api('DELETE', `api/relations/${relationId}`);
  if (rel) pushUndo({ type: 'relation_del', relation: { ...rel } });
  state.relations = state.relations.filter((r) => r.id !== relationId);
  renderCanvas();
  if (state.selectedId) renderRelationList(state.selectedId);
}

async function updateRelationLabel(relId, label) {
  const updated = await api('PUT', `api/relations/${relId}`, { label });
  const rel = state.relations.find((r) => r.id === relId);
  if (rel) rel.label = updated.label;
  drawRelations();
}

/* ============================================================
   검색 / 필터
   ============================================================ */

function panToObject(obj) {
  const rect = el('canvasWrap').getBoundingClientRect();
  state.viewport.panX = rect.width  / 2 - (obj.pos_x + obj.width  / 2) * state.viewport.scale;
  state.viewport.panY = rect.height / 2 - (obj.pos_y + obj.height / 2) * state.viewport.scale;
  applyViewport();
}

function onSearch(query) {
  state.searchQuery = query;
  renderObjectList();
  renderCanvas();
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    const match = state.objects.find((o) => o.name.toLowerCase().includes(q));
    if (match) panToObject(match);
  }
}

/* ============================================================
   자동 레이아웃
   ============================================================ */

async function autoLayout() {
  if (!state.objects.length) return;

  const H_GAP = 60;
  const V_GAP = 100;
  const beforePositions = state.objects.map(({ id, pos_x, pos_y }) => ({ id, pos_x, pos_y }));

  // 관계가 전혀 없으면 그리드 배치
  if (!state.relations.length) {
    const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(state.objects.length))));
    state.objects.forEach((obj, i) => {
      obj.pos_x = 40 + (i % cols) * (obj.width + H_GAP);
      obj.pos_y = 40 + Math.floor(i / cols) * (obj.height + V_GAP);
      markDetailDirty(obj.id, { pos_x: obj.pos_x, pos_y: obj.pos_y });
    });
    const afterPositions = state.objects.map(({ id, pos_x, pos_y }) => ({ id, pos_x, pos_y }));
    pushUndo({ type: 'move', before: beforePositions, after: afterPositions });
    renderCanvas();
    toast('자동 정렬 완료');
    return;
  }

  // 인접 리스트 구성
  const childrenOf = new Map(state.objects.map((o) => [o.id, []]));
  const inDegree   = new Map(state.objects.map((o) => [o.id, 0]));

  state.relations.forEach((rel) => {
    if (childrenOf.has(rel.parent_id) && childrenOf.has(rel.child_id)) {
      childrenOf.get(rel.parent_id).push(rel.child_id);
      inDegree.set(rel.child_id, (inDegree.get(rel.child_id) || 0) + 1);
    }
  });

  const roots   = state.objects.map((o) => o.id).filter((id) => !inDegree.get(id));
  const placed  = new Set();
  const positions = new Map();

  // 서브트리 너비 계산 (캐시는 루트 단위로 초기화)
  const swCache = new Map();
  function subtreeW(id, seen = new Set()) {
    if (swCache.has(id)) return swCache.get(id);
    if (seen.has(id)) return 140;
    const obj = state.objects.find((o) => o.id === id);
    const nodeW = obj ? obj.width : 140;
    const children = (childrenOf.get(id) || []).filter((c) => !placed.has(c));
    if (!children.length) { swCache.set(id, nodeW); return nodeW; }
    const newSeen = new Set([...seen, id]);
    const total = children.reduce((s, c, i) => s + subtreeW(c, newSeen) + (i > 0 ? H_GAP : 0), 0);
    const result = Math.max(nodeW, total);
    swCache.set(id, result);
    return result;
  }

  function placeSubtree(id, cx, y) {
    if (placed.has(id)) return;
    placed.add(id);
    const obj = state.objects.find((o) => o.id === id);
    const nodeW = obj ? obj.width  : 140;
    const nodeH = obj ? obj.height : 60;
    positions.set(id, { x: cx - nodeW / 2, y });
    const children = (childrenOf.get(id) || []).filter((c) => !placed.has(c));
    const totalW = children.reduce((s, c, i) => s + subtreeW(c) + (i > 0 ? H_GAP : 0), 0);
    let startX = cx - totalW / 2;
    children.forEach((cid) => {
      const sw = subtreeW(cid);
      placeSubtree(cid, startX + sw / 2, y + nodeH + V_GAP);
      startX += sw + H_GAP;
    });
  }

  let offsetX = 40;
  roots.forEach((rid) => {
    swCache.clear();
    const sw = subtreeW(rid);
    const obj = state.objects.find((o) => o.id === rid);
    placeSubtree(rid, offsetX + sw / 2, 40);
    offsetX += sw + H_GAP * 2;
  });

  // 미배치 노드(순환 등) → 하단 그리드
  let maxY = 40;
  positions.forEach((pos, id) => {
    const obj = state.objects.find((o) => o.id === id);
    maxY = Math.max(maxY, pos.y + (obj ? obj.height : 60));
  });

  const unplaced = state.objects.filter((o) => !placed.has(o.id));
  const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(unplaced.length))));
  unplaced.forEach((obj, i) => {
    positions.set(obj.id, {
      x: 40 + (i % cols) * (obj.width + H_GAP),
      y: maxY + V_GAP + Math.floor(i / cols) * (obj.height + V_GAP),
    });
  });

  state.objects.forEach((obj) => {
    const pos = positions.get(obj.id);
    if (!pos) return;
    obj.pos_x = pos.x;
    obj.pos_y = pos.y;
    markDetailDirty(obj.id, { pos_x: obj.pos_x, pos_y: obj.pos_y });
  });

  const afterPositions = state.objects.map(({ id, pos_x, pos_y }) => ({ id, pos_x, pos_y }));
  pushUndo({ type: 'move', before: beforePositions, after: afterPositions });
  renderCanvas();
  toast('자동 정렬 완료');
}

/* ============================================================
   메모
   ============================================================ */

async function renderMemoList(objId) {
  const ul = el('memoList');
  ul.innerHTML = '<li style="color:var(--text-muted)">불러오는 중...</li>';
  const memos = await api('GET', `api/objects/${objId}/memos`);
  ul.innerHTML = '';

  if (memos.length === 0) {
    const li = document.createElement('li');
    li.textContent = '메모가 없습니다';
    li.style.color = 'var(--text-muted)';
    ul.appendChild(li);
    return;
  }

  memos.forEach((m) => {
    const li   = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'memo-text';
    text.textContent = m.memo_text;
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await api('DELETE', `api/memos/${m.id}`);
      await renderMemoList(objId);
    });
    li.append(text, remove);
    ul.appendChild(li);
  });
}

async function addMemo() {
  const obj   = state.objects.find((o) => o.id === state.selectedId);
  const input = el('memoInput');
  const text  = input.value.trim();
  if (!obj || !text) return;
  await api('POST', `api/objects/${obj.id}/memos`, { memo_text: text });
  input.value = '';
  await renderMemoList(obj.id);
}

/* ============================================================
   내보내기 (HTML / PDF)
   ============================================================ */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildExportContent() {
  if (!state.objects.length) return null;

  const PADDING = 48;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.objects.forEach((obj) => {
    minX = Math.min(minX, obj.pos_x);
    minY = Math.min(minY, obj.pos_y);
    maxX = Math.max(maxX, obj.pos_x + obj.width);
    maxY = Math.max(maxY, obj.pos_y + obj.height);
  });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 100; }

  const ox = minX - PADDING;
  const oy = minY - PADDING;
  const W  = maxX - minX + PADDING * 2;
  const H  = maxY - minY + PADDING * 2;

  const byId = Object.fromEntries(state.objects.map((o) => [String(o.id), o]));

  const svgPaths = state.relations.map((rel) => {
    const p = byId[String(rel.parent_id)];
    const c = byId[String(rel.child_id)];
    if (!p || !c) return '';
    const p1 = { x: p.pos_x + p.width / 2 - ox, y: p.pos_y + p.height / 2 - oy };
    const p2 = { x: c.pos_x + c.width / 2 - ox, y: c.pos_y + c.height / 2 - oy };
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const co   = Math.max(-40, Math.min(40, (p2.y - p1.y) * 0.25 - (p2.x - p1.x) * 0.05));
    return `<path d="M ${p1.x} ${p1.y} Q ${midX + co} ${midY - co} ${p2.x} ${p2.y}" stroke="#4fd1c5" stroke-width="2" fill="none" opacity="0.85" marker-end="url(#ah)"/>`;
  }).join('');

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:${W}px;height:${H}px;pointer-events:none"><defs><marker id="ah" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#4fd1c5"/></marker></defs>${svgPaths}</svg>`;

  const nodesStr = state.objects.map((obj) => {
    const x = obj.pos_x - ox;
    const y = obj.pos_y - oy;
    let r = '14px', clip = '';
    if (obj.shape === 'ellipse' || obj.shape === 'circle') { r = '50%'; }
    else if (obj.shape === 'diamond') { r = '6px'; clip = 'clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);'; }
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:${obj.width}px;height:${obj.height}px;background:${obj.color};border-radius:${r};${clip}display:flex;align-items:center;justify-content:center;text-align:center;padding:6px 10px;font-size:13px;font-weight:600;color:#1b1e25;border:2px solid rgba(0,0,0,.28);box-shadow:0 3px 8px rgba(0,0,0,.4);overflow:hidden;line-height:1.25;box-sizing:border-box;">${escapeHtml(obj.name)}</div>`;
  }).join('');

  return { W, H, svgStr, nodesStr };
}

function exportHtml() {
  if (!state.objects.length) { toast('내보낼 항목이 없습니다'); return; }
  const board = state.boards.find((b) => String(b.id) === state.boardId);
  const title = board ? board.title : '마인드맵';
  const { W, H, svgStr, nodesStr } = buildExportContent();

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#1b1e25;font-family:sans-serif;padding:24px}
h1{font-size:18px;font-weight:700;color:#f2a93b;margin-bottom:16px}
.wrap{position:relative;width:${W}px;height:${H}px;background:#181a20;
background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:22px 22px}</style>
</head><body><h1>${escapeHtml(title)}</h1><div class="wrap">${svgStr}${nodesStr}</div></body></html>`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  a.download = `${title}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportPdf() {
  if (!state.objects.length) { toast('내보낼 항목이 없습니다'); return; }
  const board = state.boards.find((b) => String(b.id) === state.boardId);
  const title = board ? board.title : '마인드맵';
  const { W, H, svgStr, nodesStr } = buildExportContent();

  const MAX_W = 1060;
  const scale = W > MAX_W ? MAX_W / W : 1;
  const printW = Math.round(W * scale);
  const printH = Math.round(H * scale);

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#fff;font-family:sans-serif}
h1{font-size:16px;font-weight:700;color:#333;padding:16px 20px 12px}
.wrap{position:relative;width:${W}px;height:${H}px;background:#1b1e25;
background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:22px 22px;
transform:scale(${scale});transform-origin:top left}
@media print{@page{size:${printW + 40}px ${printH + 72}px;margin:0}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
</head><body><h1>${escapeHtml(title)}</h1>
<div class="wrap">${svgStr}${nodesStr}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400)};<\/script>
</body></html>`;

  const win = window.open('', '_blank', `width=${printW + 60},height=${printH + 120}`);
  if (!win) { toast('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.'); return; }
  win.document.write(html);
  win.document.close();
}

/* ============================================================
   PNG 내보내기
   ============================================================ */

function pngRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function pngWrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

async function exportPng() {
  if (!state.objects.length) { toast('내보낼 항목이 없습니다'); return; }

  const board = state.boards.find((b) => String(b.id) === state.boardId);
  const title = board ? board.title : '마인드맵';

  const PADDING = 48;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.objects.forEach((obj) => {
    minX = Math.min(minX, obj.pos_x);
    minY = Math.min(minY, obj.pos_y);
    maxX = Math.max(maxX, obj.pos_x + obj.width);
    maxY = Math.max(maxY, obj.pos_y + obj.height);
  });

  const ox = minX - PADDING;
  const oy = minY - PADDING;
  const W  = maxX - minX + PADDING * 2;
  const H  = maxY - minY + PADDING * 2;
  const DPR = 2;

  const canvas = document.createElement('canvas');
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  // 배경
  ctx.fillStyle = '#181a20';
  ctx.fillRect(0, 0, W, H);

  // 점 패턴
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let x = 0; x < W; x += 22) {
    for (let y = 0; y < H; y += 22) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const byId = Object.fromEntries(state.objects.map((o) => [String(o.id), o]));

  // 관계선
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = 2;

  state.relations.forEach((rel) => {
    const p = byId[String(rel.parent_id)];
    const c = byId[String(rel.child_id)];
    if (!p || !c) return;
    const p1 = { x: p.pos_x + p.width  / 2 - ox, y: p.pos_y + p.height / 2 - oy };
    const p2 = { x: c.pos_x + c.width  / 2 - ox, y: c.pos_y + c.height / 2 - oy };
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const co = Math.max(-40, Math.min(40, dy * 0.25 - dx * 0.05));
    const cpx = midX + co, cpy = midY - co;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(cpx, cpy, p2.x, p2.y);
    ctx.stroke();

    // 화살촉
    const t = 0.97;
    const ax = (1-t)*(1-t)*p1.x + 2*(1-t)*t*cpx + t*t*p2.x;
    const ay = (1-t)*(1-t)*p1.y + 2*(1-t)*t*cpy + t*t*p2.y;
    ctx.save();
    ctx.translate(p2.x, p2.y);
    ctx.rotate(Math.atan2(p2.y - ay, p2.x - ax));
    ctx.fillStyle = '#4fd1c5';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-8, -4); ctx.lineTo(-8, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // 라벨
    if (rel.label) {
      const lx = midX + co / 2, ly = midY - co / 2;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(rel.label).width;
      ctx.fillStyle = '#1b1e25';
      ctx.fillRect(lx - tw / 2 - 3, ly - 8, tw + 6, 16);
      ctx.fillStyle = '#4fd1c5';
      ctx.fillText(rel.label, lx, ly);
      ctx.restore();
    }
  });
  ctx.restore();

  // 노드
  state.objects.forEach((obj) => {
    const x = obj.pos_x - ox, y = obj.pos_y - oy;
    const w = obj.width,  h = obj.height;
    const shape = obj.shape || 'rounded-rect';

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur  = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle   = obj.color || '#F2A93B';
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth   = 2;

    if (shape === 'rounded-rect') {
      pngRoundRect(ctx, x, y, w, h, 14); ctx.fill();
      ctx.shadowColor = 'transparent';
      pngRoundRect(ctx, x, y, w, h, 14); ctx.stroke();
    } else if (shape === 'ellipse' || shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
    } else if (shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(x + w/2, y); ctx.lineTo(x + w, y + h/2);
      ctx.lineTo(x + w/2, y + h); ctx.lineTo(x, y + h/2);
      ctx.closePath(); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
    }
    ctx.restore();

    // 텍스트 (클리핑)
    ctx.save();
    if (shape === 'rounded-rect') { pngRoundRect(ctx, x, y, w, h, 14); ctx.clip(); }
    else if (shape === 'ellipse' || shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2); ctx.clip();
    } else if (shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(x + w/2, y); ctx.lineTo(x + w, y + h/2);
      ctx.lineTo(x + w/2, y + h); ctx.lineTo(x, y + h/2); ctx.closePath(); ctx.clip();
    }
    ctx.fillStyle = '#1b1e25';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = pngWrapText(ctx, obj.name, w - 20);
    const lineH = 16;
    let textY = y + h / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line) => { ctx.fillText(line, x + w / 2, textY, w - 8); textY += lineH; });
    ctx.restore();
  });

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${title}.png`;
  a.click();
}

/* ============================================================
   키보드 단축키
   ============================================================ */

function focusNameField() {
  if (!state.selectedId) { toast('선택된 항목이 없습니다'); return; }
  el('fName').focus();
  el('fName').select();
}

function focusMemoField() {
  if (!state.selectedId) { toast('선택된 항목이 없습니다'); return; }
  el('memoInput').focus();
}

function bindShortcutEvents() {
  document.addEventListener('keydown', (e) => {
    // Space → 팬 모드
    if (e.code === 'Space' && !isInputFocused()) {
      if (!state.spaceHeld) {
        state.spaceHeld = true;
        el('canvasWrap').classList.add('pan-ready');
      }
      e.preventDefault();
      return;
    }

    // Escape: 관계 모드 취소 / 다중선택 해제 / 인라인 편집 취소
    if (e.key === 'Escape') {
      if (state.inlineEdit) { cancelInlineEdit(); renderCanvas(); return; }
      if (state.relationMode && state.relationFirst !== null) {
        state.relationFirst = null;
        renderCanvas();
        return;
      }
      if (state.selectedIds.size > 0) { clearSelection(); return; }
    }

    // Delete / Backspace → 선택 항목 삭제
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputFocused()) {
      if (state.selectedIds.size > 0) {
        e.preventDefault();
        deleteSelectedObjects();
      }
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;

    switch (e.key) {
      case 'z':
      case 'Z':
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        break;
      case 'y':
      case 'Y':
        e.preventDefault();
        redo();
        break;
      case '0':
        e.preventDefault();
        resetZoom();
        break;
      case '1': e.preventDefault(); if (!isInputFocused()) createBoard(); break;
      case '2': e.preventDefault(); if (!isInputFocused()) createObject(); break;
      case '3': e.preventDefault(); if (!isInputFocused()) toggleRelationMode(); break;
      case '4': e.preventDefault(); focusNameField(); break;
      case '5': e.preventDefault(); focusMemoField(); break;
      case '6': e.preventDefault(); if (state.selectedId) deleteObject(state.selectedId); break;
      default: break;
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.spaceHeld = false;
      el('canvasWrap').classList.remove('pan-ready');
    }
  });
}

/* ============================================================
   전역 이벤트 바인딩
   ============================================================ */

function bindGlobalEvents() {
  // 보드
  el('boardSelect').addEventListener('change', (e) => selectBoard(e.target.value));
  el('btnNewBoard').addEventListener('click', createBoard);
  el('boardTitle').addEventListener('change', (e) => updateBoardTitle(e.target.value));

  // 객체 / 관계
  el('btnNewObject').addEventListener('click', createObject);
  el('btnRelationMode').addEventListener('click', toggleRelationMode);

  // 내보내기
  el('btnExportHtml').addEventListener('click', exportHtml);
  el('btnExportPdf').addEventListener('click', exportPdf);
  el('btnExportPng').addEventListener('click', exportPng);

  // 자동 정렬
  el('btnAutoLayout').addEventListener('click', autoLayout);

  // 검색
  el('searchInput').addEventListener('input', (e) => onSearch(e.target.value));

  // 줌 버튼
  el('btnZoomIn').addEventListener('click',    () => {
    const rect = el('canvasWrap').getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
  });
  el('btnZoomOut').addEventListener('click',   () => {
    const rect = el('canvasWrap').getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
  });
  el('btnZoomReset').addEventListener('click', resetZoom);

  // 캔버스 휠 줌
  el('canvasWrap').addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  // 캔버스 마우스다운 (팬 / 마키)
  el('canvasWrap').addEventListener('mousedown', (e) => {
    const isNode = e.target.closest && e.target.closest('.node');

    // 중간 버튼 or Space+좌클릭 → 팬
    if (e.button === 1 || (e.button === 0 && state.spaceHeld)) {
      e.preventDefault();
      startPan(e);
      return;
    }

    // 배경 좌클릭 → 선택 해제 + 마키
    if (e.button === 0 && !isNode) {
      if (state.inlineEdit) return;  // 인라인 편집 중엔 무시 (blur가 처리)
      if (!e.shiftKey) clearSelection();
      startMarquee(e);
    }
  });

  // 메모
  el('btnAddMemo').addEventListener('click', addMemo);
  el('memoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addMemo();
  });

  // 탭 숨김 시 flush
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && hasPending()) flushPending();
  });

  bindDetailFormEvents();
  bindShortcutEvents();
}

init();

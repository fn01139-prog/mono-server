// projects/mindmap/public/js/app.js

const state = {
  boards: [],
  boardId: null,
  objects: [],     // {id, name, content, pos_x, pos_y, color, width, height, shape}
  relations: [],   // {id, parent_id, child_id, label}
  selectedId: null,
  relationMode: false,
  relationFirst: null,
  drag: null,
};

const el = (id) => document.getElementById(id);

function toast(msg) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
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

/* ============================================================
   숫자 파싱 헬퍼
   PostgreSQL NUMERIC 타입은 node-postgres가 문자열로 반환하므로
   명시적으로 Number()로 변환해야 연산 오류가 없습니다.
   ============================================================ */

function parseObjectNumerics(o) {
  return {
    ...o,
    pos_x: Number(o.pos_x) || 0,
    pos_y: Number(o.pos_y) || 0,
    width: Number(o.width) || 140,
    height: Number(o.height) || 60,
  };
}

/* ============================================================
   지연 저장 (Deferred DB flush)
   변경 사항을 Map에 누적했다가 FLUSH_INTERVAL마다 일괄 저장합니다.
   - markHeaderDirty / markDetailDirty  : 변경 사항 누적
   - scheduleFlush                      : 타이머 설정 (이미 있으면 무시)
   - flushPending                       : 실제 API 호출
   ============================================================ */

const FLUSH_INTERVAL = 25000; // 25초

const pendingUpdates = {
  headers: new Map(),  // objectId → {name, content}
  details: new Map(),  // objectId → {pos_x, pos_y, color, width, height, shape}
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
      api('PUT', `api/objects/${id}`, data)
        .catch((err) => toast('자동 저장 실패: ' + err.message))
    ),
    ...detailEntries.map(([id, data]) =>
      api('PUT', `api/objects/${id}/detail`, data)
        .catch((err) => toast('자동 저장 실패: ' + err.message))
    ),
  ]);
}

/* ============================================================
   초기화
   ============================================================ */

async function init() {
  bindGlobalEvents();
  setActionButtonsEnabled(false);
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
}

async function loadBoards() {
  state.boards = await api('GET', 'api/boards');

  if (state.boards.length === 0) {
    const created = await api('POST', 'api/boards', { title: '새 마인드맵' });
    state.boards = [created];
  }

  renderBoardSelect();

  const remembered = localStorage.getItem('mindmap:lastBoardId');
  const remeberedExists = state.boards.find((b) => String(b.id) === remembered);
  await selectBoard(remeberedExists ? remembered : state.boards[0].id);
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
  // 보드 전환 전에 미저장 변경 사항 먼저 flush
  await flushPending();

  state.boardId = String(boardId);
  state.selectedId = null;
  localStorage.setItem('mindmap:lastBoardId', state.boardId);

  el('boardSelect').value = state.boardId;
  const board = state.boards.find((b) => String(b.id) === state.boardId);
  el('boardTitle').value = board ? board.title : '';

  await Promise.all([loadObjects(), loadRelations()]);
  renderObjectList();
  renderCanvas();
  renderDetailPanel();
}

async function loadObjects() {
  const raw = await api('GET', `api/boards/${state.boardId}/objects`);
  // NUMERIC → JS number 변환 (node-postgres는 NUMERIC을 문자열로 반환)
  state.objects = raw.map(parseObjectNumerics);
}

async function loadRelations() {
  state.relations = await api('GET', `api/boards/${state.boardId}/relations`);
}

/* ============================================================
   보드(주제/제목)
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

  if (state.objects.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = '아직 항목이 없습니다';
    ul.appendChild(li);
    return;
  }

  state.objects.forEach((obj) => {
    const li = document.createElement('li');
    li.className = 'object-item' + (obj.id === state.selectedId ? ' selected' : '');
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
    li.addEventListener('click', () => handleNodeClick(obj.id));
    ul.appendChild(li);
  });
}

/* ============================================================
   캔버스 (중앙)
   ============================================================ */

function renderCanvas() {
  el('canvasHint').classList.toggle('hidden', state.objects.length > 0);

  const layer = el('nodeLayer');
  layer.innerHTML = '';

  state.objects.forEach((obj) => {
    const node = document.createElement('div');
    node.className = 'node' + (obj.id === state.selectedId ? ' selected' : '');
    if (state.relationMode && state.relationFirst === obj.id) node.classList.add('relation-pending');
    node.dataset.id = obj.id;
    node.dataset.shape = obj.shape || 'rounded-rect';
    node.style.left = `${obj.pos_x}px`;
    node.style.top = `${obj.pos_y}px`;
    node.style.width = `${obj.width}px`;
    node.style.height = `${obj.height}px`;
    node.style.background = obj.color || '#F2A93B';
    node.textContent = obj.name;

    node.addEventListener('mousedown', (e) => startDrag(e, obj.id));
    node.addEventListener('click', (e) => {
      if (state.drag && state.drag.moved) return;
      handleNodeClick(obj.id);
    });

    layer.appendChild(node);
  });

  drawRelations();
}

function nodeCenter(obj) {
  return {
    x: obj.pos_x + obj.width / 2,
    y: obj.pos_y + obj.height / 2,
  };
}

function drawRelations() {
  const svg = el('relationLayer');
  const byId = Object.fromEntries(state.objects.map((o) => [String(o.id), o]));

  const defs = `
    <defs>
      <marker id="arrowHead" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent-2)"></path>
      </marker>
    </defs>`;

  const paths = state.relations.map((rel) => {
    const parent = byId[String(rel.parent_id)];
    const child = byId[String(rel.child_id)];
    if (!parent || !child) return '';

    const p1 = nodeCenter(parent);
    const p2 = nodeCenter(child);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const curveOffset = Math.max(-40, Math.min(40, dy * 0.25 - dx * 0.05));
    const cx = midX + curveOffset;
    const cy = midY - curveOffset;

    return `<path d="M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}"
                  stroke="var(--accent-2)" stroke-width="2" fill="none"
                  opacity="0.85" marker-end="url(#arrowHead)" data-relation-id="${rel.id}"></path>`;
  }).join('');

  svg.innerHTML = defs + paths;
}

function handleNodeClick(objId) {
  if (state.relationMode) {
    handleRelationClick(objId);
    return;
  }
  selectObject(objId);
}

/* ----- 드래그 이동 ----- */

function startDrag(e, objId) {
  if (state.relationMode) return;
  e.preventDefault();
  const obj = state.objects.find((o) => o.id === objId);
  if (!obj) return;

  // 스크롤 가능한 캔버스 안에서 정확한 좌표를 얻기 위해
  // 뷰포트 좌표 대신 canvasWrap-상대 좌표를 사용합니다.
  const canvasWrap = el('canvasWrap');
  const wrapRect = canvasWrap.getBoundingClientRect();

  const toCanvasX = (clientX) => clientX - wrapRect.left + canvasWrap.scrollLeft;
  const toCanvasY = (clientY) => clientY - wrapRect.top + canvasWrap.scrollTop;

  const startCanvasMouseX = toCanvasX(e.clientX);
  const startCanvasMouseY = toCanvasY(e.clientY);

  state.drag = {
    id: objId,
    startX: obj.pos_x,
    startY: obj.pos_y,
    moved: false,
  };

  function onMove(ev) {
    const dx = toCanvasX(ev.clientX) - startCanvasMouseX;
    const dy = toCanvasY(ev.clientY) - startCanvasMouseY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.drag.moved = true;

    obj.pos_x = Math.max(0, state.drag.startX + dx);
    obj.pos_y = Math.max(0, state.drag.startY + dy);

    const nodeEl = el('nodeLayer').querySelector(`[data-id="${objId}"]`);
    if (nodeEl) {
      nodeEl.style.left = `${obj.pos_x}px`;
      nodeEl.style.top = `${obj.pos_y}px`;
    }
    drawRelations();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (state.drag && state.drag.moved) {
      markDetailDirty(objId, { pos_x: obj.pos_x, pos_y: obj.pos_y });
    }
    state.drag = null;
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
    name: '새 항목',
    content: '',
    pos_x, pos_y,
  });
  state.objects.push(parseObjectNumerics(created));
  renderObjectList();
  renderCanvas();
  await selectObject(created.id);
  el('fName').focus();
  el('fName').select();
}

async function deleteObject(objId) {
  if (!window.confirm('이 항목을 삭제할까요? 연결된 관계와 메모도 함께 삭제됩니다.')) return;

  // 삭제 대상의 미저장 변경 사항 제거
  pendingUpdates.headers.delete(objId);
  pendingUpdates.details.delete(objId);

  await api('DELETE', `api/objects/${objId}`);
  state.objects = state.objects.filter((o) => o.id !== objId);
  state.relations = state.relations.filter((r) => r.parent_id !== objId && r.child_id !== objId);
  if (state.selectedId === objId) state.selectedId = null;
  renderObjectList();
  renderCanvas();
  renderDetailPanel();
}

/* ============================================================
   상세 패널 (우측)
   ============================================================ */

async function selectObject(objId) {
  state.selectedId = objId;
  renderObjectList();
  renderCanvas();
  await renderDetailPanel();
}

async function renderDetailPanel() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  el('detailEmpty').classList.toggle('hidden', !!obj);
  el('detailForm').classList.toggle('hidden', !obj);
  if (!obj) return;

  el('fName').value = obj.name || '';
  el('fContent').value = obj.content || '';
  el('fColor').value = obj.color || '#F2A93B';
  el('fShape').value = obj.shape || 'rounded-rect';
  el('fWidth').value = obj.width;
  el('fHeight').value = obj.height;

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
    const otherId = isParent ? rel.child_id : rel.parent_id;
    const other = byId[otherId];

    const li = document.createElement('li');
    const label = document.createElement('span');
    label.innerHTML = `<span class="arrow">${isParent ? '↳ 자식' : '↰ 부모'}</span> ${other ? other.name : '(삭제됨)'}`;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '✕';
    remove.title = '관계 삭제';
    remove.addEventListener('click', () => deleteRelation(rel.id));

    li.append(label, remove);
    ul.appendChild(li);
  });
}

/* ----- 상세 폼 입력 -> 지연 저장 ----- */

function bindDetailFormEvents() {
  el('fName').addEventListener('change', () => saveHeader());
  el('fContent').addEventListener('change', () => saveHeader());
  el('fColor').addEventListener('input', () => saveDetail());
  el('fShape').addEventListener('change', () => saveDetail());
  el('fWidth').addEventListener('change', () => saveDetail());
  el('fHeight').addEventListener('change', () => saveDetail());
  el('btnDeleteObject').addEventListener('click', () => {
    if (state.selectedId) deleteObject(state.selectedId);
  });
}

function saveHeader() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;
  obj.name = el('fName').value || '새 항목';
  obj.content = el('fContent').value;
  markHeaderDirty(obj.id, { name: obj.name, content: obj.content });
  renderObjectList();
  renderCanvas();
}

function saveDetail() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;
  obj.color = el('fColor').value;
  obj.shape = el('fShape').value;
  obj.width = Number(el('fWidth').value) || 140;
  obj.height = Number(el('fHeight').value) || 60;
  markDetailDirty(obj.id, { color: obj.color, shape: obj.shape, width: obj.width, height: obj.height });
  renderObjectList();
  renderCanvas();
}

/* ============================================================
   관계 연결 모드
   ============================================================ */

function toggleRelationMode() {
  state.relationMode = !state.relationMode;
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
  const child_id = objId;
  state.relationFirst = null;

  try {
    const created = await api('POST', `api/boards/${state.boardId}/relations`, { parent_id, child_id });
    state.relations.push(created);
  } catch (err) {
    toast(err.message);
  }
  renderCanvas();
  if (state.selectedId === parent_id || state.selectedId === child_id) {
    renderRelationList(state.selectedId);
  }
}

async function deleteRelation(relationId) {
  await api('DELETE', `api/relations/${relationId}`);
  state.relations = state.relations.filter((r) => r.id !== relationId);
  renderCanvas();
  if (state.selectedId) renderRelationList(state.selectedId);
}

/* ============================================================
   메모 (확장 테이블 예시)
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
    const li = document.createElement('li');
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
  const obj = state.objects.find((o) => o.id === state.selectedId);
  const input = el('memoInput');
  const text = input.value.trim();
  if (!obj || !text) return;
  await api('POST', `api/objects/${obj.id}/memos`, { memo_text: text });
  input.value = '';
  await renderMemoList(obj.id);
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
    if (e.key === 'Escape' && state.relationMode && state.relationFirst !== null) {
      state.relationFirst = null;
      renderCanvas();
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;

    switch (e.key) {
      case '1': e.preventDefault(); createBoard(); break;
      case '2': e.preventDefault(); createObject(); break;
      case '3': e.preventDefault(); toggleRelationMode(); break;
      case '4': e.preventDefault(); focusNameField(); break;
      case '5': e.preventDefault(); focusMemoField(); break;
      case '6': e.preventDefault(); if (state.selectedId) deleteObject(state.selectedId); break;
      default: break;
    }
  });
}

/* ============================================================
   내보내기 (HTML / PDF)
   ============================================================ */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  // 모든 노드가 (0,0)에 있을 때 방어
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 100; }

  const ox = minX - PADDING;
  const oy = minY - PADDING;
  const W = maxX - minX + PADDING * 2;
  const H = maxY - minY + PADDING * 2;

  const byId = Object.fromEntries(state.objects.map((o) => [String(o.id), o]));

  const svgPaths = state.relations.map((rel) => {
    const p = byId[String(rel.parent_id)];
    const c = byId[String(rel.child_id)];
    if (!p || !c) return '';
    const p1 = { x: p.pos_x + p.width / 2 - ox, y: p.pos_y + p.height / 2 - oy };
    const p2 = { x: c.pos_x + c.width / 2 - ox, y: c.pos_y + c.height / 2 - oy };
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const co = Math.max(-40, Math.min(40, dy * 0.25 - dx * 0.05));
    return `<path d="M ${p1.x} ${p1.y} Q ${midX + co} ${midY - co} ${p2.x} ${p2.y}" stroke="#4fd1c5" stroke-width="2" fill="none" opacity="0.85" marker-end="url(#ah)"/>`;
  }).join('');

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:${W}px;height:${H}px;pointer-events:none"><defs><marker id="ah" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#4fd1c5"/></marker></defs>${svgPaths}</svg>`;

  const nodesStr = state.objects.map((obj) => {
    const x = obj.pos_x - ox;
    const y = obj.pos_y - oy;
    let r = '14px';
    let clip = '';
    if (obj.shape === 'ellipse' || obj.shape === 'circle') {
      r = '50%';
    } else if (obj.shape === 'diamond') {
      r = '6px';
      clip = 'clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);';
    }
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
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1b1e25;font-family:sans-serif;padding:24px}
h1{font-size:18px;font-weight:700;color:#f2a93b;margin-bottom:16px}
.wrap{position:relative;width:${W}px;height:${H}px;background:#181a20;background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:22px 22px}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="wrap">
${svgStr}
${nodesStr}
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportPdf() {
  if (!state.objects.length) { toast('내보낼 항목이 없습니다'); return; }
  const board = state.boards.find((b) => String(b.id) === state.boardId);
  const title = board ? board.title : '마인드맵';
  const { W, H, svgStr, nodesStr } = buildExportContent();

  // 너무 넓으면 축소하여 인쇄 용지에 맞춤
  const MAX_W = 1060;
  const scale = W > MAX_W ? MAX_W / W : 1;
  const printW = Math.round(W * scale);
  const printH = Math.round(H * scale);

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;font-family:sans-serif}
h1{font-size:16px;font-weight:700;color:#333;padding:16px 20px 12px}
.wrap{position:relative;width:${W}px;height:${H}px;background:#1b1e25;
  background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);
  background-size:22px 22px;
  transform:scale(${scale});transform-origin:top left}
@media print{
  @page{size:${printW + 40}px ${printH + 72}px;margin:0}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="wrap">
${svgStr}
${nodesStr}
</div>
<script>
window.onload = function() { setTimeout(function() { window.print(); }, 400); };
<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', `width=${printW + 60},height=${printH + 120}`);
  if (!win) { toast('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.'); return; }
  win.document.write(html);
  win.document.close();
}

/* ============================================================
   전역 이벤트 바인딩
   ============================================================ */

function bindGlobalEvents() {
  el('boardSelect').addEventListener('change', (e) => selectBoard(e.target.value));
  el('btnNewBoard').addEventListener('click', createBoard);
  el('boardTitle').addEventListener('change', (e) => updateBoardTitle(e.target.value));

  el('btnNewObject').addEventListener('click', createObject);
  el('btnRelationMode').addEventListener('click', toggleRelationMode);
  el('btnExportHtml').addEventListener('click', exportHtml);
  el('btnExportPdf').addEventListener('click', exportPdf);

  el('btnAddMemo').addEventListener('click', addMemo);
  el('memoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addMemo();
  });

  // 탭을 숨기거나 닫을 때 미저장 변경 사항 flush
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && hasPending()) {
      flushPending();
    }
  });

  bindDetailFormEvents();
  bindShortcutEvents();
}

init();

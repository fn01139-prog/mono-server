// projects/mindmap/public/js/app.js
//
// 상대경로(api/...)로만 호출합니다 -> 이 모듈이 /mindmap 아래 어디에 마운트되어도
// (BASE_PATH 이중 적용 문제 없이) 그대로 동작합니다.

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
   초기화
   ============================================================ */

async function init() {
  bindGlobalEvents();
  await loadBoards();
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
  state.objects = await api('GET', `api/boards/${state.boardId}/objects`);
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
    node.style.left = `${obj.pos_x || 0}px`;
    node.style.top = `${obj.pos_y || 0}px`;
    node.style.width = `${obj.width || 140}px`;
    node.style.height = `${obj.height || 60}px`;
    node.style.background = obj.color || '#F2A93B';
    node.textContent = obj.name;

    node.addEventListener('mousedown', (e) => startDrag(e, obj.id));
    node.addEventListener('click', (e) => {
      // 드래그 직후 클릭 이벤트가 같이 발생하는 것을 방지
      if (state.drag && state.drag.moved) return;
      handleNodeClick(obj.id);
    });

    layer.appendChild(node);
  });

  drawRelations();
}

function nodeCenter(obj) {
  return {
    x: (obj.pos_x || 0) + (obj.width || 140) / 2,
    y: (obj.pos_y || 0) + (obj.height || 60) / 2,
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
    // 부드러운 곡선 연결을 위해 수직 방향으로 살짝 휘는 control point 사용
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
  if (state.relationMode) return; // 관계 연결 모드에서는 드래그 비활성화
  e.preventDefault();
  const obj = state.objects.find((o) => o.id === objId);
  if (!obj) return;

  const canvasInner = el('canvasInner');
  const rect = canvasInner.getBoundingClientRect();
  const startMouseX = e.clientX;
  const startMouseY = e.clientY;

  state.drag = {
    id: objId,
    startX: obj.pos_x || 0,
    startY: obj.pos_y || 0,
    moved: false,
  };

  function onMove(ev) {
    const dx = ev.clientX - startMouseX;
    const dy = ev.clientY - startMouseY;
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
      api('PUT', `api/objects/${objId}/detail`, { pos_x: obj.pos_x, pos_y: obj.pos_y })
        .catch((err) => toast('위치 저장 실패: ' + err.message));
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
  const count = state.objects.length;
  const pos_x = 60 + (count % 8) * 40;
  const pos_y = 60 + Math.floor(count / 8) * 100;

  const created = await api('POST', `api/boards/${state.boardId}/objects`, {
    name: '새 항목',
    content: '',
    pos_x, pos_y,
  });
  state.objects.push(created);
  renderObjectList();
  renderCanvas();
  await selectObject(created.id);
  el('fName').focus();
  el('fName').select();
}

async function deleteObject(objId) {
  if (!window.confirm('이 항목을 삭제할까요? 연결된 관계와 메모도 함께 삭제됩니다.')) return;
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
  el('fWidth').value = obj.width || 140;
  el('fHeight').value = obj.height || 60;

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

/* ----- 상세 폼 입력 -> 저장 ----- */

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

async function saveHeader() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;
  obj.name = el('fName').value || '새 항목';
  obj.content = el('fContent').value;
  await api('PUT', `api/objects/${obj.id}`, { name: obj.name, content: obj.content });
  renderObjectList();
  renderCanvas();
}

async function saveDetail() {
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;
  obj.color = el('fColor').value;
  obj.shape = el('fShape').value;
  obj.width = Number(el('fWidth').value) || 140;
  obj.height = Number(el('fHeight').value) || 60;
  await api('PUT', `api/objects/${obj.id}/detail`, {
    color: obj.color, shape: obj.shape, width: obj.width, height: obj.height,
  });
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
    state.relationFirst = null; // 같은 항목 다시 클릭 -> 선택 취소
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
   ------------------------------------------------------------
   Ctrl+1 새 보드 / Ctrl+2 새 항목 / Ctrl+3 관계 연결 토글
   Ctrl+4 명칭 입력란 포커스 / Ctrl+5 메모 입력란 포커스 / Ctrl+6 선택 항목 삭제
   Esc    관계 연결 모드 중 첫 번째 선택 취소

   참고: Ctrl(⌘)+1~9는 Chrome/Edge/Firefox 등에서 브라우저 탭 전환에도 쓰이는
   단축키라서, 실제로 mono-server를 일반 브라우저 탭에서 열어두면 브라우저가
   먼저 가져가 버려 동작하지 않을 수 있습니다. (이 미리보기 iframe 안에서는
   문제없이 동작합니다.) 만약 실제 배포본에서 안 먹히면 아래 KEY_MAP의
   key 값만 'Alt+숫자' 조합 등으로 바꿔서 쓰시는 걸 추천합니다.
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
   전역 이벤트 바인딩
   ============================================================ */

function bindGlobalEvents() {
  el('boardSelect').addEventListener('change', (e) => selectBoard(e.target.value));
  el('btnNewBoard').addEventListener('click', createBoard);
  el('boardTitle').addEventListener('change', (e) => updateBoardTitle(e.target.value));

  el('btnNewObject').addEventListener('click', createObject);
  el('btnRelationMode').addEventListener('click', toggleRelationMode);

  el('btnAddMemo').addEventListener('click', addMemo);
  el('memoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addMemo();
  });

  bindDetailFormEvents();
  bindShortcutEvents();
}

init();

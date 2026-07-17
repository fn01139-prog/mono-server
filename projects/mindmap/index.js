// projects/mindmap/index.js
//
// mono-server 컨벤션: config.js + index.js(Express Router) + public/
// loader.js가 이 라우터를 require해서 app.use(`/${config.name}`, router) 형태로
// 마운트한다고 가정합니다 (mdboard/portfolio와 동일 패턴).
//
// 데이터 격리: 보드(mindmap_boards)는 owner_id 기준으로 본인 것만 조회/수정/삭제 가능.
// objects/relations/memos는 board_id를 경유해 소유권을 검사한다. admin은 전체 접근 가능.

const express = require('express');
const path = require('path');
const pool = require('../../shared/db');

// mono-server 공통 유틸 (asyncHandler, ok, fail).
// shared/utils.js 경로/시그니처가 다르면 이 블록만 맞춰 수정하세요.
let asyncHandler, ok, fail;
try {
  ({ asyncHandler, ok, fail } = require('../../shared/utils'));
} catch (e) {
  // shared/utils.js를 못 찾을 때를 위한 안전한 자체 구현
  asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  ok = (res, data) => res.json({ success: true, data });
  fail = (res, message, status = 400) => res.status(status).json({ success: false, message });
}

const router = express.Router();

router.use(express.json());
router.use(express.static(path.join(__dirname, 'public')));

const isAdmin = (req) => req.user?.role === 'admin';

/** 보드를 조회하고 소유권을 검사. 없거나 권한 없으면 null 반환 (404 처리는 호출부에서). */
async function loadOwnedBoard(req, boardId) {
  const { rows } = await pool.query('SELECT * FROM mindmap_boards WHERE id = $1', [boardId]);
  const board = rows[0];
  if (!board) return null;
  if (!isAdmin(req) && board.owner_id !== req.user.userId) return null;
  return board;
}

/** object_id로부터 소속 보드를 찾아 소유권 검사 */
async function loadOwnedBoardByObject(req, objectId) {
  const { rows } = await pool.query(
    `SELECT b.* FROM mindmap_boards b
     JOIN mindmap_objects o ON o.board_id = b.id
     WHERE o.id = $1`,
    [objectId]
  );
  const board = rows[0];
  if (!board) return null;
  if (!isAdmin(req) && board.owner_id !== req.user.userId) return null;
  return board;
}

/** relation_id로부터 소속 보드를 찾아 소유권 검사 */
async function loadOwnedBoardByRelation(req, relationId) {
  const { rows } = await pool.query(
    `SELECT b.* FROM mindmap_boards b
     JOIN mindmap_relations r ON r.board_id = b.id
     WHERE r.id = $1`,
    [relationId]
  );
  const board = rows[0];
  if (!board) return null;
  if (!isAdmin(req) && board.owner_id !== req.user.userId) return null;
  return board;
}

/** memo_id로부터 소속 보드를 찾아 소유권 검사 */
async function loadOwnedBoardByMemo(req, memoId) {
  const { rows } = await pool.query(
    `SELECT b.* FROM mindmap_boards b
     JOIN mindmap_objects o ON o.board_id = b.id
     JOIN mindmap_memos m ON m.object_id = o.id
     WHERE m.id = $1`,
    [memoId]
  );
  const board = rows[0];
  if (!board) return null;
  if (!isAdmin(req) && board.owner_id !== req.user.userId) return null;
  return board;
}

/* ============================================================
   BOARD  (화면 상단 "주제(제목)")
   ============================================================ */

router.get('/boards', asyncHandler(async (req, res) => {
  const { rows } = isAdmin(req)
    ? await pool.query('SELECT id, title, owner_id, created_at, updated_at FROM mindmap_boards ORDER BY updated_at DESC')
    : await pool.query(
        'SELECT id, title, owner_id, created_at, updated_at FROM mindmap_boards WHERE owner_id = $1 ORDER BY updated_at DESC',
        [req.user.userId]
      );
  ok(res, rows);
}));

router.post('/boards', asyncHandler(async (req, res) => {
  const { title } = req.body;
  if (!title) return fail(res, 'title은 필수입니다.');
  const { rows } = await pool.query(
    'INSERT INTO mindmap_boards (title, owner_id) VALUES ($1, $2) RETURNING *',
    [title, req.user.userId]
  );
  ok(res, rows[0]);
}));

router.put('/boards/:boardId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoard(req, req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { title } = req.body;
  const { rows } = await pool.query(
    'UPDATE mindmap_boards SET title = COALESCE($1, title), updated_at = NOW() WHERE id = $2 RETURNING *',
    [title, req.params.boardId]
  );
  ok(res, rows[0]);
}));

router.delete('/boards/:boardId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoard(req, req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  await pool.query('DELETE FROM mindmap_boards WHERE id = $1', [req.params.boardId]);
  ok(res, { deleted: true });
}));

router.post('/boards/:boardId/duplicate', asyncHandler(async (req, res) => {
  const { boardId } = req.params;
  const orig = await loadOwnedBoard(req, boardId);
  if (!orig) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [newBoard] } = await client.query(
      'INSERT INTO mindmap_boards (title, owner_id) VALUES ($1, $2) RETURNING *',
      [`${orig.title} (복사)`, req.user.userId]
    );

    const { rows: objects } = await client.query(
      `SELECT h.id, h.name, h.content, d.pos_x, d.pos_y, d.color, d.width, d.height, d.shape
       FROM mindmap_objects h LEFT JOIN mindmap_object_details d ON d.object_id = h.id
       WHERE h.board_id = $1 ORDER BY h.id`,
      [boardId]
    );

    const idMap = {};
    for (const obj of objects) {
      const { rows: [newH] } = await client.query(
        'INSERT INTO mindmap_objects (board_id, name, content) VALUES ($1, $2, $3) RETURNING *',
        [newBoard.id, obj.name, obj.content]
      );
      await client.query(
        `INSERT INTO mindmap_object_details (object_id, pos_x, pos_y, color, width, height, shape)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newH.id, obj.pos_x, obj.pos_y, obj.color, obj.width, obj.height, obj.shape]
      );
      idMap[obj.id] = newH.id;
    }

    const { rows: relations } = await client.query(
      'SELECT * FROM mindmap_relations WHERE board_id = $1', [boardId]
    );
    for (const rel of relations) {
      const np = idMap[rel.parent_id], nc = idMap[rel.child_id];
      if (np && nc) {
        await client.query(
          'INSERT INTO mindmap_relations (board_id, parent_id, child_id, label) VALUES ($1, $2, $3, $4)',
          [newBoard.id, np, nc, rel.label]
        );
      }
    }

    await client.query('COMMIT');
    ok(res, newBoard);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

/* ============================================================
   OBJECT  (OBJECT_HEADER + OBJECT_DETAIL)
   ============================================================ */

// 보드에 속한 모든 객체를 헤더+디테일 합쳐서 한번에 조회 (캔버스 렌더링용)
router.get('/boards/:boardId/objects', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoard(req, req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { rows } = await pool.query(
    `SELECT h.id, h.name, h.content, h.created_at, h.updated_at,
            d.pos_x, d.pos_y, d.color, d.width, d.height, d.shape
     FROM mindmap_objects h
     LEFT JOIN mindmap_object_details d ON d.object_id = h.id
     WHERE h.board_id = $1
     ORDER BY h.id`,
    [req.params.boardId]
  );
  ok(res, rows);
}));

router.post('/boards/:boardId/objects', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoard(req, req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const {
    name, content,
    pos_x = 40, pos_y = 40,
    color = '#F2A93B', width = 140, height = 60, shape = 'rounded-rect',
  } = req.body;
  if (!name) return fail(res, 'name은 필수입니다.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [header] } = await client.query(
      'INSERT INTO mindmap_objects (board_id, name, content) VALUES ($1, $2, $3) RETURNING *',
      [req.params.boardId, name, content || null]
    );
    const { rows: [detail] } = await client.query(
      `INSERT INTO mindmap_object_details (object_id, pos_x, pos_y, color, width, height, shape)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [header.id, pos_x, pos_y, color, width, height, shape]
    );
    await client.query('COMMIT');
    ok(res, { ...header, ...detail });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// 명칭 / 내용 수정
router.put('/objects/:objectId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByObject(req, req.params.objectId);
  if (!board) return fail(res, '객체를 찾을 수 없습니다.', 404);

  const { name, content } = req.body;
  const { rows } = await pool.query(
    `UPDATE mindmap_objects SET name = COALESCE($1, name), content = COALESCE($2, content), updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [name, content, req.params.objectId]
  );
  ok(res, rows[0]);
}));

// 위치 / 색상 / 크기 / 모양 수정 (드래그 이동 시에도 이 엔드포인트를 사용)
router.put('/objects/:objectId/detail', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByObject(req, req.params.objectId);
  if (!board) return fail(res, '객체 세부정보를 찾을 수 없습니다.', 404);

  const { pos_x, pos_y, color, width, height, shape } = req.body;
  const { rows } = await pool.query(
    `UPDATE mindmap_object_details SET
        pos_x = COALESCE($1, pos_x),
        pos_y = COALESCE($2, pos_y),
        color = COALESCE($3, color),
        width = COALESCE($4, width),
        height = COALESCE($5, height),
        shape = COALESCE($6, shape),
        updated_at = NOW()
     WHERE object_id = $7 RETURNING *`,
    [pos_x, pos_y, color, width, height, shape, req.params.objectId]
  );
  ok(res, rows[0]);
}));

router.delete('/objects/:objectId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByObject(req, req.params.objectId);
  if (!board) return fail(res, '객체를 찾을 수 없습니다.', 404);

  await pool.query('DELETE FROM mindmap_objects WHERE id = $1', [req.params.objectId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   RELATION  (부모-자식 연결)
   ============================================================ */

router.get('/boards/:boardId/relations', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoard(req, req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { rows } = await pool.query(
    'SELECT id, parent_id, child_id, label FROM mindmap_relations WHERE board_id = $1',
    [req.params.boardId]
  );
  ok(res, rows);
}));

router.post('/boards/:boardId/relations', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoard(req, req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { parent_id, child_id, label } = req.body;
  if (!parent_id || !child_id) return fail(res, 'parent_id, child_id는 필수입니다.');
  if (String(parent_id) === String(child_id)) return fail(res, '자기 자신과는 연결할 수 없습니다.');
  try {
    const { rows } = await pool.query(
      'INSERT INTO mindmap_relations (board_id, parent_id, child_id, label) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.boardId, parent_id, child_id, label || null]
    );
    ok(res, rows[0]);
  } catch (e) {
    if (e.code === '23505') return fail(res, '이미 연결된 관계입니다.', 409);
    throw e;
  }
}));

router.put('/relations/:relationId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByRelation(req, req.params.relationId);
  if (!board) return fail(res, '관계를 찾을 수 없습니다.', 404);

  const { label } = req.body;
  const { rows } = await pool.query(
    'UPDATE mindmap_relations SET label = $1 WHERE id = $2 RETURNING *',
    [label != null ? String(label) : null, req.params.relationId]
  );
  ok(res, rows[0]);
}));

router.delete('/relations/:relationId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByRelation(req, req.params.relationId);
  if (!board) return fail(res, '관계를 찾을 수 없습니다.', 404);

  await pool.query('DELETE FROM mindmap_relations WHERE id = $1', [req.params.relationId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   MEMO  (확장 테이블 사용 예시)
   ============================================================ */

router.get('/objects/:objectId/memos', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByObject(req, req.params.objectId);
  if (!board) return fail(res, '객체를 찾을 수 없습니다.', 404);

  const { rows } = await pool.query(
    'SELECT id, memo_type, memo_text, created_at FROM mindmap_memos WHERE object_id = $1 ORDER BY created_at',
    [req.params.objectId]
  );
  ok(res, rows);
}));

router.post('/objects/:objectId/memos', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByObject(req, req.params.objectId);
  if (!board) return fail(res, '객체를 찾을 수 없습니다.', 404);

  const { memo_type = 'note', memo_text } = req.body;
  if (!memo_text) return fail(res, 'memo_text는 필수입니다.');
  const { rows } = await pool.query(
    'INSERT INTO mindmap_memos (object_id, memo_type, memo_text) VALUES ($1, $2, $3) RETURNING *',
    [req.params.objectId, memo_type, memo_text]
  );
  ok(res, rows[0]);
}));

router.delete('/memos/:memoId', asyncHandler(async (req, res) => {
  const board = await loadOwnedBoardByMemo(req, req.params.memoId);
  if (!board) return fail(res, '메모를 찾을 수 없습니다.', 404);

  await pool.query('DELETE FROM mindmap_memos WHERE id = $1', [req.params.memoId]);
  ok(res, { deleted: true });
}));

module.exports = router;

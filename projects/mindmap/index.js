// projects/mindmap/index.js
//
// mono-server 컨벤션: config.js + index.js(Express Router) + public/
// loader.js가 이 라우터를 require해서 app.use(`/${config.name}`, router) 형태로
// 마운트한다고 가정합니다 (mdboard/portfolio와 동일 패턴).

const express = require('express');
const path = require('path');
const pool = require('./db/pool');

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

/* ============================================================
   BOARD  (화면 상단 "주제(제목)")
   ============================================================ */

router.get('/api/boards', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, title, created_at, updated_at FROM mindmap_board ORDER BY updated_at DESC'
  );
  ok(res, rows);
}));

router.post('/api/boards', asyncHandler(async (req, res) => {
  const { title } = req.body;
  if (!title) return fail(res, 'title은 필수입니다.');
  const { rows } = await pool.query(
    'INSERT INTO mindmap_board (title) VALUES ($1) RETURNING *',
    [title]
  );
  ok(res, rows[0]);
}));

router.put('/api/boards/:boardId', asyncHandler(async (req, res) => {
  const { title } = req.body;
  const { rows } = await pool.query(
    'UPDATE mindmap_board SET title = COALESCE($1, title), updated_at = NOW() WHERE id = $2 RETURNING *',
    [title, req.params.boardId]
  );
  if (!rows.length) return fail(res, '보드를 찾을 수 없습니다.', 404);
  ok(res, rows[0]);
}));

router.delete('/api/boards/:boardId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM mindmap_board WHERE id = $1', [req.params.boardId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   OBJECT  (OBJECT_HEADER + OBJECT_DETAIL)
   ============================================================ */

// 보드에 속한 모든 객체를 헤더+디테일 합쳐서 한번에 조회 (캔버스 렌더링용)
router.get('/api/boards/:boardId/objects', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.id, h.name, h.content, h.created_at, h.updated_at,
            d.pos_x, d.pos_y, d.color, d.width, d.height, d.shape
     FROM object_header h
     LEFT JOIN object_detail d ON d.object_id = h.id
     WHERE h.board_id = $1
     ORDER BY h.id`,
    [req.params.boardId]
  );
  ok(res, rows);
}));

router.post('/api/boards/:boardId/objects', asyncHandler(async (req, res) => {
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
      'INSERT INTO object_header (board_id, name, content) VALUES ($1, $2, $3) RETURNING *',
      [req.params.boardId, name, content || null]
    );
    const { rows: [detail] } = await client.query(
      `INSERT INTO object_detail (object_id, pos_x, pos_y, color, width, height, shape)
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
router.put('/api/objects/:objectId', asyncHandler(async (req, res) => {
  const { name, content } = req.body;
  const { rows } = await pool.query(
    `UPDATE object_header SET name = COALESCE($1, name), content = COALESCE($2, content), updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [name, content, req.params.objectId]
  );
  if (!rows.length) return fail(res, '객체를 찾을 수 없습니다.', 404);
  ok(res, rows[0]);
}));

// 위치 / 색상 / 크기 / 모양 수정 (드래그 이동 시에도 이 엔드포인트를 사용)
router.put('/api/objects/:objectId/detail', asyncHandler(async (req, res) => {
  const { pos_x, pos_y, color, width, height, shape } = req.body;
  const { rows } = await pool.query(
    `UPDATE object_detail SET
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
  if (!rows.length) return fail(res, '객체 세부정보를 찾을 수 없습니다.', 404);
  ok(res, rows[0]);
}));

router.delete('/api/objects/:objectId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM object_header WHERE id = $1', [req.params.objectId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   RELATION  (부모-자식 연결)
   ============================================================ */

router.get('/api/boards/:boardId/relations', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, parent_id, child_id, label FROM relation WHERE board_id = $1',
    [req.params.boardId]
  );
  ok(res, rows);
}));

router.post('/api/boards/:boardId/relations', asyncHandler(async (req, res) => {
  const { parent_id, child_id, label } = req.body;
  if (!parent_id || !child_id) return fail(res, 'parent_id, child_id는 필수입니다.');
  if (String(parent_id) === String(child_id)) return fail(res, '자기 자신과는 연결할 수 없습니다.');
  try {
    const { rows } = await pool.query(
      'INSERT INTO relation (board_id, parent_id, child_id, label) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.boardId, parent_id, child_id, label || null]
    );
    ok(res, rows[0]);
  } catch (e) {
    if (e.code === '23505') return fail(res, '이미 연결된 관계입니다.', 409);
    throw e;
  }
}));

router.delete('/api/relations/:relationId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM relation WHERE id = $1', [req.params.relationId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   MEMO  (확장 테이블 사용 예시)
   ============================================================ */

router.get('/api/objects/:objectId/memos', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, memo_type, memo_text, created_at FROM object_memo WHERE object_id = $1 ORDER BY created_at',
    [req.params.objectId]
  );
  ok(res, rows);
}));

router.post('/api/objects/:objectId/memos', asyncHandler(async (req, res) => {
  const { memo_type = 'note', memo_text } = req.body;
  if (!memo_text) return fail(res, 'memo_text는 필수입니다.');
  const { rows } = await pool.query(
    'INSERT INTO object_memo (object_id, memo_type, memo_text) VALUES ($1, $2, $3) RETURNING *',
    [req.params.objectId, memo_type, memo_text]
  );
  ok(res, rows[0]);
}));

router.delete('/api/memos/:memoId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM object_memo WHERE id = $1', [req.params.memoId]);
  ok(res, { deleted: true });
}));

module.exports = router;

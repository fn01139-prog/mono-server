/**
 * projects/whiteboard/index.js
 * /whiteboard/api/* 로 자동 마운트됨.
 *
 * 개념: board(채널) 안에 layer(참여자 1명당 1개, 작성자 구분용)가 있고,
 * layer 안에 element(펜 드로잉 stroke / 스티키노트 note)가 쌓인다.
 *
 * 접근 제어:
 * - 조회/참여(요소 등록)는 이 앱에 접근 권한이 있는 로그인 사용자 전원 (loader.js가 앞단에서 보장)
 * - 보드 이름 변경·삭제는 보드 소유자 또는 admin만
 * - 레이어(참여자) 전체 삭제는 레이어 본인·보드 소유자·admin만
 * - 개별 요소 수정·삭제는 작성자 본인·보드 소유자·admin만 (다른 참여자의 내용은 건드릴 수 없음)
 */
const express = require('express');
const pool    = require('../../shared/db');
const { asyncHandler, ok, fail } = require('../../shared/utils');

const router = express.Router();
const isAdmin = (req) => req.user?.role === 'admin';
const ELEMENT_TYPES = ['stroke', 'note'];

router.get('/health', asyncHandler(async (req, res) => {
  ok(res, { status: 'ok', project: 'whiteboard', time: new Date() });
}));

async function loadBoard(boardId) {
  const { rows } = await pool.query('SELECT * FROM whiteboard_boards WHERE id = $1', [boardId]);
  return rows[0] || null;
}

async function loadLayer(layerId) {
  const { rows } = await pool.query('SELECT * FROM whiteboard_layers WHERE id = $1', [layerId]);
  return rows[0] || null;
}

async function loadElement(elementId) {
  const { rows } = await pool.query('SELECT * FROM whiteboard_elements WHERE id = $1', [elementId]);
  return rows[0] || null;
}

/** 보드에 대한 내 레이어를 가져오거나(없으면) 생성 — 최초 참여 시점 등록. 색상 기본값은 플랫폼 프로필 색상. */
async function ensureLayer(req, boardId) {
  const { rows: existing } = await pool.query(
    'SELECT * FROM whiteboard_layers WHERE board_id = $1 AND owner_id = $2',
    [boardId, req.user.userId]
  );
  if (existing[0]) return existing[0];

  const { rows: userRows } = await pool.query('SELECT color FROM platform_users WHERE id = $1', [req.user.userId]);
  const defaultColor = userRows[0]?.color || '#4a9eff';

  const { rows } = await pool.query(
    `INSERT INTO whiteboard_layers (board_id, owner_id, owner_name, color)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (board_id, owner_id) DO UPDATE SET owner_name = EXCLUDED.owner_name
     RETURNING *`,
    [boardId, req.user.userId, req.user.name, defaultColor]
  );
  return rows[0];
}

/* ============================================================
   BOARDS (채널) — 조회는 접근 권한이 있는 전원, 관리는 소유자/admin
   ============================================================ */

router.get('/boards', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*,
      (SELECT COUNT(*) FROM whiteboard_layers   l WHERE l.board_id = b.id) AS participant_count,
      (SELECT COUNT(*) FROM whiteboard_elements e WHERE e.board_id = b.id) AS element_count
    FROM whiteboard_boards b
    ORDER BY b.updated_at DESC
  `);
  ok(res, rows.map(r => ({ ...r, canManage: isAdmin(req) || r.owner_id === req.user.userId })));
}));

router.post('/boards', asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title?.trim()) return fail(res, 'title은 필수입니다.');
  const { rows } = await pool.query(
    'INSERT INTO whiteboard_boards (title, description, owner_id) VALUES ($1, $2, $3) RETURNING *',
    [title.trim(), description?.trim() || '', req.user.userId]
  );
  ok(res, { ...rows[0], canManage: true });
}));

router.get('/boards/:boardId', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);
  ok(res, { ...board, canManage: isAdmin(req) || board.owner_id === req.user.userId });
}));

router.put('/boards/:boardId', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);
  if (!isAdmin(req) && board.owner_id !== req.user.userId) return fail(res, '보드 소유자만 수정할 수 있습니다.', 403);

  const { title, description } = req.body;
  const { rows } = await pool.query(
    `UPDATE whiteboard_boards SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [title?.trim() || null, description != null ? description.trim() : null, req.params.boardId]
  );
  ok(res, { ...rows[0], canManage: true });
}));

router.delete('/boards/:boardId', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);
  if (!isAdmin(req) && board.owner_id !== req.user.userId) return fail(res, '보드 소유자만 삭제할 수 있습니다.', 403);

  await pool.query('DELETE FROM whiteboard_boards WHERE id = $1', [req.params.boardId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   LAYERS (참여자 = 작성자별 레이어)
   ============================================================ */

router.get('/boards/:boardId/layers', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { rows } = await pool.query(
    `SELECT l.*, (SELECT COUNT(*) FROM whiteboard_elements e WHERE e.layer_id = l.id) AS element_count
     FROM whiteboard_layers l WHERE l.board_id = $1 ORDER BY l.created_at`,
    [req.params.boardId]
  );
  ok(res, rows.map(r => ({
    ...r,
    isMine: r.owner_id === req.user.userId,
    canManage: isAdmin(req) || r.owner_id === req.user.userId || board.owner_id === req.user.userId,
  })));
}));

// 보드 입장 시 호출 — 내 레이어가 없으면 새로 등록(멱등), 있으면 그대로 반환
router.post('/boards/:boardId/join', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const layer = await ensureLayer(req, req.params.boardId);
  ok(res, layer);
}));

router.put('/layers/:layerId', asyncHandler(async (req, res) => {
  const layer = await loadLayer(req.params.layerId);
  if (!layer) return fail(res, '레이어를 찾을 수 없습니다.', 404);
  if (!isAdmin(req) && layer.owner_id !== req.user.userId) return fail(res, '본인 레이어만 수정할 수 있습니다.', 403);

  const { color } = req.body;
  if (color != null && !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 'color는 #rrggbb 형식이어야 합니다.');
  const { rows } = await pool.query(
    'UPDATE whiteboard_layers SET color = COALESCE($1, color) WHERE id = $2 RETURNING *',
    [color || null, req.params.layerId]
  );
  ok(res, rows[0]);
}));

// 레이어(참여자) 통째로 삭제 — 본인 / 보드 소유자 / admin. 해당 작성자의 요소도 함께 삭제된다(CASCADE).
router.delete('/layers/:layerId', asyncHandler(async (req, res) => {
  const layer = await loadLayer(req.params.layerId);
  if (!layer) return fail(res, '레이어를 찾을 수 없습니다.', 404);
  const board = await loadBoard(layer.board_id);

  const canManage = isAdmin(req) || layer.owner_id === req.user.userId || board?.owner_id === req.user.userId;
  if (!canManage) return fail(res, '레이어를 삭제할 권한이 없습니다.', 403);

  await pool.query('DELETE FROM whiteboard_layers WHERE id = $1', [req.params.layerId]);
  ok(res, { deleted: true });
}));

/* ============================================================
   ELEMENTS (펜 드로잉 stroke / 스티키노트 note)
   ============================================================ */

router.get('/boards/:boardId/elements', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { rows } = await pool.query(
    'SELECT * FROM whiteboard_elements WHERE board_id = $1 ORDER BY id',
    [req.params.boardId]
  );
  ok(res, rows);
}));

router.post('/boards/:boardId/elements', asyncHandler(async (req, res) => {
  const board = await loadBoard(req.params.boardId);
  if (!board) return fail(res, '보드를 찾을 수 없습니다.', 404);

  const { type, data } = req.body;
  if (!ELEMENT_TYPES.includes(type)) return fail(res, `type은 ${ELEMENT_TYPES.join('/')} 중 하나여야 합니다.`);
  if (!data || typeof data !== 'object') return fail(res, 'data가 필요합니다.');

  const layer = await ensureLayer(req, req.params.boardId);
  const { rows } = await pool.query(
    `INSERT INTO whiteboard_elements (board_id, layer_id, author_id, type, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.boardId, layer.id, req.user.userId, type, JSON.stringify(data)]
  );
  await pool.query('UPDATE whiteboard_boards SET updated_at = NOW() WHERE id = $1', [req.params.boardId]);
  ok(res, rows[0]);
}));

router.put('/elements/:elementId', asyncHandler(async (req, res) => {
  const el = await loadElement(req.params.elementId);
  if (!el) return fail(res, '요소를 찾을 수 없습니다.', 404);
  const board = await loadBoard(el.board_id);

  const canEdit = isAdmin(req) || el.author_id === req.user.userId || board?.owner_id === req.user.userId;
  if (!canEdit) return fail(res, '본인이 작성한 요소만 수정할 수 있습니다.', 403);

  const { data } = req.body;
  if (!data || typeof data !== 'object') return fail(res, 'data가 필요합니다.');
  const { rows } = await pool.query(
    'UPDATE whiteboard_elements SET data = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [JSON.stringify(data), req.params.elementId]
  );
  ok(res, rows[0]);
}));

router.delete('/elements/:elementId', asyncHandler(async (req, res) => {
  const el = await loadElement(req.params.elementId);
  if (!el) return fail(res, '요소를 찾을 수 없습니다.', 404);
  const board = await loadBoard(el.board_id);

  const canDelete = isAdmin(req) || el.author_id === req.user.userId || board?.owner_id === req.user.userId;
  if (!canDelete) return fail(res, '본인이 작성한 요소만 삭제할 수 있습니다.', 403);

  await pool.query('DELETE FROM whiteboard_elements WHERE id = $1', [req.params.elementId]);
  ok(res, { deleted: true });
}));

module.exports = router;

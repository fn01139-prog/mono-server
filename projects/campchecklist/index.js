'use strict';

const express    = require('express');
const crypto     = require('crypto');
const pool       = require('../../shared/db');

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const isAdmin = (req) => req.user?.role === 'admin';

function historyEntry(user, action) {
  return { userId: user.userId, loginId: user.loginId, name: user.name, action, at: now() };
}

const adminRequired = (req, res, next) => {
  if (!isAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  next();
};

/** trip을 조회하고, 본인이 owner/참여자/admin인지 검사. 접근 불가 시 null. */
async function loadAccessibleTrip(req, tripId) {
  const { rows } = await pool.query('SELECT * FROM camp_trips WHERE id = $1', [tripId]);
  const trip = rows[0];
  if (!trip) return null;
  if (isAdmin(req)) return trip;
  const participants = trip.participants || [];
  if (trip.owner_id === req.user.userId || participants.includes(req.user.userId)) return trip;
  return null;
}

/** trip을 조회하고 소유자(또는 admin)인지 검사. */
async function loadOwnedTrip(req, tripId) {
  const { rows } = await pool.query('SELECT * FROM camp_trips WHERE id = $1', [tripId]);
  const trip = rows[0];
  if (!trip) return null;
  if (isAdmin(req) || trip.owner_id === req.user.userId) return trip;
  return null;
}

/* ── Router ───────────────────────────────────────────────────────────── */
const router = express.Router();
router.use(express.json());

/* ── 상태 ─────────────────────────────────────────────────────────────── */
router.get('/status', (req, res) => {
  res.json({ driveEnabled: false, storage: 'postgresql' });
});

/* ── MEMBERS (이 앱에 접근 권한이 있는 플랫폼 사용자 — 참여자 후보 목록) ── */
router.get('/members', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.color
       FROM platform_users u
       JOIN platform_accounts a ON a.user_id = u.id AND a.is_active = TRUE
       LEFT JOIN platform_app_grants g ON g.user_id = u.id AND g.app_prefix = '/campchecklist'
       WHERE a.role = 'admin' OR g.user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM platform_app_grants g2 WHERE g2.user_id = '*' AND g2.app_prefix = '/campchecklist')
       ORDER BY u.name`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── ITEMS (본인 품목만 생성/수정/삭제, 조회는 같은 일정 참여자끼리 공유) ── */
router.get('/items', async (req, res) => {
  try {
    const { userId } = req.query;
    const q = userId
      ? pool.query('SELECT * FROM camp_items WHERE user_id = $1 ORDER BY created_at', [userId])
      : pool.query('SELECT * FROM camp_items ORDER BY created_at');
    const { rows } = await q;
    res.json(rows.map(r => ({ ...r, userId: r.user_id })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/items', async (req, res) => {
  const { userId, name, category, quantity, unit, note } = req.body;
  if (!userId || !name?.trim()) return res.status(400).json({ error: '필수값 누락' });
  if (!isAdmin(req) && req.user.userId !== userId)
    return res.status(403).json({ error: '본인 품목만 등록할 수 있습니다' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO camp_items (id, user_id, name, category, quantity, unit, note, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [uid(), userId, name.trim(), category || '기타', Number(quantity) || 1, unit || '개', note || '', now(), JSON.stringify(historyEntry(req.user, '등록'))]
    );
    res.json({ ...rows[0], userId: rows[0].user_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/items/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM camp_items WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '품목 없음' });
    if (!isAdmin(req) && req.user.userId !== cur[0].user_id)
      return res.status(403).json({ error: '본인 품목만 수정할 수 있습니다' });

    const { name, category, quantity, unit, note } = req.body;
    const { rows } = await pool.query(
      `UPDATE camp_items SET
         name = COALESCE($2, name), category = COALESCE($3, category),
         quantity = COALESCE($4, quantity), unit = COALESCE($5, unit),
         note = COALESCE($6, note), updated_by = $7
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, category, quantity != null ? Number(quantity) : null, unit, note, JSON.stringify(historyEntry(req.user, '수정'))]
    );
    res.json({ ...rows[0], userId: rows[0].user_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM camp_items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '품목 없음' });
    if (!isAdmin(req) && req.user.userId !== rows[0].user_id)
      return res.status(403).json({ error: '본인 품목만 삭제할 수 있습니다' });
    await pool.query('DELETE FROM camp_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── TRIPS (생성자가 참여자를 초대하는 방식 — 본인이 만들었거나 초대된 일정만 조회) ── */
function tripRow(r) {
  return {
    id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date,
    location: r.location, note: r.note, participants: r.participants,
    ownerId: r.owner_id,
    createdAt: r.created_at, createdBy: r.created_by, history: r.history,
  };
}

router.get('/trips', async (req, res) => {
  try {
    const { rows } = isAdmin(req)
      ? await pool.query('SELECT * FROM camp_trips ORDER BY start_date DESC')
      : await pool.query(
          `SELECT * FROM camp_trips
           WHERE owner_id = $1 OR participants @> $2::jsonb
           ORDER BY start_date DESC`,
          [req.user.userId, JSON.stringify([req.user.userId])]
        );
    res.json(rows.map(tripRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/trips', async (req, res) => {
  const { name, startDate, endDate, location, note, participants } = req.body;
  if (!name?.trim() || !startDate) return res.status(400).json({ error: '필수값 누락' });
  const entry = historyEntry(req.user, '생성');
  // 생성자 본인은 항상 참여자에 포함 (체크리스트/품목 조회 로직 호환)
  const parts = new Set([req.user.userId, ...(Array.isArray(participants) ? participants : [])]);
  try {
    const { rows } = await pool.query(
      `INSERT INTO camp_trips (id, name, start_date, end_date, location, note, participants, owner_id, created_at, created_by, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [uid(), name.trim(), startDate, endDate || startDate, location || '', note || '',
       JSON.stringify([...parts]), req.user.userId, now(), JSON.stringify(entry), JSON.stringify([entry])]
    );
    res.json(tripRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/trips/:id', async (req, res) => {
  try {
    const t = await loadOwnedTrip(req, req.params.id);
    if (!t) return res.status(404).json({ error: '일정 없음' });

    const entry   = historyEntry(req.user, req.body._action || '수정');
    const history = [...(t.history || []), entry];
    const { name, startDate, endDate, location, note } = req.body;

    const { rows } = await pool.query(
      `UPDATE camp_trips SET
         name = COALESCE($2, name),
         start_date = COALESCE($3, start_date),
         end_date = COALESCE($4, end_date),
         location = COALESCE($5, location),
         note = COALESCE($6, note),
         history = $7
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, startDate, endDate, location, note, JSON.stringify(history)]
    );
    res.json(tripRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/trips/:id', adminRequired, async (req, res) => {
  try {
    await pool.query('DELETE FROM camp_trips WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM camp_checks WHERE trip_id = $1', [req.params.id]);
    await pool.query('DELETE FROM camp_comments WHERE trip_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** 참여자 목록 교체 (owner 또는 admin 전용) — 생성자 자신은 항상 유지된다. */
router.put('/trips/:id/participants', async (req, res) => {
  const { participants } = req.body;
  if (!Array.isArray(participants)) return res.status(400).json({ error: 'participants 배열이 필요합니다' });
  try {
    const t = await loadOwnedTrip(req, req.params.id);
    if (!t) return res.status(404).json({ error: '일정 없음' });

    const parts = new Set([t.owner_id, ...participants]);
    const history = [...(t.history || []), historyEntry(req.user, '참여자 변경')];
    const { rows } = await pool.query(
      'UPDATE camp_trips SET participants = $2, history = $3 WHERE id = $1 RETURNING *',
      [req.params.id, JSON.stringify([...parts]), JSON.stringify(history)]
    );
    res.json(tripRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── CHECKS (일정 참여자만 조회/수정 가능) ─────────────────────────────── */
router.get('/trips/:tripId/checks', async (req, res) => {
  try {
    if (!(await loadAccessibleTrip(req, req.params.tripId)))
      return res.status(404).json({ error: '일정 없음' });

    const { rows } = await pool.query(
      'SELECT * FROM camp_checks WHERE trip_id = $1', [req.params.tripId]
    );
    const result = {};
    rows.forEach(r => {
      (result[r.user_id] ??= {})[r.item_id] = { planned: r.planned, packed: r.packed };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/trips/:tripId/checks', async (req, res) => {
  const { userId, itemId, planned, packed } = req.body;
  if (!userId || !itemId) return res.status(400).json({ error: '필수값 누락' });
  if (!isAdmin(req) && req.user.userId !== userId)
    return res.status(403).json({ error: '본인 체크리스트만 수정할 수 있습니다' });
  try {
    if (!(await loadAccessibleTrip(req, req.params.tripId)))
      return res.status(404).json({ error: '일정 없음' });

    const { rows: cur } = await pool.query(
      'SELECT * FROM camp_checks WHERE trip_id=$1 AND user_id=$2 AND item_id=$3',
      [req.params.tripId, userId, itemId]
    );
    const prev = cur[0] || { planned: false, packed: false };
    await pool.query(
      `INSERT INTO camp_checks (trip_id, user_id, item_id, planned, packed)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (trip_id, user_id, item_id)
       DO UPDATE SET planned = EXCLUDED.planned, packed = EXCLUDED.packed`,
      [req.params.tripId, userId, itemId,
       planned !== undefined ? Boolean(planned) : prev.planned,
       packed  !== undefined ? Boolean(packed)  : prev.packed]
    );
    const { rows: all } = await pool.query(
      'SELECT * FROM camp_checks WHERE trip_id = $1', [req.params.tripId]
    );
    const result = {};
    all.forEach(r => {
      (result[r.user_id] ??= {})[r.item_id] = { planned: r.planned, packed: r.packed };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── COMMENTS (일정 참여자만 조회/작성) ────────────────────────────────── */
function commentRow(r) {
  return {
    id: r.id, tripId: r.trip_id, parentId: r.parent_id, depth: r.depth,
    authorId: r.author_id, authorName: r.author_name, content: r.content,
    createdAt: r.created_at, updatedAt: r.updated_at, edited: r.edited,
  };
}

router.get('/comments', async (req, res) => {
  try {
    const { tripId } = req.query;
    if (tripId) {
      if (!(await loadAccessibleTrip(req, tripId))) return res.status(404).json({ error: '일정 없음' });
      const { rows } = await pool.query('SELECT * FROM camp_comments WHERE trip_id = $1 ORDER BY created_at', [tripId]);
      return res.json(rows.map(commentRow));
    }
    if (!isAdmin(req)) return res.status(400).json({ error: 'tripId가 필요합니다' });
    const { rows } = await pool.query('SELECT * FROM camp_comments ORDER BY created_at');
    res.json(rows.map(commentRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/comments', async (req, res) => {
  const { tripId, parentId, content } = req.body;
  if (!tripId || !content?.trim()) return res.status(400).json({ error: '필수값 누락' });
  let depth = 0;
  try {
    if (!(await loadAccessibleTrip(req, tripId))) return res.status(404).json({ error: '일정 없음' });

    if (parentId) {
      const { rows } = await pool.query('SELECT depth FROM camp_comments WHERE id = $1', [parentId]);
      if (!rows.length) return res.status(404).json({ error: '부모 댓글 없음' });
      if (rows[0].depth >= 2) return res.status(400).json({ error: '3차 대댓글까지만 작성 가능합니다' });
      depth = rows[0].depth + 1;
    }
    const ts = now();
    const { rows } = await pool.query(
      `INSERT INTO camp_comments (id, trip_id, parent_id, depth, author_id, author_name, content, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [uid(), tripId, parentId || null, depth, req.user.userId, req.user.name, content.trim(), ts]
    );
    res.json(commentRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/comments/:id', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요' });
  try {
    const { rows: cur } = await pool.query('SELECT * FROM camp_comments WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '댓글 없음' });
    if (!isAdmin(req) && req.user.userId !== cur[0].author_id)
      return res.status(403).json({ error: '본인 댓글만 수정할 수 있습니다' });

    const { rows } = await pool.query(
      'UPDATE camp_comments SET content=$2, updated_at=$3, edited=true WHERE id=$1 RETURNING *',
      [req.params.id, content.trim(), now()]
    );
    res.json(commentRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/comments/:id', adminRequired, async (req, res) => {
  try {
    const { rows: withParent } = await pool.query('SELECT id, parent_id FROM camp_comments');
    const toDelete = new Set();
    function collectTree(id) {
      toDelete.add(id);
      withParent.filter(r => r.parent_id === id).forEach(c => collectTree(c.id));
    }
    collectTree(req.params.id);

    if (toDelete.size) {
      const ids = [...toDelete];
      await pool.query(`DELETE FROM camp_comments WHERE id = ANY($1)`, [ids]);
    }
    res.json({ ok: true, deleted: toDelete.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

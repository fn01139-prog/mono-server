'use strict';

const express    = require('express');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const pool       = require('../../shared/db');

const config     = require('./config');
const JWT_SECRET = process.env.JWT_SECRET || 'campcheck-dev-secret-change-in-prod';
const JWT_EXPIRES = '30d';
const ADMIN_ID   = config.adminLoginId || 'admin';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/* ── Auth ─────────────────────────────────────────────────────────────── */
function makeToken(account, user) {
  const role = (account.loginId === ADMIN_ID) ? 'admin' : account.role;
  return jwt.sign(
    { userId: user.id, loginId: account.loginId, name: user.name, color: user.color, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function historyEntry(user, action) {
  return { userId: user.userId, loginId: user.loginId, name: user.name, action, at: now() };
}

function authOptional(req, res, next) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(h.slice(7), JWT_SECRET);
      if (payload.loginId === ADMIN_ID) payload.role = 'admin';
      req.user = payload;
    } catch { req.user = null; }
  }
  next();
}

const authRequired  = (req, res, next) => req.user ? next() : res.status(401).json({ error: '로그인이 필요합니다' });
const adminRequired = (req, res, next) => {
  if (!req.user)                return res.status(401).json({ error: '로그인이 필요합니다' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  next();
};

/* ── Router ───────────────────────────────────────────────────────────── */
const router = express.Router();
router.use(express.json());
router.use(authOptional);

/* ── 상태 ─────────────────────────────────────────────────────────────── */
router.get('/status', (req, res) => {
  res.json({ driveEnabled: false, storage: 'postgresql' });
});

/* ── AUTH ─────────────────────────────────────────────────────────────── */
router.post('/auth/register', async (req, res) => {
  const { name, loginId, password } = req.body;
  if (!name?.trim() || !loginId?.trim() || !password?.trim())
    return res.status(400).json({ error: '이름, 아이디, 비밀번호를 모두 입력하세요' });

  try {
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM camp_accounts WHERE login_id = $1', [loginId.trim()]
    );
    if (existing.length) return res.status(400).json({ error: '이미 사용 중인 아이디입니다' });

    let { rows: users } = await pool.query(
      'SELECT * FROM camp_users WHERE name = $1', [name.trim()]
    );
    let user = users[0];

    if (!user) {
      const { rows } = await pool.query(
        'INSERT INTO camp_users (id, name, color, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
        [uid(), name.trim(), '#4a7c59', now()]
      );
      user = rows[0];
    } else {
      const { rows: accRows } = await pool.query(
        'SELECT 1 FROM camp_accounts WHERE user_id = $1', [user.id]
      );
      if (accRows.length) return res.status(400).json({ error: '해당 이름으로 이미 계정이 등록되어 있습니다' });
    }

    const pwHash = await bcrypt.hash(password, 10);
    const role   = loginId.trim() === ADMIN_ID ? 'admin' : 'member';
    const { rows: accRows } = await pool.query(
      `INSERT INTO camp_accounts (user_id, login_id, pw_hash, role, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user.id, loginId.trim(), pwHash, role, now()]
    );
    const account = { ...accRows[0], loginId: accRows[0].login_id };

    res.json({
      token: makeToken(account, user),
      user: { userId: user.id, loginId: account.loginId, name: user.name, color: user.color, role: account.role }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/auth/login', async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM camp_accounts WHERE login_id = $1', [loginId]
    );
    const account = rows[0];
    if (!account || !(await bcrypt.compare(password, account.pw_hash)))
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

    await pool.query(
      'UPDATE camp_accounts SET last_login_at = $1 WHERE login_id = $2', [now(), loginId]
    );

    const { rows: userRows } = await pool.query('SELECT * FROM camp_users WHERE id = $1', [account.user_id]);
    const user = userRows[0];
    if (!user) return res.status(500).json({ error: '계정 데이터 오류' });

    const acc = { ...account, loginId: account.login_id };
    res.json({
      token: makeToken(acc, user),
      user: { userId: user.id, loginId: acc.loginId, name: user.name, color: user.color, role: acc.role }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/auth/me', authRequired, (req, res) => res.json(req.user));

/* ── USERS ────────────────────────────────────────────────────────────── */
router.get('/users', async (req, res) => {
  try {
    const { rows: users }    = await pool.query('SELECT * FROM camp_users ORDER BY created_at');
    const { rows: accounts } = await pool.query('SELECT * FROM camp_accounts');
    const result = users.map(u => {
      const acc = accounts.find(a => a.user_id === u.id);
      return { ...u, hasAccount: !!acc, loginId: req.user?.role === 'admin' ? acc?.login_id : undefined };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', adminRequired, async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '이름을 입력하세요' });
  try {
    const user = { id: uid(), name: name.trim(), color: color || '#4a7c59', created_at: now(), created_by: JSON.stringify(historyEntry(req.user, '생성')) };
    const { rows } = await pool.query(
      'INSERT INTO camp_users (id, name, color, created_at, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [user.id, user.name, user.color, user.created_at, user.created_by]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id', adminRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE camp_users SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 RETURNING *',
      [req.params.id, req.body.name, req.body.color]
    );
    if (!rows.length) return res.status(404).json({ error: '사용자 없음' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id', adminRequired, async (req, res) => {
  try {
    await pool.query('DELETE FROM camp_users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── ITEMS ────────────────────────────────────────────────────────────── */
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

router.post('/items', authRequired, async (req, res) => {
  const { userId, name, category, quantity, unit, note } = req.body;
  if (!userId || !name?.trim()) return res.status(400).json({ error: '필수값 누락' });
  if (req.user.role !== 'admin' && req.user.userId !== userId)
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

router.put('/items/:id', authRequired, async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM camp_items WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '품목 없음' });
    if (req.user.role !== 'admin' && req.user.userId !== cur[0].user_id)
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

router.delete('/items/:id', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM camp_items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '품목 없음' });
    if (req.user.role !== 'admin' && req.user.userId !== rows[0].user_id)
      return res.status(403).json({ error: '본인 품목만 삭제할 수 있습니다' });
    await pool.query('DELETE FROM camp_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── TRIPS ────────────────────────────────────────────────────────────── */
function tripRow(r) {
  return {
    id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date,
    location: r.location, note: r.note, participants: r.participants,
    createdAt: r.created_at, createdBy: r.created_by, history: r.history,
  };
}

router.get('/trips', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM camp_trips ORDER BY start_date DESC');
    res.json(rows.map(tripRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/trips', authRequired, async (req, res) => {
  const { name, startDate, endDate, location, note, participants } = req.body;
  if (!name?.trim() || !startDate) return res.status(400).json({ error: '필수값 누락' });
  const entry = historyEntry(req.user, '생성');
  try {
    const { rows } = await pool.query(
      `INSERT INTO camp_trips (id, name, start_date, end_date, location, note, participants, created_at, created_by, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [uid(), name.trim(), startDate, endDate || startDate, location || '', note || '',
       JSON.stringify(participants || []), now(), JSON.stringify(entry), JSON.stringify([entry])]
    );
    res.json(tripRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/trips/:id', authRequired, async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM camp_trips WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '일정 없음' });
    const t = cur[0];

    const entry   = historyEntry(req.user, req.body._action || '수정');
    const history = [...(t.history || []), entry];
    const { name, startDate, endDate, location, note, participants } = req.body;

    const { rows } = await pool.query(
      `UPDATE camp_trips SET
         name = COALESCE($2, name),
         start_date = COALESCE($3, start_date),
         end_date = COALESCE($4, end_date),
         location = COALESCE($5, location),
         note = COALESCE($6, note),
         participants = COALESCE($7, participants),
         history = $8
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, startDate, endDate, location, note,
       participants ? JSON.stringify(participants) : null, JSON.stringify(history)]
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

router.put('/trips/:id/join', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM camp_trips WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '일정 없음' });
    const t       = rows[0];
    const parts   = new Set(t.participants || []);
    parts.add(req.user.userId);
    const history = [...(t.history || []), historyEntry(req.user, '참여')];
    const { rows: updated } = await pool.query(
      'UPDATE camp_trips SET participants = $2, history = $3 WHERE id = $1 RETURNING *',
      [req.params.id, JSON.stringify([...parts]), JSON.stringify(history)]
    );
    res.json(tripRow(updated[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/trips/:id/join', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM camp_trips WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '일정 없음' });
    const t       = rows[0];
    const parts   = (t.participants || []).filter(p => p !== req.user.userId);
    const history = [...(t.history || []), historyEntry(req.user, '참여 취소')];
    const { rows: updated } = await pool.query(
      'UPDATE camp_trips SET participants = $2, history = $3 WHERE id = $1 RETURNING *',
      [req.params.id, JSON.stringify(parts), JSON.stringify(history)]
    );
    res.json(tripRow(updated[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── CHECKS ───────────────────────────────────────────────────────────── */
router.get('/trips/:tripId/checks', async (req, res) => {
  try {
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

router.put('/trips/:tripId/checks', authRequired, async (req, res) => {
  const { userId, itemId, planned, packed } = req.body;
  if (!userId || !itemId) return res.status(400).json({ error: '필수값 누락' });
  if (req.user.role !== 'admin' && req.user.userId !== userId)
    return res.status(403).json({ error: '본인 체크리스트만 수정할 수 있습니다' });
  try {
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

/* ── COMMENTS ─────────────────────────────────────────────────────────── */
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
    const q = tripId
      ? pool.query('SELECT * FROM camp_comments WHERE trip_id = $1 ORDER BY created_at', [tripId])
      : pool.query('SELECT * FROM camp_comments ORDER BY created_at');
    const { rows } = await q;
    res.json(rows.map(commentRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/comments', authRequired, async (req, res) => {
  const { tripId, parentId, content } = req.body;
  if (!tripId || !content?.trim()) return res.status(400).json({ error: '필수값 누락' });
  let depth = 0;
  try {
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

router.put('/comments/:id', authRequired, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요' });
  try {
    const { rows: cur } = await pool.query('SELECT * FROM camp_comments WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '댓글 없음' });
    if (req.user.role !== 'admin' && req.user.userId !== cur[0].author_id)
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

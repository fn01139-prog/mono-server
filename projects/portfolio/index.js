/**
 * projects/portfolio/index.js
 * → /portfolio/api/* 로 마운트됨
 * 데이터 저장소: PostgreSQL (portfolio_pages 테이블)
 */
const express = require('express');
const crypto  = require('crypto');
const pool    = require('../../shared/db');
const router  = express.Router();

/* ── 인증 헬퍼 ────────────────────────────────────────────────────────── */
function getPassword() { return process.env.PORTFOLIO_PASSWORD || ''; }

function makeToken(pwd) {
  return crypto.createHmac('sha256', pwd).update('portfolio-auth').digest('hex');
}

function verifyToken(token) {
  const pwd = getPassword();
  if (!pwd || !token) return false;
  return token === makeToken(pwd);
}

function requireAuth(req, res, next) {
  if (!getPassword()) return next();
  const token = req.headers['x-auth-token'];
  if (!verifyToken(token)) {
    return res.status(401).json({ success: false, error: '인증이 필요합니다.' });
  }
  next();
}

/* ── 헬스체크 ─────────────────────────────────────────────────────────── */
router.get('/health', (req, res) => {
  res.json({ success: true, project: 'portfolio', time: new Date() });
});

/* ── 인증 ─────────────────────────────────────────────────────────────── */
router.get('/auth/check', (req, res) => {
  res.json({ required: !!getPassword() });
});

router.get('/auth/verify', (req, res) => {
  const token = req.headers['x-auth-token'];
  res.json({ valid: verifyToken(token) });
});

router.post('/auth', (req, res) => {
  const pwd = getPassword();
  if (!pwd) return res.json({ success: true, token: '' });
  const { password } = req.body;
  if (password !== pwd) {
    return res.status(401).json({ success: false, error: '비밀번호가 틀렸습니다.' });
  }
  res.json({ success: true, token: makeToken(pwd) });
});

/* ── GET /portfolio/api/pages ─────────────────────────────────────────── */
router.get('/pages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, person, num, template, status, contents FROM portfolio_pages ORDER BY num'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /portfolio/api/pages/:id ────────────────────────────────────── */
router.get('/pages/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, person, num, template, status, contents FROM portfolio_pages WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Page not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /portfolio/api/pages ───────────────────────────────────────── */
router.post('/pages', requireAuth, async (req, res) => {
  const { id, person, num, template, status, contents } = req.body;
  if (!id || !person || !num)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO portfolio_pages (id, person, num, template, status, contents)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, person, num, template, status, contents`,
      [id, person, num, template || 'profile', status || 'draft', JSON.stringify(contents || [])]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Page already exists' });
    res.status(500).json({ error: e.message });
  }
});

/* ── PUT /portfolio/api/pages/:id ────────────────────────────────────── */
router.put('/pages/:id', requireAuth, async (req, res) => {
  const { template, status, contents } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE portfolio_pages
       SET template   = COALESCE($2, template),
           status     = COALESCE($3, status),
           contents   = COALESCE($4, contents),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, person, num, template, status, contents`,
      [req.params.id, template, status, contents ? JSON.stringify(contents) : null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Page not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── DELETE /portfolio/api/pages/:id ─────────────────────────────────── */
router.delete('/pages/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM portfolio_pages WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Page not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

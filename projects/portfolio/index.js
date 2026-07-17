/**
 * projects/portfolio/index.js
 * → /portfolio/api/* 로 마운트됨
 * 데이터 저장소: PostgreSQL (portfolio_pages 테이블)
 *
 * 인증: 플랫폼 로그인(loader.js 가드)을 사용. 이 라우터에 도달했다는 것은
 *   - GET /pages/:id (publicPaths로 열린 경로): req.user가 있을 수도, 없을 수도 있음
 *   - 그 외 모든 경로: req.user가 항상 존재 (loader.js requireLogin 통과)
 *
 * 격리: owner_id 기준 본인 페이지만 CRUD. status = 'published'인 페이지는 비로그인 GET 허용
 *   (기존 프론트엔드의 "공개하기/비공개로" 토글이 이미 이 필드를 사용하고 있음).
 */
const express = require('express');
const pool    = require('../../shared/db');
const router  = express.Router();

const isAdmin = (req) => req.user?.role === 'admin';

function pageRow(r) {
  return {
    id: r.id, person: r.person, num: r.num, template: r.template,
    status: r.status, contents: r.contents, ownerId: r.owner_id,
  };
}

/* ── 헬스체크 ─────────────────────────────────────────────────────────── */
router.get('/health', (req, res) => {
  res.json({ success: true, project: 'portfolio', time: new Date() });
});

/* ── GET /portfolio/api/pages (로그인 필요 — 본인 페이지 목록) ──────────── */
router.get('/pages', async (req, res) => {
  try {
    const { rows } = isAdmin(req)
      ? await pool.query('SELECT * FROM portfolio_pages ORDER BY num')
      : await pool.query('SELECT * FROM portfolio_pages WHERE owner_id = $1 ORDER BY num', [req.user.userId]);
    res.json(rows.map(pageRow));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /portfolio/api/pages/:id (공개 경로 — 비로그인 접근 가능) ──────── */
router.get('/pages/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM portfolio_pages WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Page not found' });
    const page = rows[0];

    const isOwner = req.user && (isAdmin(req) || page.owner_id === req.user.userId);
    if (page.status !== 'published' && !isOwner) return res.status(404).json({ error: 'Page not found' });

    res.json(pageRow(page));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /portfolio/api/pages (로그인 필요) ─────────────────────────── */
router.post('/pages', async (req, res) => {
  const { id, person, num, template, status, contents } = req.body;
  if (!id || !person || !num)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO portfolio_pages (id, person, num, template, status, contents, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, person, num, template || 'profile', status || 'draft', JSON.stringify(contents || []), req.user.userId]
    );
    res.status(201).json(pageRow(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Page already exists' });
    res.status(500).json({ error: e.message });
  }
});

/* ── PUT /portfolio/api/pages/:id (본인 소유만, 로그인 필요) ────────────── */
router.put('/pages/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM portfolio_pages WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Page not found' });
    if (!isAdmin(req) && cur[0].owner_id !== req.user.userId) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const { template, status, contents } = req.body;
    const { rows } = await pool.query(
      `UPDATE portfolio_pages
       SET template   = COALESCE($2, template),
           status     = COALESCE($3, status),
           contents   = COALESCE($4, contents),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, template, status, contents ? JSON.stringify(contents) : null]
    );
    res.json(pageRow(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── DELETE /portfolio/api/pages/:id (본인 소유만, 로그인 필요) ─────────── */
router.delete('/pages/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM portfolio_pages WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Page not found' });
    if (!isAdmin(req) && cur[0].owner_id !== req.user.userId) {
      return res.status(404).json({ error: 'Page not found' });
    }

    await pool.query('DELETE FROM portfolio_pages WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

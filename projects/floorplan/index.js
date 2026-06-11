/**
 * projects/floorplan/index.js
 * floorplan-server를 mono-server 구조로 이식
 * → /floorplan/api/* 로 마운트됨
 */
const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');
const router   = express.Router();
const storage  = require('./services/storage');
const config           = require('./config');

/* ── 인증 헬퍼 (mdBoard 동일 패턴) ───────────────────────────────────── */
function getAdminTokens() {
  return (process.env.FLOORPLAN_ADMIN_TOKENS || process.env.ADMIN_TOKENS || '')
    .split(',').map(t => t.trim()).filter(Boolean);
}

function verifyToken(token) {
  if (!token) return false;
  return getAdminTokens().includes(token);
}

function requireAdmin(req, res, next) {
  const tokens = getAdminTokens();
  if (!tokens.length) return next(); // 토큰 미설정 시 인증 불필요
  const token = req.headers['x-admin-token'] || '';
  if (!verifyToken(token)) {
    return res.status(403).json({ ok: false, error: '권한이 없습니다', code: 'FORBIDDEN' });
  }
  next();
}

/* ── Health ───────────────────────────────────────────────────────────── */
router.get('/health', (req, res) => {
  res.json({ ok: true, project: 'floorplan', time: new Date() });
});

/* ── 인증 확인 ────────────────────────────────────────────────────────── */
router.get('/api/auth/check', (req, res) => {
  res.json({ ok: true, required: getAdminTokens().length > 0 });
});

router.post('/api/auth/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.json({ ok: true, isAdmin: false });
  res.json({ ok: true, isAdmin: verifyToken(token) });
});

/* ── 평면도 CRUD ──────────────────────────────────────────────────────── */
// GET /floorplan/api/floorplans
router.get('/api/floorplans', async (req, res) => {
  try {
    const list = await storage.listFloorplans();
    res.json({ ok: true, data: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /floorplan/api/floorplans/:id
router.get('/api/floorplans/:id', async (req, res) => {
  try {
    const data = await storage.getFloorplan(req.params.id);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

// POST /floorplan/api/floorplans  (관리자 전용)
router.post('/api/floorplans', requireAdmin, async (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ ok: false, error: 'name, data 필수' });
    const id = await storage.saveFloorplan(name, {
      ...data,
      meta: { ...data.meta, name, savedAt: new Date().toISOString() }
    });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /floorplan/api/floorplans/:id  (관리자 전용)
router.put('/api/floorplans/:id', requireAdmin, async (req, res) => {
  try {
    const { name, data } = req.body;
    const saveName = name || req.params.id;
    const id = await storage.saveFloorplan(saveName, {
      ...data,
      meta: { ...data.meta, name: saveName, savedAt: new Date().toISOString() }
    });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /floorplan/api/floorplans/:id  (관리자 전용)
router.delete('/api/floorplans/:id', requireAdmin, async (req, res) => {
  try {
    await storage.deleteFloorplan(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── 카테고리 ─────────────────────────────────────────────────────────── */
// GET /floorplan/api/categories
router.get('/api/categories', async (req, res) => {
  try {
    const data = await storage.getCategories();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /floorplan/api/categories  (관리자 전용)
router.put('/api/categories', requireAdmin, async (req, res) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ ok: false, error: 'data는 배열' });
    await storage.saveCategories(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /floorplan/api/categories  (관리자 전용)
router.post('/api/categories', requireAdmin, async (req, res) => {
  try {
    const cats = await storage.getCategories();
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ ok: false, error: 'id, name 필수' });
    if (cats.find(c => c.id === id)) return res.status(409).json({ ok: false, error: '이미 존재하는 ID' });
    cats.push({ id, name, items: [] });
    await storage.saveCategories(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /floorplan/api/categories/:catId  (관리자 전용)
router.delete('/api/categories/:catId', requireAdmin, async (req, res) => {
  try {
    let cats = await storage.getCategories();
    cats = cats.filter(c => c.id !== req.params.catId);
    await storage.saveCategories(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /floorplan/api/categories/:catId/items  (관리자 전용)
router.post('/api/categories/:catId/items', requireAdmin, async (req, res) => {
  try {
    const cats = await storage.getCategories();
    const cat  = cats.find(c => c.id === req.params.catId);
    if (!cat) return res.status(404).json({ ok: false, error: '카테고리 없음' });
    const item = req.body;
    if (!item.label || !item.w || !item.h) return res.status(400).json({ ok: false, error: 'label, w, h 필수' });
    item.id = item.id || Date.now().toString(36);
    cat.items.push(item);
    await storage.saveCategories(cats);
    res.json({ ok: true, item });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /floorplan/api/categories/:catId/items/:itemId  (관리자 전용)
router.delete('/api/categories/:catId/items/:itemId', requireAdmin, async (req, res) => {
  try {
    const cats = await storage.getCategories();
    const cat  = cats.find(c => c.id === req.params.catId);
    if (!cat) return res.status(404).json({ ok: false, error: '카테고리 없음' });
    cat.items = cat.items.filter(i => i.id !== req.params.itemId);
    await storage.saveCategories(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

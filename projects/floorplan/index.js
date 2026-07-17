/**
 * projects/floorplan/index.js
 * floorplan-server를 mono-server 구조로 이식
 * → /floorplan/api/* 로 마운트됨
 */
const express  = require('express');
const path     = require('path');
const router   = express.Router();
const storage  = require('./services/storage');
const config           = require('./config');

const isAdmin = (req) => req.user?.role === 'admin';

/* ── Health ───────────────────────────────────────────────────────────── */
router.get('/health', (req, res) => {
  res.json({ ok: true, project: 'floorplan', time: new Date() });
});

/* ── 평면도 CRUD ──────────────────────────────────────────────────────── *
 * 조회: 로그인 사용자 전원이 전체 템플릿을 볼 수 있음 (소유자 표시 포함).
 * 수정/삭제: 소유자 본인 또는 admin만. 타인 템플릿은 읽기 전용.
 * ────────────────────────────────────────────────────────────────────── */
router.get('/floorplans', async (req, res) => {
  try {
    const list = await storage.listFloorplans();
    res.json({
      ok: true,
      data: list.map(f => ({ ...f, canEdit: isAdmin(req) || f.ownerId === req.user.userId })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/floorplans/:id', async (req, res) => {
  try {
    const row = await storage.getFloorplanRow(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: '평면도 없음: ' + req.params.id });
    res.json({
      ok: true, data: row.data, ownerId: row.owner_id,
      canEdit: isAdmin(req) || row.owner_id === req.user.userId,
    });
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

router.post('/floorplans', async (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ ok: false, error: 'name, data 필수' });

    // 이름에서 파생되는 id가 이미 존재하면 사실상 "수정"이므로, 이 경우도 소유권 검사를 거친다.
    // (그렇지 않으면 같은 이름으로 저장해 타인의 평면도를 덮어쓸 수 있음)
    const id = name.endsWith('.fpd') ? name : name + '.fpd';
    const existing = await storage.getFloorplanRow(id);
    if (existing && !isAdmin(req) && existing.owner_id !== req.user.userId) {
      return res.status(403).json({ ok: false, error: '이미 존재하는 이름입니다 (다른 사용자 소유)', code: 'FORBIDDEN' });
    }

    const savedId = await storage.createFloorplan(name, {
      ...data,
      meta: { ...data.meta, name, savedAt: new Date().toISOString() }
    }, existing ? existing.owner_id : req.user.userId);
    res.json({ ok: true, id: savedId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.put('/floorplans/:id', async (req, res) => {
  try {
    const row = await storage.getFloorplanRow(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: '평면도 없음: ' + req.params.id });
    if (!isAdmin(req) && row.owner_id !== req.user.userId) {
      return res.status(403).json({ ok: false, error: '본인 평면도만 수정할 수 있습니다', code: 'FORBIDDEN' });
    }

    const { name, data } = req.body;
    const saveName = name || req.params.id;
    const id = await storage.updateFloorplan(req.params.id, saveName, {
      ...data,
      meta: { ...data.meta, name: saveName, savedAt: new Date().toISOString() }
    });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/floorplans/:id', async (req, res) => {
  try {
    const row = await storage.getFloorplanRow(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: '평면도 없음: ' + req.params.id });
    if (!isAdmin(req) && row.owner_id !== req.user.userId) {
      return res.status(403).json({ ok: false, error: '본인 평면도만 삭제할 수 있습니다', code: 'FORBIDDEN' });
    }

    await storage.deleteFloorplan(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── 카테고리 (공용 가구 카탈로그 — 로그인 사용자 전원이 조회/편집 가능) ── */
router.get('/categories', async (req, res) => {
  try {
    const data = await storage.getCategories();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.put('/categories', async (req, res) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ ok: false, error: 'data는 배열' });
    await storage.saveCategories(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/categories', async (req, res) => {
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

router.delete('/categories/:catId', async (req, res) => {
  try {
    let cats = await storage.getCategories();
    cats = cats.filter(c => c.id !== req.params.catId);
    await storage.saveCategories(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/categories/:catId/items', async (req, res) => {
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

router.delete('/categories/:catId/items/:itemId', async (req, res) => {
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

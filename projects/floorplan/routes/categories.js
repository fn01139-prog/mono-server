const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const storage = require('../services/storage');

// GET /api/categories  — 전체 공개
router.get('/', async (req, res) => {
  try {
    const data = await storage.getCategories();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/categories  — 전체 교체 (ADMIN only)
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ ok: false, error: 'data는 배열이어야 합니다' });
    await storage.saveCategories(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/categories/:catId/items  — 카테고리에 항목 추가 (ADMIN only)
router.post('/:catId/items', requireAdmin, async (req, res) => {
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

// DELETE /api/categories/:catId/items/:itemId  — 항목 삭제 (ADMIN only)
router.delete('/:catId/items/:itemId', requireAdmin, async (req, res) => {
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

// POST /api/categories  — 카테고리 신규 추가 (ADMIN only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const cats = await storage.getCategories();
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ ok: false, error: 'id, name 필수' });
    if (cats.find(c => c.id === id)) return res.status(409).json({ ok: false, error: '이미 존재하는 카테고리 ID' });
    cats.push({ id, name, items: [] });
    await storage.saveCategories(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/categories/:catId  — 카테고리 삭제 (ADMIN only)
router.delete('/:catId', requireAdmin, async (req, res) => {
  try {
    let cats = await storage.getCategories();
    cats = cats.filter(c => c.id !== req.params.catId);
    await storage.saveCategories(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

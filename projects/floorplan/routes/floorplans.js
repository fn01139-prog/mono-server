const express  = require('express');
const router   = express.Router();
const { requireAdmin } = require('../middleware/auth');
const storage  = require('../services/storage');

// GET /api/floorplans  — 목록 (전체 공개)
router.get('/', async (req, res) => {
  try {
    const list = await storage.listFloorplans();
    res.json({ ok: true, data: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/floorplans/:id  — 단건 조회 (전체 공개)
router.get('/:id', async (req, res) => {
  try {
    const data = await storage.getFloorplan(req.params.id);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

// POST /api/floorplans  — 생성 (ADMIN only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ ok: false, error: 'name, data 필수' });
    const id = await storage.saveFloorplan(name, { ...data, meta: { ...data.meta, name, savedAt: new Date().toISOString() } });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/floorplans/:id  — 수정 (ADMIN only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, data } = req.body;
    const saveName = name || req.params.id;
    const id = await storage.saveFloorplan(saveName, { ...data, meta: { ...data.meta, name: saveName, savedAt: new Date().toISOString() } });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/floorplans/:id  — 삭제 (ADMIN only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await storage.deleteFloorplan(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

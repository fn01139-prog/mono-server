/**
 * index.js - TravelLog Express Router
 * 데이터 저장소: PostgreSQL
 * 사진 파일: Google Drive (메타데이터만 DB에 저장)
 */
const express   = require('express');
const path      = require('path');
const multer    = require('multer');
const { v4: uuidv4 } = require('uuid');
const Anthropic  = require('@anthropic-ai/sdk');
const drive      = require('./public/js/drive');
const pool       = require('../../shared/db');

const router   = express.Router();
const upload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ── 헬퍼 ─────────────────────────────────────────────────────────────── */
function tripFromRow(r) {
  return { id: r.id, status: r.status, startDate: r.start_date, createdAt: r.created_at, ...r.data };
}

function scheduleFromRow(r) {
  return { id: r.id, tripId: r.trip_id, order: r.sort_order, createdAt: r.created_at, ...r.data };
}

function recordFromRow(r) {
  return { id: r.id, tripId: r.trip_id, date: r.record_date, createdAt: r.created_at, ...r.data };
}

function photoFromRow(r) {
  return { fileId: r.file_id, tripId: r.trip_id, uploadedAt: r.uploaded_at, ...r.data };
}

/* ── 정적 파일 ─────────────────────────────────────────────────────────── */
router.use(express.static(path.join(__dirname, 'public')));

/* ── Config ─────────────────────────────────────────────────────────────── */
router.get('/api/config', (req, res) => {
  res.json({ mapsKey: process.env.GOOGLE_MAPS_KEY || '' });
});

/* ── 여행 CRUD ───────────────────────────────────────────────────────────── */
router.get('/api/trips', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM travel_trips ORDER BY start_date DESC NULLS LAST'
    );
    res.json(rows.map(tripFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/trips', async (req, res) => {
  try {
    const { startDate, status, ...rest } = req.body;
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO travel_trips (id, start_date, status, data, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [id, startDate || null, status || 'planned', JSON.stringify(rest)]
    );
    res.json(tripFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/trips/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_trips WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });

    const { startDate, status, ...rest } = req.body;
    const merged = { ...cur[0].data, ...rest };
    const { rows } = await pool.query(
      `UPDATE travel_trips
       SET start_date = COALESCE($2, start_date),
           status     = COALESCE($3, status),
           data       = $4
       WHERE id = $1 RETURNING *`,
      [req.params.id, startDate || null, status || null, JSON.stringify(merged)]
    );
    res.json(tripFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/trips/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM travel_trips WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM travel_schedules WHERE trip_id = $1', [req.params.id]);
    await pool.query('DELETE FROM travel_records WHERE trip_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 일정 CRUD ───────────────────────────────────────────────────────────── */
router.get('/api/schedules', async (req, res) => {
  try {
    const { tripId } = req.query;
    const q = tripId
      ? pool.query('SELECT * FROM travel_schedules WHERE trip_id = $1 ORDER BY sort_order, scheduled_at', [tripId])
      : pool.query('SELECT * FROM travel_schedules ORDER BY sort_order, scheduled_at');
    const { rows } = await q;
    res.json(rows.map(scheduleFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/schedules', async (req, res) => {
  try {
    const { tripId, date, time, ...rest } = req.body;
    const { rows: existing } = await pool.query(
      'SELECT MAX(sort_order) AS max FROM travel_schedules WHERE trip_id = $1', [tripId]
    );
    const order = (existing[0].max || 0) + 1;
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO travel_schedules (id, trip_id, sort_order, scheduled_at, data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [id, tripId, order, date && time ? `${date} ${time}` : (date || null), JSON.stringify({ date, time, ...rest })]
    );
    res.json(scheduleFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/schedules/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_schedules WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

    const { date, time, ...rest } = req.body;
    const merged = { ...cur[0].data, date: date ?? cur[0].data?.date, time: time ?? cur[0].data?.time, ...rest };
    const { rows } = await pool.query(
      `UPDATE travel_schedules
       SET scheduled_at = $2, data = $3
       WHERE id = $1 RETURNING *`,
      [req.params.id,
       merged.date && merged.time ? `${merged.date} ${merged.time}` : (merged.date || null),
       JSON.stringify(merged)]
    );
    res.json(scheduleFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/schedules/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM travel_schedules WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/schedules/reorder', async (req, res) => {
  try {
    const { tripId, orderedIds } = req.body;
    for (let i = 0; i < orderedIds.length; i++) {
      await pool.query(
        'UPDATE travel_schedules SET sort_order = $1 WHERE id = $2 AND trip_id = $3',
        [i + 1, orderedIds[i], tripId]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 여행 기록 CRUD ──────────────────────────────────────────────────────── */
router.get('/api/records', async (req, res) => {
  try {
    const { tripId } = req.query;
    const q = tripId
      ? pool.query('SELECT * FROM travel_records WHERE trip_id = $1 ORDER BY record_date DESC', [tripId])
      : pool.query('SELECT * FROM travel_records ORDER BY record_date DESC');
    const { rows } = await q;
    res.json(rows.map(recordFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/records', async (req, res) => {
  try {
    const { tripId, date, ...rest } = req.body;
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO travel_records (id, trip_id, record_date, data, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [id, tripId, date || null, JSON.stringify({ tripId, date, photoIds: [], ...rest })]
    );
    res.json(recordFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/records/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_records WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });

    const { date, ...rest } = req.body;
    const merged = { ...cur[0].data, ...rest, date: date ?? cur[0].data?.date };
    const { rows } = await pool.query(
      'UPDATE travel_records SET record_date = $2, data = $3 WHERE id = $1 RETURNING *',
      [req.params.id, merged.date || null, JSON.stringify(merged)]
    );
    res.json(recordFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/records/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM travel_records WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 사진 메타데이터 ──────────────────────────────────────────────────────── */
router.get('/api/photos', async (req, res) => {
  try {
    const { tripId } = req.query;
    const q = tripId
      ? pool.query('SELECT * FROM travel_photos WHERE trip_id = $1 ORDER BY uploaded_at DESC', [tripId])
      : pool.query('SELECT * FROM travel_photos ORDER BY uploaded_at DESC');
    const { rows } = await q;
    res.json(rows.map(photoFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 위치 기반 그루핑 ─────────────────────────────────────────────────────── */
router.get('/api/photos/by-location', async (req, res) => {
  try {
    const { tripId } = req.query;
    const q = tripId
      ? pool.query(`SELECT * FROM travel_photos WHERE trip_id = $1 AND (data->>'lat') IS NOT NULL`, [tripId])
      : pool.query(`SELECT * FROM travel_photos WHERE (data->>'lat') IS NOT NULL`);
    const { rows } = await q;
    const photos = rows.map(photoFromRow).filter(p => p.lat && p.lng);

    const clusters = [];
    const used = new Set();
    photos.forEach(photo => {
      if (used.has(photo.fileId)) return;
      const cluster = { lat: photo.lat, lng: photo.lng, photos: [photo] };
      used.add(photo.fileId);
      photos.forEach(other => {
        if (used.has(other.fileId)) return;
        if (haversine(photo.lat, photo.lng, other.lat, other.lng) < 0.1) {
          cluster.photos.push(other);
          used.add(other.fileId);
        }
      });
      cluster.lat   = cluster.photos.reduce((s, p) => s + p.lat, 0) / cluster.photos.length;
      cluster.lng   = cluster.photos.reduce((s, p) => s + p.lng, 0) / cluster.photos.length;
      cluster.cover = cluster.photos[0].thumbnailUrl;
      clusters.push(cluster);
    });
    res.json(clusters);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── 사진 업로드 (파일은 Drive, 메타데이터는 DB) ───────────────────────────── */
router.post('/api/photos/upload', upload.array('photos', 30), async (req, res) => {
  try {
    const { tripId, metaJson } = req.body;
    const metaList = metaJson ? JSON.parse(metaJson) : [];

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: '파일이 없습니다' });

    const folderName = `travel-${tripId ? tripId.slice(0, 8) : 'misc'}`;
    const folderId   = await drive.getOrCreateFolder(folderName);

    const uploaded = [];
    for (let i = 0; i < req.files.length; i++) {
      const file   = req.files[i];
      const meta   = metaList[i] || {};
      const result = await drive.uploadPhoto(file.originalname, file.buffer, file.mimetype, folderId);

      const photoData = {
        fileName:     result.fileName,
        takenAt:      meta.takenAt || null,
        lat:          meta.lat    ? parseFloat(meta.lat)  : null,
        lng:          meta.lng    ? parseFloat(meta.lng)  : null,
        cameraMake:   meta.cameraMake  || null,
        cameraModel:  meta.cameraModel || null,
        width:        meta.width  ? parseInt(meta.width)  : null,
        height:       meta.height ? parseInt(meta.height) : null,
        thumbnailUrl: result.thumbnailUrl,
        viewUrl:      result.viewUrl,
      };

      await pool.query(
        `INSERT INTO travel_photos (file_id, trip_id, data, uploaded_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (file_id) DO NOTHING`,
        [result.fileId, tripId || null, JSON.stringify(photoData)]
      );
      uploaded.push({ fileId: result.fileId, tripId: tripId || null, ...photoData });
    }

    res.json({ ok: true, uploaded });
  } catch (e) {
    console.error('[travellog] 사진 업로드 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── 장소 추천 ───────────────────────────────────────────────────────────── */
router.get('/api/places/nearby', async (req, res) => {
  try {
    const { lat, lng, type = '맛집', keyword = '' } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat, lng 필수' });

    const typeMap = {
      '맛집': 'restaurant', '카페': 'cafe', '레크레이션': 'tourist_attraction',
      '볼거리': 'museum', '숙박': 'lodging',
    };
    const googleType = typeMap[type] || 'tourist_attraction';
    const mapsKey    = process.env.GOOGLE_MAPS_KEY;

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=2000&type=${googleType}&language=ko${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}&key=${mapsKey}`;
    const placesRes  = await fetch(url);
    const placesData = await placesRes.json();
    const candidates = (placesData.results || []).slice(0, 15).map(p => ({
      placeId: p.place_id, name: p.name, address: p.vicinity,
      rating: p.rating, userRatingsTotal: p.user_ratings_total,
      lat: p.geometry.location.lat, lng: p.geometry.location.lng,
      openNow: p.opening_hours?.open_now,
      photoRef: p.photos?.[0]?.photo_reference,
    }));

    if (candidates.length === 0) return res.json([]);

    const prompt = `다음은 ${type} 장소 목록입니다. 여행자에게 TOP 5를 추천하고 각각 짧은 한국어 추천 코멘트(20자 이내)를 달아주세요.
검색 키워드: "${keyword || type}"
장소 목록: ${JSON.stringify(candidates.map(c => ({ name: c.name, rating: c.rating, reviews: c.userRatingsTotal })))}

반드시 JSON 배열만 응답 (다른 텍스트 없이):
[{"index": 0, "comment": "추천 이유"}, ...]`;

    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    let top5 = candidates.slice(0, 5);
    try {
      const text = aiRes.content[0].text.replace(/```json|```/g, '').trim();
      const picks = JSON.parse(text);
      top5 = picks.map(p => ({
        ...candidates[p.index],
        aiComment: p.comment,
        photoUrl: candidates[p.index]?.photoRef
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photoreference=${candidates[p.index].photoRef}&key=${mapsKey}`
          : null,
      })).filter(Boolean);
    } catch (_) {
      top5 = candidates.slice(0, 5).map(p => ({ ...p, aiComment: '' }));
    }

    res.json(top5);
  } catch (e) {
    console.error('[travellog] 장소 추천 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── SPA fallback ─────────────────────────────────────────────────────────── */
router.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = router;

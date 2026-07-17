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

const isAdmin = (req) => req.user?.role === 'admin';

/** trip을 조회하고 소유권을 검사. 없거나 권한 없으면 null. */
async function loadOwnedTrip(req, tripId) {
  if (!tripId) return null;
  const { rows } = await pool.query('SELECT * FROM travel_trips WHERE id = $1', [tripId]);
  const trip = rows[0];
  if (!trip) return null;
  if (!isAdmin(req) && trip.owner_id !== req.user.userId) return null;
  return trip;
}

/** 본인 소유 trip id 목록 (admin은 null → 필터 없음을 의미) */
async function ownedTripIds(req) {
  if (isAdmin(req)) return null;
  const { rows } = await pool.query('SELECT id FROM travel_trips WHERE owner_id = $1', [req.user.userId]);
  return rows.map(r => r.id);
}

/* ── 정적 파일 ─────────────────────────────────────────────────────────── */
router.use(express.static(path.join(__dirname, 'public')));

/* ── Config ─────────────────────────────────────────────────────────────── */
router.get('/config', (req, res) => {
  res.json({ mapsKey: process.env.GOOGLE_MAPS_KEY || '' });
});

/* ── 여행 CRUD ───────────────────────────────────────────────────────────── */
router.get('/trips', async (req, res) => {
  try {
    const { rows } = isAdmin(req)
      ? await pool.query('SELECT * FROM travel_trips ORDER BY start_date DESC NULLS LAST')
      : await pool.query(
          'SELECT * FROM travel_trips WHERE owner_id = $1 ORDER BY start_date DESC NULLS LAST',
          [req.user.userId]
        );
    res.json(rows.map(tripFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/trips', async (req, res) => {
  try {
    const { startDate, status, ...rest } = req.body;
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO travel_trips (id, start_date, status, data, owner_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [id, startDate || null, status || 'planned', JSON.stringify(rest), req.user.userId]
    );
    res.json(tripFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/trips/:id', async (req, res) => {
  try {
    const cur = await loadOwnedTrip(req, req.params.id);
    if (!cur) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });

    const { startDate, status, ...rest } = req.body;
    const merged = { ...cur.data, ...rest };
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

router.delete('/trips/:id', async (req, res) => {
  try {
    const cur = await loadOwnedTrip(req, req.params.id);
    if (!cur) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });

    await pool.query('DELETE FROM travel_trips WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM travel_schedules WHERE trip_id = $1', [req.params.id]);
    await pool.query('DELETE FROM travel_records WHERE trip_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 일정 CRUD ───────────────────────────────────────────────────────────── */
router.get('/schedules', async (req, res) => {
  try {
    const { tripId } = req.query;
    if (tripId) {
      const trip = await loadOwnedTrip(req, tripId);
      if (!trip) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
      const { rows } = await pool.query(
        'SELECT * FROM travel_schedules WHERE trip_id = $1 ORDER BY sort_order, scheduled_at', [tripId]
      );
      return res.json(rows.map(scheduleFromRow));
    }
    const ids = await ownedTripIds(req);
    const { rows } = ids === null
      ? await pool.query('SELECT * FROM travel_schedules ORDER BY sort_order, scheduled_at')
      : await pool.query('SELECT * FROM travel_schedules WHERE trip_id = ANY($1) ORDER BY sort_order, scheduled_at', [ids]);
    res.json(rows.map(scheduleFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/schedules', async (req, res) => {
  try {
    const { tripId, date, time, ...rest } = req.body;
    const trip = await loadOwnedTrip(req, tripId);
    if (!trip) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });

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

router.put('/schedules/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_schedules WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });
    if (!(await loadOwnedTrip(req, cur[0].trip_id))) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

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

router.delete('/schedules/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_schedules WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });
    if (!(await loadOwnedTrip(req, cur[0].trip_id))) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

    await pool.query('DELETE FROM travel_schedules WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/schedules/reorder', async (req, res) => {
  try {
    const { tripId, orderedIds } = req.body;
    if (!(await loadOwnedTrip(req, tripId))) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
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
router.get('/records', async (req, res) => {
  try {
    const { tripId } = req.query;
    if (tripId) {
      const trip = await loadOwnedTrip(req, tripId);
      if (!trip) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
      const { rows } = await pool.query('SELECT * FROM travel_records WHERE trip_id = $1 ORDER BY record_date DESC', [tripId]);
      return res.json(rows.map(recordFromRow));
    }
    const ids = await ownedTripIds(req);
    const { rows } = ids === null
      ? await pool.query('SELECT * FROM travel_records ORDER BY record_date DESC')
      : await pool.query('SELECT * FROM travel_records WHERE trip_id = ANY($1) ORDER BY record_date DESC', [ids]);
    res.json(rows.map(recordFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/records', async (req, res) => {
  try {
    const { tripId, date, ...rest } = req.body;
    if (!(await loadOwnedTrip(req, tripId))) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO travel_records (id, trip_id, record_date, data, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [id, tripId, date || null, JSON.stringify({ tripId, date, photoIds: [], ...rest })]
    );
    res.json(recordFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/records/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_records WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });
    if (!(await loadOwnedTrip(req, cur[0].trip_id))) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });

    const { date, ...rest } = req.body;
    const merged = { ...cur[0].data, ...rest, date: date ?? cur[0].data?.date };
    const { rows } = await pool.query(
      'UPDATE travel_records SET record_date = $2, data = $3 WHERE id = $1 RETURNING *',
      [req.params.id, merged.date || null, JSON.stringify(merged)]
    );
    res.json(recordFromRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/records/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM travel_records WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });
    if (!(await loadOwnedTrip(req, cur[0].trip_id))) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });

    await pool.query('DELETE FROM travel_records WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 사진 메타데이터 ──────────────────────────────────────────────────────── */
router.get('/photos', async (req, res) => {
  try {
    const { tripId } = req.query;
    if (tripId) {
      if (!(await loadOwnedTrip(req, tripId))) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
      const { rows } = await pool.query('SELECT * FROM travel_photos WHERE trip_id = $1 ORDER BY uploaded_at DESC', [tripId]);
      return res.json(rows.map(photoFromRow));
    }
    const ids = await ownedTripIds(req);
    const { rows } = ids === null
      ? await pool.query('SELECT * FROM travel_photos ORDER BY uploaded_at DESC')
      : await pool.query('SELECT * FROM travel_photos WHERE trip_id = ANY($1) ORDER BY uploaded_at DESC', [ids]);
    res.json(rows.map(photoFromRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 위치 기반 그루핑 ─────────────────────────────────────────────────────── */
router.get('/photos/by-location', async (req, res) => {
  try {
    const { tripId } = req.query;
    let rows;
    if (tripId) {
      if (!(await loadOwnedTrip(req, tripId))) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
      ({ rows } = await pool.query(`SELECT * FROM travel_photos WHERE trip_id = $1 AND (data->>'lat') IS NOT NULL`, [tripId]));
    } else {
      const ids = await ownedTripIds(req);
      ({ rows } = ids === null
        ? await pool.query(`SELECT * FROM travel_photos WHERE (data->>'lat') IS NOT NULL`)
        : await pool.query(`SELECT * FROM travel_photos WHERE trip_id = ANY($1) AND (data->>'lat') IS NOT NULL`, [ids]));
    }
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
router.post('/photos/upload', upload.array('photos', 30), async (req, res) => {
  try {
    const { tripId, metaJson } = req.body;
    const metaList = metaJson ? JSON.parse(metaJson) : [];

    if (tripId && !(await loadOwnedTrip(req, tripId)))
      return res.status(404).json({ error: '여행을 찾을 수 없습니다' });

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

/* ── 클로드 정리 내용 가져오기 ──────────────────────────────────────────────
 * Claude와의 대화에서 이미 정리된 구조화 데이터를 그대로 등록한다.
 * body: { tripId?, trip?: {name,startDate,endDate,participants,note},
 *         schedules?: [{date,time,placeName,category,duration,memo}],
 *         records?:   [{date,placeName,participants,memo,rating}] }
 * ──────────────────────────────────────────────────────────────────────── */
async function geocodePlace(name) {
  const mapsKey = process.env.GOOGLE_MAPS_KEY;
  if (!mapsKey || !name) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&language=ko&key=${mapsKey}`;
    const r = await fetch(url);
    const d = await r.json();
    const loc = d.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng, address: d.results[0].formatted_address } : null;
  } catch (_) { return null; }
}

router.post('/import', async (req, res) => {
  try {
    // 이미 정리된(구조화된) 여행 데이터를 그대로 등록한다.
    // "정리"는 Claude와의 대화에서 끝난 상태로 넘어온다고 가정 — 여기서는 AI를 다시 부르지 않는다.
    const { tripId, trip: tripInput, schedules: scheduleItemsRaw, records: recordItemsRaw } = req.body;
    const scheduleItems = Array.isArray(scheduleItemsRaw) ? scheduleItemsRaw : [];
    const recordItems   = Array.isArray(recordItemsRaw)   ? recordItemsRaw   : [];

    if (!tripId && !tripInput?.name && scheduleItems.length === 0 && recordItems.length === 0) {
      return res.status(400).json({ error: 'tripId 또는 trip.name, 혹은 schedules/records 중 하나는 필요합니다' });
    }

    let existingTrip = null;
    if (tripId) {
      const trip = await loadOwnedTrip(req, tripId);
      if (!trip) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
      existingTrip = tripFromRow(trip);
    }

    /* 여행: 기존 여행에 추가하거나 새로 생성 */
    let trip;
    if (existingTrip) {
      trip = existingTrip;
    } else {
      const t = tripInput || {};
      const id = uuidv4();
      const data = {
        name: t.name || '가져온 여행',
        endDate: t.endDate || null,
        participants: Array.isArray(t.participants) ? t.participants : [],
        note: t.note || '',
      };
      const { rows } = await pool.query(
        `INSERT INTO travel_trips (id, start_date, status, data, owner_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [id, t.startDate || null, 'planned', JSON.stringify(data), req.user.userId]
      );
      trip = tripFromRow(rows[0]);
    }

    /* 일정: 장소명 지오코딩(실패해도 무시) 후 등록 */
    const geocoded = await Promise.all(scheduleItems.map(s => geocodePlace(s.placeName)));
    const { rows: existing } = await pool.query(
      'SELECT MAX(sort_order) AS max FROM travel_schedules WHERE trip_id = $1', [trip.id]
    );
    let order = existing[0].max || 0;

    const createdSchedules = [];
    for (let i = 0; i < scheduleItems.length; i++) {
      const s = scheduleItems[i];
      const geo = geocoded[i];
      order += 1;
      const id = uuidv4();
      const data = {
        date: s.date || null, time: s.time || null,
        category: s.category || '기타', duration: s.duration || null, memo: s.memo || '',
        place: { name: s.placeName || '', lat: geo?.lat ?? null, lng: geo?.lng ?? null, placeId: '', address: geo?.address || '' },
      };
      const { rows } = await pool.query(
        `INSERT INTO travel_schedules (id, trip_id, sort_order, scheduled_at, data, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [id, trip.id, order, data.date && data.time ? `${data.date} ${data.time}` : (data.date || null), JSON.stringify(data)]
      );
      createdSchedules.push(scheduleFromRow(rows[0]));
    }

    /* 기록: 후기/있었던 일 등록 */
    const createdRecords = [];
    for (const r of recordItems) {
      const id = uuidv4();
      const data = {
        tripId: trip.id, date: r.date || null, placeName: r.placeName || '',
        participants: Array.isArray(r.participants) ? r.participants : [],
        memo: r.memo || '', rating: r.rating || 0, photoIds: [],
      };
      const { rows } = await pool.query(
        `INSERT INTO travel_records (id, trip_id, record_date, data, created_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [id, trip.id, data.date, JSON.stringify(data)]
      );
      createdRecords.push(recordFromRow(rows[0]));
    }

    res.json({ ok: true, trip, schedules: createdSchedules, records: createdRecords });
  } catch (e) {
    console.error('[travellog] 가져오기 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── 장소 추천 ───────────────────────────────────────────────────────────── */
router.get('/places/nearby', async (req, res) => {
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

/**
 * index.js - TravelLog Express Router
 * mono-server 프로젝트로 /travellog 경로에 마운트됨
 */
const express  = require('express');
const path     = require('path');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const drive    = require('./public/js/drive');

const router   = express.Router();
const upload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
console.log(anthropic);
// ─── 파일명 (Drive) ────────────────────────────────────────────────────────────
const FILES = {
  trips:     'travellog-trips.json',
  schedules: 'travellog-schedules.json',
  records:   'travellog-records.json',
  photos:    'travellog-photos.json',
};

// ─── 인메모리 스토어 ───────────────────────────────────────────────────────────
let store  = { trips: [], schedules: [], records: [], photos: [] };
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  await syncFromDrive();
}

async function syncFromDrive() {
  const [trips, schedules, records, photos] = await Promise.all([
    drive.readJson(FILES.trips),
    drive.readJson(FILES.schedules),
    drive.readJson(FILES.records),
    drive.readJson(FILES.photos),
  ]);
  store  = { trips, schedules, records, photos };
  loaded = true;
  console.log(`[travellog] Drive 동기화 완료 - trips:${trips.length} schedules:${schedules.length} records:${records.length} photos:${photos.length}`);
}

async function pushToDrive() {
  await Promise.all([
    drive.writeJson(FILES.trips,     store.trips),
    drive.writeJson(FILES.schedules, store.schedules),
    drive.writeJson(FILES.records,   store.records),
    drive.writeJson(FILES.photos,    store.photos),
  ]);
}

// ─── 정적 파일 ────────────────────────────────────────────────────────────────
router.use(express.static(path.join(__dirname, 'public')));

// ─── Config (프론트에 Maps Key 제공) ──────────────────────────────────────────
router.get('/api/config', (req, res) => {
  res.json({ mapsKey: process.env.GOOGLE_MAPS_KEY || '' });
});

// ─── 동기화 ───────────────────────────────────────────────────────────────────
router.get('/api/sync', async (req, res) => {
  try {
    await syncFromDrive();
    res.json({ ok: true, counts: { trips: store.trips.length, schedules: store.schedules.length, records: store.records.length, photos: store.photos.length } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/sync/push', async (req, res) => {
  try {
    await ensureLoaded();
    await pushToDrive();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 여행 CRUD ────────────────────────────────────────────────────────────────
router.get('/api/trips', async (req, res) => {
  try {
    await ensureLoaded();
    res.json(store.trips.sort((a, b) => b.startDate.localeCompare(a.startDate)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/trips', async (req, res) => {
  try {
    await ensureLoaded();
    const trip = { id: uuidv4(), createdAt: new Date().toISOString(), status: 'planned', ...req.body };
    store.trips.push(trip);
    await drive.writeJson(FILES.trips, store.trips);
    res.json(trip);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/trips/:id', async (req, res) => {
  try {
    await ensureLoaded();
    const idx = store.trips.findIndex(t => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '여행을 찾을 수 없습니다' });
    store.trips[idx] = { ...store.trips[idx], ...req.body, id: req.params.id };
    await drive.writeJson(FILES.trips, store.trips);
    res.json(store.trips[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/trips/:id', async (req, res) => {
  try {
    await ensureLoaded();
    store.trips      = store.trips.filter(t => t.id !== req.params.id);
    store.schedules  = store.schedules.filter(s => s.tripId !== req.params.id);
    store.records    = store.records.filter(r => r.tripId !== req.params.id);
    await Promise.all([
      drive.writeJson(FILES.trips, store.trips),
      drive.writeJson(FILES.schedules, store.schedules),
      drive.writeJson(FILES.records, store.records),
    ]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 일정 CRUD ────────────────────────────────────────────────────────────────
router.get('/api/schedules', async (req, res) => {
  try {
    await ensureLoaded();
    const { tripId } = req.query;
    const result = store.schedules
      .filter(s => !tripId || s.tripId === tripId)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/schedules', async (req, res) => {
  try {
    await ensureLoaded();
    const tripSchedules = store.schedules.filter(s => s.tripId === req.body.tripId);
    const maxOrder = tripSchedules.reduce((m, s) => Math.max(m, s.order || 0), 0);
    const item = { id: uuidv4(), order: maxOrder + 1, createdAt: new Date().toISOString(), ...req.body };
    store.schedules.push(item);
    await drive.writeJson(FILES.schedules, store.schedules);
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/schedules/:id', async (req, res) => {
  try {
    await ensureLoaded();
    const idx = store.schedules.findIndex(s => s.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });
    store.schedules[idx] = { ...store.schedules[idx], ...req.body, id: req.params.id };
    await drive.writeJson(FILES.schedules, store.schedules);
    res.json(store.schedules[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/schedules/:id', async (req, res) => {
  try {
    await ensureLoaded();
    store.schedules = store.schedules.filter(s => s.id !== req.params.id);
    await drive.writeJson(FILES.schedules, store.schedules);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 일정 순서 변경
router.post('/api/schedules/reorder', async (req, res) => {
  try {
    await ensureLoaded();
    const { tripId, orderedIds } = req.body; // orderedIds: [id1, id2, ...]
    orderedIds.forEach((id, i) => {
      const idx = store.schedules.findIndex(s => s.id === id && s.tripId === tripId);
      if (idx >= 0) store.schedules[idx].order = i + 1;
    });
    await drive.writeJson(FILES.schedules, store.schedules);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 여행 기록 CRUD ───────────────────────────────────────────────────────────
router.get('/api/records', async (req, res) => {
  try {
    await ensureLoaded();
    const { tripId } = req.query;
    const result = store.records
      .filter(r => !tripId || r.tripId === tripId)
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/records', async (req, res) => {
  try {
    await ensureLoaded();
    const item = { id: uuidv4(), createdAt: new Date().toISOString(), photoIds: [], ...req.body };
    store.records.push(item);
    await drive.writeJson(FILES.records, store.records);
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/records/:id', async (req, res) => {
  try {
    await ensureLoaded();
    const idx = store.records.findIndex(r => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });
    store.records[idx] = { ...store.records[idx], ...req.body, id: req.params.id };
    await drive.writeJson(FILES.records, store.records);
    res.json(store.records[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/records/:id', async (req, res) => {
  try {
    await ensureLoaded();
    store.records = store.records.filter(r => r.id !== req.params.id);
    await drive.writeJson(FILES.records, store.records);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 사진 메타데이터 ──────────────────────────────────────────────────────────
router.get('/api/photos', async (req, res) => {
  try {
    await ensureLoaded();
    const { tripId } = req.query;
    const result = store.photos.filter(p => !tripId || p.tripId === tripId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 위치 기반 그루핑 (100m 반경으로 클러스터링)
router.get('/api/photos/by-location', async (req, res) => {
  try {
    await ensureLoaded();
    const { tripId } = req.query;
    const photos = store.photos.filter(p => (!tripId || p.tripId === tripId) && p.lat && p.lng);

    const clusters = [];
    const used = new Set();

    photos.forEach(photo => {
      if (used.has(photo.fileId)) return;
      const cluster = { lat: photo.lat, lng: photo.lng, photos: [photo] };
      used.add(photo.fileId);

      photos.forEach(other => {
        if (used.has(other.fileId)) return;
        const dist = haversine(photo.lat, photo.lng, other.lat, other.lng);
        if (dist < 0.1) { // 100m
          cluster.photos.push(other);
          used.add(other.fileId);
        }
      });

      // 클러스터 중심 재계산
      cluster.lat = cluster.photos.reduce((s, p) => s + p.lat, 0) / cluster.photos.length;
      cluster.lng = cluster.photos.reduce((s, p) => s + p.lng, 0) / cluster.photos.length;
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

// ─── 사진 업로드 ──────────────────────────────────────────────────────────────
router.post('/api/photos/upload', upload.array('photos', 30), async (req, res) => {
  try {
    await ensureLoaded();
    const { tripId, metaJson } = req.body;
    const metaList = metaJson ? JSON.parse(metaJson) : [];

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '파일이 없습니다' });
    }

    // 여행별 폴더 생성 (이름: tripId 앞 8자)
    const folderName = `travel-${tripId ? tripId.slice(0, 8) : 'misc'}`;
    const folderId = await drive.getOrCreateFolder(folderName);

    const uploaded = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const meta = metaList[i] || {};

      // Drive 업로드
      const result = await drive.uploadPhoto(file.originalname, file.buffer, file.mimetype, folderId);

      const photoMeta = {
        fileId:       result.fileId,
        fileName:     result.fileName,
        tripId:       tripId || null,
        takenAt:      meta.takenAt || null,
        lat:          meta.lat    ? parseFloat(meta.lat)  : null,
        lng:          meta.lng    ? parseFloat(meta.lng)  : null,
        cameraMake:   meta.cameraMake  || null,
        cameraModel:  meta.cameraModel || null,
        width:        meta.width  ? parseInt(meta.width)  : null,
        height:       meta.height ? parseInt(meta.height) : null,
        thumbnailUrl: result.thumbnailUrl,
        viewUrl:      result.viewUrl,
        uploadedAt:   new Date().toISOString(),
      };

      store.photos.push(photoMeta);
      uploaded.push(photoMeta);
    }

    await drive.writeJson(FILES.photos, store.photos);
    res.json({ ok: true, uploaded });
  } catch (e) {
    console.error('[travellog] 사진 업로드 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 장소 추천 (Claude API + Google Places) ───────────────────────────────────
router.get('/api/places/nearby', async (req, res) => {
  try {
    const { lat, lng, type = '맛집', keyword = '' } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat, lng 필수' });

    const typeMap = {
      '맛집':       'restaurant',
      '카페':       'cafe',
      '레크레이션': 'tourist_attraction',
      '볼거리':     'museum',
      '숙박':       'lodging',
    };
    const googleType = typeMap[type] || 'tourist_attraction';
    const mapsKey = process.env.GOOGLE_MAPS_KEY;

    // Google Places Nearby Search
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=2000&type=${googleType}&language=ko${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}&key=${mapsKey}`;
    const placesRes = await fetch(url);
    const placesData = await placesRes.json();
    const candidates = (placesData.results || []).slice(0, 15).map(p => ({
      placeId: p.place_id,
      name: p.name,
      address: p.vicinity,
      rating: p.rating,
      userRatingsTotal: p.user_ratings_total,
      lat: p.geometry.location.lat,
      lng: p.geometry.location.lng,
      openNow: p.opening_hours?.open_now,
      photoRef: p.photos?.[0]?.photo_reference,
    }));

    if (candidates.length === 0) return res.json([]);

    // Claude로 추천 코멘트 생성
    const prompt = `다음은 ${type} 장소 목록입니다. 여행자에게 TOP 5를 추천하고 각각 짧은 한국어 추천 코멘트(20자 이내)를 달아주세요.
검색 키워드: "${keyword || type}"
장소 목록: ${JSON.stringify(candidates.map(c => ({ name: c.name, rating: c.rating, reviews: c.userRatingsTotal })))}

반드시 JSON 배열만 응답 (다른 텍스트 없이):
[{"index": 0, "comment": "추천 이유"}, ...]  (index는 위 목록의 0-based 인덱스)`;

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
        photoUrl: p.photoRef ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photoreference=${p.photoRef}&key=${mapsKey}` : null,
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

// ─── SPA fallback ─────────────────────────────────────────────────────────────
router.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = router;

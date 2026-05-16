'use strict';

/**
 * camping-checklist/index.js
 *
 * loader.js 동작 방식:
 *   app.use('/campchecklist/api', require('./index.js'))
 *
 * 따라서 이 파일은 express.Router() 를 export 하며,
 * 라우트 경로에 /api 접두사를 붙이지 않는다.
 *
 *   router.get('/status')  → GET /campchecklist/api/status
 *   router.get('/users')   → GET /campchecklist/api/users
 *   router.get('/trips')   → GET /campchecklist/api/trips
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const DATA_DIR         = path.join(__dirname, 'data');
const SYNC_INTERVAL_MS = 30 * 1000;

// ════════════════════════════════════════════════════════════════════
// 데이터 디렉토리 및 초기 파일 보장
// ════════════════════════════════════════════════════════════════════
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const INIT_DATA = { users: '[]', items: '[]', trips: '[]', checks: '{}' };
Object.entries(INIT_DATA).forEach(([name, empty]) => {
  const f = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, empty, 'utf8');
});

// ════════════════════════════════════════════════════════════════════
// DB 헬퍼 — dirty 플래그로 변경 추적
// ════════════════════════════════════════════════════════════════════
const dirty    = new Set();
let lastSyncAt = null;
let syncStatus = 'idle';

const db = {
  read(name) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8')); }
    catch { return name === 'checks' ? {} : []; }
  },
  write(name, data) {
    fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
    dirty.add(name);
  },
};

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ════════════════════════════════════════════════════════════════════
// Google Drive 연동
// ════════════════════════════════════════════════════════════════════
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
const USE_DRIVE = !!(process.env.GDRIVE_KEY && FOLDER_ID);
let drive         = null;
const fileIdCache = {};

if (USE_DRIVE) {
  try {
    const { google } = require('googleapis');
    let rawKey = process.env.GDRIVE_KEY;
    try { JSON.parse(rawKey); } catch { rawKey = Buffer.from(rawKey, 'base64').toString('utf8'); }
    const key = JSON.parse(rawKey);
    if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
    const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/drive'] });
    drive = google.drive({ version: 'v3', auth });
    console.log('[CampCheck] ✅ Google Drive 연동 활성화');
  } catch (e) {
    console.error('[CampCheck] ❌ Drive 초기화 실패:', e.message);
  }
}

async function getFileId(filename) {
  if (fileIdCache[filename]) return fileIdCache[filename];
  const res = await drive.files.list({
    q: `name='${filename}' and '${FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id)', spaces: 'drive',
  });
  const id = res.data.files[0]?.id ?? null;
  if (id) fileIdCache[filename] = id;
  return id;
}

async function drivePull(filename) {
  const fileId = await getFileId(filename);
  if (!fileId) return null;
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

async function drivePush(filename, content) {
  const media  = { mimeType: 'application/json', body: content };
  const fileId = await getFileId(filename);
  if (fileId) {
    await drive.files.update({ fileId, media });
  } else {
    const created = await drive.files.create({
      requestBody: { name: filename, parents: [FOLDER_ID] }, media, fields: 'id',
    });
    fileIdCache[filename] = created.data.id;
  }
}

async function pullFromDrive() {
  if (!drive) return;
  console.log('[CampCheck] 📥 Google Drive 데이터 복원 중...');
  for (const name of ['users', 'items', 'trips', 'checks']) {
    try {
      const content = await drivePull(`${name}.json`);
      if (content) {
        fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), content, 'utf8');
        console.log(`[CampCheck]   ✓ ${name}.json`);
      } else {
        console.log(`[CampCheck]   ○ ${name}.json — 신규 시작`);
      }
    } catch (e) { console.error(`[CampCheck]   ✗ ${name}.json:`, e.message); }
  }
}

async function syncToDrive() {
  if (!drive || dirty.size === 0) return;
  syncStatus   = 'syncing';
  const toSync = [...dirty];
  dirty.clear();
  const results = [];
  for (const name of toSync) {
    try {
      await drivePush(`${name}.json`, fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
      results.push(`✓ ${name}`);
    } catch (e) { dirty.add(name); results.push(`✗ ${name}`); syncStatus = 'error'; }
  }
  if (syncStatus !== 'error') { syncStatus = 'idle'; lastSyncAt = now(); }
  console.log(`[CampCheck] ☁️  Drive 동기화 [${new Date().toLocaleTimeString('ko-KR')}] ${results.join(' | ')}`);
}

process.on('SIGTERM', async () => { await syncToDrive(); process.exit(0); });
process.on('SIGINT',  async () => { await syncToDrive(); process.exit(0); });

// ════════════════════════════════════════════════════════════════════
// require() 시 자동 초기화 (모노서버 수정 불필요)
// ════════════════════════════════════════════════════════════════════
pullFromDrive()
  .then(() => {
    if (drive) {
      setInterval(syncToDrive, SYNC_INTERVAL_MS);
      console.log(`[CampCheck] 🔄 Drive ${SYNC_INTERVAL_MS / 1000}초 주기 동기화 시작`);
    }
    console.log('[CampCheck] 🏕️  준비 완료');
  })
  .catch(e => console.error('[CampCheck] 초기화 오류:', e.message));

// ════════════════════════════════════════════════════════════════════
// Router 정의
//
// loader.js: app.use('/campchecklist/api', router)
// → router.get('/status') = GET /campchecklist/api/status
// → router.get('/users')  = GET /campchecklist/api/users
// ════════════════════════════════════════════════════════════════════
const router = express.Router();

// ── 동기화 상태 ──────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({
  driveEnabled:    !!drive,
  syncStatus,
  pendingChanges:  [...dirty],
  lastSyncAt,
  syncIntervalSec: SYNC_INTERVAL_MS / 1000,
}));

// ── USERS ────────────────────────────────────────────────────────
router.get('/users', (req, res) => res.json(db.read('users')));

router.post('/users', (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '이름을 입력하세요' });
  const users = db.read('users');
  const user  = { id: uid(), name: name.trim(), color: color || '#4a7c59', createdAt: now() };
  users.push(user);
  db.write('users', users);
  res.json(user);
});

router.put('/users/:id', (req, res) => {
  const users = db.read('users');
  const i = users.findIndex(u => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '사용자 없음' });
  users[i] = { ...users[i], ...req.body, id: users[i].id };
  db.write('users', users);
  res.json(users[i]);
});

router.delete('/users/:id', (req, res) => {
  db.write('users', db.read('users').filter(u => u.id !== req.params.id));
  db.write('items', db.read('items').filter(i => i.userId !== req.params.id));
  const trips = db.read('trips');
  trips.forEach(t => { t.participants = (t.participants || []).filter(p => p !== req.params.id); });
  db.write('trips', trips);
  res.json({ ok: true });
});

// ── ITEMS ────────────────────────────────────────────────────────
router.get('/items', (req, res) => {
  let items = db.read('items');
  if (req.query.userId) items = items.filter(i => i.userId === req.query.userId);
  res.json(items);
});

router.post('/items', (req, res) => {
  const { userId, name, category, quantity, unit, note } = req.body;
  if (!userId || !name?.trim()) return res.status(400).json({ error: '필수값 누락' });
  const items = db.read('items');
  const item  = {
    id: uid(), userId, name: name.trim(),
    category: category || '기타', quantity: Number(quantity) || 1,
    unit: unit || '개', note: note || '', createdAt: now(),
  };
  items.push(item);
  db.write('items', items);
  res.json(item);
});

router.put('/items/:id', (req, res) => {
  const items = db.read('items');
  const i = items.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '품목 없음' });
  items[i] = { ...items[i], ...req.body, id: items[i].id, userId: items[i].userId };
  db.write('items', items);
  res.json(items[i]);
});

router.delete('/items/:id', (req, res) => {
  db.write('items', db.read('items').filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

// ── TRIPS ────────────────────────────────────────────────────────
router.get('/trips', (req, res) => res.json(db.read('trips')));

router.post('/trips', (req, res) => {
  const { name, startDate, endDate, location, note, participants } = req.body;
  if (!name?.trim() || !startDate) return res.status(400).json({ error: '필수값 누락' });
  const trips = db.read('trips');
  const trip  = {
    id: uid(), name: name.trim(), startDate, endDate: endDate || startDate,
    location: location || '', note: note || '', participants: participants || [], createdAt: now(),
  };
  trips.push(trip);
  db.write('trips', trips);
  res.json(trip);
});

router.put('/trips/:id', (req, res) => {
  const trips = db.read('trips');
  const i = trips.findIndex(t => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '일정 없음' });
  trips[i] = { ...trips[i], ...req.body, id: trips[i].id };
  db.write('trips', trips);
  res.json(trips[i]);
});

router.delete('/trips/:id', (req, res) => {
  db.write('trips', db.read('trips').filter(t => t.id !== req.params.id));
  const checks = db.read('checks');
  delete checks[req.params.id];
  db.write('checks', checks);
  res.json({ ok: true });
});

// ── CHECKS ───────────────────────────────────────────────────────
router.get('/trips/:tripId/checks', (req, res) => {
  res.json(db.read('checks')[req.params.tripId] || {});
});

router.put('/trips/:tripId/checks', (req, res) => {
  const { userId, itemId, planned, packed } = req.body;
  if (!userId || !itemId) return res.status(400).json({ error: '필수값 누락' });
  const checks = db.read('checks');
  const tc  = (checks[req.params.tripId] ??= {});
  const uc  = (tc[userId] ??= {});
  const cur = uc[itemId] ?? { planned: false, packed: false };
  uc[itemId] = {
    planned: planned !== undefined ? Boolean(planned) : cur.planned,
    packed:  packed  !== undefined ? Boolean(packed)  : cur.packed,
  };
  db.write('checks', checks);
  res.json(tc);
});

// ════════════════════════════════════════════════════════════════════
// export — loader.js 가 app.use('/campchecklist/api', router) 로 마운트
// ════════════════════════════════════════════════════════════════════
module.exports = router;

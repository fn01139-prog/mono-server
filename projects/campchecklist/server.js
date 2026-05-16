'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app              = express();
const PORT             = process.env.PORT || 3000;
const DATA_DIR         = path.join(__dirname, 'data');
const SYNC_INTERVAL_MS = 30 * 1000; // 30초

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
const dirty    = new Set(); // 변경된 파일명 추적
let lastSyncAt = null;      // 마지막 Drive 동기화 성공 시각
let syncStatus = 'idle';    // idle | syncing | error

const db = {
  read(name) {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
    } catch {
      return name === 'checks' ? {} : [];
    }
  },
  write(name, data) {
    fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
    dirty.add(name); // 변경 마킹 → 다음 30초 주기에 Drive Push
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
const fileIdCache = {}; // { 'users.json': 'driveFileId' } — list API 호출 최소화

if (USE_DRIVE) {
  try {
    const { google } = require('googleapis');

    // raw JSON 또는 base64 인코딩 모두 지원 (Railway 환경변수 이슈 대응)
    let rawKey = process.env.GDRIVE_KEY;
    try { JSON.parse(rawKey); }
    catch { rawKey = Buffer.from(rawKey, 'base64').toString('utf8'); }

    const key = JSON.parse(rawKey);
    // 일부 플랫폼에서 private_key 개행이 \\n으로 이스케이프되는 이슈 대응
    if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Google Drive 연동 활성화 | 폴더:', FOLDER_ID);
  } catch (e) {
    console.error('❌ Drive 초기화 실패:', e.message);
  }
}

// ── Drive 파일 ID 조회 (캐시 우선, 없으면 list API) ─────────────────
async function getFileId(filename) {
  if (fileIdCache[filename]) return fileIdCache[filename];
  const res = await drive.files.list({
    q: `name='${filename}' and '${FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  const id = res.data.files[0]?.id ?? null;
  if (id) fileIdCache[filename] = id;
  return id;
}

// ── Drive → 로컬 Pull (단일 파일) ───────────────────────────────────
async function drivePull(filename) {
  const fileId = await getFileId(filename);
  if (!fileId) return null; // Drive에 없음 (최초 기동)
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

// ── 로컬 → Drive Push (단일 파일) ───────────────────────────────────
async function drivePush(filename, content) {
  const media  = { mimeType: 'application/json', body: content };
  const fileId = await getFileId(filename);
  if (fileId) {
    await drive.files.update({ fileId, media });
  } else {
    const created = await drive.files.create({
      requestBody: { name: filename, parents: [FOLDER_ID] },
      media,
      fields: 'id',
    });
    fileIdCache[filename] = created.data.id; // 신규 생성 ID 캐시
  }
}

// ── 서버 시작 시 Drive → 로컬 전체 복원 ────────────────────────────
async function pullFromDrive() {
  if (!drive) return;
  console.log('📥 Google Drive에서 데이터 복원 중...');
  for (const name of ['users', 'items', 'trips', 'checks']) {
    try {
      const content = await drivePull(`${name}.json`);
      if (content) {
        fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), content, 'utf8');
        console.log(`  ✓ ${name}.json 복원`);
      } else {
        console.log(`  ○ ${name}.json Drive에 없음 — 신규 시작`);
      }
    } catch (e) {
      console.error(`  ✗ ${name}.json 복원 실패:`, e.message);
    }
  }
}

// ── 30초 배치 동기화 — dirty 있을 때만 실행 ────────────────────────
async function syncToDrive() {
  if (!drive || dirty.size === 0) return; // 변경 없으면 API 호출 안 함

  syncStatus   = 'syncing';
  const toSync = [...dirty];
  dirty.clear(); // 먼저 clear → 실패 시 개별 재추가

  const results = [];
  for (const name of toSync) {
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8');
      await drivePush(`${name}.json`, content);
      results.push(`✓ ${name}`);
    } catch (e) {
      dirty.add(name); // 실패 파일은 다음 주기에 재시도
      results.push(`✗ ${name}(${e.message})`);
      syncStatus = 'error';
    }
  }

  if (syncStatus !== 'error') {
    syncStatus = 'idle';
    lastSyncAt = now();
  }
  console.log(`☁️  Drive 동기화 [${new Date().toLocaleTimeString('ko-KR')}] ${results.join(' | ')}`);
}

// ── Graceful Shutdown — SIGTERM/SIGINT 시 최종 동기화 후 종료 ────────
async function shutdown(signal) {
  console.log(`\n[${signal}] 종료 전 Drive 최종 동기화 시작...`);
  await syncToDrive();
  console.log('✅ 최종 동기화 완료. 종료합니다.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ════════════════════════════════════════════════════════════════════
// Express 미들웨어
// ════════════════════════════════════════════════════════════════════
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════════════
// 동기화 상태 API (프론트 10초 폴링)
// ════════════════════════════════════════════════════════════════════
app.get('/api/status', (req, res) => {
  res.json({
    driveEnabled:    !!drive,
    syncStatus,                      // idle | syncing | error
    pendingChanges:  [...dirty],     // 아직 동기화 안 된 파일 목록
    lastSyncAt,                      // 마지막 성공 시각 ISO string
    syncIntervalSec: SYNC_INTERVAL_MS / 1000,
  });
});

// ════════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════════
app.get('/api/users', (req, res) => res.json(db.read('users')));

app.post('/api/users', (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '이름을 입력하세요' });
  const users = db.read('users');
  const user  = { id: uid(), name: name.trim(), color: color || '#4a7c59', createdAt: now() };
  users.push(user);
  db.write('users', users);
  res.json(user);
});

app.put('/api/users/:id', (req, res) => {
  const users = db.read('users');
  const i = users.findIndex(u => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '사용자 없음' });
  users[i] = { ...users[i], ...req.body, id: users[i].id };
  db.write('users', users);
  res.json(users[i]);
});

app.delete('/api/users/:id', (req, res) => {
  db.write('users', db.read('users').filter(u => u.id !== req.params.id));
  db.write('items', db.read('items').filter(i => i.userId !== req.params.id));
  const trips = db.read('trips');
  trips.forEach(t => { t.participants = (t.participants || []).filter(p => p !== req.params.id); });
  db.write('trips', trips);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// ITEMS
// ════════════════════════════════════════════════════════════════════
app.get('/api/items', (req, res) => {
  let items = db.read('items');
  if (req.query.userId) items = items.filter(i => i.userId === req.query.userId);
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const { userId, name, category, quantity, unit, note } = req.body;
  if (!userId || !name?.trim()) return res.status(400).json({ error: '필수값 누락' });
  const items = db.read('items');
  const item  = {
    id: uid(), userId, name: name.trim(),
    category: category || '기타',
    quantity: Number(quantity) || 1,
    unit: unit || '개', note: note || '',
    createdAt: now(),
  };
  items.push(item);
  db.write('items', items);
  res.json(item);
});

app.put('/api/items/:id', (req, res) => {
  const items = db.read('items');
  const i = items.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '품목 없음' });
  items[i] = { ...items[i], ...req.body, id: items[i].id, userId: items[i].userId };
  db.write('items', items);
  res.json(items[i]);
});

app.delete('/api/items/:id', (req, res) => {
  db.write('items', db.read('items').filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// TRIPS
// ════════════════════════════════════════════════════════════════════
app.get('/api/trips', (req, res) => res.json(db.read('trips')));

app.post('/api/trips', (req, res) => {
  const { name, startDate, endDate, location, note, participants } = req.body;
  if (!name?.trim() || !startDate) return res.status(400).json({ error: '필수값 누락' });
  const trips = db.read('trips');
  const trip  = {
    id: uid(), name: name.trim(), startDate,
    endDate: endDate || startDate,
    location: location || '', note: note || '',
    participants: participants || [],
    createdAt: now(),
  };
  trips.push(trip);
  db.write('trips', trips);
  res.json(trip);
});

app.put('/api/trips/:id', (req, res) => {
  const trips = db.read('trips');
  const i = trips.findIndex(t => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '일정 없음' });
  trips[i] = { ...trips[i], ...req.body, id: trips[i].id };
  db.write('trips', trips);
  res.json(trips[i]);
});

app.delete('/api/trips/:id', (req, res) => {
  db.write('trips', db.read('trips').filter(t => t.id !== req.params.id));
  const checks = db.read('checks');
  delete checks[req.params.id];
  db.write('checks', checks);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// CHECKS  { [tripId]: { [userId]: { [itemId]: { planned, packed } } } }
// ════════════════════════════════════════════════════════════════════
app.get('/api/trips/:tripId/checks', (req, res) => {
  const checks = db.read('checks');
  res.json(checks[req.params.tripId] || {});
});

app.put('/api/trips/:tripId/checks', (req, res) => {
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
// 서버 기동 — Drive Pull 완료 후 listen, 동기화 인터벌 등록
// ════════════════════════════════════════════════════════════════════
pullFromDrive().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🏕️  CampCheck 서버 가동 → http://localhost:${PORT}`);
    console.log(`📁 데이터 경로: ${DATA_DIR}`);

    if (drive) {
      setInterval(syncToDrive, SYNC_INTERVAL_MS);
      console.log(`🔄 Drive 배치 동기화: ${SYNC_INTERVAL_MS / 1000}초 주기 (변경 있을 때만 실행)\n`);
    } else {
      console.log('💾 로컬 전용 모드 (GDRIVE_KEY / GDRIVE_FOLDER_ID 미설정)\n');
    }
  });
});

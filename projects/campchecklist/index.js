'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const DATA_DIR         = path.join(__dirname, 'data');
const SYNC_INTERVAL_MS = 30 * 1000;
const config           = require('./config');
const JWT_SECRET       = process.env.JWT_SECRET || 'campcheck-dev-secret-change-in-prod';
const JWT_EXPIRES      = '30d';
const ADMIN_ID         = config.adminLoginId || 'admin';

// ════════════════════════════════════════════════════════════════════
// 데이터 디렉토리 및 초기 파일
// ════════════════════════════════════════════════════════════════════
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const INIT = {
  users: '[]', items: '[]', trips: '[]', checks: '{}',
  accounts: '[]',  // { userId, loginId, pwHash, role, createdAt, lastLoginAt }
  comments: '[]',  // { id, tripId, parentId, depth, authorId, authorName, content, createdAt, updatedAt, edited }
};
Object.entries(INIT).forEach(([n, v]) => {
  const f = path.join(DATA_DIR, `${n}.json`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, v, 'utf8');
});

// ════════════════════════════════════════════════════════════════════
// DB 헬퍼
// ════════════════════════════════════════════════════════════════════
const dirty       = new Set();
let lastSyncAt    = null;
let syncStatus    = 'idle';
let lastSyncError = null;
let lastPullAt    = null;  // 마지막 Drive Pull 성공 시각
let lastPullError = null;  // 마지막 Drive Pull 실패 원인

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
// Google Drive 연동 (30초 배치)
// ════════════════════════════════════════════════════════════════════
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
let drive       = null;
const fileIdCache = {};

// ── Drive 초기화 (OAuth2 Refresh Token)
// top-level await 금지 → IIFE Promise로 감싸서 _driveReady에 저장
// 서비스 계정(GDRIVE_KEY) 대신 OAuth2를 사용하므로:
//   - 저장 쿼터 문제 없음 (파일 소유권이 본인 구글 계정)
//   - clock skew 처리 불필요 (googleapis가 토큰 자동 갱신)
//
// 필요 환경변수: GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, GDRIVE_FOLDER_ID
// 토큰 발급: node get-token.js 실행
let _driveReady = null;

const _oauthReady = !!(
  process.env.GDRIVE_CLIENT_ID &&
  process.env.GDRIVE_CLIENT_SECRET &&
  process.env.GDRIVE_REFRESH_TOKEN &&
  FOLDER_ID
);

if (_oauthReady) {
  _driveReady = (async () => {
    const { google } = require('googleapis');

    const oauth2Client = new google.auth.OAuth2(
      process.env.GDRIVE_CLIENT_ID,
      process.env.GDRIVE_CLIENT_SECRET,
      'http://localhost' // 초기 인증 후에는 redirect_uri 미사용
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GDRIVE_REFRESH_TOKEN,
    });

    // access_token 만료 시 googleapis가 자동으로 갱신
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token)
        console.log('[CampCheck] 🔑 Drive 토큰 갱신됨');
    });

    drive = google.drive({ version: 'v3', auth: oauth2Client });
    console.log('[CampCheck] ✅ Google Drive 연동 활성화 (OAuth2)');
  })().catch(e => console.error('[CampCheck] ❌ Drive 초기화 실패:', e.message));
}

async function getFileId(filename) {
  if (fileIdCache[filename]) return fileIdCache[filename];
  const res = await drive.files.list({ q: `name='${filename}' and '${FOLDER_ID}' in parents and trashed=false`, fields: 'files(id)', spaces: 'drive' });
  const id  = res.data.files[0]?.id ?? null;
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
    const c = await drive.files.create({ requestBody: { name: filename, parents: [FOLDER_ID] }, media, fields: 'id' });
    fileIdCache[filename] = c.data.id;
  }
}
async function pullFromDrive() {
  if (!drive) return;
  lastPullError = null;
  console.log('[CampCheck] 📥 Drive 복원 중...');
  let anyFailed = false;
  for (const name of Object.keys(INIT)) {
    try {
      const content = await drivePull(`${name}.json`);
      if (content) {
        fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), content, 'utf8');
        console.log(`[CampCheck]   ✓ ${name}.json`);
      } else {
        console.log(`[CampCheck]   ○ ${name}.json — 신규 시작`);
      }
    } catch (e) {
      anyFailed    = true;
      lastPullError = `[${name}] ${e.message}`;
      console.error(`[CampCheck]   ✗ ${name}.json:`, e.message);
    }
  }
  if (!anyFailed) lastPullAt = now();
}
async function syncToDrive() {
  if (!drive || dirty.size === 0) return;
  syncStatus    = 'syncing';
  lastSyncError = null;
  const toSync  = [...dirty];
  dirty.clear();
  const results = [];
  for (const name of toSync) {
    try {
      await drivePush(`${name}.json`, fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
      results.push(`✓ ${name}`);
    } catch (e) {
      dirty.add(name); // 실패 파일은 다음 주기 재시도
      lastSyncError = `[${name}] ${e?.errors?.[0]?.message || e.message}`;
      results.push(`✗ ${name}: ${lastSyncError}`);
      syncStatus = 'error';
      console.error(`[CampCheck] ☁️  Drive Push 실패 — ${lastSyncError}`);
    }
  }
  if (syncStatus !== 'error') { syncStatus = 'idle'; lastSyncAt = now(); }
  console.log(`[CampCheck] ☁️  Drive [${new Date().toLocaleTimeString('ko-KR')}] ${results.join(' | ')}`);
}
process.on('SIGTERM', async () => { await syncToDrive(); process.exit(0); });
process.on('SIGINT',  async () => { await syncToDrive(); process.exit(0); });

// ════════════════════════════════════════════════════════════════════
// Auth 유틸
// ════════════════════════════════════════════════════════════════════
function makeToken(account, user) {
  const role = (account.loginId === ADMIN_ID) ? 'admin' : account.role;
  return jwt.sign(
    { userId: user.id, loginId: account.loginId, name: user.name, color: user.color, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// 이력 객체 생성 헬퍼
function historyEntry(user, action) {
  return { userId: user.userId, loginId: user.loginId, name: user.name, action, at: now() };
}

// ════════════════════════════════════════════════════════════════════
// Auth 미들웨어
// ════════════════════════════════════════════════════════════════════
function authOptional(req, res, next) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(h.slice(7), JWT_SECRET);
      // config.adminLoginId 와 일치하면 강제로 admin 적용
      if (payload.loginId === ADMIN_ID) payload.role = 'admin';
      req.user = payload;
    } catch { req.user = null; }
  }
  next();
}
const authRequired  = (req, res, next) => req.user ? next() : res.status(401).json({ error: '로그인이 필요합니다' });
const adminRequired = (req, res, next) => {
  if (!req.user)               return res.status(401).json({ error: '로그인이 필요합니다' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  next();
};

// ════════════════════════════════════════════════════════════════════
// Lazy Init — 첫 API 요청 시점에 Drive 초기화
//
// 서버(모노서버)가 완전히 listen된 이후 실제 요청이 들어올 때 실행되므로
// healthcheck 타임아웃 문제가 발생하지 않음
//
// _initPromise:
//   null       → 아직 초기화 안 됨 (첫 요청에서 시작)
//   Promise    → 초기화 진행 중 또는 완료 (이후 요청은 바로 통과)
// ════════════════════════════════════════════════════════════════════
let _initPromise = null;

function ensureInit() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    // Drive 클라이언트 초기화가 완료될 때까지 대기
    if (_driveReady) await _driveReady;
    await pullFromDrive();
    if (drive) {
      setInterval(syncToDrive, SYNC_INTERVAL_MS);
      console.log(`[CampCheck] 🔄 Drive ${SYNC_INTERVAL_MS / 1000}초 동기화 시작`);
    }
    console.log('[CampCheck] 🏕️  준비 완료');
  })().catch(e => {
    console.error('[CampCheck] 초기화 오류:', e.message);
    _initPromise = null; // 실패 시 다음 요청에서 재시도
  });
  return _initPromise;
}

// ════════════════════════════════════════════════════════════════════
// Router
// ════════════════════════════════════════════════════════════════════
const router = express.Router();
router.use(express.json());

// Lazy Init 미들웨어 — 모든 라우트보다 먼저 등록
// healthcheck는 여기를 거치지 않으므로 Drive 완료를 기다리지 않음
router.use((req, res, next) => {
  ensureInit()
    .then(() => next())
    .catch(() => next()); // 초기화 실패해도 요청은 처리 (로컬 데이터로 동작)
});

router.use(authOptional); // 모든 요청에 user 첨부 시도

// ── 동기화 상태 ────────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({
  driveEnabled:    !!drive,
  syncStatus,
  pendingChanges:  [...dirty],
  lastSyncAt,
  lastSyncError,
  lastPullAt,       // 마지막 Drive Pull 성공 시각
  lastPullError,    // 마지막 Drive Pull 실패 원인
  syncIntervalSec: SYNC_INTERVAL_MS / 1000,
}));

// ── 수동 Drive Pull (admin) ─────────────────────────────────────────
// 서버 시작 시 자동 pull이 실패했거나 데이터가 비어있을 때 수동으로 복원
router.post('/admin/drive/pull', adminRequired, async (req, res) => {
  if (!drive) return res.status(400).json({ error: 'Google Drive가 연동되지 않았습니다' });
  try {
    await pullFromDrive();
    _initPromise = null; // 다음 요청에서 ensureInit 재실행 (데이터 갱신 반영)
    res.json({ ok: true, message: 'Drive에서 데이터 복원 완료', lastPullAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 수동 Drive Push (admin) ────────────────────────────────────────
// 전체 데이터를 Drive에 강제 업로드
router.post('/admin/drive/push', adminRequired, async (req, res) => {
  if (!drive) return res.status(400).json({ error: 'Google Drive가 연동되지 않았습니다' });
  ['users','items','trips','checks','accounts','comments'].forEach(n => dirty.add(n));
  try {
    await syncToDrive();
    res.json({ ok: true, message: '전체 데이터 Drive 업로드 완료', lastSyncAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════

// 회원가입 — 이름+아이디+PW 입력, 기존 user와 자동 연결 또는 신규 생성
router.post('/auth/register', async (req, res) => {
  const { name, loginId, password } = req.body;
  if (!name?.trim() || !loginId?.trim() || !password?.trim())
    return res.status(400).json({ error: '이름, 아이디, 비밀번호를 모두 입력하세요' });

  const accounts = db.read('accounts');
  if (accounts.find(a => a.loginId === loginId.trim()))
    return res.status(400).json({ error: '이미 사용 중인 아이디입니다' });

  // 같은 이름의 기존 user가 있으면 연결, 없으면 신규 생성
  const users = db.read('users');
  let user    = users.find(u => u.name === name.trim());
  if (!user) {
    user = { id: uid(), name: name.trim(), color: '#4a7c59', createdAt: now() };
    users.push(user);
    db.write('users', users);
  }

  // 이미 해당 userId로 계정이 있으면 중복
  if (accounts.find(a => a.userId === user.id))
    return res.status(400).json({ error: '해당 이름으로 이미 계정이 등록되어 있습니다' });

  const pwHash  = await bcrypt.hash(password, 10);
  const role    = loginId.trim() === ADMIN_ID ? 'admin' : 'member';
  const account = { userId: user.id, loginId: loginId.trim(), pwHash, role, createdAt: now(), lastLoginAt: null };
  accounts.push(account);
  db.write('accounts', accounts);

  res.json({ token: makeToken(account, user), user: { userId: user.id, loginId: account.loginId, name: user.name, color: user.color, role: account.role } });
});

// 로그인
router.post('/auth/login', async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요' });

  const accounts = db.read('accounts');
  const account  = accounts.find(a => a.loginId === loginId);
  if (!account || !(await bcrypt.compare(password, account.pwHash)))
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

  account.lastLoginAt = now();
  db.write('accounts', accounts);

  const user = db.read('users').find(u => u.id === account.userId);
  if (!user) return res.status(500).json({ error: '계정 데이터 오류' });

  res.json({ token: makeToken(account, user), user: { userId: user.id, loginId: account.loginId, name: user.name, color: user.color, role: account.role } });
});

// 내 정보
router.get('/auth/me', authRequired, (req, res) => res.json(req.user));

// ════════════════════════════════════════════════════════════════════
// USERS — 조회 공개, 등록/수정/삭제는 admin
// ════════════════════════════════════════════════════════════════════
router.get('/users', (req, res) => {
  const users    = db.read('users');
  const accounts = db.read('accounts');
  const result   = users.map(u => {
    const acc = accounts.find(a => a.userId === u.id);
    return { ...u, hasAccount: !!acc, loginId: req.user?.role === 'admin' ? acc?.loginId : undefined };
  });
  res.json(result);
});

router.post('/users', adminRequired, (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '이름을 입력하세요' });
  const users = db.read('users');
  const user  = { id: uid(), name: name.trim(), color: color || '#4a7c59', createdAt: now(), createdBy: historyEntry(req.user, '생성') };
  users.push(user);
  db.write('users', users);
  res.json(user);
});

router.put('/users/:id', adminRequired, (req, res) => {
  const users = db.read('users');
  const i     = users.findIndex(u => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '사용자 없음' });
  users[i] = { ...users[i], ...req.body, id: users[i].id, updatedBy: historyEntry(req.user, '수정') };
  db.write('users', users);
  res.json(users[i]);
});

router.delete('/users/:id', adminRequired, (req, res) => {
  db.write('users',    db.read('users').filter(u => u.id !== req.params.id));
  db.write('items',    db.read('items').filter(i => i.userId !== req.params.id));
  db.write('accounts', db.read('accounts').filter(a => a.userId !== req.params.id));
  const trips = db.read('trips');
  trips.forEach(t => { t.participants = (t.participants || []).filter(p => p !== req.params.id); });
  db.write('trips', trips);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// ITEMS — 조회 공개, 등록/수정/삭제는 본인 or admin
// ════════════════════════════════════════════════════════════════════
router.get('/items', (req, res) => {
  let items = db.read('items');
  if (req.query.userId) items = items.filter(i => i.userId === req.query.userId);
  res.json(items);
});

router.post('/items', authRequired, (req, res) => {
  const { userId, name, category, quantity, unit, note } = req.body;
  if (!userId || !name?.trim()) return res.status(400).json({ error: '필수값 누락' });
  // 본인 아이템 또는 admin
  if (req.user.role !== 'admin' && req.user.userId !== userId)
    return res.status(403).json({ error: '본인 품목만 등록할 수 있습니다' });
  const items = db.read('items');
  const item  = { id: uid(), userId, name: name.trim(), category: category || '기타', quantity: Number(quantity) || 1, unit: unit || '개', note: note || '', createdAt: now(), createdBy: historyEntry(req.user, '등록') };
  items.push(item);
  db.write('items', items);
  res.json(item);
});

router.put('/items/:id', authRequired, (req, res) => {
  const items = db.read('items');
  const i     = items.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '품목 없음' });
  if (req.user.role !== 'admin' && req.user.userId !== items[i].userId)
    return res.status(403).json({ error: '본인 품목만 수정할 수 있습니다' });
  items[i] = { ...items[i], ...req.body, id: items[i].id, userId: items[i].userId, updatedBy: historyEntry(req.user, '수정') };
  db.write('items', items);
  res.json(items[i]);
});

router.delete('/items/:id', authRequired, (req, res) => {
  const items = db.read('items');
  const item  = items.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: '품목 없음' });
  if (req.user.role !== 'admin' && req.user.userId !== item.userId)
    return res.status(403).json({ error: '본인 품목만 삭제할 수 있습니다' });
  db.write('items', items.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// TRIPS — 조회 공개, 생성은 로그인, 수정은 로그인+이력, 삭제는 admin만
// ════════════════════════════════════════════════════════════════════
router.get('/trips', (req, res) => res.json(db.read('trips')));

router.post('/trips', authRequired, (req, res) => {
  const { name, startDate, endDate, location, note, participants } = req.body;
  if (!name?.trim() || !startDate) return res.status(400).json({ error: '필수값 누락' });
  const trips = db.read('trips');
  const trip  = {
    id: uid(), name: name.trim(), startDate, endDate: endDate || startDate,
    location: location || '', note: note || '', participants: participants || [],
    createdAt: now(),
    createdBy: historyEntry(req.user, '생성'),
    history:   [historyEntry(req.user, '생성')],
  };
  trips.push(trip);
  db.write('trips', trips);
  res.json(trip);
});

router.put('/trips/:id', authRequired, (req, res) => {
  const trips = db.read('trips');
  const i     = trips.findIndex(t => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '일정 없음' });

  // 일반 유저: 실제 삭제 불가, 'note에 취소됨' 처리는 프론트에서 PUT으로 요청
  const entry = historyEntry(req.user, req.body._action || '수정');
  trips[i] = {
    ...trips[i], ...req.body,
    id: trips[i].id,
    createdBy: trips[i].createdBy,
    history: [...(trips[i].history || []), entry],
    _action: undefined,
  };
  db.write('trips', trips);
  res.json(trips[i]);
});

// 실제 삭제는 admin만
router.delete('/trips/:id', adminRequired, (req, res) => {
  db.write('trips', db.read('trips').filter(t => t.id !== req.params.id));
  const checks = db.read('checks'); delete checks[req.params.id]; db.write('checks', checks);
  db.write('comments', db.read('comments').filter(c => c.tripId !== req.params.id));
  res.json({ ok: true });
});

// 일정 참여/탈퇴 (로그인 사용자 본인 기준)
router.put('/trips/:id/join', authRequired, (req, res) => {
  const trips = db.read('trips');
  const i     = trips.findIndex(t => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '일정 없음' });
  const parts = new Set(trips[i].participants || []);
  parts.add(req.user.userId);
  trips[i].participants = [...parts];
  trips[i].history = [...(trips[i].history || []), historyEntry(req.user, '참여')];
  db.write('trips', trips);
  res.json(trips[i]);
});

router.delete('/trips/:id/join', authRequired, (req, res) => {
  const trips = db.read('trips');
  const i     = trips.findIndex(t => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '일정 없음' });
  trips[i].participants = (trips[i].participants || []).filter(p => p !== req.user.userId);
  trips[i].history = [...(trips[i].history || []), historyEntry(req.user, '참여 취소')];
  db.write('trips', trips);
  res.json(trips[i]);
});

// ════════════════════════════════════════════════════════════════════
// CHECKS — 조회 공개, 수정은 본인 또는 admin
// ════════════════════════════════════════════════════════════════════
router.get('/trips/:tripId/checks', (req, res) => {
  res.json(db.read('checks')[req.params.tripId] || {});
});

router.put('/trips/:tripId/checks', authRequired, (req, res) => {
  const { userId, itemId, planned, packed } = req.body;
  if (!userId || !itemId) return res.status(400).json({ error: '필수값 누락' });
  if (req.user.role !== 'admin' && req.user.userId !== userId)
    return res.status(403).json({ error: '본인 체크리스트만 수정할 수 있습니다' });
  const checks = db.read('checks');
  const tc     = (checks[req.params.tripId] ??= {});
  const uc     = (tc[userId] ??= {});
  const cur    = uc[itemId] ?? { planned: false, packed: false };
  uc[itemId]   = {
    planned: planned !== undefined ? Boolean(planned) : cur.planned,
    packed:  packed  !== undefined ? Boolean(packed)  : cur.packed,
  };
  db.write('checks', checks);
  res.json(tc);
});

// ════════════════════════════════════════════════════════════════════
// COMMENTS — 조회 공개, 작성/수정은 로그인, 삭제는 admin
// ════════════════════════════════════════════════════════════════════
router.get('/comments', (req, res) => {
  const { tripId } = req.query;
  const comments   = db.read('comments');
  res.json(tripId ? comments.filter(c => c.tripId === tripId) : comments);
});

router.post('/comments', authRequired, (req, res) => {
  const { tripId, parentId, content } = req.body;
  if (!tripId || !content?.trim()) return res.status(400).json({ error: '필수값 누락' });

  let depth = 0;
  if (parentId) {
    const parent = db.read('comments').find(c => c.id === parentId);
    if (!parent) return res.status(404).json({ error: '부모 댓글 없음' });
    if (parent.depth >= 2) return res.status(400).json({ error: '3차 대댓글까지만 작성 가능합니다' });
    depth = parent.depth + 1;
  }

  const comments = db.read('comments');
  const comment  = {
    id: uid(), tripId, parentId: parentId || null, depth,
    authorId: req.user.userId, authorName: req.user.name,
    content:  content.trim(),
    createdAt: now(), updatedAt: now(), edited: false,
  };
  comments.push(comment);
  db.write('comments', comments);
  res.json(comment);
});

// 수정 — 본인 or admin (삭제 없음, 수정만)
router.put('/comments/:id', authRequired, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요' });

  const comments = db.read('comments');
  const i        = comments.findIndex(c => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '댓글 없음' });
  if (req.user.role !== 'admin' && req.user.userId !== comments[i].authorId)
    return res.status(403).json({ error: '본인 댓글만 수정할 수 있습니다' });

  comments[i].content   = content.trim();
  comments[i].updatedAt = now();
  comments[i].edited    = true;
  db.write('comments', comments);
  res.json(comments[i]);
});

// 삭제 — admin 전용
router.delete('/comments/:id', adminRequired, (req, res) => {
  const comments = db.read('comments');
  // 자식 댓글도 함께 삭제
  const toDelete = new Set();
  function collectIds(id) {
    toDelete.add(id);
    comments.filter(c => c.parentId === id).forEach(c => collectIds(c.id));
  }
  collectIds(req.params.id);
  db.write('comments', comments.filter(c => !toDelete.has(c.id)));
  res.json({ ok: true, deleted: [...toDelete].length });
});

module.exports = router;

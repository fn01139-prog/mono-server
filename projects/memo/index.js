'use strict';
// ─────────────────────────────────────────────────────────────────────
// memo — 사내 공유 문서함 (mono-server 서브프로젝트 라우터)
//
// core/loader.js가 이 라우터를 `/memo/api`에 마운트하고, 그 앞에 자동으로
// requireLogin + requireApp('/memo') 가드를 삽입한다 — 이 파일 안에서는
// 로그인 여부를 따로 검사할 필요가 없다. 정적 파일(public/)도 loader.js가
// `/memo`에 직접 마운트하므로 이 라우터 안에서 express.static을 쓰지 않는다.
//
// 라우트 경로에는 '/api/' 접두사를 붙이지 않는다 — 이미 `/memo/api`에
// 마운트되므로 붙이면 `/memo/api/api/...`가 되어버린다 (CLAUDE.md 참고).
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CONTENT_DIR, IMG_DIR } = require('./lib/paths');
const store = require('./lib/tree-store');
const auth = require('./lib/auth');

const router = express.Router();

router.use(express.json({ limit: '5mb' }));

// ---------- id 검증 헬퍼 ----------
function requireMidUnlock(getMidId) {
  return (req, res, next) => {
    const midId = getMidId(req);
    if (!midId || !store.isValidId(midId, 'mid')) {
      return res.status(400).json({ error: 'midId가 필요합니다.' });
    }
    const unlocked = auth.getUnlockedMids(req).includes(midId);
    if (!unlocked) {
      return res.status(403).json({ error: '이 중분류의 권한 코드가 필요합니다.', midId, needsCode: true });
    }
    next();
  };
}

// ---------- multer (이미지 업로드) ----------
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMG_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeBase = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
        .slice(0, 40);
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeBase}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('허용되지 않는 이미지 확장자입니다.'));
    cb(null, true);
  },
});

// ---------- 공개 열람 라우트 (로그인 + 앱 권한은 loader.js가 이미 검사) ----------
router.get('/tree', (req, res) => {
  const unlockedMids = new Set(auth.getUnlockedMids(req));
  const sanitized = {
    majors: store.tree.majors.map((major) => ({
      id: major.id,
      name: major.name,
      mids: major.mids.map((mid) => {
        const unlocked = !mid.codeHash || unlockedMids.has(mid.id);
        return {
          id: mid.id,
          name: mid.name,
          hasCode: !!mid.codeHash,
          unlocked,
          docCount: mid.docs.length,
          docs: unlocked ? mid.docs.map((doc) => ({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt })) : [],
        };
      }),
    })),
  };
  res.json(sanitized);
});

router.get('/docs/:docId', (req, res) => {
  const { docId } = req.params;
  if (!store.isValidId(docId, 'doc')) return res.status(400).json({ error: 'invalid docId' });
  const found = store.findDoc(docId);
  if (!found) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
  const { major, mid, doc } = found;
  if (mid.codeHash && !auth.getUnlockedMids(req).includes(mid.id)) {
    return res.status(403).json({ error: '이 문서를 보려면 중분류 권한 코드가 필요합니다.', midId: mid.id, needsCode: true });
  }
  const filePath = path.join(CONTENT_DIR, major.id, mid.id, `${doc.id}.html`);
  let html = '';
  try {
    html = fs.readFileSync(filePath, 'utf8');
  } catch {
    return res.status(404).json({ error: '문서 파일을 찾을 수 없습니다.' });
  }
  store.logAccess(req, 'view_doc', docId);
  res.json({
    id: doc.id,
    title: doc.title,
    html,
    majorId: major.id,
    majorName: major.name,
    midId: mid.id,
    midName: mid.name,
  });
});

// ---------- 관리자 라우트 (플랫폼 로그인의 role === 'admin') ----------

router.post('/admin/majors', auth.requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '대분류 이름을 입력하세요.' });
  const major = { id: store.genId('maj'), name, createdAt: new Date().toISOString(), mids: [] };
  store.tree.majors.push(major);
  store.persistTree();
  res.status(201).json({ id: major.id, name: major.name });
});

router.put('/admin/majors/:majorId', auth.requireAdmin, (req, res) => {
  const major = store.findMajor(req.params.majorId);
  if (!major) return res.status(404).json({ error: '대분류를 찾을 수 없습니다.' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '대분류 이름을 입력하세요.' });
  major.name = name;
  store.persistTree();
  res.json({ id: major.id, name: major.name });
});

router.post('/admin/majors/:majorId/mids', auth.requireAdmin, (req, res) => {
  const major = store.findMajor(req.params.majorId);
  if (!major) return res.status(404).json({ error: '대분류를 찾을 수 없습니다.' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '중분류 이름을 입력하세요.' });
  const mid = { id: store.genId('mid'), name, createdAt: new Date().toISOString(), codeHash: null, codeSetAt: null, docs: [] };
  major.mids.push(mid);
  store.persistTree();
  res.status(201).json({ id: mid.id, name: mid.name });
});

router.put('/admin/mids/:midId', auth.requireAdmin, (req, res) => {
  const found = store.findMidAnywhere(req.params.midId);
  if (!found) return res.status(404).json({ error: '중분류를 찾을 수 없습니다.' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '중분류 이름을 입력하세요.' });
  found.mid.name = name;
  store.persistTree();
  res.json({ id: found.mid.id, name: found.mid.name });
});

router.put('/admin/mids/:midId/code', auth.requireAdmin, (req, res) => {
  const found = store.findMidAnywhere(req.params.midId);
  if (!found) return res.status(404).json({ error: '중분류를 찾을 수 없습니다.' });
  const code = (req.body.code || '').trim();
  if (!code || code.length < 4) return res.status(400).json({ error: '코드는 4자 이상이어야 합니다.' });
  found.mid.codeHash = store.hashCode(code);
  found.mid.codeSetAt = new Date().toISOString();
  store.persistTree();
  res.json({ id: found.mid.id, code, codeSetAt: found.mid.codeSetAt });
});

router.delete('/admin/majors/:majorId', auth.requireAdmin, (req, res) => {
  const idx = store.tree.majors.findIndex((m) => m.id === req.params.majorId);
  if (idx === -1) return res.status(404).json({ error: '대분류를 찾을 수 없습니다.' });
  const [major] = store.tree.majors.splice(idx, 1);
  store.persistTree();
  fs.rmSync(path.join(CONTENT_DIR, major.id), { recursive: true, force: true });
  store.logAccess(req, 'delete_major', major.id);
  res.json({ ok: true });
});

router.delete('/admin/mids/:midId', auth.requireAdmin, (req, res) => {
  const found = store.findMidAnywhere(req.params.midId);
  if (!found) return res.status(404).json({ error: '중분류를 찾을 수 없습니다.' });
  const { major, mid } = found;
  major.mids = major.mids.filter((m) => m.id !== mid.id);
  store.persistTree();
  fs.rmSync(path.join(CONTENT_DIR, major.id, mid.id), { recursive: true, force: true });
  store.logAccess(req, 'delete_mid', mid.id);
  res.json({ ok: true });
});

// ---------- 중분류 코드 잠금해제 (공개 — 앱 접근 권한이 있는 로그인 사용자 전원) ----------

router.get('/mids/:midId/unlock-status', (req, res) => {
  const unlocked = auth.getUnlockedMids(req).includes(req.params.midId);
  res.json({ unlocked });
});

router.post('/mids/:midId/unlock', (req, res) => {
  const found = store.findMidAnywhere(req.params.midId);
  if (!found) return res.status(404).json({ error: '중분류를 찾을 수 없습니다.' });
  if (!found.mid.codeHash) {
    return res.status(403).json({ error: '관리자가 먼저 이 중분류에 권한 코드를 설정해야 합니다.' });
  }
  const code = (req.body.code || '').trim();
  if (!store.verifyCode(code, found.mid.codeHash)) {
    return res.status(403).json({ error: '코드가 일치하지 않습니다.' });
  }
  auth.addUnlockedMid(req, res, found.mid.id);
  res.json({ unlocked: true });
});

// ---------- 에디터 페이지 (관리자 전용, public/ 밖에서 명시적 라우트로만 노출) ----------

router.get('/admin/editor', auth.requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'editor.html'));
});

// ---------- 문서 쓰기 (관리자 + 중분류 코드 이중 게이트) ----------

router.post('/docs', auth.requireAdmin, requireMidUnlock((req) => req.body.midId), (req, res) => {
  const { majorId, midId } = req.body;
  const title = (req.body.title || '').trim();
  const html = req.body.html || '';
  if (!store.isValidId(majorId, 'maj') || !store.isValidId(midId, 'mid')) {
    return res.status(400).json({ error: 'majorId/midId가 올바르지 않습니다.' });
  }
  if (!title) return res.status(400).json({ error: '문서 제목을 입력하세요.' });
  const major = store.findMajor(majorId);
  const mid = major && major.mids.find((m) => m.id === midId);
  if (!major || !mid) return res.status(404).json({ error: '대분류/중분류를 찾을 수 없습니다.' });

  const docId = store.genId('doc');
  const dir = path.join(CONTENT_DIR, major.id, mid.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${docId}.html`), html, 'utf8');

  const now = new Date().toISOString();
  mid.docs.push({ id: docId, title, createdAt: now, updatedAt: now });
  store.persistTree();
  store.logAccess(req, 'create_doc', docId);
  res.status(201).json({ id: docId, majorId: major.id, midId: mid.id, title });
});

router.put(
  '/docs/:docId',
  auth.requireAdmin,
  requireMidUnlock((req) => {
    const found = store.findDoc(req.params.docId);
    return found ? found.mid.id : null;
  }),
  (req, res) => {
    const found = store.findDoc(req.params.docId);
    if (!found) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    const { major, mid, doc } = found;
    const title = (req.body.title || '').trim();
    const html = req.body.html || '';
    if (!title) return res.status(400).json({ error: '문서 제목을 입력하세요.' });

    fs.writeFileSync(path.join(CONTENT_DIR, major.id, mid.id, `${doc.id}.html`), html, 'utf8');
    doc.title = title;
    doc.updatedAt = new Date().toISOString();
    store.persistTree();
    store.logAccess(req, 'update_doc', doc.id);
    res.json({ id: doc.id, majorId: major.id, midId: mid.id, title });
  }
);

router.delete(
  '/docs/:docId',
  auth.requireAdmin,
  requireMidUnlock((req) => {
    const found = store.findDoc(req.params.docId);
    return found ? found.mid.id : null;
  }),
  (req, res) => {
    const found = store.findDoc(req.params.docId);
    if (!found) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    const { major, mid, doc } = found;
    mid.docs = mid.docs.filter((d) => d.id !== doc.id);
    store.persistTree();
    try {
      fs.unlinkSync(path.join(CONTENT_DIR, major.id, mid.id, `${doc.id}.html`));
    } catch {
      // 파일이 이미 없어도 트리에서 지우는 게 중요
    }
    store.logAccess(req, 'delete_doc', doc.id);
    res.json({ ok: true });
  }
);

router.post('/upload-image', auth.requireAdmin, requireMidUnlock((req) => req.query.midId), (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드 실패' });
    if (!req.file) return res.status(400).json({ error: '이미지 파일이 없습니다.' });
    res.json({ default: `/memo/content/img/${req.file.filename}` });
  });
});

module.exports = router;

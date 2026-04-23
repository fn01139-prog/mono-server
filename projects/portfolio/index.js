/**
 * projects/portfolio/index.js
 * 기존 namecard server.js (순수 http) → Express Router로 이식
 * → /portfolio/api/* 로 마운트됨
 *
 * 뷰어 SPA 라우팅 (/portfolio/:pageId) 은 loader.js의 catch-all로 처리
 */
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const router  = express.Router();

/* ── 인증 헬퍼 ────────────────────────────────────────────────────────── */
function getPassword() { return process.env.PORTFOLIO_PASSWORD || ''; }

function makeToken(pwd) {
  return crypto.createHmac('sha256', pwd).update('portfolio-auth').digest('hex');
}

function verifyToken(token) {
  const pwd = getPassword();
  if (!pwd || !token) return false;
  return token === makeToken(pwd);
}

function requireAuth(req, res, next) {
  if (!getPassword()) return next();
  const token = req.headers['x-auth-token'];
  if (!verifyToken(token)) {
    return res.status(401).json({ success: false, error: '인증이 필요합니다.' });
  }
  next();
}

const DATA_FILE = path.join(__dirname, 'data', 'pages.json');

// ─── 데이터 헬퍼 ─────────────────────────────────────────────
function readPages() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch (e) { return []; }
}

function writePages(pages) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(pages, null, 2), 'utf-8');
}

// 초기 샘플 데이터 생성
function ensureDataFile() {
  if (fs.existsSync(DATA_FILE)) return;
  const sample = [
    {
      id: 'sample1', person: 'user', num: 1, template: 'profile', status: 'published',
      contents: [
        { type: 'greeting', data: { name: '이름', title: '직함', bio: '자기소개' } },
        { type: 'skills',   data: { tags: ['JavaScript', 'Node.js', 'SAP ABAP'] } },
        { type: 'contact',  data: { email: 'email@example.com', phone: '', links: [] } },
      ]
    }
  ];
  writePages(sample);
}
ensureDataFile();

// ─── 헬스체크 ────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ success: true, project: 'portfolio', time: new Date() });
});

// ─── 인증 ────────────────────────────────────────────────────
router.get('/auth/check', (req, res) => {
  res.json({ required: !!getPassword() });
});

router.post('/auth', (req, res) => {
  const pwd = getPassword();
  if (!pwd) return res.json({ success: true, token: '' });
  const { password } = req.body;
  if (password !== pwd) {
    return res.status(401).json({ success: false, error: '비밀번호가 틀렸습니다.' });
  }
  res.json({ success: true, token: makeToken(pwd) });
});

// ─── GET /portfolio/api/pages ─────────────────────────────────
router.get('/pages', (req, res) => {
  res.json(readPages());
});

// ─── GET /portfolio/api/pages/:id ────────────────────────────
router.get('/pages/:id', (req, res) => {
  const page = readPages().find(p => p.id === req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json(page);
});

// ─── POST /portfolio/api/pages ────────────────────────────────
router.post('/pages', requireAuth, (req, res) => {
  const body  = req.body;
  const pages = readPages();

  if (!body.id || !body.person || !body.num)
    return res.status(400).json({ error: 'Missing required fields' });
  if (pages.find(p => p.id === body.id))
    return res.status(409).json({ error: 'Page already exists' });

  const newPage = {
    id:       body.id,
    person:   body.person,
    num:      body.num,
    template: body.template || 'profile',
    status:   body.status   || 'draft',
    contents: body.contents || [{ type: 'greeting', data: { name: '', title: '', bio: '' } }],
  };
  pages.push(newPage);
  writePages(pages);
  res.status(201).json(newPage);
});

// ─── PUT /portfolio/api/pages/:id ────────────────────────────
router.put('/pages/:id', requireAuth, (req, res) => {
  const pages = readPages();
  const idx   = pages.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Page not found' });

  const body = req.body;
  pages[idx] = {
    ...pages[idx],
    template: body.template ?? pages[idx].template,
    status:   body.status   ?? pages[idx].status,
    contents: body.contents ?? pages[idx].contents,
  };
  writePages(pages);
  res.json(pages[idx]);
});

// ─── DELETE /portfolio/api/pages/:id ─────────────────────────
router.delete('/pages/:id', requireAuth, (req, res) => {
  let pages = readPages();
  const idx = pages.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Page not found' });

  pages.splice(idx, 1);
  writePages(pages);
  res.json({ success: true });
});

module.exports = router;

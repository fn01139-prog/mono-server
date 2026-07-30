require('dotenv').config();
const express      = require('express');
const morgan       = require('morgan');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');
const loader       = require('./core/loader');
const batch        = require('./core/batch');
const pool         = require('./shared/db');
const authRoutes   = require('./core/auth-routes');
const { attachUser, requireLogin, requireRole } = require('./core/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── 공통 미들웨어 ── */
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    // origin 없으면 같은 도메인 요청 (Railway 자체 서빙) → 허용
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

/* ── 인증 라우트 + 로그인 페이지 (앱 로딩보다 먼저 등록) ── */
app.use('/auth', authRoutes);
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'core/views/login.html'));
});
app.get('/admin', requireLogin, requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'core/views/admin.html'));
});

/* ── 공통 클라이언트 자산 (401 리다이렉트 가드 등) ── */
app.use('/shared-assets', express.static(path.join(__dirname, 'shared/public')));

/* ── 프로젝트 자동 로딩 ── */
loader.mount(app);

/* ── Railway 헬스체크 ── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date() });
});

/* ── 루트 인덱스 (허브 페이지, 로그인 필요) ── */
app.get('/', requireLogin, async (req, res, next) => {
  try {
    const allProjects = loader.getList();
    let projects = allProjects;

    if (req.user.role !== 'admin') {
      const { rows } = await pool.query(
        `SELECT app_prefix FROM platform_app_grants WHERE user_id IN ($1, '*')`,
        [req.user.userId]
      );
      const allowed = new Set(rows.map(r => r.app_prefix));
      projects = allProjects.filter(p => allowed.has(p.prefix));
    }

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Yu's App Hub</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 40px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .user   { font-size: 0.85rem; color: #aaa; display: flex; align-items: center; gap: 12px; }
    .user a { color: #4a9eff; text-decoration: none; }
    .user a:hover { text-decoration: underline; }
    #logoutBtn { background: none; border: 1px solid #2a2a2a; color: #aaa; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
    #logoutBtn:hover { border-color: #4a9eff; color: #4a9eff; }
    h1  { font-size: 1.8rem; margin-bottom: 8px; color: #fff; }
    p.sub   { color: #888; margin-bottom: 32px; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .card {
      background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 24px; text-decoration: none; color: inherit;
      transition: border-color .2s, transform .2s;
    }
    .card:hover { border-color: #4a9eff; transform: translateY(-2px); }
    .card h2   { font-size: 1.1rem; margin-bottom: 6px; color: #fff; }
    .card span { font-size: 0.8rem; color: #4a9eff; }
    .card p    { font-size: 0.85rem; color: #888; margin-top: 8px; margin-bottom: 0; }
    .empty { color: #666; }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>🗂 Yu's App Hub</h1>
    <div class="user">
      <span>${req.user.name} (${req.user.role === 'admin' ? '관리자' : '사용자'})</span>
      ${req.user.role === 'admin' ? '<a href="/admin">사용자 관리</a>' : ''}
      <button id="logoutBtn">로그아웃</button>
    </div>
  </div>
  <p class="sub">등록된 프로젝트 목록 · ${new Date().toLocaleDateString('ko-KR')}</p>
  <div class="grid">
    ${projects.map(p => `
    <a class="card" href="${p.prefix}">
      <h2>${p.icon || '📦'} ${p.name}</h2>
      <span>${p.prefix}</span>
      <p>${p.description || ''}</p>
    </a>`).join('')}
    ${projects.length === 0 ? '<p class="empty">접근 권한이 있는 앱이 없습니다. 관리자에게 문의하세요.</p>' : ''}
  </div>
  <script>
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      location.href = '/login';
    });
  </script>
</body>
</html>`;
    res.send(html);
  } catch (e) {
    next(e);
  }
});

/* ── 404 ── */
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

/* ── 글로벌 에러 핸들러 ── */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await require('./scripts/migrate').run(pool);
      console.log('[DB] Migration check complete.');
      await require('./scripts/migrate-auth').run(pool);
      console.log('[DB] Auth bootstrap/migration complete.');
      await batch.init();
    } catch (e) {
      console.error('[DB] Migration failed:', e.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 mono-server running on http://localhost:${PORT}`);
    loader.printStatus();
  });
}

start();

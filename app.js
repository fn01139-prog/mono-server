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
app.get('/notify-settings', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'core/views/notify-settings.html'));
});

/* ── 공통 클라이언트 자산 (401 리다이렉트 가드 등) ── */
app.use('/shared-assets', express.static(path.join(__dirname, 'shared/public')));

/* ── 웹푸시 서비스워커: 스코프가 사이트 전체를 덮으려면 루트 경로(/sw.js)로 서빙해야 함 ── */
app.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'shared/public/sw.js'));
});

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
    table.fb-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 32px; }
    .fb-table th, .fb-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2a2a; }
    .fb-table th { color: #888; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; }
    .fb-section h2 { font-size: 1.1rem; color: #fff; margin-top: 40px; }
    .fb-section p.sub { color: #888; font-size: 0.82rem; margin-bottom: 0; }
    .fb-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 0.7rem; font-weight: 600; }
    .fb-badge-pending { background: rgba(227,179,65,.15); border: 1px solid rgba(227,179,65,.4); color: #e3b341; }
    .fb-badge-done { background: rgba(63,185,80,.12); border: 1px solid rgba(63,185,80,.35); color: #3fb950; }
    .fb-empty { color: #666; font-size: 0.85rem; padding: 16px 0; }
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
  <script src="/shared-assets/feedback-widget.js"></script>
</head>
<body>
  <div class="topbar">
    <h1>🗂 Yu's App Hub</h1>
    <div class="user">
      <span>${req.user.name} (${req.user.role === 'admin' ? '관리자' : '사용자'})</span>
      <a href="/notify-settings">🔔 알림 설정</a>
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

  <div class="fb-section">
    <h2>💬 버그 · 개선 요청 현황</h2>
    <p class="sub">모든 프로젝트 화면에서 <code>Ctrl+H</code>로 신고할 수 있습니다. 처리 이력은 추후 우수 신고자 베네핏에 활용될 예정입니다.</p>
    <table class="fb-table">
      <thead>
        <tr><th>프로젝트</th><th>처리구분</th><th>요청내용</th><th>요청자</th><th>요청일시</th><th>완료여부</th><th>처리내용</th><th>완료시간</th></tr>
      </thead>
      <tbody id="fbRows"></tbody>
    </table>
    <div class="fb-empty" id="fbEmpty" style="display:none">등록된 신고가 없습니다.</div>
  </div>

  <script>
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      location.href = '/login';
    });

    const FB_CATEGORY = { bug: '🐛 버그', improvement: '✨ 기능개선' };
    const FB_TYPE = { ui: '화면구성', error: '시스템 오류', feature: '추가기능' };

    function fbEsc(s) {
      const el = document.createElement('div');
      el.textContent = s == null ? '' : String(s);
      return el.innerHTML;
    }
    function fbDate(v) { return v ? new Date(v).toLocaleString('ko-KR') : '-'; }
    function fbResolver(f) {
      if (f.status !== 'done') return '-';
      if (f.resolved_by === 'claude-batch') return '🤖 Claude 자동처리';
      if (f.resolved_by_name) return '🙋 ' + fbEsc(f.resolved_by_name) + ' (수동)';
      return '-';
    }

    (async function loadFeedback() {
      try {
        const res = await fetch('/auth/feedback?limit=100', { credentials: 'include' });
        const list = await res.json();
        document.getElementById('fbEmpty').style.display = list.length ? 'none' : 'block';
        document.getElementById('fbRows').innerHTML = list.map(f => \`
          <tr>
            <td>\${fbEsc(f.app_prefix)}</td>
            <td>\${FB_CATEGORY[f.category] || fbEsc(f.category)} · \${FB_TYPE[f.type] || fbEsc(f.type)}</td>
            <td style="max-width:280px;">\${fbEsc(f.content)}</td>
            <td>\${fbEsc(f.requester_name)}</td>
            <td style="color:#888;font-size:0.78rem">\${fbDate(f.created_at)}</td>
            <td>\${f.status === 'done' ? '<span class="fb-badge fb-badge-done">완료</span>' : '<span class="fb-badge fb-badge-pending">대기</span>'}</td>
            <td style="max-width:240px;color:#aaa;">\${fbEsc(f.resolution_note) || '-'}</td>
            <td style="color:#888;font-size:0.78rem">\${fbDate(f.resolved_at)}</td>
          </tr>
        \`).join('');
      } catch (e) {
        document.getElementById('fbEmpty').textContent = '신고 목록을 불러오지 못했습니다: ' + e.message;
        document.getElementById('fbEmpty').style.display = 'block';
      }
    })();
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

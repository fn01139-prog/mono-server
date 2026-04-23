require('dotenv').config();
const express = require('express');
const morgan  = require('morgan');
const cors    = require('cors');
const loader  = require('./core/loader');

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

/* ── 프로젝트 자동 로딩 ── */
loader.mount(app);

/* ── Railway 헬스체크 ── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date() });
});

/* ── 루트 인덱스 (허브 페이지) ── */
app.get('/', (req, res) => {
  const projects = loader.getList();
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Yu's App Hub</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 40px; }
    h1  { font-size: 1.8rem; margin-bottom: 8px; color: #fff; }
    p   { color: #888; margin-bottom: 32px; font-size: 0.9rem; }
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
  </style>
</head>
<body>
  <h1>🗂 Yu's App Hub</h1>
  <p>등록된 프로젝트 목록 · ${new Date().toLocaleDateString('ko-KR')}</p>
  <div class="grid">
    ${projects.map(p => `
    <a class="card" href="${p.prefix}">
      <h2>${p.icon || '📦'} ${p.name}</h2>
      <span>${p.prefix}</span>
      <p>${p.description || ''}</p>
    </a>`).join('')}
  </div>
</body>
</html>`;
  res.send(html);
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

app.listen(PORT, () => {
  console.log(`\n🚀 mono-server running on http://localhost:${PORT}`);
  loader.printStatus();
});

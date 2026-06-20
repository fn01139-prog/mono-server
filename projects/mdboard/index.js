/**
 * projects/mdboard/index.js
 * 기존 server.js의 API 라우터를 mono-server 구조로 이식
 * → /mdboard/api/* 로 마운트됨
 */
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const os      = require('os');
const crypto  = require('crypto');
const { Marp } = require('@marp-team/marp-core');
const drive   = require('./drive');
const router  = express.Router();

/* ── 인증 헬퍼 ────────────────────────────────────────────────────────── */
function getPassword() { return process.env.MDBOARD_PASSWORD || ''; }

function makeToken(pwd) {
  return crypto.createHmac('sha256', pwd).update('mdboard-auth').digest('hex');
}

function verifyToken(token) {
  const pwd = getPassword();
  if (!pwd || !token) return false;
  return token === makeToken(pwd);
}

function requireAuth(req, res, next) {
  if (!getPassword()) return next(); // 비밀번호 미설정 시 인증 불필요
  const token = req.headers['x-auth-token'];
  if (!verifyToken(token)) {
    return res.status(401).json({ success: false, error: '인증이 필요합니다.' });
  }
  next();
}

const PROJECT_DIR  = __dirname;
const CONTENTS_DIR = path.join(PROJECT_DIR, 'public', 'contents');
const IMG_DIR      = path.join(CONTENTS_DIR, 'img');

[CONTENTS_DIR, IMG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: IMG_DIR,
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext)
                     .replace(/[^a-zA-Z0-9가-힣_\-]/g, '_')
                     .substring(0, 60);
    cb(null, `${base}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

function safePath(filename) {
  const resolved = path.resolve(CONTENTS_DIR, path.basename(filename));
  return resolved.startsWith(CONTENTS_DIR) ? resolved : null;
}

function getFileInfo(filename) {
  const filePath = path.join(CONTENTS_DIR, filename);
  const stat     = fs.statSync(filePath);
  const content  = fs.readFileSync(filePath, 'utf8');
  const headingMatch = content.match(/^#\s+(.+)/m);
  const title    = headingMatch ? headingMatch[1].trim() : filename.replace('.md', '');
  const lines    = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('```'));
  const preview  = (lines[0] || '').replace(/[*_`[\]!]/g, '').substring(0, 120);
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  return { name: filename, title, preview, size: stat.size, wordCount, created: stat.birthtime, modified: stat.mtime };
}

router.get('/health', (req, res) => {
  res.json({ success: true, project: 'mdBoard', time: new Date() });
});

/* 인증 필요 여부 확인 */
router.get('/auth/check', (req, res) => {
  res.json({ required: !!getPassword() });
});

/* 인증 (비밀번호 검증 → 토큰 반환) */
router.post('/auth', (req, res) => {
  const pwd = getPassword();
  if (!pwd) return res.json({ success: true, token: '' }); // 비밀번호 미설정
  const { password } = req.body;
  if (password !== pwd) {
    return res.status(401).json({ success: false, error: '비밀번호가 틀렸습니다.' });
  }
  res.json({ success: true, token: makeToken(pwd) });
});

// Drive Lazy Init — auth/health 라우트 이후, 파일 라우트 이전에 적용
// 초기화 실패 시에도 next()를 호출해 로컬 파일로 동작 유지
router.use((req, res, next) => {
  drive.ensureInit()
    .then(() => next())
    .catch(() => next());
});

router.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(CONTENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => getFileInfo(f))
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ success: true, files });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/file/:name', (req, res) => {
  try {
    const name = req.params.name;
    if (!name.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
    const filePath = safePath(name);
    if (!filePath)                return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, content: fs.readFileSync(filePath, 'utf8'), name });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/save', requireAuth, async (req, res) => {
  try {
    let { name, content, originalName } = req.body;
    if (!name || content === undefined)
      return res.status(400).json({ error: 'name and content required' });
 
    name = name.trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!name.endsWith('.md')) name += '.md';
 
    const filePath = safePath(name);
    if (!filePath) return res.status(403).json({ error: 'Forbidden' });
 
    // 로컬 저장
    fs.writeFileSync(filePath, content, 'utf8');
 
    if (originalName && originalName !== name) {
      const oldPath = safePath(originalName);
      if (oldPath && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
        drive.deleteFile(originalName).catch(() => {});
      }
    }
    drive.pushFile(name, content).catch(() => {});
    res.json({ success: true, name });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/file/:name', requireAuth, (req, res) => {
  try {
    const filePath = safePath(req.params.name);
    if (!filePath)                return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(filePath);
    drive.deleteFile(req.params.name).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/stats', (req, res) => {
  try {
    const mdFiles  = fs.readdirSync(CONTENTS_DIR).filter(f => f.endsWith('.md'));
    const imgFiles = fs.readdirSync(IMG_DIR).filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f));
    const totalMem = os.totalmem(), freeMem = os.freemem();
    let totalSize = 0, lastModified = null;
    const fileInfos = [];

    mdFiles.forEach(f => {
      try {
        const stat = fs.statSync(path.join(CONTENTS_DIR, f));
        totalSize += stat.size;
        if (!lastModified || stat.mtime > new Date(lastModified)) lastModified = stat.mtime;
        fileInfos.push(getFileInfo(f));
      } catch(e) {}
    });
    imgFiles.forEach(f => {
      try { totalSize += fs.statSync(path.join(IMG_DIR, f)).size; } catch(e) {}
    });

    const recentFiles = fileInfos.sort((a,b) => new Date(b.modified)-new Date(a.modified)).slice(0,5);
    const changeList  = [{ title: "mono-server 통합", content: "Railway 배포용 통합 완료", modified: new Date().toISOString().split('T')[0] }];
    const mem = process.memoryUsage(), cpus = os.cpus();

    res.json({
      success: true, totalFiles: mdFiles.length, totalImages: imgFiles.length,
      totalSize, lastModified, recentFiles, changeList,
      memory: { total: totalMem, used: totalMem-freeMem, free: freeMem,
                usedPercent: Math.round(((totalMem-freeMem)/totalMem)*100),
                processRss: mem.rss, processHeap: mem.heapUsed, heapTotal: mem.heapTotal },
      cpu: { loadAvg1: parseFloat(os.loadavg()[0].toFixed(2)),
             loadAvg5: parseFloat(os.loadavg()[1].toFixed(2)),
             loadAvg15: parseFloat(os.loadavg()[2].toFixed(2)),
             cores: cpus.length, model: (cpus[0]||{}).model||'Unknown' },
      uptime: { system: Math.floor(os.uptime()), process: Math.floor(process.uptime()) },
      platform: os.platform(), arch: os.arch(), nodeVersion: process.version,
      hostname: os.hostname(), timestamp: new Date().toISOString()
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/* ── Marp HTML 내보내기 ─────────────────────────────────────────────────── */
router.get('/export/html/:name', (req, res) => {
  try {
    const name = req.params.name;
    if (!name.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
    const filePath = safePath(name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

    const content = fs.readFileSync(filePath, 'utf8');
    const marp = new Marp({ html: true });
    const { html, css } = marp.render(content);
    const title = name.replace(/\.md$/i, '');

    const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
${html}
</body>
</html>`;

    const outputName = title + '.html';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(outputName)}`);
    res.send(fullHtml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Marp PDF 내보내기 (브라우저 인쇄 → PDF) ───────────────────────────── */
router.get('/export/pdf/:name', (req, res) => {
  try {
    const name = req.params.name;
    if (!name.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
    const filePath = safePath(name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

    const content = fs.readFileSync(filePath, 'utf8');
    const marp = new Marp({ html: true });
    const { html, css } = marp.render(content);
    const title = name.replace(/\.md$/i, '');

    const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
${css}
@media print {
  @page { margin: 0; size: A4 landscape; }
  body { margin: 0; }
}
</style>
</head>
<body>
${html}
<script>
window.onload = function() { setTimeout(function() { window.print(); }, 400); };
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fullHtml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  res.json({ success: true, filename: req.file.filename,
             url: `/mdboard/contents/img/${req.file.filename}`, size: req.file.size });
});

router.get('/images', (req, res) => {
  try {
    const images = fs.readdirSync(IMG_DIR)
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(IMG_DIR, f));
        return { name: f, url: `/mdboard/contents/img/${f}`, size: stat.size, modified: stat.mtime };
      })
      .sort((a,b) => new Date(b.modified)-new Date(a.modified));
    res.json({ success: true, images });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;

/**
 * projects/mdboard/index.js
 * → /mdboard/api/* 로 마운트됨
 */
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const os      = require('os');
const pool    = require('../../shared/db');
const { Marp } = require('@marp-team/marp-core');
const perm    = require('./permissions');
const mailer  = require('../../shared/mailer');
const router  = express.Router();

/* ── 인증 ─────────────────────────────────────────────────────────────── *
 * 접근 제어(로그인 여부)는 loader.js 가드가 담당한다. 이 라우터는
 * "이미 로그인된 사용자가 이 파일에 read/write 권한이 있는가"만 검사한다.
 * /publish만 예외적으로 x-api-key로 비로그인 접근을 허용한다(Claude Code 등
 * programmatic 접근용, 기존 동작 유지).
 * ────────────────────────────────────────────────────────────────────── */

// 콘텐츠는 Railway 볼륨(paths.js 참고, 디렉토리 생성도 거기서 처리)에 상시 저장된다.
// Google Drive는 더 이상 실시간 동기화 대상이 아니고, scripts/mdboard-drive-migrate.js
// (1회 이관)와 core/jobs/mdboard-drive-backup.js(월 1회 백업)에서만 별도로 사용한다.
const { CONTENTS_DIR, IMG_DIR } = require('./paths');

const storage = multer.diskStorage({
  destination: IMG_DIR,
  filename: (req, file, cb) => {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext  = path.extname(original).toLowerCase();
    const base = path.basename(original, ext)
                     .replace(/[^a-zA-Z0-9가-힣_\-]/g, '_').substring(0, 60);
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

const htmlStorage = multer.diskStorage({
  destination: CONTENTS_DIR,
  filename: (req, file, cb) => {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext  = path.extname(original).toLowerCase();
    const base = path.basename(original, ext)
                     .replace(/[^a-zA-Z0-9가-힣_\-]/g, '_').substring(0, 80);
    let finalName = `${base}${ext}`;
    if (fs.existsSync(path.join(CONTENTS_DIR, finalName)))
      finalName = `${base}_${Date.now()}${ext}`;
    cb(null, finalName);
  }
});
const htmlUpload = multer({
  storage: htmlStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.html' || ext === '.htm');
  }
});

/* ── 경로 보안 헬퍼 ───────────────────────────────────────────────────── */
// relPath: 'file.md' 또는 'folder/file.md' (최대 2단계)
function safePath(relPath) {
  if (!relPath) return null;
  const parts = relPath.replace(/\\/g, '/').split('/').filter(p => p && p !== '..' && p !== '.');
  if (parts.length === 0 || parts.length > 2) return null;
  if (parts.length === 2 && parts[0] === 'img') return null;
  const resolved = path.resolve(CONTENTS_DIR, ...parts);
  const base = CONTENTS_DIR.endsWith(path.sep) ? CONTENTS_DIR : CONTENTS_DIR + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

// HTML 파일명 검증 (루트 레벨만 허용)
function safeHtmlPath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename);
  if (!/\.html?$/i.test(base)) return null;
  const resolved = path.resolve(CONTENTS_DIR, base);
  const contentsBase = CONTENTS_DIR.endsWith(path.sep) ? CONTENTS_DIR : CONTENTS_DIR + path.sep;
  return resolved.startsWith(contentsBase) ? resolved : null;
}

// 폴더명 검증 (슬래시, '..' 등 불허)
function safeFolderPath(name) {
  if (!name || typeof name !== 'string') return null;
  const cleaned = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  if (!cleaned || cleaned === 'img' || cleaned === '.' || cleaned === '..') return null;
  const resolved = path.resolve(CONTENTS_DIR, cleaned);
  const base = CONTENTS_DIR.endsWith(path.sep) ? CONTENTS_DIR : CONTENTS_DIR + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

/* ── 파일 정보 ────────────────────────────────────────────────────────── */
function getFileInfo(filename, folder = null) {
  const filePath = folder
    ? path.join(CONTENTS_DIR, folder, filename)
    : path.join(CONTENTS_DIR, filename);
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const headingMatch = content.match(/^#\s+(.+)/m);
  const title = headingMatch ? headingMatch[1].trim() : filename.replace(/\.md$/i, '');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('```'));
  const preview = (lines[0] || '').replace(/[*_`[\]!]/g, '').substring(0, 120);
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const filePath_ = folder ? `${folder}/${filename}` : filename;
  return { name: filename, path: filePath_, folder: folder || null, title, preview, size: stat.size, wordCount, created: stat.birthtime, modified: stat.mtime };
}

function getHtmlFileInfo(filename) {
  const filePath = path.join(CONTENTS_DIR, filename);
  const stat = fs.statSync(filePath);
  let title = filename.replace(/\.html?$/i, '');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const m = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  } catch {}
  return { name: filename, path: filename, folder: null, title, preview: '', size: stat.size, wordCount: 0, created: stat.birthtime, modified: stat.mtime, type: 'html' };
}

function getAllHtmlFileInfos() {
  try {
    return fs.readdirSync(CONTENTS_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && /\.html?$/i.test(e.name))
      .map(e => getHtmlFileInfo(e.name))
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  } catch { return []; }
}

// 모든 .md 파일 수집 (서브폴더 포함)
function getAllMdFileInfos() {
  const result = [];
  const entries = fs.readdirSync(CONTENTS_DIR, { withFileTypes: true });
  entries.forEach(e => {
    if (e.isFile() && e.name.endsWith('.md')) {
      result.push(getFileInfo(e.name, null));
    } else if (e.isDirectory() && e.name !== 'img') {
      try {
        fs.readdirSync(path.join(CONTENTS_DIR, e.name))
          .filter(f => f.endsWith('.md'))
          .forEach(f => result.push(getFileInfo(f, e.name)));
      } catch {}
    }
  });
  return result;
}

/* ── 헬스체크 ─────────────────────────────────────────────────────────── */
router.get('/health', (req, res) => {
  res.json({ success: true, project: 'mdBoard', time: new Date() });
});

/* ── 협업자 목록 (이 앱에 접근 권한이 있는 플랫폼 사용자 — 공유 대상 후보) ── */
router.get('/collaborators', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.color
       FROM platform_users u
       JOIN platform_accounts a ON a.user_id = u.id AND a.is_active = TRUE
       LEFT JOIN platform_app_grants g ON g.user_id = u.id AND g.app_prefix = '/mdboard'
       WHERE a.role = 'admin' OR g.user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM platform_app_grants g2 WHERE g2.user_id = '*' AND g2.app_prefix = '/mdboard')
       ORDER BY u.name`
    );
    res.json({ success: true, users: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── 메일 발송 이력 조회 (GET /mail-logs) — shared/mailer.js 공통 라우터 ── */
router.use(mailer.mailLogRouter('/mdboard'));

/* ── 파일 목록 (폴더 구조 포함) ────────────────────────────────────────── */
router.get('/files', async (req, res) => {
  try {
    const entries = fs.readdirSync(CONTENTS_DIR, { withFileTypes: true });

    const rootFilesAll = entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => getFileInfo(e.name, null));

    const folderEntries = entries
      .filter(e => e.isDirectory() && e.name !== 'img')
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    const foldersAll = folderEntries.map(d => {
      try {
        const files = fs.readdirSync(path.join(CONTENTS_DIR, d.name))
          .filter(f => f.endsWith('.md'))
          .map(f => getFileInfo(f, d.name));
        return { name: d.name, files };
      } catch { return { name: d.name, files: [] }; }
    });

    const htmlFilesAll = getAllHtmlFileInfos();

    // self-healing: 레지스트리에 없는 파일은 조회 과정에서 admin 소유로 자동 등록
    const allInfos = [...rootFilesAll, ...foldersAll.flatMap(f => f.files), ...htmlFilesAll];
    for (const f of allInfos) {
      await perm.ensureRegistered(f.path, f.type === 'html' ? 'html' : 'md');
    }

    const readable = await perm.readableFilePaths(req); // null이면 admin(전체 허용)
    const isReadable = (p) => readable === null || readable.has(p);

    const rootFiles = rootFilesAll.filter(f => isReadable(f.path)).sort((a, b) => new Date(b.modified) - new Date(a.modified));
    // 빈 폴더도 그대로 노출 — 폴더는 소유 개념 없는 공유 구조라 파일이 0개라고 숨기면
    // 방금 만든 폴더가 사이드바/이동 다이얼로그 어디에도 안 보이는 문제가 생김
    const folders = foldersAll
      .map(fld => ({ name: fld.name, files: fld.files.filter(f => isReadable(f.path)).sort((a, b) => new Date(b.modified) - new Date(a.modified)) }));
    const htmlFiles = htmlFilesAll.filter(f => isReadable(f.path)).sort((a, b) => new Date(b.modified) - new Date(a.modified));
    const allFiles = [...rootFiles, ...folders.flatMap(f => f.files)];

    res.json({ success: true, files: allFiles, rootFiles, folders, htmlFiles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 파일 조회 (/file/* 와일드카드) ────────────────────────────────────── */
router.get('/file/*', async (req, res) => {
  try {
    const name = req.params[0];
    if (!name.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
    const filePath = safePath(name);
    if (!filePath)                return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    if (!(await perm.canRead(req, name))) return res.status(404).json({ error: 'Not found' });

    const content = fs.readFileSync(filePath, 'utf8');
    const stat    = fs.statSync(filePath);
    const parts   = name.split('/');
    const folder  = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
    const filename = parts[parts.length - 1];
    res.json({ success: true, content, name: filename, path: name, folder, size: stat.size, modified: stat.mtime });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 파일 저장 ────────────────────────────────────────────────────────── */
router.post('/save', async (req, res) => {
  try {
    let { name, folder, content, originalName, originalFolder } = req.body;
    if (!name || content === undefined)
      return res.status(400).json({ error: 'name and content required' });

    name   = name.trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!name.endsWith('.md')) name += '.md';
    folder = folder ? folder.trim().replace(/[<>:"/\\|?*]/g, '_') : null;

    if (folder) {
      const fp = safeFolderPath(folder);
      if (!fp) return res.status(403).json({ error: 'Invalid folder' });
      if (!fs.existsSync(fp)) fs.mkdirSync(fp, { recursive: true });
    }

    const newRelPath = folder ? `${folder}/${name}` : name;
    const newAbsPath = safePath(newRelPath);
    if (!newAbsPath) return res.status(403).json({ error: 'Forbidden' });

    let origRelPath = null;
    if (originalName) {
      if (!originalName.endsWith('.md')) originalName += '.md';
      const origFolder = originalFolder || null;
      origRelPath = origFolder ? `${origFolder}/${originalName}` : originalName;
    }

    // 기존 파일(원래 이름 또는 덮어쓰려는 대상)에 쓰기 권한이 있는지 확인
    const targetForCheck = origRelPath || newRelPath;
    const targetExists = fs.existsSync(safePath(targetForCheck) || '');
    if (targetExists && !(await perm.canWrite(req, targetForCheck))) {
      return res.status(403).json({ success: false, error: '이 파일에 대한 쓰기 권한이 없습니다.' });
    }

    // 이름/폴더 변경 시 구 파일 삭제 + 레지스트리 경로 갱신
    if (origRelPath && origRelPath !== newRelPath) {
      const oldAbs = safePath(origRelPath);
      if (oldAbs && fs.existsSync(oldAbs)) {
        fs.unlinkSync(oldAbs);
      }
      await perm.renamePath(origRelPath, newRelPath);
    }

    fs.writeFileSync(newAbsPath, content, 'utf8');
    if (!targetExists) await perm.registerNew(newRelPath, 'md', req.user.userId);
    res.json({ success: true, name, folder: folder || null, path: newRelPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 파일 삭제 (/file/* 와일드카드) ────────────────────────────────────── */
router.delete('/file/*', async (req, res) => {
  try {
    const name     = req.params[0];
    const filePath = safePath(name);
    if (!filePath)                return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    if (!(await perm.canWrite(req, name))) return res.status(403).json({ success: false, error: '이 파일에 대한 쓰기 권한이 없습니다.' });

    fs.unlinkSync(filePath);
    await perm.deletePath(name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 폴더 목록 ────────────────────────────────────────────────────────── */
router.get('/folders', (req, res) => {
  try {
    const folders = fs.readdirSync(CONTENTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name !== 'img')
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'ko'));
    res.json({ success: true, folders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 폴더 생성 (로그인 사용자 전원 — 폴더는 공유 구조, 소유 개념 없음) ──── */
router.post('/folders', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const folderPath = safeFolderPath(name);
    if (!folderPath) return res.status(403).json({ error: '유효하지 않은 폴더명입니다.' });
    if (fs.existsSync(folderPath)) return res.status(409).json({ success: false, error: '이미 존재하는 폴더입니다.' });
    fs.mkdirSync(folderPath);
    res.json({ success: true, name: path.basename(folderPath) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 폴더 삭제 (빈 폴더만) ─────────────────────────────────────────────── */
router.delete('/folders/:name', (req, res) => {
  try {
    const folderPath = safeFolderPath(req.params.name);
    if (!folderPath)                return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(folderPath)) return res.status(404).json({ error: 'Not found' });
    const files = fs.readdirSync(folderPath);
    if (files.length > 0) return res.status(400).json({ success: false, error: '폴더가 비어있지 않습니다.' });
    fs.rmdirSync(folderPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 파일 이동 ────────────────────────────────────────────────────────── */
router.post('/move', async (req, res) => {
  try {
    const { file, fromFolder, toFolder } = req.body;
    if (!file) return res.status(400).json({ error: 'file required' });

    const fromRel = fromFolder ? `${fromFolder}/${file}` : file;
    const toRel   = toFolder   ? `${toFolder}/${file}`   : file;
    if (fromRel === toRel) return res.json({ success: true, path: toRel });

    const fromAbs = safePath(fromRel);
    const toAbs   = safePath(toRel);
    if (!fromAbs || !toAbs)           return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(fromAbs))      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    if (fs.existsSync(toAbs))         return res.status(409).json({ success: false, error: '대상 폴더에 같은 이름의 파일이 있습니다.' });
    if (!(await perm.canWrite(req, fromRel))) return res.status(403).json({ success: false, error: '이 파일에 대한 쓰기 권한이 없습니다.' });

    if (toFolder) {
      const tp = safeFolderPath(toFolder);
      if (!tp || !fs.existsSync(tp)) return res.status(404).json({ error: '대상 폴더가 없습니다.' });
    }

    fs.renameSync(fromAbs, toAbs);
    await perm.renamePath(fromRel, toRel);
    res.json({ success: true, path: toRel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 통계 ─────────────────────────────────────────────────────────────── */
router.get('/stats', (req, res) => {
  try {
    const allInfos  = getAllMdFileInfos();
    const imgFiles  = fs.readdirSync(IMG_DIR).filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f));
    const totalMem  = os.totalmem(), freeMem = os.freemem();
    let totalSize   = 0, lastModified = null;

    allInfos.forEach(f => {
      totalSize += f.size;
      if (!lastModified || f.modified > new Date(lastModified)) lastModified = f.modified;
    });
    imgFiles.forEach(f => {
      try { totalSize += fs.statSync(path.join(IMG_DIR, f)).size; } catch {}
    });

    const recentFiles = [...allInfos].sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 5);
    const changeList  = [{ title: 'mono-server 통합', content: 'Railway 배포용 통합 완료', modified: new Date().toISOString().split('T')[0] }];
    const mem = process.memoryUsage(), cpus = os.cpus();

    const htmlInfos = getAllHtmlFileInfos();
    res.json({
      success: true, totalFiles: allInfos.length, totalImages: imgFiles.length, totalHtmlFiles: htmlInfos.length,
      totalSize, lastModified, recentFiles, changeList,
      memory: { total: totalMem, used: totalMem - freeMem, free: freeMem,
                usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
                processRss: mem.rss, processHeap: mem.heapUsed, heapTotal: mem.heapTotal },
      cpu: { loadAvg1: parseFloat(os.loadavg()[0].toFixed(2)),
             loadAvg5: parseFloat(os.loadavg()[1].toFixed(2)),
             loadAvg15: parseFloat(os.loadavg()[2].toFixed(2)),
             cores: cpus.length, model: (cpus[0] || {}).model || 'Unknown' },
      uptime: { system: Math.floor(os.uptime()), process: Math.floor(process.uptime()) },
      platform: os.platform(), arch: os.arch(), nodeVersion: process.version,
      hostname: os.hostname(), timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 이미지 업로드 (문서에 종속 — 별도 권한 관리 없음, 로그인만 필요) ──── */
router.post('/upload-image', upload.single('image'), (req, res) => {
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
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ success: true, images });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── HTML 파일 업로드 ─────────────────────────────────────────────────── */
router.post('/upload-html', (req, res) => {
  htmlUpload.single('html')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ error: '파일 크기가 너무 큽니다. (최대 5MB)' });
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'HTML 파일이 없습니다.' });
    await perm.registerNew(req.file.filename, 'html', req.user.userId);
    res.json({ success: true, filename: req.file.filename, size: req.file.size });
  });
});

/* ── HTML 파일 삭제 ───────────────────────────────────────────────────── */
router.delete('/html-file/:filename', async (req, res) => {
  try {
    const filePath = safeHtmlPath(req.params.filename);
    if (!filePath)                return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    if (!(await perm.canWrite(req, req.params.filename))) {
      return res.status(403).json({ success: false, error: '이 파일에 대한 쓰기 권한이 없습니다.' });
    }

    fs.unlinkSync(filePath);
    await perm.deletePath(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── Claude 퍼블리시 (API 키 전용) ─────────────────────────────────────── */
// POST /publish  { title, content, folder?, overwrite? }
// x-api-key 헤더로만 접근 가능 (비밀번호 인증 불허)
router.post('/publish', async (req, res) => {
  const apiKey = process.env.MDBOARD_API_KEY || '';
  if (!apiKey || req.headers['x-api-key'] !== apiKey)
    return res.status(401).json({ success: false, error: 'API 키가 필요합니다.' });

  try {
    let { title, content, folder, overwrite } = req.body;
    if (!title || content === undefined)
      return res.status(400).json({ error: 'title과 content가 필요합니다.' });

    title  = title.trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!title.endsWith('.md')) title += '.md';
    folder = folder ? folder.trim().replace(/[<>:"/\\|?*]/g, '_') : null;

    if (folder) {
      const fp = safeFolderPath(folder);
      if (!fp) return res.status(403).json({ error: '유효하지 않은 폴더명입니다.' });
      if (!fs.existsSync(fp)) fs.mkdirSync(fp, { recursive: true });
    }

    const relPath = folder ? `${folder}/${title}` : title;
    const absPath = safePath(relPath);
    if (!absPath) return res.status(403).json({ error: 'Forbidden' });

    if (fs.existsSync(absPath) && !overwrite)
      return res.status(409).json({ success: false, error: '이미 존재하는 파일입니다. overwrite: true 로 덮어쓸 수 있습니다.', path: relPath });

    const fileExisted = fs.existsSync(absPath);
    fs.writeFileSync(absPath, content, 'utf8');
    if (!fileExisted) {
      const adminId = await perm.getAdminUserId();
      if (adminId) await perm.registerNew(relPath, 'md', adminId);
    }

    res.json({ success: true, title, folder: folder || null, path: relPath,
               url: `/mdboard#${encodeURIComponent(relPath)}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── Marp HTML 내보내기 ─────────────────────────────────────────────────── */
router.get('/export/html/*', async (req, res) => {
  try {
    const name = req.params[0];
    if (!name.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
    const filePath = safePath(name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    if (!(await perm.canRead(req, name))) return res.status(404).json({ error: 'Not found' });

    const content = fs.readFileSync(filePath, 'utf8');
    const marp    = new Marp({ html: true });
    const { html, css } = marp.render(content);
    const title   = name.split('/').pop().replace(/\.md$/i, '');

    const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${css}</style>
</head>
<body>${html}</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title + '.html')}`);
    res.send(fullHtml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Marp PDF 내보내기 (브라우저 인쇄) ─────────────────────────────────── */
router.get('/export/pdf/*', async (req, res) => {
  try {
    const name = req.params[0];
    if (!name.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
    const filePath = safePath(name);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    if (!(await perm.canRead(req, name))) return res.status(404).json({ error: 'Not found' });

    const content = fs.readFileSync(filePath, 'utf8');
    const marp    = new Marp({ html: true });
    const { html, css } = marp.render(content);
    const title   = name.split('/').pop().replace(/\.md$/i, '');

    const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
${css}
@media print { @page { margin: 0; size: A4 landscape; } body { margin: 0; } }
</style>
</head>
<body>
${html}
<script>window.onload = function() { setTimeout(function() { window.print(); }, 400); };</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fullHtml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 파일 공유 관리 (소유자/admin만) ────────────────────────────────────── */
router.get('/file-permissions', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ success: false, error: 'path 쿼리가 필요합니다' });
    if (!(await perm.canWrite(req, filePath))) {
      return res.status(403).json({ success: false, error: '이 파일의 공유 설정을 볼 권한이 없습니다.' });
    }
    const info = await perm.getGrants(filePath);
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/file-permissions', async (req, res) => {
  try {
    const { path: filePath, grants } = req.body;
    if (!filePath || !Array.isArray(grants)) {
      return res.status(400).json({ success: false, error: 'path와 grants 배열이 필요합니다' });
    }
    if (!(await perm.canWrite(req, filePath))) {
      return res.status(403).json({ success: false, error: '이 파일을 공유할 권한이 없습니다.' });
    }
    await perm.setGrants(filePath, grants, req.user.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

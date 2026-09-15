/**
 * projects/mdboard/publish-routes.js
 * Claude Code / MCP 서버 등 programmatic 클라이언트 전용 퍼블리시 API.
 *
 * core/loader.js가 마운트하는 프로젝트 라우터(index.js)는 requireLogin 가드가
 * 먼저 걸리고, 쓰기 메서드(POST)는 config.publicPaths로도 우회할 수 없다
 * (loader.js 주석 참고). 그래서 로그인 없이 x-api-key만으로 접근해야 하는 이
 * 엔드포인트들은 loader.mount() 이전에 app에 직접 마운트해 가드를 아예
 * 거치지 않는다 — core/auth-routes.js의 /auth/feedback/batch/* 와 동일 패턴.
 *
 * app.js에서 `app.use('/mdboard/api', require('./projects/mdboard/publish-routes'))`
 * 로 loader.mount(app)보다 먼저 마운트한다. 여기서 처리하지 않는 경로는
 * Express가 자동으로 다음 미들웨어(로그인 가드가 걸린 실제 mdboard 라우터)로
 * 넘기므로 기존 라우트와 충돌하지 않는다.
 */
'use strict';

const express = require('express');
const fs      = require('fs');
const { CONTENTS_DIR } = require('./paths');
const { safePath, safeHtmlPath, safeFolderPath } = require('./pathSafety');
const perm    = require('./permissions');

const router = express.Router();

const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB — /upload-html 파일 업로드 제한과 동일

function requireApiKey(req, res, next) {
  const apiKey = process.env.MDBOARD_API_KEY || '';
  if (!apiKey || req.headers['x-api-key'] !== apiKey)
    return res.status(401).json({ success: false, error: 'API 키가 필요합니다.' });
  next();
}

// 주의: router.use(requireApiKey)로 전역 적용하면 안 된다 — 이 라우터는
// /mdboard/api 전체를 가로채므로, /files·/folders(GET) 등 이 파일에 없는
// 나머지 모든 경로까지 API 키를 요구하게 돼 로그인한 브라우저 사용자가 막힌다.
// 반드시 아래 각 라우트에 개별적으로 requireApiKey를 붙인다.

async function registerIfNew(relPath, type, fileExisted) {
  if (fileExisted) return;
  const adminId = await perm.getAdminUserId();
  if (adminId) await perm.registerNew(relPath, type, adminId);
}

/* ── 마크다운 퍼블리시 ────────────────────────────────────────────────── *
 * POST /publish  { title, content, folder?, overwrite? }
 * 기존 mdboard-push.js / mdboard-publish 스킬과 동일한 계약을 유지한다.
 * ────────────────────────────────────────────────────────────────────── */
router.post('/publish', requireApiKey, async (req, res) => {
  try {
    let { title, content, folder, overwrite } = req.body;
    if (!title || content === undefined)
      return res.status(400).json({ error: 'title과 content가 필요합니다.' });
    if (Buffer.byteLength(String(content), 'utf8') > MAX_CONTENT_SIZE)
      return res.status(400).json({ success: false, error: '내용이 너무 큽니다. (최대 5MB)' });

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
    await registerIfNew(relPath, 'md', fileExisted);

    res.json({ success: true, title, folder: folder || null, path: relPath,
               url: `/mdboard#${encodeURIComponent(relPath)}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── HTML 퍼블리시 ────────────────────────────────────────────────────── *
 * POST /publish-html  { title, content, overwrite? }
 * HTML은 기존 /upload-html과 동일하게 contents/ 루트에만 저장한다(서브폴더 없음).
 * ────────────────────────────────────────────────────────────────────── */
router.post('/publish-html', requireApiKey, async (req, res) => {
  try {
    let { title, content, overwrite } = req.body;
    if (!title || content === undefined)
      return res.status(400).json({ error: 'title과 content가 필요합니다.' });
    if (Buffer.byteLength(String(content), 'utf8') > MAX_CONTENT_SIZE)
      return res.status(400).json({ success: false, error: '내용이 너무 큽니다. (최대 5MB)' });

    let filename = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!/\.html?$/i.test(filename)) filename += '.html';

    const absPath = safeHtmlPath(filename);
    if (!absPath) return res.status(403).json({ error: 'Forbidden' });

    if (fs.existsSync(absPath) && !overwrite)
      return res.status(409).json({ success: false, error: '이미 존재하는 파일입니다. overwrite: true 로 덮어쓸 수 있습니다.', path: filename });

    const fileExisted = fs.existsSync(absPath);
    fs.writeFileSync(absPath, content, 'utf8');
    await registerIfNew(filename, 'html', fileExisted);

    res.json({ success: true, title: filename, path: filename,
               url: `/mdboard/include/view-html.html?file=${encodeURIComponent(filename)}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── 폴더 목록 (md 퍼블리시 시 폴더 선택용) ──────────────────────────────── *
 * 브라우저용 GET /folders(로그인 필요)와 경로가 겹치지 않도록 /publish/folders로 분리.
 * ────────────────────────────────────────────────────────────────────── */
router.get('/publish/folders', requireApiKey, (req, res) => {
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

module.exports = router;

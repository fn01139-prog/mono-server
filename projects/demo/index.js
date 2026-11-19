/**
 * projects/demo/index.js — 웹데모 API (/demo/api)
 *
 * GET    /list           공개. 저장소 public/ + 볼륨의 데모 파일 목록
 * GET    /me             공개. 현재 로그인 여부와 업로드 권한 (index.html 업로드 UI 표시용)
 * PUT    /files/<path>   업로드 권한 필요. HTML 본문을 그대로 볼륨에 저장 (재기동 없이 즉시 게시)
 * DELETE /files/<path>   업로드 권한 필요. 볼륨의 파일 삭제 (저장소 public/ 파일은 삭제 불가)
 *
 * 업로드 권한 = 플랫폼 로그인 + /demo 앱 권한(admin은 항상 통과, core/auth의 requireApp과 동일 규칙)
 *              또는 x-api-key(DEMO_API_KEY) — scripts/demo-push.js 등 CLI용.
 * config.public === true 라 loader 가드가 없으므로 쓰기 라우트는 여기서 직접 검사한다.
 *
 * 업로드는 express.raw로 받는다 — app.js의 express.json()은 기본 100kb 제한이라 큰 HTML이
 * 막히지만, text/html·application/octet-stream 본문은 그 파서를 거치지 않는다.
 */
'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const pool    = require('../../shared/db');
const { DEMO_DIR, DEMO_DIR_READY } = require('./paths');

const router     = express.Router();
const PREFIX     = '/demo';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_SIZE   = '10mb';
const ALLOWED_EXT = new Set(['.html', '.htm']);   // HTML만 업로드 허용

/* ── 권한 ───────────────────────────────────────────────────────────── */

function hasApiKey(req) {
  const key = process.env.DEMO_API_KEY || '';
  return !!key && req.headers['x-api-key'] === key;
}

async function canUpload(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM platform_app_grants WHERE app_prefix = $1 AND user_id IN ($2, '*') LIMIT 1`,
    [PREFIX, user.userId]
  );
  return rows.length > 0;
}

async function requireUploader(req, res, next) {
  try {
    if (hasApiKey(req)) return next();
    if (!req.user) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
    if (!(await canUpload(req.user)))
      return res.status(403).json({ success: false, error: '웹데모 업로드 권한이 없습니다. 관리자에게 /demo 앱 권한을 요청하세요.' });
    next();
  } catch (e) { next(e); }
}

function requireVolume(req, res, next) {
  if (!DEMO_DIR_READY)
    return res.status(503).json({ success: false, error: `게시 디렉토리(${DEMO_DIR})를 사용할 수 없습니다.` });
  next();
}

/* ── 경로 ───────────────────────────────────────────────────────────── */

/** 상대경로 검증: 영문/숫자/한글/-_. 로 된 세그먼트만, 상위 이동·숨김파일 금지, .html/.htm만 */
function resolveSafe(rel) {
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.length > 200) return { error: '경로가 비어 있거나 너무 깁니다.' };
  const segs = rel.split('/');
  if (segs.some(s => !s || s.startsWith('.') || !/^[\w\-.가-힣]+$/.test(s)))
    return { error: '폴더/파일명은 영문·숫자·한글·- _ . 만 사용할 수 있습니다.' };
  if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase()))
    return { error: 'HTML 파일(.html, .htm)만 업로드할 수 있습니다.' };
  if (rel.toLowerCase() === 'index.html') return { error: 'index.html은 목록 페이지라 덮어쓸 수 없습니다.' };
  const abs = path.resolve(DEMO_DIR, rel);
  if (!abs.startsWith(path.resolve(DEMO_DIR) + path.sep)) return { error: '허용되지 않는 경로입니다.' };
  return { rel, abs };
}

function walk(root, base = '') {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const abs = path.join(root, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs, rel));
    else if (/\.html?$/i.test(ent.name)) {
      const st = fs.statSync(abs);
      out.push({ path: rel, size: st.size, mtime: st.mtime });
    }
  }
  return out;
}

/* ── 조회 (공개) ────────────────────────────────────────────────────── */

router.get('/list', (req, res) => {
  const map = new Map();
  walk(PUBLIC_DIR).forEach(f => map.set(f.path, { ...f, source: 'repo' }));
  if (DEMO_DIR_READY) walk(DEMO_DIR).forEach(f => map.set(f.path, { ...f, source: 'volume' })); // 볼륨 우선(서빙 순서와 동일)
  map.delete('index.html');
  const files = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  res.json({ success: true, files });
});

router.get('/me', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({
      success:   true,
      loggedIn:  !!req.user,
      name:      req.user?.name || req.user?.loginId || null,
      canUpload: DEMO_DIR_READY && await canUpload(req.user),
    });
  } catch (e) { next(e); }
});

/* ── 업로드 / 삭제 (업로드 권한) ────────────────────────────────────── */

router.put('/files/*', requireUploader, requireVolume,
  express.raw({ type: () => true, limit: MAX_SIZE }),
  (req, res) => {
    const target = resolveSafe(req.params[0]);
    if (target.error) return res.status(400).json({ success: false, error: target.error });
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      return res.status(400).json({ success: false, error: '본문이 비어 있습니다.' });
    // 확장자만 바꾼 바이너리 차단: NUL 바이트가 있으면 텍스트(HTML)가 아니다
    if (req.body.subarray(0, 8192).includes(0))
      return res.status(400).json({ success: false, error: 'HTML 텍스트 파일이 아닙니다.' });
    const existed = fs.existsSync(target.abs);
    fs.mkdirSync(path.dirname(target.abs), { recursive: true });
    const tmp = `${target.abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, req.body);
    fs.renameSync(tmp, target.abs);                       // 원자적 교체 — 읽는 중인 요청이 깨진 파일을 받지 않도록
    res.status(existed ? 200 : 201).json({ success: true, path: target.rel, url: `${PREFIX}/${target.rel}`, overwritten: existed });
  });

router.delete('/files/*', requireUploader, requireVolume, (req, res) => {
  const target = resolveSafe(req.params[0]);
  if (target.error) return res.status(400).json({ success: false, error: target.error });
  if (!fs.existsSync(target.abs)) return res.status(404).json({ success: false, error: '볼륨에 해당 파일이 없습니다. (저장소 파일은 삭제할 수 없음)' });
  fs.unlinkSync(target.abs);
  res.json({ success: true, path: target.rel });
});

module.exports = router;

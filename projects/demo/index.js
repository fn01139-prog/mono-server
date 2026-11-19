/**
 * projects/demo/index.js — 웹데모 API (/demo/api)
 *
 * GET    /list           공개. 저장소 public/ + 볼륨의 데모 파일 목록
 * PUT    /files/<path>   x-api-key(DEMO_API_KEY). 요청 본문을 그대로 볼륨에 저장 (재기동 없이 즉시 게시)
 * DELETE /files/<path>   x-api-key(DEMO_API_KEY). 볼륨의 파일 삭제 (저장소 public/ 파일은 삭제 불가)
 *
 * config.public === true 라 loader 가드가 없으므로, 쓰기 라우트는 여기서 직접 API 키를 검사한다.
 * 업로드는 express.raw로 받는다 — app.js의 express.json()은 기본 100kb 제한이라 큰 HTML/이미지가
 * 막히지만, application/octet-stream 등 JSON이 아닌 본문은 그 파서를 거치지 않는다.
 */
'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { DEMO_DIR, DEMO_DIR_READY } = require('./paths');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_SIZE   = '10mb';
const ALLOWED_EXT = new Set(['.html', '.htm', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.txt', '.md']);

function requireApiKey(req, res, next) {
  const key = process.env.DEMO_API_KEY || '';
  if (!key || req.headers['x-api-key'] !== key)
    return res.status(401).json({ success: false, error: 'API 키가 필요합니다.' });
  next();
}

function requireVolume(req, res, next) {
  if (!DEMO_DIR_READY)
    return res.status(503).json({ success: false, error: `게시 디렉토리(${DEMO_DIR})를 사용할 수 없습니다.` });
  next();
}

/** 상대경로 검증: 영문/숫자/한글/-_. 로 된 세그먼트만, 상위 이동·숨김파일 금지, 허용 확장자만 */
function resolveSafe(rel) {
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.length > 200) return null;
  const segs = rel.split('/');
  if (segs.some(s => !s || s.startsWith('.') || !/^[\w\-.가-힣]+$/.test(s))) return null;
  if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) return null;
  const abs = path.resolve(DEMO_DIR, rel);
  if (!abs.startsWith(path.resolve(DEMO_DIR) + path.sep)) return null;
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

/* ── 목록 (공개) ── */
router.get('/list', (req, res) => {
  const map = new Map();
  walk(PUBLIC_DIR).forEach(f => map.set(f.path, { ...f, source: 'repo' }));
  if (DEMO_DIR_READY) walk(DEMO_DIR).forEach(f => map.set(f.path, { ...f, source: 'volume' })); // 볼륨 우선(서빙 순서와 동일)
  map.delete('index.html');
  const files = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  res.json({ success: true, files });
});

/* ── 업로드 (API 키) ── */
router.put('/files/*', requireApiKey, requireVolume,
  express.raw({ type: () => true, limit: MAX_SIZE }),
  (req, res) => {
    const target = resolveSafe(req.params[0]);
    if (!target) return res.status(400).json({ success: false, error: '허용되지 않는 경로 또는 확장자입니다.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      return res.status(400).json({ success: false, error: '본문이 비어 있습니다.' });
    const existed = fs.existsSync(target.abs);
    fs.mkdirSync(path.dirname(target.abs), { recursive: true });
    const tmp = `${target.abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, req.body);
    fs.renameSync(tmp, target.abs);                       // 원자적 교체 — 읽는 중인 요청이 깨진 파일을 받지 않도록
    res.status(existed ? 200 : 201).json({ success: true, path: target.rel, url: `/demo/${target.rel}`, overwritten: existed });
  });

/* ── 삭제 (API 키) ── */
router.delete('/files/*', requireApiKey, requireVolume, (req, res) => {
  const target = resolveSafe(req.params[0]);
  if (!target) return res.status(400).json({ success: false, error: '허용되지 않는 경로입니다.' });
  if (!fs.existsSync(target.abs)) return res.status(404).json({ success: false, error: '볼륨에 해당 파일이 없습니다. (저장소 파일은 삭제할 수 없음)' });
  fs.unlinkSync(target.abs);
  res.json({ success: true, path: target.rel });
});

module.exports = router;

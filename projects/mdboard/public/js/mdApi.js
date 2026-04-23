/**
 * mdApi.js
 * Express 라우터 — MD 파일을 텍스트로 반환하는 API 엔드포인트
 * 기존 Express 앱에 router를 마운트하거나 직접 app.use()로 등록하세요.
 *
 * 사용 예시 (app.js):
 *   const mdApi = require('./server/mdApi');
 *   app.use('/api', mdApi);
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();

// MD 파일이 저장된 루트 디렉토리 (환경변수 또는 기본값)
const MD_ROOT = process.env.MD_ROOT || path.join(__dirname, '../docs');

/**
 * GET /api/md?file=경로/파일명.md
 *
 * 쿼리 파라미터:
 *   file  — MD_ROOT 기준 상대 경로 (예: "guide/intro.md")
 *
 * 응답:
 *   200  { markdown: "# 제목\n..." }
 *   400  { error: "file 파라미터가 필요합니다." }
 *   403  { error: "접근이 허용되지 않는 경로입니다." }
 *   404  { error: "파일을 찾을 수 없습니다." }
 */
router.get('/md', (req, res) => {
  const { file } = req.query;

  if (!file) {
    return res.status(400).json({ error: 'file 파라미터가 필요합니다.' });
  }

  // 경로 탈출(path traversal) 방어
  const resolved = path.resolve(MD_ROOT, file);
  if (!resolved.startsWith(path.resolve(MD_ROOT))) {
    return res.status(403).json({ error: '접근이 허용되지 않는 경로입니다.' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

  const markdown = fs.readFileSync(resolved, 'utf-8');
  res.json({ markdown });
});

/**
 * GET /api/md-list
 * MD_ROOT 하위의 모든 .md 파일 목록 반환 (선택적으로 사용)
 *
 * 응답:
 *   200  { files: ["guide/intro.md", "api/reference.md", ...] }
 */
router.get('/md-list', (req, res) => {
  function walk(dir, base = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(entry => {
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) return walk(path.join(dir, entry.name), rel);
      if (entry.name.endsWith('.md')) return [rel.replace(/\\/g, '/')];
      return [];
    });
  }

  try {
    const files = walk(MD_ROOT);
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: 'MD 파일 목록을 읽는 중 오류가 발생했습니다.' });
  }
});

module.exports = router;

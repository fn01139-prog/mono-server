/**
 * projects/babylog/index.js
 * baby-log API 를 /babylog/api 에 마운트 (loader.js 가 자동으로 붙임)
 *
 * - 테이블은 같은 Postgres 의 `babylog` 스키마에 격리 (BABYLOG_DB_SCHEMA)
 * - 인증은 baby-log 자체 JWT. 플랫폼 JWT_SECRET 과 반드시 다른 BABYLOG_JWT_SECRET 사용
 *   (같은 키면 core/auth.js 의 attachUser 가 baby-log 토큰을 플랫폼 로그인으로 받아들일 수 있음)
 * - 설정이 빠지거나 초기화에 실패해도 mono-server 전체는 계속 돈다 (이 앱만 503)
 */
const express = require('express');
const state = require('./state');

let lib = null;
const problem = state.check();
if (problem) {
  state.disable(problem);
} else {
  process.env.BABYLOG_DB_SCHEMA = process.env.BABYLOG_DB_SCHEMA || 'babylog';
  // shared/db.js 와 같은 규칙: 운영에서는 SSL
  if (process.env.PGSSL === undefined && process.env.NODE_ENV === 'production') process.env.PGSSL = 'true';
  try {
    lib = require('./lib/server');
    lib.start()
      .then(() => console.log(`  👶 [babylog] 준비 완료 (스키마 ${process.env.BABYLOG_DB_SCHEMA}, AI 보정 ${lib.aiEnabled() ? '켜짐' : '꺼짐'})`))
      .catch((e) => state.disable('초기화 실패: ' + e.message));
  } catch (e) {
    lib = null;
    state.disable('로드 실패: ' + e.message);
  }
}

const router = express.Router();
router.use((req, res, next) => {
  if (state.disabled()) return res.status(503).json({ error: '아기 기록 서비스를 준비 중입니다' });
  next();
});
if (lib) router.use(lib.api);
module.exports = router;
module.exports.web = lib ? lib.web : null;

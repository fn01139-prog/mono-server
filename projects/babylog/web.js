/**
 * projects/babylog/web.js
 * baby-log 웹 화면(PWA, 앱 WebView 요약)을 /babylog 에 서빙.
 * loader.js 의 public/ 자동 서빙 대신 이 라우터를 쓰는 이유: baby-log 의 보안 헤더(CSP 등)와
 * /babylog → /babylog/ 리다이렉트(상대 경로 api/… 용)를 그대로 적용하기 위해.
 * app.js 에서 loader.mount() 보다 먼저 마운트한다.
 */
const express = require('express');
const api = require('./index');
const state = require('./state');

const router = express.Router();
router.use((req, res, next) => {
  if (state.disabled() || !api.web) return res.status(503).send('아기 기록 서비스를 준비 중입니다');
  next();
});
if (api.web) router.use(api.web);
module.exports = router;

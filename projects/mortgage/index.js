/**
 * projects/mortgage/index.js
 * 주택담보대출 상담 준비 — 순수 프론트엔드 SPA, API 없음
 * 케이스 데이터는 브라우저 localStorage에만 저장되며 서버로 전송되지 않는다.
 * /<prefix>/api/* 로 자동 마운트됩니다.
 */
const express = require('express');
const router  = express.Router();
const { asyncHandler, ok } = require('../../shared/utils');

router.get('/health', asyncHandler(async (req, res) => {
  ok(res, { status: 'ok', project: 'mortgage', time: new Date() });
}));

module.exports = router;

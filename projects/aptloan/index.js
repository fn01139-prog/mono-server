/**
 * projects/aptloan/index.js
 * 아파트 입주비용 · 대출 계산기 — 순수 프론트엔드 SPA, API 없음
 * /<prefix>/api/* 로 자동 마운트됩니다.
 */
const express = require('express');
const router  = express.Router();
const { asyncHandler, ok } = require('../../shared/utils');

router.get('/health', asyncHandler(async (req, res) => {
  ok(res, { status: 'ok', project: 'aptloan', time: new Date() });
}));

module.exports = router;

/**
 * projects/_template/index.js
 * 새 프로젝트 API 라우터 템플릿
 * /<prefix>/api/* 로 자동 마운트됩니다.
 */
const express = require('express');
const router  = express.Router();
const { asyncHandler, ok, fail } = require('../../shared/utils');

// 헬스체크 (필수 유지)
router.get('/health', asyncHandler(async (req, res) => {
  ok(res, { status: 'ok', project: 'template', time: new Date() });
}));

// 여기에 라우터 추가
// router.get('/items', asyncHandler(async (req, res) => { ... }));

module.exports = router;

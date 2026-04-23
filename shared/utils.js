/**
 * shared/utils.js
 * 모든 프로젝트에서 공통으로 사용하는 유틸리티
 */

/** 비동기 라우터 에러 자동 전파 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** 성공 응답 포맷 */
const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });

/** 실패 응답 포맷 */
const fail = (res, message, status = 400) =>
  res.status(status).json({ success: false, error: message });

module.exports = { asyncHandler, ok, fail };

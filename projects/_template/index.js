/**
 * projects/_template/index.js
 * 새 프로젝트 API 라우터 템플릿
 * /<prefix>/api/* 로 자동 마운트됩니다.
 *
 * 플랫폼 공용 기능(메일 발송/메신저 알림/배치잡)은 직접 구현하지 말고 재사용할 것.
 * 자세한 사용법은 루트 CLAUDE.md의 "플랫폼 공통 인프라" 섹션 참고.
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

/* ── 플랫폼 공용 기능 사용 예시 (필요할 때 주석 해제) ──────────────────────
 *
 * // 1) 메일 발송 — shared/mailer.js
 * const { sendMail } = require('../../shared/mailer');
 * await sendMail({
 *   to: 'user@example.com', subject: '제목', text: '본문',
 *   appPrefix: '/PREFIX_HERE', sentBy: req.user?.userId,
 * });
 *
 * // 2) 이 프로젝트의 메일 발송 이력을 자체 API로 노출하고 싶다면
 * const { mailLogRouter } = require('../../shared/mailer');
 * router.use(mailLogRouter('/PREFIX_HERE')); // GET <prefix>/api/mail-logs
 *
 * // 3) 메신저 알림(텔레그램/디스코드/ntfy/웹푸시) — shared/notify/
 * const notify = require('../../shared/notify');
 * await notify.registerCategory('PREFIX-my-event', '이벤트 설명', '/PREFIX_HERE'); // 앱 시작 시 1회, 멱등
 * await notify.send({ category: 'PREFIX-my-event', title: '제목', body: '본문' });  // 카테고리 구독자 전체에게
 *
 * // 4) 정기 배치잡이 필요하면 이 파일이 아니라 core/jobs/<name>.js 를 새로 만들 것
 * //    (core/batch.js가 core/jobs/*.js 를 자동 스캔해서 등록함)
 * ────────────────────────────────────────────────────────────────────── */

module.exports = router;

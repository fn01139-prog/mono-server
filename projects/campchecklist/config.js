module.exports = {
  enabled:     true,
  name:        'CampCheck',
  prefix:      '/campchecklist',
  description: '캠핑 짐 챙기기 체크리스트 — 참여자별 품목 관리 · 게시판 · Google Drive 동기화',
  icon:        '🏕️',
  // 인증은 플랫폼 로그인(core/auth.js)을 사용. admin 여부는 platform_accounts.role로 판단.
};
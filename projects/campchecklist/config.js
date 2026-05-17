module.exports = {
  enabled:     true,
  name:        'CampCheck',
  prefix:      '/campchecklist',
  description: '캠핑 짐 챙기기 체크리스트 — 참여자별 품목 관리 · 게시판 · Google Drive 동기화',
  icon:        '🏕️',

  // ── 관리자 로그인 ID (이 ID로 가입한 계정은 자동으로 admin 역할)
  // 환경변수 CAMP_ADMIN_ID 로도 지정 가능 (우선순위 높음)
  adminLoginId: process.env.CAMP_ADMIN_ID || 'admin',
};

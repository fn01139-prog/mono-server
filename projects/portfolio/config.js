// projects/portfolio/config.js
module.exports = {
  name:        '포트폴리오',
  prefix:      '/portfolio',
  description: '개인 포트폴리오 & 페이지 빌더',
  icon:        '🌐',
  enabled:     true,
  spa:         true,   // /:pageId → index.html SPA 라우팅
  customRoutes: [
    { path: '/studio', file: 'studio.html' },  // 관리자 페이지 (인증 필요)
  ],
};

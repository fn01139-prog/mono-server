// projects/portfolio/config.js
module.exports = {
  name:        '포트폴리오',
  prefix:      '/portfolio',
  description: '개인 포트폴리오 & 페이지 빌더',
  icon:        '🌐',
  enabled:     true,
  spa:         true,   // /:pageId → index.html SPA 라우팅
  customRoutes: [
    { path: '/studio', file: 'studio.html' },  // 관리자 페이지 (로그인 필요)
  ],
  // 공개 페이지 뷰어: 비로그인 GET만 허용 (studio.html은 loader.js가 항상 별도 차단).
  // 실제 노출 여부(status === 'published')는 /pages/:id 라우트 안에서 다시 검사한다.
  publicPaths: [
    '/pages/:id',   // API 마운트(/portfolio/api) 기준 상대경로
  ],
  publicStaticPaths: [
    '/',            // 정적/SPA 마운트(/portfolio) 기준 상대경로: index.html (SPA 셸)
    '/portfolio.html',
    '/css/*',
    '/js/*',
    '/*',           // SPA catch-all: /portfolio/:pageId
  ],
};

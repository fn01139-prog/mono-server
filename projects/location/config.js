// projects/location/config.js
module.exports = {
  name:        '위치 일정',
  prefix:      '/location',
  description: '시간별 위치 일정 등록 · 공유 링크(문자/카톡) 발송',
  icon:        '📍',
  enabled:     true,
  // 공유 페이지(/location/s/:token), x-api-key 등록 API, 원격 MCP(/location/mcp)는
  // 로그인 가드 밖에서 접근해야 하므로 app.js에서 loader.mount()보다 먼저 직접 마운트한다
  // (mdboard의 publish-routes.js와 동일 패턴) — 그래서 publicPaths는 필요 없다.
};

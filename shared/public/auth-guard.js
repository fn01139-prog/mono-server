/**
 * shared/public/auth-guard.js
 * 모든 앱 공통: API가 401을 반환하면 /login?next=<현재경로>로 리다이렉트.
 * 각 앱의 index.html 등 진입 HTML의 다른 스크립트보다 먼저 로드한다.
 */
(function () {
  if (window.__monoAuthGuardInstalled) return;
  window.__monoAuthGuardInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    return originalFetch(input, init).then((res) => {
      if (res.status === 401 && !location.pathname.startsWith('/login')) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login?next=${next}`;
      }
      return res;
    });
  };
})();

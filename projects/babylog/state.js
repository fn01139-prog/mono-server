// babylog 모듈 활성 상태 (index.js 와 web.js 가 공유)
let reason = null;

function check() {
  if (!process.env.DATABASE_URL) return 'DATABASE_URL 없음';
  const s = process.env.BABYLOG_JWT_SECRET;
  if (!s || s.length < 32) return 'BABYLOG_JWT_SECRET(32자 이상) 없음';
  if (s === process.env.JWT_SECRET) return 'BABYLOG_JWT_SECRET 이 플랫폼 JWT_SECRET 과 같음 — 다른 값을 쓰세요';
  return null;
}

function disable(why) {
  reason = why;
  console.error(`  ⛔ [babylog] 비활성: ${why}`);
}

module.exports = { check, disable, disabled: () => reason };

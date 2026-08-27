'use strict';
const crypto = require('crypto');

// ── mono-server 이식 시 변경점 ───────────────────────────────────────
// 관리자 판별은 더 이상 이 모듈이 하지 않는다. mono-server 플랫폼 로그인
// (core/auth.js)이 이미 모든 요청에 req.user(JWT 검증 결과: userId/loginId/
// name/role)를 채워주므로, isAdmin(req)는 req.user.role만 보면 된다.
// 자체 비밀번호 로그인/서명 토큰 발급 로직(원본의 login/logout)은 전부 제거했다
// — 로그인 자체는 플랫폼 공통 /login, /auth/login이 처리한다.
//
// 이 파일에 남은 건 "중분류별 열람/작성 코드" 잠금해제 상태를 서명된 쿠키에
// 담아두는 기능뿐이다. 이건 admin/일반사용자 구분과는 별개의 이중 게이트라
// (관리자든 일반 방문자든 중분류 코드를 따로 입력해야 함) 플랫폼 인증으로
// 대체할 수 없어 원본 방식(HMAC 서명 쿠키, 외부 의존성 없음)을 그대로 유지했다.

const TOKEN_SECRET = process.env.MEMO_TOKEN_SECRET;
if (!TOKEN_SECRET) {
  console.warn(
    '[memo] MEMO_TOKEN_SECRET 환경변수가 설정되지 않았습니다 — 매 배포/재시작마다 중분류 열람 코드 잠금해제 상태가 초기화됩니다.'
  );
}
const EFFECTIVE_SECRET = TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

const UNLOCK_COOKIE = 'memo_unlock';
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload, ttlMs) {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlMs });
  const payloadPart = b64url(body);
  const sig = crypto.createHmac('sha256', EFFECTIVE_SECRET).update(payloadPart).digest('base64url');
  return `${payloadPart}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadPart, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', EFFECTIVE_SECRET).update(payloadPart).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/memo',
    maxAge: maxAgeMs,
  };
}

// ---------- 관리자 판별 (플랫폼 로그인 위임) ----------

function isAdmin(req) {
  return req.user?.role === 'admin';
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  next();
}

// ---------- 중분류 코드 잠금해제 (서명 쿠키) ----------

function getUnlockedMids(req) {
  const payload = verify(req.cookies?.[UNLOCK_COOKIE]);
  return payload && Array.isArray(payload.mids) ? payload.mids : [];
}

function addUnlockedMid(req, res, midId) {
  const mids = new Set(getUnlockedMids(req));
  mids.add(midId);
  const token = sign({ mids: [...mids] }, UNLOCK_TTL_MS);
  res.cookie(UNLOCK_COOKIE, token, cookieOpts(UNLOCK_TTL_MS));
}

module.exports = {
  isAdmin,
  requireAdmin,
  getUnlockedMids,
  addUnlockedMid,
};

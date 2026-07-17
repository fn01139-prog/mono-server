/**
 * core/auth.js
 * 플랫폼 공통 JWT 인증 미들웨어
 */

const jwt  = require('jsonwebtoken');
const pool = require('../shared/db');

const JWT_SECRET  = process.env.JWT_SECRET || 'campcheck-dev-secret-change-in-prod';
const JWT_EXPIRES = '7d';
const COOKIE_NAME = 'mono_token';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'campcheck-dev-secret-change-in-prod') {
  console.warn('\n⚠️  [auth] JWT_SECRET이 기본값입니다. 프로덕션에서는 반드시 강한 값으로 교체하세요!\n');
}

function signToken(user) {
  return jwt.sign(
    { userId: user.userId, loginId: user.loginId, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  // 브라우저가 쿠키를 정확히 매칭해 지우려면 set 시점과 동일한 속성(sameSite/secure/path)이 필요하다.
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function getTokenFromReq(req) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return req.cookies?.[COOKIE_NAME] || null;
}

/** 모든 요청에서 JWT 파싱 → req.user 주입 (없거나 무효하면 req.user = null) */
function attachUser(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) { req.user = null; return next(); }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

function wantsJson(req) {
  // req.path는 마운트된 라우터 기준 상대경로라 '/auth', '/api/' 접두사 검사가 무력화된다
  // (예: app.use('/auth', router) 안에서는 req.path가 '/me'로 이미 잘려 있음).
  // req.originalUrl은 마운트 깊이와 무관하게 항상 전체 요청 경로를 유지하므로 이걸 기준으로 판단한다.
  return req.originalUrl.startsWith('/auth') ||
    req.originalUrl.includes('/api/') ||
    req.get('accept')?.includes('application/json') ||
    req.xhr;
}

/** 로그인 필요 — 미로그인 시 API는 401, HTML은 /login으로 리다이렉트 */
function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: '로그인이 필요합니다' });
  const next_ = encodeURIComponent(req.originalUrl);
  res.redirect(`/login?next=${next_}`);
}

/** 특정 앱에 대한 접근 권한 검사 (admin은 항상 통과, '*' 와일드카드 지원) */
function requireApp(prefix) {
  return async (req, res, next) => {
    if (!req.user) {
      if (wantsJson(req)) return res.status(401).json({ error: '로그인이 필요합니다' });
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (req.user.role === 'admin') return next();
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM platform_app_grants WHERE app_prefix = $1 AND user_id IN ($2, '*') LIMIT 1`,
        [prefix, req.user.userId]
      );
      if (rows.length) return next();
      if (wantsJson(req)) return res.status(403).json({ error: '이 앱에 대한 접근 권한이 없습니다' });
      res.status(403).send(forbiddenPage(prefix));
    } catch (e) {
      next(e);
    }
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      if (wantsJson(req)) return res.status(401).json({ error: '로그인이 필요합니다' });
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (req.user.role !== role) {
      if (wantsJson(req)) return res.status(403).json({ error: '권한이 없습니다' });
      return res.status(403).send(forbiddenPage(req.originalUrl));
    }
    next();
  };
}

function forbiddenPage(prefix) {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>접근 권한 없음</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; }
  h1 { color: #fff; font-size: 1.4rem; }
  p { color: #888; }
  a { color: #4a9eff; text-decoration: none; }
</style></head>
<body><div class="box">
  <h1>🔒 접근 권한이 없습니다</h1>
  <p><code>${prefix}</code> 앱에 대한 접근 권한이 없습니다. 관리자에게 권한을 요청하세요.</p>
  <p><a href="/">← 허브로 돌아가기</a></p>
</div></body></html>`;
}

/** 요청 경로가 config.publicPaths 패턴 중 하나와 일치하는지 검사 */
function matchesPublicPath(reqPath, patterns) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some(pattern => {
    // '*' → .*, ':param' → 세그먼트 매치
    const regexStr = '^' + pattern
      .split('/')
      .map(seg => {
        if (seg === '*') return '.*';
        if (seg.startsWith(':')) return '[^/]+';
        return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/') + '/?$';
    return new RegExp(regexStr).test(reqPath);
  });
}

module.exports = {
  signToken, setAuthCookie, clearAuthCookie,
  attachUser, requireLogin, requireApp, requireRole,
  matchesPublicPath,
  JWT_SECRET, COOKIE_NAME,
};

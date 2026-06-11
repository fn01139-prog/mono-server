const config = require('../config');

/**
 * 관리자 권한 검증 미들웨어
 * Authorization: Bearer <token>  또는  X-Admin-Token: <token>
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const tokenHeader = req.headers['x-admin-token'] || '';

  let token = tokenHeader;
  if (!token && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 필요합니다', code: 'NO_TOKEN' });
  }

  if (!config.adminTokens.includes(token)) {
    return res.status(403).json({ error: '권한이 없습니다', code: 'FORBIDDEN' });
  }

  req.isAdmin = true;
  next();
}

/**
 * 토큰 검증만 (응답은 호출자가 결정)
 */
function verifyToken(token) {
  return config.adminTokens.includes(token);
}

module.exports = { requireAdmin, verifyToken };

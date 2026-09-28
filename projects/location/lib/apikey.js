/**
 * projects/location/lib/apikey.js
 * x-api-key 진입점(publish-routes, mcp-routes) 공용 인증.
 * LOCATION_API_KEY 미설정이면 전부 거부한다(실수로 열려 있는 상태를 방지).
 *
 * 키 전달 방식: `Authorization: Bearer <key>` 또는 `x-api-key: <key>`.
 * 커넥터가 커스텀 헤더를 못 붙이는 경우를 위한 URL 쿼리(`?key=`)는
 * LOCATION_ALLOW_URL_KEY=1 일 때만 허용한다 — morgan 로그에 URL이 그대로 남으므로 기본 꺼짐.
 */
'use strict';

const crypto = require('crypto');

function digest(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

function extractKey(req) {
  const auth = req.headers['authorization'] || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']);
  if (process.env.LOCATION_ALLOW_URL_KEY === '1' && typeof req.query.key === 'string') return req.query.key;
  return '';
}

function requireApiKey(req, res, next) {
  const expected = process.env.LOCATION_API_KEY || '';
  if (!expected) return res.status(503).json({ success: false, error: 'LOCATION_API_KEY가 서버에 설정되어 있지 않습니다.' });
  const provided = extractKey(req);
  if (!provided || !crypto.timingSafeEqual(digest(provided), digest(expected))) {
    return res.status(401).json({ success: false, error: 'API 키가 필요합니다.' });
  }
  next();
}

/** 절대 URL 생성용 — PUBLIC_BASE_URL 우선, 없으면 요청 헤더에서 추정 (Railway 프록시 뒤) */
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

module.exports = { requireApiKey, baseUrl };

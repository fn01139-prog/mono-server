// JWT 인증: Access Token(짧게) + Refresh Token(길게, DB 저장·회전)
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const ACCESS_TTL = process.env.ACCESS_TTL || '1h';
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TTL_DAYS, 10) || 30;
const ISSUER = 'baby-log';

// BABYLOG_JWT_SECRET 우선: mono-server처럼 다른 앱과 한 프로세스에 있을 때 그쪽 JWT_SECRET과 섞이지 않게
let SECRET = process.env.BABYLOG_JWT_SECRET || process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BABYLOG_JWT_SECRET(또는 JWT_SECRET, 32자 이상)이 필요합니다.');
  }
  SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[경고] JWT_SECRET 미설정 → 임시 키 사용 (재시작하면 모든 로그인이 풀립니다)');
}

// ---------- 토큰 ----------
function signAccess(user) {
  return jwt.sign({ name: user.name }, SECRET, {
    subject: user.id, issuer: ISSUER, expiresIn: ACCESS_TTL, algorithm: 'HS256',
  });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function issueRefresh(client, userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, sha256(token), REFRESH_TTL_DAYS]
  );
  return token;
}

async function issueTokens(client, user) {
  return {
    accessToken: signAccess(user),
    refreshToken: await issueRefresh(client, user.id),
    user: { id: user.id, email: user.email, name: user.name },
  };
}

// ---------- 미들웨어 ----------
function requireAuth(req, res, next) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: '로그인이 필요합니다', code: 'NO_TOKEN' });
  try {
    const p = jwt.verify(m[1], SECRET, { algorithms: ['HS256'], issuer: ISSUER });
    req.user = { id: p.sub, name: p.name };
    next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    res.status(401).json({ error: expired ? '토큰 만료' : '유효하지 않은 토큰', code: expired ? 'TOKEN_EXPIRED' : 'BAD_TOKEN' });
  }
}

// ---------- 간단한 로그인 시도 제한 (메모리, 15분에 10회) ----------
const attempts = new Map();
function tooMany(key) {
  const now = Date.now(), win = 15 * 60 * 1000;
  const list = (attempts.get(key) || []).filter((t) => now - t < win);
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 10000) attempts.clear();
  return list.length > 10;
}

// ---------- 라우터 ----------
const router = express.Router();
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

function inviteCode() {
  // 헷갈리는 문자(0, O, 1, I) 제외
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => abc[b % abc.length]).join('');
}

router.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim().slice(0, 30);
    const code = String(req.body.inviteCode || '').trim().toUpperCase();
    if (!EMAIL_RX.test(email)) return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다' });
    if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상' });
    if (!name) return res.status(400).json({ error: '이름을 입력하세요' });
    if (tooMany('reg:' + req.ip)) return res.status(429).json({ error: '잠시 후 다시 시도하세요' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.tx(async (c) => {
      const dup = await c.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (dup.rowCount) return { error: '이미 가입된 이메일입니다', status: 409 };

      let familyId, role = 'owner';
      if (code) {
        const f = await c.query('SELECT id FROM families WHERE invite_code = $1', [code]);
        if (!f.rowCount) return { error: '초대 코드가 올바르지 않습니다', status: 400 };
        familyId = f.rows[0].id;
        role = 'member';
      }
      const u = await c.query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
        [email, hash, name]
      );
      const user = u.rows[0];
      if (!familyId) {
        const f = await c.query('INSERT INTO families (name, invite_code) VALUES ($1, $2) RETURNING id', [`${name}네 가족`, inviteCode()]);
        familyId = f.rows[0].id;
      }
      await c.query('INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)', [familyId, user.id, role]);
      return { tokens: await issueTokens(c, user) };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result.tokens);
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (tooMany('login:' + req.ip + ':' + email)) return res.status(429).json({ error: '잠시 후 다시 시도하세요' });

    const r = await db.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
    const user = r.rows[0];
    // 사용자 유무와 관계없이 bcrypt 비교를 수행해 응답 시간 차이를 줄임
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: '이메일 또는 비밀번호가 틀립니다' });

    const tokens = await db.tx((c) => issueTokens(c, user));
    res.json(tokens);
  } catch (err) { next(err); }
});

// Refresh Token 회전: 사용한 토큰은 폐기하고 새로 발급
router.post('/refresh', async (req, res, next) => {
  try {
    const token = String(req.body.refreshToken || '');
    if (!token) return res.status(400).json({ error: 'refreshToken 필요' });

    const result = await db.tx(async (c) => {
      const r = await c.query(
        `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.email, u.name
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
        [sha256(token)]
      );
      const row = r.rows[0];
      if (!row) return null;
      if (row.revoked_at) {
        // 이미 폐기된 토큰 재사용 = 탈취 의심 → 해당 사용자 토큰 전부 폐기
        await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
        return null;
      }
      if (new Date(row.expires_at) < new Date()) return null;
      await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
      return issueTokens(c, { id: row.user_id, email: row.email, name: row.name });
    });
    if (!result) return res.status(401).json({ error: '다시 로그인하세요', code: 'REFRESH_INVALID' });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = String(req.body.refreshToken || '');
    if (token) await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, requireAuth, inviteCode };

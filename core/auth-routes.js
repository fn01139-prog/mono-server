/**
 * core/auth-routes.js
 * /auth/* — 로그인/로그아웃/내정보 + admin 전용 사용자·권한 관리 API
 */

const express      = require('express');
const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const rateLimit    = require('express-rate-limit');
const pool         = require('../shared/db');
const loader       = require('./loader');
const {
  signToken, setAuthCookie, clearAuthCookie,
  attachUser, requireLogin, requireRole,
} = require('./auth');

const router = express.Router();
router.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' },
});

async function getUserApps(userId, role) {
  if (role === 'admin') return loader.getList().map(p => p.prefix);
  const { rows } = await pool.query(
    `SELECT app_prefix FROM platform_app_grants WHERE user_id IN ($1, '*')`,
    [userId]
  );
  return [...new Set(rows.map(r => r.app_prefix))];
}

/* ── 로그인 / 로그아웃 / 내 정보 ─────────────────────────────────────── */
router.post('/login', loginLimiter, async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId?.trim() || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM platform_accounts WHERE login_id = $1', [loginId.trim()]
    );
    const account = rows[0];
    const genericError = () => res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

    if (!account || !account.is_active) return genericError();
    if (!(await bcrypt.compare(password, account.pw_hash))) return genericError();

    const { rows: userRows } = await pool.query('SELECT * FROM platform_users WHERE id = $1', [account.user_id]);
    const user = userRows[0];
    if (!user) return genericError();

    await pool.query('UPDATE platform_accounts SET last_login_at = NOW() WHERE user_id = $1', [account.user_id]);

    const payload = { userId: user.id, loginId: account.login_id, name: user.name, role: account.role };
    const token = signToken(payload);
    setAuthCookie(res, token);
    res.json({ token, user: payload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', attachUser, requireLogin, async (req, res) => {
  try {
    const apps = await getUserApps(req.user.userId, req.user.role);
    res.json({ ...req.user, apps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── admin: 사용자 관리 ───────────────────────────────────────────────── */
router.use('/admin', attachUser, requireLogin, requireRole('admin'));

router.get('/admin/apps', (req, res) => {
  res.json(loader.getList());
});

router.get('/admin/users', async (req, res) => {
  try {
    const { rows: users } = await pool.query('SELECT * FROM platform_users ORDER BY created_at');
    const { rows: accounts } = await pool.query('SELECT * FROM platform_accounts');
    const { rows: grants } = await pool.query('SELECT * FROM platform_app_grants');

    const result = users.map(u => {
      const acc = accounts.find(a => a.user_id === u.id);
      const apps = grants.filter(g => g.user_id === u.id).map(g => g.app_prefix);
      return {
        userId: u.id, name: u.name, color: u.color, createdAt: u.created_at,
        loginId: acc?.login_id, role: acc?.role, isActive: acc?.is_active,
        lastLoginAt: acc?.last_login_at, apps,
      };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/users', async (req, res) => {
  const { name, loginId, password, apps } = req.body;
  if (!name?.trim() || !loginId?.trim() || !password?.trim()) {
    return res.status(400).json({ error: '이름, 아이디, 비밀번호를 모두 입력하세요' });
  }
  try {
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM platform_accounts WHERE login_id = $1', [loginId.trim()]
    );
    if (existing.length) return res.status(400).json({ error: '이미 사용 중인 아이디입니다' });

    const userId = crypto.randomUUID();
    await pool.query('INSERT INTO platform_users (id, name) VALUES ($1, $2)', [userId, name.trim()]);
    const pwHash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO platform_accounts (user_id, login_id, pw_hash, role) VALUES ($1, $2, $3, 'member')`,
      [userId, loginId.trim(), pwHash]
    );

    if (Array.isArray(apps)) {
      for (const prefix of apps) {
        await pool.query(
          `INSERT INTO platform_app_grants (user_id, app_prefix, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [userId, prefix, req.user.userId]
        );
      }
    }
    res.json({ ok: true, userId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/users/:id', async (req, res) => {
  const { name, password, isActive } = req.body;
  try {
    if (name) await pool.query('UPDATE platform_users SET name = $1 WHERE id = $2', [name, req.params.id]);
    if (password) {
      const pwHash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE platform_accounts SET pw_hash = $1 WHERE user_id = $2', [pwHash, req.params.id]);
    }
    if (typeof isActive === 'boolean') {
      await pool.query('UPDATE platform_accounts SET is_active = $1 WHERE user_id = $2', [isActive, req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/users/:id/apps', async (req, res) => {
  const { apps } = req.body;
  if (!Array.isArray(apps)) return res.status(400).json({ error: 'apps 배열이 필요합니다' });
  try {
    await pool.query('DELETE FROM platform_app_grants WHERE user_id = $1', [req.params.id]);
    for (const prefix of apps) {
      await pool.query(
        'INSERT INTO platform_app_grants (user_id, app_prefix, granted_by) VALUES ($1, $2, $3)',
        [req.params.id, prefix, req.user.userId]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM platform_users WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM platform_app_grants WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

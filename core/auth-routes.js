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
const batch        = require('./batch');
const mailer       = require('../shared/mailer');
const notify       = require('../shared/notify');
const notifyDb     = require('../shared/notify/db');
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

/** 이 계정을 제외하고 활성 admin이 0명이 되는지 검사 (마지막 admin 보호용) */
async function isLastActiveAdmin(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int c FROM platform_accounts WHERE role = 'admin' AND is_active AND user_id <> $1`,
    [userId]
  );
  return rows[0].c === 0;
}

router.put('/admin/users/:id', async (req, res) => {
  const { name, password, isActive } = req.body;
  try {
    if (isActive === false) {
      const { rows } = await pool.query('SELECT role FROM platform_accounts WHERE user_id = $1', [req.params.id]);
      if (rows[0]?.role === 'admin' && await isLastActiveAdmin(req.params.id)) {
        return res.status(400).json({ error: '마지막 admin 계정은 비활성화할 수 없습니다' });
      }
    }
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
    const { rows } = await pool.query('SELECT role FROM platform_accounts WHERE user_id = $1', [req.params.id]);
    if (rows[0]?.role === 'admin' && await isLastActiveAdmin(req.params.id)) {
      return res.status(400).json({ error: '마지막 admin 계정은 삭제할 수 없습니다' });
    }
    await pool.query('DELETE FROM platform_users WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM platform_app_grants WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── admin: 메일 발송 (shared/mailer.js) ──────────────────────────────── */
router.get('/admin/mail/config', async (req, res) => {
  try {
    res.json(await mailer.getConfigStatus());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/mail/logs', async (req, res) => {
  try {
    res.json(await mailer.getLogs({ limit: Number(req.query.limit) || 50 }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/mail/test', async (req, res) => {
  const { to } = req.body;
  if (!to?.trim()) return res.status(400).json({ error: '받는 사람 주소를 입력하세요' });
  try {
    await mailer.sendMail({
      to: to.trim(),
      subject: '[mono-server] 테스트 메일',
      text: `이 메일은 관리자(${req.user.name})가 admin 콘솔에서 보낸 테스트 메일입니다.\n발송 시각: ${new Date().toLocaleString('ko-KR')}`,
      appPrefix: 'admin',
      sentBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── admin: 배치잡 (core/batch.js) ────────────────────────────────────── */
router.get('/admin/batch/jobs', async (req, res) => {
  try {
    res.json(await batch.list());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/batch/jobs/:id', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled(boolean)이 필요합니다' });
  try {
    await batch.setEnabled(req.params.id, enabled);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/batch/jobs/:id/run', async (req, res) => {
  try {
    const summary = await batch.execute(req.params.id);
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/batch/logs', async (req, res) => {
  try {
    res.json(await batch.getLogs(req.query.jobId || null, Number(req.query.limit) || 50));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── admin: 로그인/권한 제어 시스템 점검 ─────────────────────────────────── */
router.get('/admin/system/check', async (req, res) => {
  try {
    const checks = [];

    const jwtOk = !!process.env.JWT_SECRET && process.env.JWT_SECRET !== 'campcheck-dev-secret-change-in-prod';
    checks.push({
      key: 'jwt_secret', label: 'JWT_SECRET 설정', ok: jwtOk,
      detail: jwtOk ? '커스텀 값으로 설정됨' : '기본값 사용 중 — 프로덕션에서는 반드시 교체 필요',
    });

    const { rows: adminRows } = await pool.query(
      `SELECT COUNT(*)::int c FROM platform_accounts WHERE role = 'admin' AND is_active`
    );
    checks.push({
      key: 'admin_count', label: '활성 admin 계정 수', ok: adminRows[0].c >= 1,
      detail: `${adminRows[0].c}명`,
    });

    const { rows: inactiveRows } = await pool.query(
      `SELECT COUNT(*)::int c FROM platform_accounts WHERE NOT is_active`
    );
    checks.push({
      key: 'inactive_count', label: '비활성 계정 수', ok: true,
      detail: `${inactiveRows[0].c}명`,
    });

    const { rows: wildcardRows } = await pool.query(
      `SELECT COUNT(*)::int c FROM platform_app_grants WHERE user_id = '*'`
    );
    checks.push({
      key: 'wildcard_grants', label: "전체공개('*') 앱 권한 수", ok: true,
      detail: `${wildcardRows[0].c}건`,
    });

    const { rows: noGrantRows } = await pool.query(`
      SELECT COUNT(*)::int c FROM platform_accounts a
      WHERE a.role = 'member' AND a.is_active
        AND NOT EXISTS (SELECT 1 FROM platform_app_grants g WHERE g.user_id IN (a.user_id, '*'))
    `);
    checks.push({
      key: 'no_grant_users', label: '앱 권한이 하나도 없는 활성 사용자', ok: noGrantRows[0].c === 0,
      detail: `${noGrantRows[0].c}명`,
    });

    const mailStatus = await mailer.getConfigStatus();
    checks.push({
      key: 'mail_configured', label: '메일 발송 설정 (Brevo API)', ok: mailStatus.configured,
      detail: mailStatus.apiKeySet ? 'BREVO_API_KEY 설정됨' : '미설정 (BREVO_API_KEY)',
    });
    checks.push({
      key: 'mail_from', label: '발신자 주소(SMTP_FROM) 설정', ok: mailStatus.fromExplicit,
      detail: mailStatus.fromExplicit
        ? `${mailStatus.from} (모든 프로젝트 공통)`
        : `미설정 — SMTP_USER(${mailStatus.from || '-'})로 폴백 중`,
    });

    checks.push({
      key: 'notify_telegram', label: '텔레그램 봇 토큰 설정', ok: !!process.env.TELEGRAM_BOT_TOKEN,
      detail: process.env.TELEGRAM_BOT_TOKEN ? '설정됨' : '미설정 (TELEGRAM_BOT_TOKEN) — 텔레그램 채널 발송 불가',
    });
    const vapidOk = !!(process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    checks.push({
      key: 'notify_webpush', label: '웹푸시 VAPID 키 설정', ok: vapidOk,
      detail: vapidOk ? '설정됨' : '미설정 (VAPID_*) — 웹푸시 채널 발송 불가',
    });
    const { rows: recipientRows } = await pool.query(`SELECT COUNT(*)::int c FROM notify_recipients WHERE is_active`);
    checks.push({
      key: 'notify_recipients', label: '알림 수신자 등록 수', ok: recipientRows[0].c > 0,
      detail: `${recipientRows[0].c}명`,
    });

    res.json({ checks, env: process.env.NODE_ENV || 'development' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── admin: 메신저 알림 (shared/notify/) ─────────────────────────────── */
router.get('/admin/notify/recipients', async (req, res) => {
  try {
    res.json(await notifyDb.listRecipients());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/notify/recipients', async (req, res) => {
  const { name, relation } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '이름을 입력하세요' });
  try {
    res.json(await notifyDb.createRecipient(name.trim(), relation));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/notify/recipients/:id', async (req, res) => {
  try {
    await notifyDb.updateRecipient(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/notify/recipients/:id', async (req, res) => {
  try {
    await notifyDb.deleteRecipient(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/notify/recipients/:id/channels', async (req, res) => {
  try {
    res.json(await notifyDb.listChannelsForRecipient(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/notify/recipients/:id/channels', async (req, res) => {
  const { type, ...config } = req.body;
  try {
    res.json(await notifyDb.addChannel(req.params.id, type, config));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/admin/notify/channels/:type/:id', async (req, res) => {
  try {
    await notifyDb.deleteChannel(req.params.type, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/admin/notify/categories', async (req, res) => {
  try {
    res.json(await notifyDb.listCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// VAPID public key는 브라우저의 pushManager.subscribe()에 넘겨야 해서 공개해도 안전함 (private key만 비밀)
router.get('/admin/notify/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.get('/admin/notify/recipients/:id/subscriptions', async (req, res) => {
  try {
    res.json(await notifyDb.listSubscriptionsForRecipient(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/notify/recipients/:id/subscriptions/:categoryId', async (req, res) => {
  const { channels, isActive } = req.body;
  if (!Array.isArray(channels)) return res.status(400).json({ error: 'channels 배열이 필요합니다' });
  try {
    res.json(await notifyDb.upsertSubscription(req.params.id, req.params.categoryId, channels, isActive !== false));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/notify/test', async (req, res) => {
  const { recipientId, channel, title, body } = req.body;
  if (!recipientId || !channel || !body?.trim()) {
    return res.status(400).json({ error: 'recipientId, channel, body가 필요합니다' });
  }
  try {
    await notify.sendTest({ recipientId, channel, title, body });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/notify/logs', async (req, res) => {
  try {
    res.json(await notify.getLog({ limit: Number(req.query.limit) || 50 }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

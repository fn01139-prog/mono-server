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
const { isValidP256PublicKey } = require('../shared/notify/channels/webpush');
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

/* ── 일반 사용자: 내 알림 설정 (본인 recipient만 조작 가능 — admin 권한 불필요) ──── */
router.use('/notify', attachUser, requireLogin);

async function myRecipient(req) {
  return notifyDb.getOrCreateRecipientForUser(req.user.userId, req.user.name);
}

router.get('/notify/me', async (req, res) => {
  try {
    const recipient = await myRecipient(req);
    const channels = await notifyDb.listChannelsForRecipient(recipient.id);
    const subscriptions = await notifyDb.listSubscriptionsForRecipient(recipient.id);
    res.json({ recipient, channels, subscriptions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/notify/categories', async (req, res) => {
  try {
    res.json(await notifyDb.listCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/notify/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/notify/channels', async (req, res) => {
  const { type, ...config } = req.body;
  try {
    const recipient = await myRecipient(req);
    res.json(await notifyDb.addChannel(recipient.id, type, config));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/notify/channels/:type/:id', async (req, res) => {
  try {
    const recipient = await myRecipient(req);
    const deleted = await notifyDb.deleteChannelIfOwned(req.params.type, req.params.id, recipient.id);
    if (!deleted) return res.status(404).json({ error: '채널을 찾을 수 없습니다' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/notify/subscriptions/:categoryId', async (req, res) => {
  const { channels, isActive } = req.body;
  if (!Array.isArray(channels)) return res.status(400).json({ error: 'channels 배열이 필요합니다' });
  try {
    const recipient = await myRecipient(req);
    res.json(await notifyDb.upsertSubscription(recipient.id, req.params.categoryId, channels, isActive !== false));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/notify/test', async (req, res) => {
  const { channel, title, body } = req.body;
  if (!channel || !body?.trim()) return res.status(400).json({ error: 'channel, body가 필요합니다' });
  try {
    const recipient = await myRecipient(req);
    const result = await notify.sendTest({ recipientId: recipient.id, channel, title, body });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/notify/logs', async (req, res) => {
  try {
    const recipient = await myRecipient(req);
    res.json(await notify.getLog({ recipientId: recipient.id, limit: Number(req.query.limit) || 50 }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 버그/개선요청 신고 (플랫폼 공통, 모든 프로젝트에서 Ctrl+H → shared/public/feedback-widget.js) ──
 * 등록: 로그인 사용자 누구나 자기 화면에서 신고 가능. 조회: 로그인 사용자 누구나 전체 목록을 볼 수 있음
 * (허브 페이지에 요청자·처리 현황을 공개해 우수 신고자 베네핏에 활용할 예정이므로 admin 전용이 아님).
 * 상태 변경은 관리자 콘솔(수동) 또는 /feedback/batch/*(x-api-key, Claude 배치 자동 처리) 둘 중 하나로만 가능.
 */
const FEEDBACK_CATEGORIES = new Set(['bug', 'improvement']);
const FEEDBACK_TYPES = new Set(['ui', 'error', 'feature']);
const FEEDBACK_SELECT = `
  SELECT f.*, u.name AS resolved_by_name
  FROM platform_feedback f
  LEFT JOIN platform_users u ON u.id = f.resolved_by
`;

router.post('/feedback', attachUser, requireLogin, async (req, res) => {
  const { appPrefix, category, type, content, pageUrl } = req.body;
  if (!FEEDBACK_CATEGORIES.has(category)) return res.status(400).json({ error: '분류가 올바르지 않습니다' });
  if (!FEEDBACK_TYPES.has(type)) return res.status(400).json({ error: '종류가 올바르지 않습니다' });
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO platform_feedback (app_prefix, category, type, content, page_url, requester_id, requester_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [appPrefix?.trim() || '-', category, type, content.trim(), pageUrl || null, req.user.userId, req.user.name]
    );
    res.json({ ok: true, feedback: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/feedback', attachUser, requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${FEEDBACK_SELECT} ORDER BY f.created_at DESC LIMIT $1`,
      [Math.min(Number(req.query.limit) || 200, 500)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Claude 배치 처리용 (x-api-key 전용, 로그인 불필요 — mdboard /publish와 동일 패턴) ── */
function requireFeedbackApiKey(req, res, next) {
  const apiKey = process.env.FEEDBACK_API_KEY || '';
  if (!apiKey || req.headers['x-api-key'] !== apiKey) {
    return res.status(401).json({ error: 'API 키가 필요합니다' });
  }
  next();
}

// GET /feedback/batch/pending — 처리 대기 중인 개선 리스트 (Claude 배치가 소비)
router.get('/feedback/batch/pending', requireFeedbackApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${FEEDBACK_SELECT} WHERE f.status = 'pending' ORDER BY f.created_at ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /feedback/batch/:id  { status, resolutionNote?, resolvedBy? } — 처리 완료 시 상태값 업데이트
router.put('/feedback/batch/:id', requireFeedbackApiKey, async (req, res) => {
  const { status, resolutionNote, resolvedBy } = req.body;
  if (!['pending', 'done'].includes(status)) {
    return res.status(400).json({ error: 'status는 pending 또는 done 이어야 합니다' });
  }
  const isDone = status === 'done';
  try {
    const { rows } = await pool.query(
      `UPDATE platform_feedback
         SET status = $1,
             resolution_note = COALESCE($2, resolution_note),
             resolved_by = $3,
             resolved_at = $4
       WHERE id = $5 RETURNING *`,
      [status, resolutionNote ?? null, isDone ? (resolvedBy || 'claude-batch') : null, isDone ? new Date() : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
    res.json({ ok: true, feedback: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

/* ── admin: 버그/개선요청 신고 관리 (관리자 콘솔 통합 모니터링 탭) ──────────── */
router.put('/admin/feedback/:id', async (req, res) => {
  const { status, resolutionNote, category, type } = req.body;
  if (status !== undefined && !['pending', 'done'].includes(status)) {
    return res.status(400).json({ error: 'status가 올바르지 않습니다' });
  }
  if (category !== undefined && !FEEDBACK_CATEGORIES.has(category)) {
    return res.status(400).json({ error: '분류가 올바르지 않습니다' });
  }
  if (type !== undefined && !FEEDBACK_TYPES.has(type)) {
    return res.status(400).json({ error: '종류가 올바르지 않습니다' });
  }
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM platform_feedback WHERE id = $1', [req.params.id]);
    if (!existingRows.length) return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
    const cur = existingRows[0];
    const nextStatus = status !== undefined ? status : cur.status;
    const { rows } = await pool.query(
      `UPDATE platform_feedback
         SET status = $1, resolution_note = $2, category = $3, type = $4,
             resolved_by = $5, resolved_at = $6
       WHERE id = $7 RETURNING *`,
      [
        nextStatus,
        resolutionNote !== undefined ? resolutionNote : cur.resolution_note,
        category || cur.category,
        type || cur.type,
        nextStatus === 'done' ? req.user.userId : null,
        nextStatus === 'done' ? (cur.status === 'done' ? cur.resolved_at : new Date()) : null,
        req.params.id,
      ]
    );
    res.json({ ok: true, feedback: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/feedback/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM platform_feedback WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
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
    const vapidPresent = !!(process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    const vapidKeyValid = vapidPresent && isValidP256PublicKey(process.env.VAPID_PUBLIC_KEY);
    checks.push({
      key: 'notify_webpush', label: '웹푸시 VAPID 키 설정', ok: vapidPresent && vapidKeyValid,
      detail: !vapidPresent
        ? '미설정 (VAPID_*) — 웹푸시 채널 발송 불가'
        : vapidKeyValid
          ? '설정됨'
          : 'VAPID_PUBLIC_KEY가 유효한 P-256 공개키가 아님 — 복사 과정에서 손상되었을 수 있음, 재발급 필요',
    });
    const { rows: recipientRows } = await pool.query(`SELECT COUNT(*)::int c FROM notify_recipients WHERE is_active`);
    checks.push({
      key: 'notify_recipients', label: '알림 수신자 등록 수', ok: recipientRows[0].c > 0,
      detail: `${recipientRows[0].c}명`,
    });

    checks.push({
      key: 'feedback_api_key', label: '버그/개선요청 배치 API 키 (FEEDBACK_API_KEY)', ok: !!process.env.FEEDBACK_API_KEY,
      detail: process.env.FEEDBACK_API_KEY ? '설정됨 — Claude 배치가 /auth/feedback/batch/* 호출 가능' : '미설정 — 배치 처리 API 접근 불가',
    });
    const { rows: pendingFeedbackRows } = await pool.query(`SELECT COUNT(*)::int c FROM platform_feedback WHERE status = 'pending'`);
    checks.push({
      key: 'feedback_pending', label: '처리 대기 중인 버그/개선요청', ok: true,
      detail: `${pendingFeedbackRows[0].c}건`,
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
    const result = await notify.sendTest({ recipientId, channel, title, body });
    res.json({ ok: true, ...result });
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

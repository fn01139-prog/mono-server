const express = require('express');
const path = require('path');
const db = require('./db');
const { router: authRouter, requireAuth, inviteCode } = require('./auth');
const { computeSummary, dayStartUtc, localDate } = require('./summary');
const { nextDue } = require('./reminders');
const { runOnce, start: startReminders, sendPush } = require('./notifier');
const { parseWithAI, aiEnabled } = require('./ai-parse');
const { scoreRecord, curves, ageDays } = require('./growth');
const { buildSchedule, isKnown } = require('./health-schedule');
const { matchMedicine, doseStatus, nightInfo, dutyFor, ingredientOf, computePatterns } = require('./extras');

// 이 파일은 두 가지로 쓰인다.
//  1) 단독 실행: `node server.js` → 아래 맨 끝에서 Express 앱을 만들어 / 에 마운트
//  2) mono-server 모듈: require 해서 { web, api, start } 를 원하는 경로(/babylog, /babylog/api)에 마운트
// 웹 화면은 상대 경로(api/…)로 호출하므로 어느 경로에 붙여도 동작한다.

const securityHeaders = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
  });
  next();
};

// 웹(PWA) 정적 파일
const web = express.Router();
web.use(securityHeaders);
web.get('/', (req, res, next) => {
  // /babylog → /babylog/ (상대 경로 api/… 가 올바르게 풀리도록)
  if (req.originalUrl.split('?')[0].endsWith('/')) return next();
  res.redirect(301, req.originalUrl.replace(/^([^?]*)/, '$1/'));
});
web.use(express.static(path.join(__dirname, 'public')));

// API — /api 아래에 마운트
const apiRoot = express.Router();
apiRoot.use(express.json({ limit: '200kb' }));
apiRoot.use(securityHeaders);
apiRoot.use('/auth', authRouter);

// 이하 모든 api 는 로그인 필요
const api = express.Router();
api.use(requireAuth);
apiRoot.use(api);

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['feeding', 'diaper', 'sleep', 'medicine', 'bath', 'etc']);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- 권한 헬퍼 ----------
async function memberRole(userId, familyId) {
  const r = await db.query('SELECT role FROM family_members WHERE user_id = $1 AND family_id = $2', [userId, familyId]);
  return r.rows[0]?.role || null;
}

/** 사용자가 접근 가능한 아기 id 집합 (요청한 id 중) */
async function accessibleBabies(userId, babyIds) {
  if (!babyIds.length) return new Set();
  const r = await db.query(
    `SELECT b.id FROM babies b JOIN family_members m ON m.family_id = b.family_id
     WHERE m.user_id = $1 AND b.id = ANY($2::uuid[])`,
    [userId, babyIds]
  );
  return new Set(r.rows.map((x) => x.id));
}

async function babyIfAllowed(userId, babyId) {
  if (!UUID_RX.test(babyId)) return null;
  const r = await db.query(
    `SELECT b.*, m.role FROM babies b JOIN family_members m ON m.family_id = b.family_id
     WHERE m.user_id = $1 AND b.id = $2`,
    [userId, babyId]
  );
  return r.rows[0] || null;
}

// ---------- 내 정보 ----------
api.get('/me', wrap(async (req, res) => {
  const [u, fam, babies] = await Promise.all([
    db.query('SELECT id, email, name FROM users WHERE id = $1', [req.user.id]),
    db.query(
      `SELECT f.id, f.name, f.invite_code, m.role,
              (SELECT count(*)::int FROM family_members x WHERE x.family_id = f.id) AS member_count
       FROM families f JOIN family_members m ON m.family_id = f.id
       WHERE m.user_id = $1 ORDER BY m.joined_at`, [req.user.id]),
    db.query(
      `SELECT b.id, b.family_id, b.name, to_char(b.birth_date, 'YYYY-MM-DD') AS birth_date, b.sex
       FROM babies b JOIN family_members m ON m.family_id = b.family_id
       WHERE m.user_id = $1 ORDER BY b.birth_date NULLS LAST, b.created_at`, [req.user.id]),
  ]);
  if (!u.rowCount) return res.status(401).json({ error: '사용자 없음', code: 'BAD_TOKEN' });
  res.json({ user: u.rows[0], families: fam.rows, babies: babies.rows });
}));

// ---------- 가족 ----------
api.post('/families/join', wrap(async (req, res) => {
  const code = String(req.body.inviteCode || '').trim().toUpperCase();
  const f = await db.query('SELECT id, name FROM families WHERE invite_code = $1', [code]);
  if (!f.rowCount) return res.status(404).json({ error: '초대 코드가 올바르지 않습니다' });
  await db.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`, [f.rows[0].id, req.user.id]);
  res.json({ family: f.rows[0] });
}));

api.post('/families/:id/invite/rotate', wrap(async (req, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(404).json({ error: '없음' });
  if ((await memberRole(req.user.id, req.params.id)) !== 'owner') return res.status(403).json({ error: '가족 대표만 가능합니다' });
  const r = await db.query('UPDATE families SET invite_code = $1 WHERE id = $2 RETURNING invite_code', [inviteCode(), req.params.id]);
  res.json(r.rows[0]);
}));

// ---------- 아기 ----------
function babyFields(body) {
  const name = body.name != null ? String(body.name).trim().slice(0, 20) : undefined;
  const birth = body.birth_date ? String(body.birth_date) : body.birth_date === null ? null : undefined;
  const sex = body.sex === 'M' || body.sex === 'F' ? body.sex : body.sex === null || body.sex === '' ? null : undefined;
  if (name === '') return { error: '이름을 입력하세요' };
  if (birth && (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || isNaN(new Date(birth)))) return { error: '생일 형식은 YYYY-MM-DD' };
  return { name, birth, sex };
}

api.post('/babies', wrap(async (req, res) => {
  let familyId = req.body.family_id;
  if (!familyId) {
    const r = await db.query('SELECT family_id FROM family_members WHERE user_id = $1 ORDER BY joined_at LIMIT 1', [req.user.id]);
    familyId = r.rows[0]?.family_id;
  }
  if (!familyId || !UUID_RX.test(familyId) || !(await memberRole(req.user.id, familyId))) return res.status(403).json({ error: '가족 권한이 없습니다' });
  const f = babyFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  if (!f.name) return res.status(400).json({ error: '이름을 입력하세요' });
  try {
    const r = await db.query(
      `INSERT INTO babies (family_id, name, birth_date, sex) VALUES ($1, $2, $3, $4)
       RETURNING id, family_id, name, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, sex`,
      [familyId, f.name, f.birth ?? null, f.sex ?? null]);
    await db.query('INSERT INTO reminder_settings (baby_id) VALUES ($1) ON CONFLICT DO NOTHING', [r.rows[0].id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '같은 이름의 아기가 이미 있습니다' });
    throw err;
  }
}));

api.patch('/babies/:id', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const f = babyFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  const r = await db.query(
    `UPDATE babies SET name = COALESCE($2, name),
       birth_date = CASE WHEN $3::boolean THEN $4::date ELSE birth_date END,
       sex = CASE WHEN $5::boolean THEN $6 ELSE sex END
     WHERE id = $1 RETURNING id, family_id, name, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, sex`,
    [baby.id, f.name ?? null, f.birth !== undefined, f.birth ?? null, f.sex !== undefined, f.sex ?? null]);
  res.json(r.rows[0]);
}));

api.delete('/babies/:id', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  if (baby.role !== 'owner') return res.status(403).json({ error: '가족 대표만 삭제할 수 있습니다' });
  await db.query('DELETE FROM babies WHERE id = $1', [baby.id]); // 기록도 함께 삭제됨
  res.json({ deleted: 1 });
}));

// ---------- 이벤트 ----------
function sanitize(e) {
  if (!e || typeof e !== 'object') return 'event 형식 오류';
  if (typeof e.id !== 'string' || !e.id || e.id.length > 64) return 'id 누락';
  if (typeof e.baby_id !== 'string' || !UUID_RX.test(e.baby_id)) return 'baby_id 누락';
  if (!TYPES.has(e.type)) return `알 수 없는 type: ${e.type}`;
  const t = new Date(e.time);
  if (isNaN(t)) return 'time 형식 오류';
  if (e.amount != null && (typeof e.amount !== 'number' || !isFinite(e.amount) || e.amount < 0 || e.amount > 10000)) return 'amount 범위 오류';
  const detail = e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail) ? e.detail : {};
  if (JSON.stringify(detail).length > 2000) return 'detail 너무 큼';
  return {
    id: e.id, baby_id: e.baby_id.toLowerCase(), type: e.type, time: t.toISOString(),
    amount: e.amount ?? null,
    unit: typeof e.unit === 'string' ? e.unit.slice(0, 10) : null,
    detail,
    raw_text: typeof e.raw_text === 'string' ? e.raw_text.slice(0, 500) : null,
    approx_time: !!e.approx_time,
  };
}

const EVENT_COLS = `e.id, e.baby_id, e.type, e.time, e.amount::float AS amount, e.unit, e.detail,
  e.raw_text, e.approx_time, e.created_at, u.name AS recorded_by_name`;

api.post('/events', wrap(async (req, res) => {
  const list = Array.isArray(req.body.events) ? req.body.events : [];
  if (!list.length || list.length > 50) return res.status(400).json({ error: 'events 는 1~50건' });
  const clean = [];
  for (const e of list) {
    const r = sanitize(e);
    if (typeof r === 'string') return res.status(400).json({ error: r, id: e?.id });
    clean.push(r);
  }
  const allowed = await accessibleBabies(req.user.id, [...new Set(clean.map((e) => e.baby_id))]);
  const denied = clean.find((e) => !allowed.has(e.baby_id));
  if (denied) return res.status(403).json({ error: '이 아기에 기록할 권한이 없습니다', id: denied.id });

  const saved = await db.tx(async (c) => {
    let n = 0;
    for (const e of clean) {
      const r = await c.query(
        `INSERT INTO events (id, baby_id, type, time, amount, unit, detail, raw_text, approx_time, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.baby_id, e.type, e.time, e.amount, e.unit, e.detail, e.raw_text, e.approx_time, req.user.id]);
      n += r.rowCount;
    }
    return n;
  });
  res.status(201).json({ saved, received: clean.length });
}));

api.get('/babies/:id/events', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const params = [baby.id, limit];
  let where = 'e.baby_id = $1';
  if (req.query.since && !isNaN(new Date(req.query.since))) { params.push(new Date(req.query.since).toISOString()); where += ` AND e.time >= $${params.length}`; }
  if (TYPES.has(req.query.type)) { params.push(req.query.type); where += ` AND e.type = $${params.length}`; }
  const r = await db.query(
    `SELECT ${EVENT_COLS} FROM events e LEFT JOIN users u ON u.id = e.recorded_by
     WHERE ${where} ORDER BY e.time DESC LIMIT $2`, params);
  res.json({ baby: { id: baby.id, name: baby.name }, events: r.rows });
}));

// ---------- 하루 요약 ----------
// GET /api/babies/:id/summary?date=YYYY-MM-DD&tz=540  (tz: UTC 기준 분, 한국 540)
api.get('/babies/:id/summary', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const tzMin = Number.isFinite(+req.query.tz) && Math.abs(+req.query.tz) <= 840 ? +req.query.tz : 540;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localDate(Date.now(), tzMin);
  const from = dayStartUtc(date, tzMin);
  if (isNaN(from)) return res.status(400).json({ error: 'date 형식 오류' });

  // 7일 추이 + 자정을 넘는 수면 계산을 위해 앞뒤 여유를 두고 조회
  const r = await db.query(
    `SELECT e.id, e.type, e.time, e.amount::float AS amount, e.unit, e.detail, e.raw_text, e.approx_time, u.name AS recorded_by_name
     FROM events e LEFT JOIN users u ON u.id = e.recorded_by
     WHERE e.baby_id = $1 AND e.time >= $2 AND e.time < $3 ORDER BY e.time`,
    [baby.id, new Date(from - 8 * 86400000).toISOString(), new Date(from + 2 * 86400000).toISOString()]);

  const summary = computeSummary(r.rows, { date, tzMin });
  const birth = baby.birth_date ? new Date(baby.birth_date) : null;
  res.json({
    baby: {
      id: baby.id, name: baby.name,
      birth_date: birth ? localDate(birth.getTime(), tzMin) : null,
      age_days: birth ? Math.floor((from - dayStartUtc(localDate(birth.getTime(), tzMin), tzMin)) / 86400000) + 1 : null,
    },
    ...summary,
  });
}));

// ---------- 성장 기록 ----------
const GROWTH_RANGE = { weight_kg: [0.3, 60], height_cm: [25, 150], head_cm: [18, 60] };
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

async function babyMeta(id) {
  const r = await db.query(`SELECT name, sex, to_char(birth_date, 'YYYY-MM-DD') AS birth, vaccine_prefs FROM babies WHERE id = $1`, [id]);
  return r.rows[0];
}

api.get('/babies/:id/growth', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const meta = await babyMeta(baby.id);
  const r = await db.query(
    `SELECT g.id, to_char(g.measured_on, 'YYYY-MM-DD') AS measured_on, g.weight_kg::float AS weight_kg, g.height_cm::float AS height_cm,
            g.head_cm::float AS head_cm, g.note, u.name AS recorded_by_name
     FROM growth_records g LEFT JOIN users u ON u.id = g.recorded_by WHERE g.baby_id = $1 ORDER BY g.measured_on, g.created_at`, [baby.id]);
  const records = r.rows.map((x) => ({ ...x, scores: scoreRecord(x, meta.birth, meta.sex) }));
  const today = localDate(Date.now(), 540);
  const ageNow = meta.birth ? ageDays(meta.birth, today) : null;
  const maxDay = Math.max(ageNow ?? 0, ...records.map((x) => x.scores.age_days ?? 0)) + 60;
  res.json({
    baby: { name: meta.name, sex: meta.sex, birth_date: meta.birth, age_days: ageNow },
    records,
    curves: meta.birth ? curves(meta.sex, Math.max(maxDay, 180)) : null,
    missing: !meta.birth ? 'birth_date' : !meta.sex ? 'sex' : null,
    source: { title: 'WHO Child Growth Standards', url: 'https://www.who.int/tools/child-growth-standards' },
  });
}));

api.post('/babies/:id/growth', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const b = req.body || {};
  const on = DATE_RX.test(b.measured_on || '') ? b.measured_on : localDate(Date.now(), 540);
  const vals = {};
  for (const [k, [lo, hi]] of Object.entries(GROWTH_RANGE)) {
    if (b[k] == null || b[k] === '') continue;
    const v = Number(b[k]);
    if (!isFinite(v) || v < lo || v > hi) return res.status(400).json({ error: `${k}는 ${lo}~${hi} 사이로 입력하세요` });
    vals[k] = v;
  }
  if (!Object.keys(vals).length) return res.status(400).json({ error: '몸무게·키·머리둘레 중 하나는 입력하세요' });
  const r = await db.query(
    `INSERT INTO growth_records (baby_id, measured_on, weight_kg, height_cm, head_cm, note, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [baby.id, on, vals.weight_kg ?? null, vals.height_cm ?? null, vals.head_cm ?? null, b.note ? String(b.note).slice(0, 200) : null, req.user.id]);
  res.status(201).json({ id: r.rows[0].id });
}));

api.delete('/growth/:id', wrap(async (req, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(404).json({ error: '없음' });
  const r = await db.query(
    `DELETE FROM growth_records g USING babies b, family_members m
     WHERE g.id = $1 AND b.id = g.baby_id AND m.family_id = b.family_id AND m.user_id = $2`, [req.params.id, req.user.id]);
  res.status(r.rowCount ? 200 : 404).json({ deleted: r.rowCount });
}));

// ---------- 예방접종 · 건강검진 ----------
async function healthPayload(babyId) {
  const meta = await babyMeta(babyId);
  if (!meta.birth) return { missing: 'birth_date' };
  const rec = await db.query(`SELECT kind, code, dose, to_char(done_on, 'YYYY-MM-DD') AS done_on, place FROM health_records WHERE baby_id = $1`, [babyId]);
  return { baby: { name: meta.name, sex: meta.sex, birth_date: meta.birth },
    ...buildSchedule({ birth: meta.birth, sex: meta.sex, prefs: meta.vaccine_prefs, records: rec.rows, today: localDate(Date.now(), 540) }) };
}

api.get('/babies/:id/health', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  res.json(await healthPayload(baby.id));
}));

// 완료 표시/취소 (여러 건 한 번에): {items:[{kind, code, dose, done, done_on?, place?}]}
api.post('/babies/:id/health', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 80) : [];
  if (!items.length) return res.status(400).json({ error: 'items 필요' });
  for (const it of items) {
    if (!isKnown(it.kind, it.code, it.dose)) return res.status(400).json({ error: `알 수 없는 항목: ${it.kind} ${it.code} ${it.dose}` });
    if (it.done !== false && it.done_on && !DATE_RX.test(it.done_on)) return res.status(400).json({ error: 'done_on 형식 오류' });
  }
  const today = localDate(Date.now(), 540);
  await db.tx(async (c) => {
    for (const it of items) {
      if (it.done === false) await c.query('DELETE FROM health_records WHERE baby_id = $1 AND kind = $2 AND code = $3 AND dose = $4', [baby.id, it.kind, it.code, it.dose]);
      else await c.query(
        `INSERT INTO health_records (baby_id, kind, code, dose, done_on, place, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (baby_id, kind, code, dose) DO UPDATE SET done_on = EXCLUDED.done_on, place = EXCLUDED.place`,
        [baby.id, it.kind, it.code, it.dose, it.done_on || today, it.place ? String(it.place).slice(0, 60) : null, req.user.id]);
    }
  });
  res.json(await healthPayload(baby.id));
}));

api.put('/babies/:id/vaccine-prefs', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const p = {};
  if (['RV1', 'RV5'].includes(req.body?.RV)) p.RV = req.body.RV;
  if (['IJEV', 'LJEV'].includes(req.body?.JE)) p.JE = req.body.JE;
  await db.query('UPDATE babies SET vaccine_prefs = vaccine_prefs || $2::jsonb WHERE id = $1', [baby.id, JSON.stringify(p)]);
  res.json(await healthPayload(baby.id));
}));

// ---------- 투약 ----------
const MED_UNITS = ['ml', 'mg', '포', '정', '방울'];
function medFields(b, creating) {
  const out = {};
  if ('name' in b || creating) {
    const name = String(b.name || '').trim().slice(0, 30);
    if (!name) return { error: '약 이름을 입력하세요' };
    out.name = name;
  }
  if ('aliases' in b) out.aliases = (Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split(','))
    .map((x) => String(x).trim().slice(0, 20)).filter(Boolean).slice(0, 5);
  if ('min_interval_min' in b || creating) {
    if (!Number.isInteger(b.min_interval_min) || b.min_interval_min < 30 || b.min_interval_min > 1440) return { error: '투약 간격은 약 라벨·처방에 적힌 대로 30분~24시간 사이로 입력하세요' };
    out.min_interval_min = b.min_interval_min;
  }
  if ('max_per_day' in b) {
    if (b.max_per_day != null && (!Number.isInteger(b.max_per_day) || b.max_per_day < 1 || b.max_per_day > 12)) return { error: '하루 최대 횟수는 1~12' };
    out.max_per_day = b.max_per_day ?? null;
  }
  if ('dose_amount' in b) {
    if (b.dose_amount != null && (typeof b.dose_amount !== 'number' || b.dose_amount <= 0 || b.dose_amount > 1000)) return { error: '1회 양 오류' };
    out.dose_amount = b.dose_amount ?? null;
  }
  if ('dose_unit' in b) out.dose_unit = MED_UNITS.includes(b.dose_unit) ? b.dose_unit : null;
  if ('remind' in b) out.remind = !!b.remind;
  if ('note' in b) out.note = b.note ? String(b.note).slice(0, 200) : null;
  return out;
}

async function medicineIfAllowed(userId, id) {
  if (!UUID_RX.test(id)) return null;
  const r = await db.query(
    `SELECT md.* FROM medicines md JOIN babies b ON b.id = md.baby_id JOIN family_members m ON m.family_id = b.family_id
     WHERE md.id = $1 AND m.user_id = $2`, [id, userId]);
  return r.rows[0] || null;
}

const MED_COLS = 'id, name, aliases, min_interval_min, max_per_day, dose_amount::float AS dose_amount, dose_unit, remind, note';
async function medicinePayload(babyId, now = Date.now()) {
  const meds = (await db.query(`SELECT ${MED_COLS} FROM medicines WHERE baby_id = $1 AND active ORDER BY created_at`, [babyId])).rows;
  const doses = (await db.query(
    `SELECT e.id, e.time, e.amount::float AS amount, e.unit, e.detail, u.name AS recorded_by_name FROM events e LEFT JOIN users u ON u.id = e.recorded_by
     WHERE e.baby_id = $1 AND e.type = 'medicine' AND e.time > to_timestamp($2 / 1000.0) - interval '3 days' AND e.time <= to_timestamp($2 / 1000.0) + interval '10 minutes'
     ORDER BY e.time DESC`, [babyId, now])).rows;
  const byMed = {}, recent = [];
  for (const d of doses) {
    const m = matchMedicine(d, meds);
    if (m) (byMed[m.id] ||= []).push({ id: d.id, t: new Date(d.time).getTime() });
    recent.push({ ...d, medicine_id: m?.id || null, medicine_name: m?.name || d.detail?.name || null });
  }
  return {
    medicines: meds.map((m) => ({ ...m, status: doseStatus(m, byMed[m.id] || [], now) })),
    recent: recent.filter((d) => new Date(d.time).getTime() > now - 48 * 3600000),
  };
}

api.get('/babies/:id/medicines', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  res.json(await medicinePayload(baby.id));
}));

api.post('/babies/:id/medicines', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const f = medFields(req.body || {}, true);
  if (f.error) return res.status(400).json({ error: f.error });
  try {
    await db.query(
      `INSERT INTO medicines (baby_id, name, aliases, min_interval_min, max_per_day, dose_amount, dose_unit, remind, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [baby.id, f.name, f.aliases || [], f.min_interval_min, f.max_per_day ?? null, f.dose_amount ?? null, f.dose_unit ?? null, f.remind ?? true, f.note ?? null]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '같은 이름의 약이 이미 있어요' });
    throw err;
  }
  res.status(201).json(await medicinePayload(baby.id));
}));

api.patch('/medicines/:id', wrap(async (req, res) => {
  const med = await medicineIfAllowed(req.user.id, req.params.id);
  if (!med) return res.status(404).json({ error: '약을 찾을 수 없습니다' });
  const f = medFields(req.body || {}, false);
  if (f.error) return res.status(400).json({ error: f.error });
  const keys = Object.keys(f);
  if (keys.length) {
    try {
      await db.query(`UPDATE medicines SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [med.id, ...keys.map((k) => f[k])]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: '같은 이름의 약이 이미 있어요' });
      throw err;
    }
  }
  res.json(await medicinePayload(med.baby_id));
}));

// 그만 먹이기 (기록은 남기고 목록·알림에서 뺌)
api.delete('/medicines/:id', wrap(async (req, res) => {
  const med = await medicineIfAllowed(req.user.id, req.params.id);
  if (!med) return res.status(404).json({ error: '약을 찾을 수 없습니다' });
  await db.query('UPDATE medicines SET active = FALSE WHERE id = $1', [med.id]);
  res.json(await medicinePayload(med.baby_id));
}));

// ---------- 이유식 새 재료 ----------
const REACTIONS = ['발진', '두드러기', '설사', '구토', '기침', '붓기', '기타'];
const FOOD_STATUS = ['watching', 'ok', 'reaction', 'known'];

async function foodPayload(babyId) {
  const today = localDate(Date.now(), 540);
  const trials = (await db.query(
    `SELECT f.id, f.food, to_char(f.first_date, 'YYYY-MM-DD') AS first_date, f.observe_days, f.status, f.reactions, f.note,
            to_char(f.first_date + f.observe_days - 1, 'YYYY-MM-DD') AS end_date, ($2::date - f.first_date + 1) AS day_index, u.name AS recorded_by_name
     FROM food_trials f LEFT JOIN users u ON u.id = f.recorded_by WHERE f.baby_id = $1 ORDER BY f.first_date DESC, f.created_at DESC`,
    [babyId, today])).rows;
  // 기록에 나온 이유식 메뉴 중 아직 목록에 없는 재료 (최근 7일에 먹은 것, 처음 먹은 날 포함)
  const seen = (await db.query(
    `SELECT e.detail->>'food' AS food, min(e.time) AS first_time, max(e.time) AS last_time FROM events e
     WHERE e.baby_id = $1 AND e.type = 'feeding' AND e.detail ? 'food' AND e.time > now() - interval '60 days'
     GROUP BY 1`, [babyId])).rows;
  const known = new Set(trials.map((t) => t.food));
  const sugg = new Map();
  for (const s of seen) {
    const ing = ingredientOf(s.food);
    if (!ing || known.has(ing) || Date.now() - new Date(s.last_time) > 7 * 86400000) continue;
    const first = localDate(new Date(s.first_time).getTime(), 540);
    if (!sugg.has(ing) || first < sugg.get(ing).first_seen) sugg.set(ing, { food: ing, first_seen: first, menu: s.food });
  }
  return { trials, suggestions: [...sugg.values()], reactions: REACTIONS, today };
}

async function foodIfAllowed(userId, id) {
  if (!UUID_RX.test(id)) return null;
  const r = await db.query(
    `SELECT f.* FROM food_trials f JOIN babies b ON b.id = f.baby_id JOIN family_members m ON m.family_id = b.family_id
     WHERE f.id = $1 AND m.user_id = $2`, [id, userId]);
  return r.rows[0] || null;
}

api.get('/babies/:id/foods', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  res.json(await foodPayload(baby.id));
}));

api.post('/babies/:id/foods', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const b = req.body || {};
  const food = String(b.food || '').trim().slice(0, 20);
  if (!food) return res.status(400).json({ error: '재료 이름을 입력하세요' });
  const first = DATE_RX.test(b.first_date || '') ? b.first_date : localDate(Date.now(), 540);
  const days = Number.isInteger(b.observe_days) && b.observe_days >= 1 && b.observe_days <= 7 ? b.observe_days : 3;
  const status = FOOD_STATUS.includes(b.status) ? b.status : 'watching';
  try {
    await db.query(`INSERT INTO food_trials (baby_id, food, first_date, observe_days, status, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [baby.id, food, first, days, status, req.user.id]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 목록에 있는 재료예요' });
    throw err;
  }
  res.status(201).json(await foodPayload(baby.id));
}));

api.patch('/foods/:id', wrap(async (req, res) => {
  const t = await foodIfAllowed(req.user.id, req.params.id);
  if (!t) return res.status(404).json({ error: '재료를 찾을 수 없습니다' });
  const b = req.body || {}, sets = [], vals = [t.id];
  const add = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
  if ('status' in b) { if (!FOOD_STATUS.includes(b.status)) return res.status(400).json({ error: 'status 오류' }); add('status', b.status); }
  if ('reactions' in b) {
    if (!Array.isArray(b.reactions) || b.reactions.some((x) => !REACTIONS.includes(x))) return res.status(400).json({ error: `반응은 ${REACTIONS.join(', ')} 중에서` });
    add('reactions', [...new Set(b.reactions)]);
  }
  if ('note' in b) add('note', b.note ? String(b.note).slice(0, 200) : null);
  if ('observe_days' in b) { if (!Number.isInteger(b.observe_days) || b.observe_days < 1 || b.observe_days > 7) return res.status(400).json({ error: '관찰 기간은 1~7일' }); add('observe_days', b.observe_days); }
  if ('first_date' in b) { if (!DATE_RX.test(b.first_date || '')) return res.status(400).json({ error: '날짜 형식 오류' }); add('first_date', b.first_date); }
  if (sets.length) await db.query(`UPDATE food_trials SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  res.json(await foodPayload(t.baby_id));
}));

api.delete('/foods/:id', wrap(async (req, res) => {
  const t = await foodIfAllowed(req.user.id, req.params.id);
  if (!t) return res.status(404).json({ error: '재료를 찾을 수 없습니다' });
  await db.query('DELETE FROM food_trials WHERE id = $1', [t.id]);
  res.json(await foodPayload(t.baby_id));
}));

// ---------- 밤 당번 ----------
async function dutyPayload(familyId, now = Date.now()) {
  await db.query('INSERT INTO family_settings (family_id) VALUES ($1) ON CONFLICT DO NOTHING', [familyId]);
  const [fs, members, weekly, ovs] = await Promise.all([
    db.query('SELECT duty_enabled, night_start, night_end FROM family_settings WHERE family_id = $1', [familyId]),
    db.query('SELECT u.id, u.name FROM family_members m JOIN users u ON u.id = m.user_id WHERE m.family_id = $1 ORDER BY m.joined_at', [familyId]),
    db.query('SELECT weekday, user_id FROM night_duty WHERE family_id = $1', [familyId]),
    db.query(`SELECT to_char(night_date, 'YYYY-MM-DD') AS d, user_id FROM night_duty_override WHERE family_id = $1 AND night_date >= CURRENT_DATE - 1`, [familyId]),
  ]);
  const settings = fs.rows[0];
  const wk = new Map(weekly.rows.map((r) => [r.weekday, r.user_id]));
  const ov = new Map(ovs.rows.map((r) => [r.d, r.user_id]));
  const ni = nightInfo(settings, now, 540);
  const name = (id) => members.rows.find((m) => m.id === id)?.name || null;
  const tonight = dutyFor(ni.tonight, wk, ov);
  return {
    settings, members: members.rows,
    weekly: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, wk.get(d) || null])),
    tonight: { date: ni.tonight, in_night: ni.inNight, ...tonight, name: name(tonight.user_id) },
  };
}
async function familyIfMember(userId, familyId) {
  if (!UUID_RX.test(familyId)) return false;
  return !!(await memberRole(userId, familyId));
}

api.get('/families/:id/duty', wrap(async (req, res) => {
  if (!(await familyIfMember(req.user.id, req.params.id))) return res.status(404).json({ error: '가족을 찾을 수 없습니다' });
  res.json(await dutyPayload(req.params.id));
}));

// {duty_enabled, night_start, night_end, weekly: {"0": userId|null, ...}}
api.put('/families/:id/duty', wrap(async (req, res) => {
  const fid = req.params.id;
  if (!(await familyIfMember(req.user.id, fid))) return res.status(404).json({ error: '가족을 찾을 수 없습니다' });
  const b = req.body || {};
  const members = new Set((await db.query('SELECT user_id FROM family_members WHERE family_id = $1', [fid])).rows.map((r) => r.user_id));
  for (const k of ['night_start', 'night_end']) if (k in b && (!Number.isInteger(b[k]) || b[k] < 0 || b[k] > 1439)) return res.status(400).json({ error: `${k}는 0~1439(분)` });
  if ('weekly' in b) {
    for (const [d, u] of Object.entries(b.weekly || {})) {
      if (!/^[0-6]$/.test(d) || (u != null && !members.has(u))) return res.status(400).json({ error: '당번은 가족 구성원만 정할 수 있어요' });
    }
  }
  await db.tx(async (c) => {
    await c.query('INSERT INTO family_settings (family_id) VALUES ($1) ON CONFLICT DO NOTHING', [fid]);
    const sets = [], vals = [fid];
    for (const k of ['duty_enabled', 'night_start', 'night_end']) if (k in b) { vals.push(k === 'duty_enabled' ? !!b[k] : b[k]); sets.push(`${k} = $${vals.length}`); }
    if (sets.length) await c.query(`UPDATE family_settings SET ${sets.join(', ')} WHERE family_id = $1`, vals);
    for (const [d, u] of Object.entries(b.weekly || {})) {
      if (u == null) await c.query('DELETE FROM night_duty WHERE family_id = $1 AND weekday = $2', [fid, +d]);
      else await c.query(`INSERT INTO night_duty (family_id, weekday, user_id) VALUES ($1, $2, $3)
                          ON CONFLICT (family_id, weekday) DO UPDATE SET user_id = EXCLUDED.user_id`, [fid, +d, u]);
    }
  });
  res.json(await dutyPayload(fid));
}));

// 오늘 밤만 바꾸기: {user_id: id | null(당번 없음)} / {reset: true}(요일 설정대로)
api.put('/families/:id/duty/tonight', wrap(async (req, res) => {
  const fid = req.params.id;
  if (!(await familyIfMember(req.user.id, fid))) return res.status(404).json({ error: '가족을 찾을 수 없습니다' });
  const cur = await dutyPayload(fid);
  const b = req.body || {};
  if (b.reset) await db.query('DELETE FROM night_duty_override WHERE family_id = $1 AND night_date = $2', [fid, cur.tonight.date]);
  else {
    if (b.user_id != null && !cur.members.some((m) => m.id === b.user_id)) return res.status(400).json({ error: '당번은 가족 구성원만 정할 수 있어요' });
    await db.query(`INSERT INTO night_duty_override (family_id, night_date, user_id) VALUES ($1, $2, $3)
                    ON CONFLICT (family_id, night_date) DO UPDATE SET user_id = EXCLUDED.user_id`, [fid, cur.tonight.date, b.user_id ?? null]);
  }
  res.json(await dutyPayload(fid));
}));

// ---------- 수면 패턴 ----------
api.get('/babies/:id/patterns', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const tzMin = Number.isFinite(+req.query.tz) && Math.abs(+req.query.tz) <= 840 ? +req.query.tz : 540;
  const end = DATE_RX.test(req.query.end || '') ? req.query.end : localDate(Date.now(), tzMin);
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 28);
  const from = dayStartUtc(end, tzMin) - (days + 1) * 86400000, to = dayStartUtc(end, tzMin) + 86400000;
  const r = await db.query(
    `SELECT id, type, time, amount::float AS amount, unit, detail FROM events
     WHERE baby_id = $1 AND type IN ('sleep', 'feeding') AND time >= $2 AND time < $3 ORDER BY time`,
    [baby.id, new Date(from).toISOString(), new Date(to).toISOString()]);
  res.json({ baby: { id: baby.id, name: baby.name }, ...computePatterns(r.rows, { end, days, tzMin }) });
}));

// ---------- AI 파싱 보정 ----------
const aiUsage = new Map(); // 사용자별 시간당 호출 제한
api.get('/parse/status', (req, res) => res.json({ enabled: aiEnabled() }));
api.post('/parse', wrap(async (req, res) => {
  if (!aiEnabled()) return res.status(501).json({ error: 'AI 보정이 꺼져 있습니다' });
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'text 필요' });
  const hour = Math.floor(Date.now() / 3600000), key = req.user.id;
  const u = aiUsage.get(key);
  const n = u && u.hour === hour ? u.n + 1 : 1;
  aiUsage.set(key, { hour, n });
  if (n > (parseInt(process.env.AI_HOURLY_LIMIT, 10) || 60)) return res.status(429).json({ error: 'AI 보정 사용량을 초과했어요. 잠시 후 다시 시도하세요.' });

  const babies = (await db.query(
    `SELECT b.id, b.name FROM babies b JOIN family_members m ON m.family_id = b.family_id WHERE m.user_id = $1`, [req.user.id])).rows;
  const defaultBabyId = babies.find((b) => b.id === req.body.baby_id)?.id || babies[0]?.id || null;
  const tzMin = Number.isInteger(req.body.tz) && Math.abs(req.body.tz) <= 840 ? req.body.tz : 540;
  try {
    const events = await parseWithAI({ text, tzMin, babies, defaultBabyId });
    res.json({ events });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
}));

// ---------- 알림 설정 (아기별, 가족 공용) ----------
const REMINDER_FIELDS = {
  feeding_enabled: 'bool', feeding_interval_min: [30, 720],
  diaper_enabled: 'bool', diaper_interval_min: [30, 720],
  nap_enabled: 'bool', nap_max_min: [20, 360],
  wake_enabled: 'bool', wake_window_min: [30, 480],
  skip_while_sleeping: 'bool',
  vaccine_enabled: 'bool', checkup_enabled: 'bool', medicine_enabled: 'bool', food_enabled: 'bool',
};

async function latestByType(babyId) {
  const r = await db.query(
    `SELECT DISTINCT ON (type) id, type, time, amount::float AS amount, unit, detail FROM events
     WHERE baby_id = $1 AND type IN ('feeding', 'diaper', 'sleep') AND time <= now()
     ORDER BY type, time DESC`, [babyId]);
  return Object.fromEntries(r.rows.map((e) => [e.type, e]));
}

api.get('/babies/:id/reminders', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  await db.query('INSERT INTO reminder_settings (baby_id) VALUES ($1) ON CONFLICT DO NOTHING', [baby.id]);
  const r = await db.query('SELECT * FROM reminder_settings WHERE baby_id = $1', [baby.id]);
  const { baby_id, updated_at, ...settings } = r.rows[0];
  res.json({ settings, next: nextDue(settings, await latestByType(baby.id), Date.now()) });
}));

api.put('/babies/:id/reminders', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const sets = [], vals = [baby.id];
  for (const [k, rule] of Object.entries(REMINDER_FIELDS)) {
    if (!(k in req.body)) continue;
    const v = req.body[k];
    if (rule === 'bool') { if (typeof v !== 'boolean') return res.status(400).json({ error: `${k}는 true/false` }); }
    else if (!Number.isInteger(v) || v < rule[0] || v > rule[1]) return res.status(400).json({ error: `${k}는 ${rule[0]}~${rule[1]}분` });
    vals.push(v); sets.push(`${k} = $${vals.length}`);
  }
  await db.query('INSERT INTO reminder_settings (baby_id) VALUES ($1) ON CONFLICT DO NOTHING', [baby.id]);
  if (sets.length) await db.query(`UPDATE reminder_settings SET ${sets.join(', ')}, updated_at = now() WHERE baby_id = $1`, vals);
  const r = await db.query('SELECT * FROM reminder_settings WHERE baby_id = $1', [baby.id]);
  const { baby_id, updated_at, ...settings } = r.rows[0];
  res.json({ settings, next: nextDue(settings, await latestByType(baby.id), Date.now()) });
}));

// ---------- 사용자 알림 설정 (방해금지) ----------
api.get('/me/settings', wrap(async (req, res) => {
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
  const r = await db.query('SELECT quiet_enabled, quiet_start, quiet_end, tz_min, notify_enabled FROM user_settings WHERE user_id = $1', [req.user.id]);
  const t = await db.query('SELECT count(*)::int AS n FROM push_tokens WHERE user_id = $1', [req.user.id]);
  res.json({ ...r.rows[0], devices: t.rows[0].n });
}));

api.put('/me/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [req.user.id];
  const add = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
  for (const k of ['quiet_enabled', 'notify_enabled']) {
    if (k in b) { if (typeof b[k] !== 'boolean') return res.status(400).json({ error: `${k}는 true/false` }); add(k, b[k]); }
  }
  for (const k of ['quiet_start', 'quiet_end']) {
    if (k in b) { if (!Number.isInteger(b[k]) || b[k] < 0 || b[k] > 1439) return res.status(400).json({ error: `${k}는 0~1439(분)` }); add(k, b[k]); }
  }
  if ('tz_min' in b) { if (!Number.isInteger(b.tz_min) || Math.abs(b.tz_min) > 840) return res.status(400).json({ error: 'tz_min 오류' }); add('tz_min', b.tz_min); }
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
  if (sets.length) await db.query(`UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = $1`, vals);
  const r = await db.query('SELECT quiet_enabled, quiet_start, quiet_end, tz_min, notify_enabled FROM user_settings WHERE user_id = $1', [req.user.id]);
  res.json(r.rows[0]);
}));

// ---------- 푸시 토큰 ----------
const PUSH_TOKEN_RX = /^Expo(nent)?PushToken\[[\w-]+\]$/;
api.post('/push-tokens', wrap(async (req, res) => {
  const token = String(req.body.token || '');
  if (!PUSH_TOKEN_RX.test(token)) return res.status(400).json({ error: '푸시 토큰 형식 오류' });
  const platform = ['ios', 'android'].includes(req.body.platform) ? req.body.platform : null;
  // 같은 기기에서 다른 계정으로 로그인하면 토큰 소유자를 옮김
  await db.query(
    `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen = now()`,
    [token, req.user.id, platform]);
  res.json({ ok: true });
}));

api.delete('/push-tokens', wrap(async (req, res) => {
  await db.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [String(req.body?.token || ''), req.user.id]);
  res.json({ ok: true });
}));

api.post('/push-tokens/test', wrap(async (req, res) => {
  const r = await db.query('SELECT token FROM push_tokens WHERE user_id = $1', [req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: '등록된 기기가 없습니다. 앱에서 알림을 허용해 주세요.' });
  const result = await sendPush(r.rows.map(({ token }) => ({
    to: token, title: '테스트 알림', body: '알림이 정상적으로 도착했어요.', sound: 'default', channelId: 'reminders', data: { type: 'test' },
  })));
  res.json(result);
}));

if (process.env.REMINDERS_DEBUG === 'true') {
  // 테스트용: 스케줄러를 즉시 1회 실행 (now 지정 가능)
  api.post('/_debug/run-reminders', wrap(async (req, res) => res.json(await runOnce(req.body?.now ? new Date(req.body.now).getTime() : Date.now(), { health: req.body?.health }))));
}

// ---------- 내보내기 (CSV, 엑셀 한글 호환) ----------
const CSV_TYPE = { feeding: '수유·식사', diaper: '기저귀', sleep: '수면', medicine: '투약', bath: '목욕', etc: '기타' };
const CSV_KIND = { formula: '분유', breast: '모유', solid: '이유식', milk: '우유', snack: '간식', pee: '소변', poo: '대변', both: '소변+대변', sleep: '잠듦', wake: '깸', unknown: '' };
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;  // 엑셀 수식 주입 방지
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

api.get('/babies/:id/export.csv', wrap(async (req, res) => {
  const baby = await babyIfAllowed(req.user.id, req.params.id);
  if (!baby) return res.status(404).json({ error: '아기를 찾을 수 없습니다' });
  const tzMin = Number.isFinite(+req.query.tz) && Math.abs(+req.query.tz) <= 840 ? +req.query.tz : 540;
  const today = localDate(Date.now(), tzMin);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : localDate(dayStartUtc(to, tzMin) - 29 * 86400000, tzMin);
  const a = dayStartUtc(from, tzMin), b = dayStartUtc(to, tzMin) + 86400000;
  if (!(b > a) || b - a > 366 * 86400000) return res.status(400).json({ error: '기간은 1~366일' });

  const r = await db.query(
    `SELECT e.type, e.time, e.amount::float AS amount, e.unit, e.detail, e.raw_text, e.approx_time, u.name AS by
     FROM events e LEFT JOIN users u ON u.id = e.recorded_by
     WHERE e.baby_id = $1 AND e.time >= $2 AND e.time < $3 ORDER BY e.time`,
    [baby.id, new Date(a).toISOString(), new Date(b).toISOString()]);

  const head = ['날짜', '시간', '종류', '세부', '용량', '단위', '메뉴/약', '시간(분)', '메모', '대략', '원문', '기록자'];
  const lines = [head.join(',')];
  for (const e of r.rows) {
    const local = new Date(new Date(e.time).getTime() + tzMin * 60000).toISOString();
    const d = e.detail || {};
    lines.push([local.slice(0, 10), local.slice(11, 16), CSV_TYPE[e.type], CSV_KIND[d.kind] ?? d.kind ?? '', e.amount, e.unit,
      d.food || d.name || '', d.duration_min || '', [d.note, d.memo, d.nap ? '낮잠' : ''].filter(Boolean).join(' '),
      e.approx_time ? 'Y' : '', e.raw_text, e.by].map(csvCell).join(','));
  }
  const filename = `${baby.name}_${from}_${to}.csv`;
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="baby-log.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.send('﻿' + lines.join('\r\n'));  // BOM: 엑셀에서 한글 깨짐 방지
}));

// 이벤트 1건 + 권한 확인
async function eventIfAllowed(userId, eventId) {
  const r = await db.query(
    `SELECT e.id FROM events e JOIN babies b ON b.id = e.baby_id
     JOIN family_members m ON m.family_id = b.family_id
     WHERE e.id = $1 AND m.user_id = $2`, [eventId, userId]);
  return r.rows[0] || null;
}

api.patch('/events/:id', wrap(async (req, res) => {
  if (!(await eventIfAllowed(req.user.id, req.params.id))) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });
  const b = req.body || {};
  if (b.type !== undefined && !TYPES.has(b.type)) return res.status(400).json({ error: 'type 오류' });
  if (b.time !== undefined && isNaN(new Date(b.time))) return res.status(400).json({ error: 'time 오류' });
  if (b.amount != null && (typeof b.amount !== 'number' || b.amount < 0 || b.amount > 10000)) return res.status(400).json({ error: 'amount 오류' });
  if (b.baby_id !== undefined && !(await accessibleBabies(req.user.id, [b.baby_id])).has(b.baby_id)) return res.status(403).json({ error: '권한 없음' });
  const r = await db.query(
    `UPDATE events SET
       type = COALESCE($2, type), time = COALESCE($3, time),
       amount = CASE WHEN $4::boolean THEN $5::numeric ELSE amount END,
       unit = CASE WHEN $6::boolean THEN $7 ELSE unit END,
       detail = COALESCE($8, detail), baby_id = COALESCE($9::uuid, baby_id), updated_at = now()
     WHERE id = $1 RETURNING id`,
    [req.params.id, b.type ?? null, b.time ? new Date(b.time).toISOString() : null,
     'amount' in b, b.amount ?? null, 'unit' in b, b.unit ?? null,
     b.detail && typeof b.detail === 'object' ? b.detail : null, b.baby_id ?? null]);
  res.json({ updated: r.rowCount });
}));

api.delete('/events/:id', wrap(async (req, res) => {
  if (!(await eventIfAllowed(req.user.id, req.params.id))) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });
  await db.query('DELETE FROM events WHERE id = $1', [req.params.id]);
  res.json({ deleted: 1 });
}));

apiRoot.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류' });
});

/** 스키마 적용 + 알림 스케줄러 시작 (마운트 방식과 무관하게 한 번 호출) */
async function start() {
  await db.init();
  // 기존 아기에게 기본 알림 설정 행 생성
  await db.query('INSERT INTO reminder_settings (baby_id) SELECT id FROM babies ON CONFLICT DO NOTHING');
  if (process.env.REMINDERS_ENABLED !== 'false') startReminders(parseInt(process.env.REMINDERS_INTERVAL_MS, 10) || 60000);
}

module.exports = { web, api: apiRoot, start, aiEnabled };

if (require.main === module) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  app.set('trust proxy', 1); // Railway 프록시 뒤에서 req.ip 정확히
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', apiRoot);
  app.use(web);
  start().then(() => {
    app.listen(PORT, () => console.log(`baby-log on :${PORT} (AI 보정: ${aiEnabled() ? '켜짐' : '꺼짐'})`));
  }).catch((err) => { console.error('DB 초기화 실패', err); process.exit(1); });
}

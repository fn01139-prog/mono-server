// 알림 스케줄러 + Expo 푸시 발송
const db = require('./db');
const { evaluate, inQuietHours } = require('./reminders');
const { buildSchedule } = require('./health-schedule');
const { matchMedicine, doseStatus, nightInfo, dutyFor } = require('./extras');

const PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const TZ_MIN = parseInt(process.env.DEFAULT_TZ_MIN, 10) || 540;

/** Expo 푸시 API로 발송. 만료된 토큰은 DB에서 삭제 */
async function sendPush(messages) {
  if (!messages.length) return { ok: 0, failed: 0 };
  let ok = 0, failed = 0;
  const dead = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk),
      });
      const body = await res.json().catch(() => ({}));
      (body.data || []).forEach((ticket, j) => {
        if (ticket.status === 'ok') ok++;
        else {
          failed++;
          if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[j].to);
        }
      });
      if (!res.ok && !body.data) failed += chunk.length;
    } catch (err) {
      console.error('[push] 발송 실패', err.message);
      failed += chunk.length;
    }
  }
  if (dead.length) await db.query('DELETE FROM push_tokens WHERE token = ANY($1)', [dead]);
  return { ok, failed };
}

/** 가족 구성원 중 지금 받을 수 있는 사람의 토큰 */
/**
 * 지금 알림을 받을 기기 토큰
 * - 밤 당번이 켜져 있고 밤 시간이면: 당번 한 사람에게만 (당번은 방해금지 시간도 무시하고 받음)
 * - 그 외: 가족 전원, 각자 방해금지·알림 끔 설정 반영
 */
async function recipientTokens(familyId, now) {
  const duty = await tonightDuty(familyId, now);
  if (duty) {
    const r = await db.query(
      `SELECT t.token FROM push_tokens t LEFT JOIN user_settings us ON us.user_id = t.user_id
       WHERE t.user_id = $1 AND COALESCE(us.notify_enabled, TRUE)`, [duty]);
    return r.rows.map((x) => x.token);
  }
  const r = await db.query(
    `SELECT t.token, us.quiet_enabled, us.quiet_start, us.quiet_end, us.tz_min, COALESCE(us.notify_enabled, TRUE) AS notify_enabled
     FROM family_members m
     JOIN push_tokens t ON t.user_id = m.user_id
     LEFT JOIN user_settings us ON us.user_id = m.user_id
     WHERE m.family_id = $1`, [familyId]);
  return r.rows.filter((u) => u.notify_enabled && !inQuietHours(u, now)).map((u) => u.token);
}

/** 지금이 당번이 정해진 밤이면 당번 user_id, 아니면 null */
async function tonightDuty(familyId, now) {
  const fs = (await db.query('SELECT duty_enabled, night_start, night_end FROM family_settings WHERE family_id = $1', [familyId])).rows[0];
  if (!fs?.duty_enabled) return null;
  const ni = nightInfo(fs, now, TZ_MIN);
  if (!ni.inNight) return null;
  const [w, o] = await Promise.all([
    db.query('SELECT user_id FROM night_duty WHERE family_id = $1 AND weekday = EXTRACT(DOW FROM $2::date)', [familyId, ni.nightDate]),
    db.query('SELECT user_id FROM night_duty_override WHERE family_id = $1 AND night_date = $2', [familyId, ni.nightDate]),
  ]);
  const weekly = new Map(w.rows.length ? [[new Date(ni.nightDate + 'T00:00:00Z').getUTCDay(), w.rows[0].user_id]] : []);
  const ov = new Map(o.rows.length ? [[ni.nightDate, o.rows[0].user_id]] : []);
  return dutyFor(ni.nightDate, weekly, ov).user_id;
}

/** 한 번만 보내기 (reminder_log 선점) → 받을 사람에게 발송 */
async function sendOnce(now, b, rule, anchor, title, body, data) {
  const ins = await db.query(`INSERT INTO reminder_log (baby_id, rule, anchor_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING baby_id`, [b.id, rule, anchor]);
  if (!ins.rowCount) return 0;
  const tokens = await recipientTokens(b.family_id, now);
  const r = await sendPush(tokens.map((to) => ({ to, title, body, sound: 'default', channelId: 'reminders', priority: 'high', data: { ...data, babyId: b.id } })));
  await db.query('UPDATE reminder_log SET recipients = $4 WHERE baby_id = $1 AND rule = $2 AND anchor_id = $3', [b.id, rule, anchor, r.ok]);
  return r.ok;
}

const pad2 = (n) => String(n).padStart(2, '0');
const clockOf = (ms) => { const d = new Date(ms + TZ_MIN * 60000); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
const durOf = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`; };

/** 투약: 부모가 입력한 간격이 지나 "다음 투약 가능 시각"이 되면 1회 (기준 투약마다) */
async function medicineReminders(now) {
  const meds = (await db.query(
    `SELECT md.id, md.name, md.aliases, md.min_interval_min, md.max_per_day, b.id AS baby_id, b.name AS baby_name, b.family_id
     FROM medicines md JOIN babies b ON b.id = md.baby_id JOIN reminder_settings rs ON rs.baby_id = b.id
     WHERE md.active AND md.remind AND rs.medicine_enabled`)).rows;
  if (!meds.length) return { due: 0, sent: 0 };
  const babyIds = [...new Set(meds.map((m) => m.baby_id))];
  const allMeds = (await db.query('SELECT id, baby_id, name, aliases FROM medicines WHERE active AND baby_id = ANY($1::uuid[])', [babyIds])).rows;
  const doses = (await db.query(
    `SELECT id, baby_id, time, detail FROM events WHERE type = 'medicine' AND baby_id = ANY($1::uuid[])
       AND time > to_timestamp($2 / 1000.0) - interval '48 hours' AND time <= to_timestamp($2 / 1000.0)`, [babyIds, now])).rows;
  let due = 0, sent = 0;
  for (const m of meds) {
    const mine = doses.filter((d) => d.baby_id === m.baby_id && matchMedicine(d, allMeds.filter((x) => x.baby_id === m.baby_id))?.id === m.id)
      .map((d) => ({ id: d.id, t: new Date(d.time).getTime() }));
    if (!mine.length) continue;
    const st = doseStatus(m, mine, now);
    const next = st.next_allowed && new Date(st.next_allowed).getTime();
    if (!next || now < next || now - next > 180 * 60000) continue;
    due++;
    sent += await sendOnce(now, { id: m.baby_id, family_id: m.family_id }, 'medicine', `${m.id}:${st.last_id}`,
      `${m.baby_name} ${m.name} 투약 가능 시각`,
      `마지막 ${clockOf(new Date(st.last_time).getTime())} · 설정한 간격 ${durOf(m.min_interval_min)}${st.limited ? ' · 하루 최대 횟수 기준' : ''}. 필요할 때만 먹이세요.`,
      { type: 'medicine', medicineId: m.id });
  }
  return { due, sent };
}

/** 이유식 새 재료: 관찰 기간이 끝난 다음 날(낮)에 1회 "괜찮았나요?" */
async function foodReminders(now) {
  const h = new Date(now + TZ_MIN * 60000).getUTCHours();
  if (h < 9 || h >= 20) return { due: 0, sent: 0 };
  const today = new Date(now + TZ_MIN * 60000).toISOString().slice(0, 10);
  const rows = (await db.query(
    `SELECT f.id, f.food, f.observe_days, b.id AS baby_id, b.name AS baby_name, b.family_id
     FROM food_trials f JOIN babies b ON b.id = f.baby_id JOIN reminder_settings rs ON rs.baby_id = b.id
     WHERE rs.food_enabled AND f.status = 'watching'
       AND $1::date >= f.first_date + f.observe_days AND $1::date <= f.first_date + f.observe_days + 3`, [today])).rows;
  let sent = 0;
  for (const f of rows) {
    sent += await sendOnce(now, { id: f.baby_id, family_id: f.family_id }, 'food', `food:${f.id}`,
      `${f.baby_name} ${f.food} 관찰 ${f.observe_days}일이 지났어요`,
      '이상 반응이 없었다면 "괜찮음", 있었다면 "반응 있음"으로 표시해 주세요.', { type: 'food', foodId: f.id });
  }
  return { due: rows.length, sent };
}

/** 예방접종·검진: 시작 7일 전부터 1회, 검진은 기간 끝나기 7일 전에도 1회. 낮(9~20시)에만 */
async function healthReminders(now) {
  const h = new Date(now + TZ_MIN * 60000).getUTCHours();
  if (h < 9 || h >= 20) return { due: 0, sent: 0 };
  const today = new Date(now + TZ_MIN * 60000).toISOString().slice(0, 10);
  const babies = await db.query(
    `SELECT b.id, b.name, b.family_id, b.sex, to_char(b.birth_date, 'YYYY-MM-DD') AS birth, b.vaccine_prefs, rs.vaccine_enabled, rs.checkup_enabled
     FROM babies b JOIN reminder_settings rs ON rs.baby_id = b.id
     WHERE b.birth_date IS NOT NULL AND b.birth_date > (to_timestamp($1 / 1000.0) - interval '13 years')::date
       AND (rs.vaccine_enabled OR rs.checkup_enabled)`, [now]);
  let due = 0, sent = 0;
  for (const b of babies.rows) {
    const rec = await db.query(`SELECT kind, code, dose, to_char(done_on, 'YYYY-MM-DD') AS done_on FROM health_records WHERE baby_id = $1`, [b.id]);
    const s = buildSchedule({ birth: b.birth, sex: b.sex, prefs: b.vaccine_prefs, records: rec.rows, today });
    const items = [];
    if (b.vaccine_enabled) {
      // 같은 날 여러 접종은 하나로 묶어서
      const soon = s.vaccines.filter((v) => v.status === 'upcoming' && v.days_until <= 7);
      const byDate = {};
      soon.forEach((v) => (byDate[v.from] ||= []).push(v));
      for (const [from, list] of Object.entries(byDate)) {
        const d = list[0].days_until;
        items.push({ rule: 'vaccine', anchor: `vaccine:${from}:${list.map((v) => v.code + v.dose).join(',')}`,
          title: `${b.name} 예방접종 ${d ? `D-${d}` : '오늘부터'}`,
          body: `${list.map((v) => `${v.name} ${v.dose}차`).join(', ')} · ${from}부터 접종할 수 있어요` });
      }
    }
    if (b.checkup_enabled) {
      for (const c of s.checkups) {
        if (c.status === 'upcoming' && c.days_until <= 7) items.push({ rule: 'checkup', anchor: `checkup:${c.dose}:start`,
          title: `${b.name} 건강검진 ${c.days_until ? `D-${c.days_until}` : '오늘부터'}`, body: `${c.name} (${c.label}) · ${c.from}부터 ${c.to}까지` });
        const left = Math.round((Date.parse(c.to) - Date.parse(today)) / 86400000);
        if (c.status === 'due' && left <= 7) items.push({ rule: 'checkup', anchor: `checkup:${c.dose}:end`,
          title: `${b.name} 건강검진 기간이 ${left}일 남았어요`, body: `${c.name} · ${c.to}까지 받아야 해요` });
      }
    }
    for (const it of items) {
      due++;
      const ins = await db.query(`INSERT INTO reminder_log (baby_id, rule, anchor_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING baby_id`, [b.id, it.rule, it.anchor]);
      if (!ins.rowCount) continue;
      const tokens = await recipientTokens(b.family_id, now);
      const r = await sendPush(tokens.map((to) => ({ to, title: it.title, body: it.body, sound: 'default', channelId: 'reminders', data: { type: 'health', rule: it.rule, babyId: b.id } })));
      sent += r.ok;
    }
  }
  return { due, sent };
}

let running = false;
/** 한 번 돌기: 기록이 최근 2일 안에 있는 아기만 검사. 접종·검진은 10분마다 */
async function runOnce(now = Date.now(), { health } = {}) {
  if (running) return { skipped: true };
  running = true;
  const stats = { babies: 0, due: 0, sent: 0 };
  try {
    const babies = await db.query(
      `SELECT b.id, b.name, b.family_id, rs.*
       FROM babies b JOIN reminder_settings rs ON rs.baby_id = b.id
       WHERE (rs.feeding_enabled OR rs.diaper_enabled OR rs.nap_enabled OR rs.wake_enabled)
         AND EXISTS (SELECT 1 FROM events e WHERE e.baby_id = b.id AND e.time > to_timestamp($1 / 1000.0) - interval '2 days')`,
      [now]);
    stats.babies = babies.rowCount;
    stats.medicine = await medicineReminders(now);
    if (health ?? new Date(now).getUTCMinutes() % 10 === 0) {
      stats.health = await healthReminders(now);
      stats.food = await foodReminders(now);
    }
    if (!babies.rowCount) return stats;

    const latest = await db.query(
      `SELECT DISTINCT ON (baby_id, type) id, baby_id, type, time, amount::float AS amount, unit, detail
       FROM events
       WHERE baby_id = ANY($1::uuid[]) AND type IN ('feeding', 'diaper', 'sleep') AND time <= to_timestamp($2 / 1000.0)
       ORDER BY baby_id, type, time DESC`,
      [babies.rows.map((b) => b.id), now]);
    const byBaby = {};
    for (const e of latest.rows) (byBaby[e.baby_id] ||= {})[e.type] = e;

    for (const b of babies.rows) {
      const due = evaluate(b, byBaby[b.id] || {}, { now, tzMin: TZ_MIN, babyName: b.name });
      for (const d of due) {
        stats.due++;
        // 먼저 기록 → 여러 인스턴스/재시작에도 중복 발송 없음
        const ins = await db.query(
          `INSERT INTO reminder_log (baby_id, rule, anchor_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING baby_id`, [b.id, d.rule, d.anchorId]);
        if (!ins.rowCount) continue;
        const tokens = await recipientTokens(b.family_id, now);
        const result = await sendPush(tokens.map((to) => ({
          to, title: d.title, body: d.body, sound: 'default', channelId: 'reminders', priority: 'high',
          data: { type: 'reminder', rule: d.rule, babyId: b.id },
        })));
        stats.sent += result.ok;
        await db.query('UPDATE reminder_log SET recipients = $4 WHERE baby_id = $1 AND rule = $2 AND anchor_id = $3', [b.id, d.rule, d.anchorId, result.ok]);
      }
    }
    // 오래된 발송 기록 정리
    await db.query(`DELETE FROM reminder_log WHERE sent_at < now() - interval '30 days'`);
    return stats;
  } catch (err) {
    console.error('[reminders] 실행 오류', err);
    return { ...stats, error: err.message };
  } finally {
    running = false;
  }
}

function start(intervalMs = 60000) {
  const t = setInterval(() => runOnce(), intervalMs);
  t.unref?.();
  console.log(`[reminders] 스케줄러 시작 (${intervalMs / 1000}초 간격)`);
  return t;
}

module.exports = { runOnce, start, sendPush };

/**
 * projects/location/lib/plans.js
 * 위치 일정 도메인 로직(DB). 모든 함수는 ownerId로 격리한다.
 * - index.js(로그인 사용자, ownerId = req.user.userId)
 * - publish-routes.js / mcp-routes.js(x-api-key, ownerId = getApiOwnerId())
 * 세 진입점이 같은 함수를 공유하므로 검증/즐겨찾기 좌표 자동채움 규칙이 항상 동일하다.
 */
'use strict';

const crypto = require('crypto');
const pool   = require('../../../shared/db');

const SHARE_PATH_PREFIX = '/location/s/';
const MAX_ENTRIES = 50;

class ValidationError extends Error {}

/* ── 검증/정규화 ─────────────────────────────────────────────────────── */
function normDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError('date는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ValidationError('존재하지 않는 날짜입니다.');
  }
  return s;
}

function normTime(s) {
  const m = typeof s === 'string' && s.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new ValidationError('time은 HH:MM(24시간) 형식이어야 합니다.');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function normCoord(v, min, max, name) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} 값이 올바르지 않습니다.`);
  return n;
}

function cleanEntry(e) {
  if (!e || typeof e !== 'object') throw new ValidationError('entry 형식이 올바르지 않습니다.');
  const place = typeof e.place === 'string' ? e.place.trim() : '';
  if (!place) throw new ValidationError('place가 필요합니다.');
  if (place.length > 200) throw new ValidationError('place는 200자 이하여야 합니다.');
  const note = e.note == null ? null : String(e.note).trim() || null;
  if (note && note.length > 500) throw new ValidationError('note는 500자 이하여야 합니다.');
  return {
    time:  normTime(e.time),
    place,
    note,
    lat:   normCoord(e.lat, -90, 90, 'lat'),
    lng:   normCoord(e.lng, -180, 180, 'lng'),
  };
}

function cleanEntries(list) {
  if (!Array.isArray(list) || list.length === 0) throw new ValidationError('entries는 1개 이상의 배열이어야 합니다.');
  if (list.length > MAX_ENTRIES) throw new ValidationError(`entries는 최대 ${MAX_ENTRIES}개까지 가능합니다.`);
  return list.map(cleanEntry);
}

/* ── API 키 진입점용 소유자 결정 ─────────────────────────────────────── */
async function getApiOwnerId() {
  if (process.env.LOCATION_OWNER_ID) return process.env.LOCATION_OWNER_ID;
  const { rows } = await pool.query(
    `SELECT user_id FROM platform_accounts
      WHERE role = 'admin' AND is_active ORDER BY created_at ASC LIMIT 1`
  );
  return rows[0]?.user_id || null;
}

/* ── 즐겨찾는 장소 ───────────────────────────────────────────────────── */
async function listFavorites(ownerId) {
  const { rows } = await pool.query(
    `SELECT name, lat, lng, address FROM location_favorites WHERE owner_id = $1 ORDER BY name`, [ownerId]);
  return rows;
}

async function getFavorite(ownerId, name) {
  const { rows } = await pool.query(
    `SELECT name, lat, lng, address FROM location_favorites WHERE owner_id = $1 AND name = $2`,
    [ownerId, String(name).trim()]);
  return rows[0] || null;
}

async function setFavorite(ownerId, name, { lat, lng, address }) {
  name = String(name || '').trim();
  if (!name) throw new ValidationError('name이 필요합니다.');
  if (name.length > 100) throw new ValidationError('name은 100자 이하여야 합니다.');
  const la = normCoord(lat, -90, 90, 'lat');
  const ln = normCoord(lng, -180, 180, 'lng');
  if (la === null || ln === null) throw new ValidationError('lat, lng가 모두 필요합니다.');
  await pool.query(
    `INSERT INTO location_favorites (owner_id, name, lat, lng, address)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (owner_id, name) DO UPDATE SET lat = $3, lng = $4, address = $5`,
    [ownerId, name, la, ln, address ? String(address).slice(0, 300) : null]);
}

async function deleteFavorite(ownerId, name) {
  const r = await pool.query(
    `DELETE FROM location_favorites WHERE owner_id = $1 AND name = $2`, [ownerId, String(name).trim()]);
  return r.rowCount > 0;
}

/** 좌표가 없는 항목 중 place가 즐겨찾기 이름과 정확히 같으면 좌표를 채운다 ("집", "사무실" 등). */
async function applyFavorites(client, ownerId, entries) {
  const { rows } = await client.query(
    `SELECT name, lat, lng FROM location_favorites WHERE owner_id = $1`, [ownerId]);
  if (!rows.length) return entries;
  const map = new Map(rows.map((r) => [r.name, r]));
  return entries.map((e) => {
    const fav = map.get(e.place);
    return (e.lat === null && e.lng === null && fav) ? { ...e, lat: fav.lat, lng: fav.lng } : e;
  });
}

/* ── 일정(plan) ──────────────────────────────────────────────────────── */
function newToken() { return crypto.randomBytes(9).toString('base64url'); }

/** (owner, date) 플랜을 가져오거나 만든다. 공유 토큰은 최초 생성 시 한 번만 정해지고 이후 유지된다. */
async function getOrCreatePlanId(client, ownerId, date) {
  for (let i = 0; i < 3; i++) {
    try {
      const { rows } = await client.query(
        `INSERT INTO location_plans (owner_id, plan_date, share_token)
         VALUES ($1, $2, $3)
         ON CONFLICT (owner_id, plan_date) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [ownerId, date, newToken()]);
      return rows[0].id;
    } catch (e) {
      if (e.code === '23505' && i < 2) continue; // share_token 충돌(사실상 발생 안 함)
      throw e;
    }
  }
}

async function insertEntries(client, planId, entries) {
  for (const e of entries) {
    await client.query(
      `INSERT INTO location_entries (plan_id, entry_time, place, note, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [planId, e.time, e.place, e.note, e.lat, e.lng]);
  }
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function readEntries(planId) {
  const { rows } = await pool.query(
    `SELECT id, to_char(entry_time, 'HH24:MI') AS time, place, note, lat, lng
       FROM location_entries WHERE plan_id = $1 ORDER BY entry_time, id`, [planId]);
  return rows;
}

async function getPlan(ownerId, date) {
  date = normDate(date);
  const { rows } = await pool.query(
    `SELECT id, plan_date::text AS date, share_token
       FROM location_plans WHERE owner_id = $1 AND plan_date = $2`, [ownerId, date]);
  if (!rows.length) return null;
  return { date: rows[0].date, shareToken: rows[0].share_token, entries: await readEntries(rows[0].id) };
}

/** 하루치 일정을 통째로 교체 */
async function replacePlan(ownerId, date, rawEntries) {
  date = normDate(date);
  let entries = cleanEntries(rawEntries);
  await withTx(async (client) => {
    entries = await applyFavorites(client, ownerId, entries);
    const planId = await getOrCreatePlanId(client, ownerId, date);
    await client.query(`DELETE FROM location_entries WHERE plan_id = $1`, [planId]);
    await insertEntries(client, planId, entries);
  });
  return getPlan(ownerId, date);
}

/** 기존 항목은 그대로 두고 1건 추가 */
async function addEntry(ownerId, date, rawEntry) {
  date = normDate(date);
  let entry = cleanEntry(rawEntry);
  await withTx(async (client) => {
    [entry] = await applyFavorites(client, ownerId, [entry]);
    const planId = await getOrCreatePlanId(client, ownerId, date);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM location_entries WHERE plan_id = $1`, [planId]);
    if (rows[0].n >= MAX_ENTRIES) throw new ValidationError(`하루 최대 ${MAX_ENTRIES}개까지 가능합니다.`);
    await insertEntries(client, planId, [entry]);
  });
  return getPlan(ownerId, date);
}

/** 항목 1건 수정 — 본인 플랜의 항목만. fields: time/place/note/lat/lng 중 일부 */
async function updateEntry(ownerId, id, fields) {
  const sets = [];
  const vals = [];
  const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (fields.time  !== undefined) push('entry_time', normTime(fields.time));
  if (fields.place !== undefined) {
    const p = String(fields.place).trim();
    if (!p || p.length > 200) throw new ValidationError('place가 올바르지 않습니다.');
    push('place', p);
  }
  if (fields.note !== undefined) {
    const n = fields.note === null ? null : String(fields.note).trim() || null;
    if (n && n.length > 500) throw new ValidationError('note는 500자 이하여야 합니다.');
    push('note', n);
  }
  if (fields.lat !== undefined) push('lat', normCoord(fields.lat, -90, 90, 'lat'));
  if (fields.lng !== undefined) push('lng', normCoord(fields.lng, -180, 180, 'lng'));
  if (!sets.length) throw new ValidationError('수정할 필드가 없습니다.');
  sets.push('updated_at = NOW()');
  vals.push(Number(id), ownerId);
  const r = await pool.query(
    `UPDATE location_entries e SET ${sets.join(', ')}
       FROM location_plans p
      WHERE e.id = $${vals.length - 1} AND e.plan_id = p.id AND p.owner_id = $${vals.length}`, vals);
  return r.rowCount > 0;
}

async function deleteEntry(ownerId, id) {
  const r = await pool.query(
    `DELETE FROM location_entries e USING location_plans p
      WHERE e.id = $1 AND e.plan_id = p.id AND p.owner_id = $2`, [Number(id), ownerId]);
  return r.rowCount > 0;
}

async function deletePlan(ownerId, date) {
  const r = await pool.query(
    `DELETE FROM location_plans WHERE owner_id = $1 AND plan_date = $2`, [ownerId, normDate(date)]);
  return r.rowCount > 0;
}

async function listPlans(ownerId, { limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT p.plan_date::text AS date, p.share_token AS "shareToken", COUNT(e.id)::int AS "entryCount"
       FROM location_plans p LEFT JOIN location_entries e ON e.plan_id = p.id
      WHERE p.owner_id = $1
      GROUP BY p.id ORDER BY p.plan_date DESC LIMIT $2`,
    [ownerId, Math.min(Math.max(Number(limit) || 30, 1), 200)]);
  return rows;
}

/** 공유 페이지용 — 토큰이 곧 비밀키이므로 소유자 조건 없이 조회 */
async function getPlanByToken(token) {
  const { rows } = await pool.query(
    `SELECT id, plan_date::text AS date FROM location_plans WHERE share_token = $1`, [token]);
  if (!rows.length) return null;
  return { date: rows[0].date, entries: await readEntries(rows[0].id) };
}

function sharePath(token) { return SHARE_PATH_PREFIX + token; }

module.exports = {
  ValidationError, getApiOwnerId,
  getPlan, replacePlan, addEntry, updateEntry, deleteEntry, deletePlan, listPlans, getPlanByToken,
  listFavorites, getFavorite, setFavorite, deleteFavorite,
  sharePath,
};

/**
 * projects/totalprice/index.js
 * 금/은 시세(한국금거래소) + 국내 주식 시세(Npay 증권) 조회 API 라우터.
 * /totalprice/api/* 로 자동 마운트됩니다.
 */
const express = require('express');
const router = express.Router();
const { asyncHandler, ok, fail } = require('../../shared/utils');
const pool = require('../../shared/db');
const { fetchGoldPrice } = require('./lib/koreagoldx');
const { buildReport } = require('./lib/report');
const { fetchDaily, fetchIntraday, fetchSnapshot } = require('./lib/naverStock');
const insightService = require('./lib/insightService');
const notifyDb = require('../../shared/notify/db');
const { nowInKst, currentBucket, isDue, ALERT_CATEGORY_KEY } = require('../../core/jobs/totalprice-alert-runner');

// 전부 동적 데이터(시세/뉴스/사용자별 알림)라 HTTP 캐시가 붙으면 안 됨 —
// Express 기본 ETag가 304를 돌려줬을 때 클라이언트가 캐시된 본문을 못 채우는 경우가 있어 아예 끈다.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/health', asyncHandler(async (req, res) => {
  ok(res, { status: 'ok', project: 'totalprice', time: new Date() });
}));

/* ── 금/은 시세 (한국금거래소) ───────────────────────────────────────── */
/* 조회 조합(type/start/end)별 마지막 성공 응답을 totalprice_gold_cache에 저장해두고,
 * 실시간 조회가 실패하면 폴백으로 쓴다. 배포마다 컨테이너가 새로 뜨는 호스팅(Railway 등)에서도
 * 살아남도록 파일이 아니라 DB에 저장한다. */

const GOLD_CACHE_TTL_MS = 10 * 60 * 1000; // 비공식 API라 과도한 호출을 피하기 위한 10분 캐시

let goldMemCache = null; // { key, fetchedAt, list }

async function readGoldDbCache(cacheKey) {
  const { rows } = await pool.query('SELECT list FROM totalprice_gold_cache WHERE cache_key = $1', [cacheKey]);
  return rows[0]?.list || null;
}

async function writeGoldDbCache(cacheKey, fetched) {
  await pool.query(
    `INSERT INTO totalprice_gold_cache (cache_key, type, data_date_start, data_date_end, list, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (cache_key) DO UPDATE
       SET type = $2, data_date_start = $3, data_date_end = $4, list = $5, updated_at = NOW()`,
    [cacheKey, fetched.type, fetched.dataDateStart, fetched.dataDateEnd, JSON.stringify(fetched.list)]
  );
}

router.get('/gold/report', asyncHandler(async (req, res) => {
  const { type, start, end } = req.query;
  const cacheKey = `${type || 'Au'}:${start || ''}:${end || ''}`;

  if (goldMemCache && goldMemCache.key === cacheKey && Date.now() - goldMemCache.fetchedAt < GOLD_CACHE_TTL_MS) {
    return ok(res, buildReport(goldMemCache.list));
  }

  try {
    const fetched = await fetchGoldPrice({ type, startDate: start, endDate: end });
    goldMemCache = { key: cacheKey, fetchedAt: Date.now(), list: fetched.list };
    await writeGoldDbCache(cacheKey, fetched).catch(e => console.warn('[totalprice] 금시세 DB 캐시 저장 실패:', e.message));
    return ok(res, buildReport(fetched.list));
  } catch (err) {
    console.warn('[totalprice] 금시세 실시간 조회 실패, DB 캐시로 폴백:', err.message);
    const fallbackList = await readGoldDbCache(cacheKey).catch(() => null);
    if (fallbackList) {
      return ok(res, { ...buildReport(fallbackList), stale: true, error: err.message });
    }
    return fail(res, `금시세 조회 실패: ${err.message}`, 502);
  }
}));

/* ── 주식 시세 (Npay 증권) ─────────────────────────────────────────── */

// 종목 검색: DB(totalprice_stocks)에서 코드/명칭 매칭. 배치잡이 주기적으로 목록을 갱신한다.
router.get('/stocks/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return ok(res, []);

  const { rows } = await pool.query(
    `SELECT code, name, market FROM totalprice_stocks
     WHERE code ILIKE $1 OR name ILIKE $1
     ORDER BY (code = $2) DESC, (name = $2) DESC, (code ILIKE $2 || '%') DESC, (name ILIKE $2 || '%') DESC, name ASC
     LIMIT 20`,
    [`%${q}%`, q]
  );
  ok(res, rows);
}));

router.get('/stocks/:code/daily', asyncHandler(async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return fail(res, '종목코드는 6자리 숫자여야 합니다.', 400);

  const pages = Number(req.query.pages) || 4;
  try {
    const rows = await fetchDaily(code, { pages });
    ok(res, { code, rows: rows.reverse() }); // 오름차순(오래된 날짜 → 최신)으로 반환
  } catch (err) {
    fail(res, `일별 시세 조회 실패: ${err.message}`, 502);
  }
}));

router.get('/stocks/:code/intraday', asyncHandler(async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return fail(res, '종목코드는 6자리 숫자여야 합니다.', 400);

  const pages = Number(req.query.pages) || 3;
  const thistime = req.query.thistime || '';
  try {
    const rows = await fetchIntraday(code, { thistime, pages });
    ok(res, { code, rows: rows.reverse() }); // 오름차순(과거 → 최근)으로 반환
  } catch (err) {
    fail(res, `시간별 시세 조회 실패: ${err.message}`, 502);
  }
}));

// 종목 현재가 스냅샷만 단독 조회 (AI 분석 없이 가볍게 확인하고 싶을 때)
router.get('/stocks/:code/snapshot', asyncHandler(async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return fail(res, '종목코드는 6자리 숫자여야 합니다.', 400);

  try {
    const snapshot = await fetchSnapshot(code);
    ok(res, { code, snapshot });
  } catch (err) {
    fail(res, `현재가 조회 실패: ${err.message}`, 502);
  }
}));

/* ── AI 참고 자료 (Claude Haiku 4.5) ───────────────────────────────────
 * 현재가/최근 시세 흐름/최근 뉴스를 모아 매수·매도 판단에 참고할 요약을 생성한다.
 * 투자 자문이 아닌 정보 참고용 — 응답에 disclaimer를 항상 포함한다.
 * 실제 수집/생성 로직은 lib/insightService.js — 배치잡(totalprice-alert-runner)과 공유.
 */
router.get('/stocks/:code/insight', asyncHandler(async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return fail(res, '종목코드는 6자리 숫자여야 합니다.', 400);

  try {
    const data = await insightService.getInsight(code);
    ok(res, data);
  } catch (err) {
    // aiAdvisor.mapAnthropicError()가 Anthropic 에러 타입(billing_error 등)을 code/httpStatus로 분류해둔다.
    res.status(err.httpStatus || 502).json({ success: false, error: err.message, errorCode: err.code || 'unknown_error' });
  }
}));

/* ── AI 알림 예약 (totalprice_alerts) ──────────────────────────────────
 * 로그인한 사용자가 "종목 X를 매일/평일 HH:MM에 AI로 분석해서 내가 등록한 알림 채널로 보내줘"를
 * 등록하는 화면. 실제 실행은 core/jobs/totalprice-alert-runner.js(플랫폼 공통 배치잡 프레임워크)가
 * 주기적으로 이 테이블을 스캔하며 담당 — admin 콘솔 배치잡 탭에도 자동으로 노출된다.
 */
const ALERT_APIS = [
  { key: 'stock-insight', label: '종목 AI 참고 자료 (매수/매도 판단 참고)' },
];
const NOTIFY_CHANNEL_LABELS = { telegram: '텔레그램', discord: '디스코드', ntfy: 'ntfy', webpush: '웹푸시' };

router.get('/alerts/apis', asyncHandler(async (req, res) => {
  ok(res, ALERT_APIS);
}));

// 이 사용자가 실제로 연결해둔(활성) 알림 채널 타입만 반환 — select box는 이 목록만 보여준다.
router.get('/alerts/channels', asyncHandler(async (req, res) => {
  const recipient = await notifyDb.getOrCreateRecipientForUser(req.user.userId, req.user.name);
  const channelsByType = await notifyDb.listChannelsForRecipient(recipient.id);
  const available = Object.entries(channelsByType)
    .filter(([, rows]) => rows.some(r => r.is_active))
    .map(([type]) => ({ type, label: NOTIFY_CHANNEL_LABELS[type] || type }));
  ok(res, available);
}));

router.get('/alerts', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM totalprice_alerts WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.userId]
  );
  ok(res, rows);
}));

// 실제로 발송됐던 AI 알림 이력(일자/시간/종목/내용) — 본인에게 온 것만 조회 가능.
// core/jobs/totalprice-alert-runner.js가 notify_log에 ALERT_CATEGORY_KEY로 남겨둔 기록을 그대로 사용.
router.get('/alerts/history', asyncHandler(async (req, res) => {
  const recipient = await notifyDb.getOrCreateRecipientForUser(req.user.userId, req.user.name);
  const logs = await notifyDb.getLog({
    recipientId: recipient.id,
    category: ALERT_CATEGORY_KEY,
    limit: Number(req.query.limit) || 50,
  });
  ok(res, logs);
}));

router.post('/alerts', asyncHandler(async (req, res) => {
  const { apiKey, code, stockName, frequency, runTime, runMinute, runWeekday, notifyChannel } = req.body || {};

  if (!/^\d{6}$/.test(code || '')) return fail(res, '종목코드는 6자리 숫자여야 합니다.', 400);
  if (!ALERT_APIS.some(a => a.key === apiKey)) return fail(res, '알 수 없는 호출 API입니다.', 400);
  if (!['daily', 'hourly', 'weekly'].includes(frequency)) return fail(res, '주기가 올바르지 않습니다.', 400);
  if (!NOTIFY_CHANNEL_LABELS[notifyChannel]) return fail(res, '알림 방법이 올바르지 않습니다.', 400);

  // 주기별로 필요한 값만 검증하고, 나머지는 저장하지 않도록 null로 정리
  let dbRunTime = null;
  let dbRunMinute = null;
  let dbRunWeekday = null;

  if (frequency === 'daily') {
    if (!/^\d{2}:\d{2}$/.test(runTime || '')) return fail(res, '시간(HH:MM)을 입력하세요.', 400);
    dbRunTime = runTime;
  } else if (frequency === 'weekly') {
    if (!/^\d{2}:\d{2}$/.test(runTime || '')) return fail(res, '시간(HH:MM)을 입력하세요.', 400);
    const weekday = Number(runWeekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return fail(res, '요일을 선택하세요.', 400);
    dbRunTime = runTime;
    dbRunWeekday = weekday;
  } else if (frequency === 'hourly') {
    const minute = Number(runMinute);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return fail(res, '분을 선택하세요.', 400);
    dbRunMinute = minute;
  }

  // 실제로 연결된 채널인지 서버에서도 재검증 (클라이언트가 select box를 우회해도 막힘)
  const recipient = await notifyDb.getOrCreateRecipientForUser(req.user.userId, req.user.name);
  const channelsByType = await notifyDb.listChannelsForRecipient(recipient.id);
  if (!(channelsByType[notifyChannel] || []).some(c => c.is_active)) {
    return fail(res, `연결된 ${NOTIFY_CHANNEL_LABELS[notifyChannel]} 채널이 없습니다. /notify-settings에서 먼저 연결하세요.`, 400);
  }

  // 예약 시각이 오늘 중 이미 지난 시각(예: 지금 14시인데 09:00 daily로 등록)이면
  // totalprice-alert-runner의 배치 tick 로직상 "아직 이번 주기에 실행 안 함" 상태라
  // 다음 10분 tick에 바로 발송돼버린다. 등록 시점에 이미 지난 주기라면 이번 주기는
  // 건너뛰도록 last_run_bucket을 선점해서, 다음 정상 주기(내일/다음 시간 등)부터 발송되게 한다.
  const kst = nowInKst();
  const stub = { frequency, run_time: dbRunTime, run_minute: dbRunMinute, run_weekday: dbRunWeekday, last_run_bucket: null };
  const initialBucket = isDue(stub, kst) ? currentBucket(frequency, kst) : null;

  const { rows } = await pool.query(
    `INSERT INTO totalprice_alerts (user_id, api_key, code, stock_name, frequency, run_time, run_minute, run_weekday, notify_channel, last_run_bucket)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [req.user.userId, apiKey, code, stockName || code, frequency, dbRunTime, dbRunMinute, dbRunWeekday, notifyChannel, initialBucket]
  );
  ok(res, rows[0]);
}));

router.patch('/alerts/:id', asyncHandler(async (req, res) => {
  const { isActive } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE totalprice_alerts SET is_active = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [!!isActive, req.params.id, req.user.userId]
  );
  if (rows.length === 0) return fail(res, '알림 예약을 찾을 수 없습니다.', 404);
  ok(res, rows[0]);
}));

router.delete('/alerts/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM totalprice_alerts WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.userId]
  );
  if (rowCount === 0) return fail(res, '알림 예약을 찾을 수 없습니다.', 404);
  ok(res, { deleted: true });
}));

module.exports = router;

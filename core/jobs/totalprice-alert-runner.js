/**
 * core/jobs/totalprice-alert-runner.js
 * totalprice_alerts(사용자가 등록한 "종목 X를 매일/매시간/매주 이 시각에 AI로 분석해서
 * 등록한 알림 채널로 보내줘" 예약)을 스캔해 시각이 된 항목을 실행한다.
 *
 * 10분마다 깨어나서, 주기별로 아래 조건을 모두 만족하면 발송한다.
 *   - daily : 오늘 아직 안 보냈고, 현재 시각이 run_time을 지났으면
 *   - weekly: 오늘이 run_weekday이고, 오늘 아직 안 보냈고, 현재 시각이 run_time을 지났으면
 *   - hourly: 이번 시간(0~59분 사이) 안에 아직 안 보냈고, 현재 분이 run_minute을 지났으면
 * (정확히 그 순간이 아니라 그 이후 첫 틱에 발송 — 잡이 잠깐 멈췄다 재개돼도 그 주기는 놓치지 않음)
 * last_run_bucket에 "이번에 실행한 주기"를 문자열로 저장해 중복 발송을 막는다.
 */
const insightService = require('../../projects/totalprice/lib/insightService');
const notify = require('../../shared/notify');
const notifyDb = require('../../shared/notify/db');

// notify_log에 이 카테고리로 기록해두면 발송 이력을 조회할 수 있다(GET /totalprice/api/alerts/history).
// 구독 여부와 무관하게 항상 발송해야 해서 notify.send()가 아니라 sendTest()를 그대로 쓰고,
// 이력 조회용으로만 카테고리를 붙인다 — 최초 1회 조회 후 메모이즈.
const ALERT_CATEGORY_KEY = 'totalprice-ai-alert';
let alertCategoryId = null;
async function ensureAlertCategoryId() {
  if (alertCategoryId) return alertCategoryId;
  const cat = await notifyDb.getOrCreateCategory(ALERT_CATEGORY_KEY, '종목 AI 참고자료 알림', '/totalprice');
  alertCategoryId = cat.id;
  return alertCategoryId;
}

function nowInKst() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}
const pad2 = n => String(n).padStart(2, '0');

/** daily/weekly는 날짜 단위, hourly는 시간 단위로 "이미 실행한 주기"를 구분하는 키 */
function currentBucket(frequency, kst) {
  const dateStr = `${kst.getFullYear()}-${pad2(kst.getMonth() + 1)}-${pad2(kst.getDate())}`;
  return frequency === 'hourly' ? `${dateStr}T${pad2(kst.getHours())}` : dateStr;
}

function isDue(alert, kst) {
  const bucket = currentBucket(alert.frequency, kst);
  if (alert.last_run_bucket === bucket) return false; // 이번 주기엔 이미 실행함

  if (alert.frequency === 'hourly') {
    return kst.getMinutes() >= alert.run_minute;
  }

  const hhmm = `${pad2(kst.getHours())}:${pad2(kst.getMinutes())}`;
  if (alert.frequency === 'weekly') {
    return kst.getDay() === alert.run_weekday && hhmm >= alert.run_time;
  }
  return hhmm >= alert.run_time; // daily
}

async function markResult(pool, alert, bucket, status, errorMsg) {
  await pool.query(
    `UPDATE totalprice_alerts
     SET last_run_at = NOW(), last_run_bucket = $2, last_status = $3, last_error = $4
     WHERE id = $1`,
    [alert.id, bucket, status, errorMsg || null]
  );
}

function buildMessage(insight) {
  const s = insight.snapshot;
  // 네이버 시세 페이지 스크래핑이 부분적으로 실패하면 snapshot 객체 자체는 오지만
  // price/changePct가 null일 수 있다 — 그 경우 "현재가 undefined원"이 찍히지 않도록 가드.
  const priceLine = (s && s.price != null)
    ? `현재가 ${s.price.toLocaleString('ko-KR')}원 (${s.changePct >= 0 ? '+' : ''}${s.changePct}%)`
    : '';
  const sentimentLabel = { positive: '긍정적', neutral: '중립적', negative: '부정적' }[insight.analysis.sentiment] || '중립적';
  const body = [
    priceLine,
    `[${sentimentLabel}] ${insight.analysis.summary || ''}`,
    insight.analysis.riskFactors?.[0] ? `⚠ ${insight.analysis.riskFactors[0]}` : null,
    '※ 투자 자문 아님, 참고용',
  ].filter(Boolean).join('\n');

  return {
    title: `[종합시세] ${insight.name}(${insight.code}) AI 참고 자료`,
    body,
  };
}

module.exports = {
  id: 'totalprice-alert-runner',
  name: '종목 AI 참고자료 알림 발송',
  schedule: '*/10 * * * *', // 10분마다
  description: '사용자가 등록한 totalprice AI 알림 예약(종목/주기/시간/알림채널)을 확인해 시각이 된 항목을 발송합니다.',
  // 알림 등록 API(projects/totalprice/index.js)가 "생성 시점에 이미 지난 시각으로 예약된
  // 알림이 다음 tick에 바로 발송되는" 것을 막기 위해 재사용 — isDue()로 즉시 발송 대상인지
  // 미리 판별해 last_run_bucket을 선점시킨다.
  nowInKst,
  currentBucket,
  isDue,
  ALERT_CATEGORY_KEY,
  run: async (pool) => {
    const kst = nowInKst();
    const { rows: alerts } = await pool.query(`SELECT * FROM totalprice_alerts WHERE is_active = TRUE`);

    const due = alerts.filter(a => isDue(a, kst));
    if (due.length === 0) return '발송 대상 없음';

    let sent = 0;
    let failed = 0;

    for (const alert of due) {
      const bucket = currentBucket(alert.frequency, kst);
      try {
        const insight = await insightService.getInsight(alert.code);
        const { rows: userRows } = await pool.query('SELECT name FROM platform_users WHERE id = $1', [alert.user_id]);
        const recipient = await notifyDb.getOrCreateRecipientForUser(alert.user_id, userRows[0]?.name || alert.user_id);

        const { title, body } = buildMessage(insight);
        const categoryId = await ensureAlertCategoryId();
        await notify.sendTest({ recipientId: recipient.id, channel: alert.notify_channel, title, body, categoryId });

        await markResult(pool, alert, bucket, 'success', null);
        sent++;
      } catch (e) {
        console.error(`[totalprice-alert-runner] alert #${alert.id} 실패:`, e.message);
        await markResult(pool, alert, bucket, 'error', e.message).catch(() => {});
        failed++;
      }
    }

    return `${due.length}건 대상, 발송 ${sent}건, 실패 ${failed}건`;
  },
};

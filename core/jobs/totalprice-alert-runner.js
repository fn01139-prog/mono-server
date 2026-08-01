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
  const priceLine = s
    ? `현재가 ${s.price?.toLocaleString('ko-KR')}원 (${s.changePct >= 0 ? '+' : ''}${s.changePct}%)`
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
        await notify.sendTest({ recipientId: recipient.id, channel: alert.notify_channel, title, body });

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
